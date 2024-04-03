import { Inject, Injectable } from '@nestjs/common';

import type {
  AddOperatorNoteRequest,
  ChangePriorityRequest,
  IncidentQuery,
  RecordLocationRequest,
  ResolveIncidentRequest,
} from '@guardianlink/contracts';
import {
  type Clock,
  DomainErrors,
  type DomainError,
  type GeoPoint,
  type IncidentStatus,
  type Page,
  type Result,
  UserRole,
  collect,
  createGeoPoint,
  err,
  normaliseLimit,
  ok,
} from '@guardianlink/shared-types';

import {
  addOperatorNote,
  changePriority,
  claim,
  recordLocation,
  release,
  resolve,
  type IncidentState,
} from '../../domain/incident/incident';
import type { StoredIncidentEvent } from '../../domain/incident/incident-events';
import { PORTS } from '../tokens';
import type {
  IncidentRepository,
  LocationTelemetryRepository,
  PrivacySettingsRepository,
  RealtimePublisher,
  StructuredLogger,
} from '../ports';

export interface Actor {
  readonly userId: string;
  readonly role: UserRole;
}

/**
 * Everything an authenticated caller can do to an incident after it exists.
 *
 * Authorisation is enforced here, in the service, not only in the HTTP guard. The guard
 * knows whether you are logged in and what role you hold; only this layer knows whether
 * this particular incident is yours. Route-level checks alone are how "any logged-in
 * user can read any incident by guessing an id" happens, so the ownership predicate
 * lives in one place and every read and write goes through it.
 */
@Injectable()
export class IncidentService {
  constructor(
    @Inject(PORTS.IncidentRepository) private readonly incidents: IncidentRepository,
    @Inject(PORTS.LocationTelemetryRepository)
    private readonly telemetry: LocationTelemetryRepository,
    @Inject(PORTS.PrivacySettingsRepository) private readonly privacy: PrivacySettingsRepository,
    @Inject(PORTS.RealtimePublisher) private readonly realtime: RealtimePublisher,
    @Inject(PORTS.Clock) private readonly clock: Clock,
    @Inject(PORTS.Logger) private readonly logger: StructuredLogger,
  ) {}

  /**
   * The single ownership rule.
   *
   * A subject may see their own incidents. Operators and admins may see any incident,
   * because that is the job. Anyone else gets a not-found rather than a forbidden, so a
   * caller cannot use the error to confirm that an incident id exists.
   */
  private authorise(state: IncidentState, actor: Actor): DomainError | null {
    if (actor.role === UserRole.Operator || actor.role === UserRole.Admin) return null;
    if (state.userId === actor.userId) return null;
    return DomainErrors.notFound('Incident');
  }

  private async load(incidentId: string, actor: Actor): Promise<Result<IncidentState, DomainError>> {
    const state = await this.incidents.findById(incidentId);
    if (state === null) return err(DomainErrors.notFound('Incident'));
    const denied = this.authorise(state, actor);
    if (denied) return err(denied);
    return ok(state);
  }

  async get(incidentId: string, actor: Actor): Promise<Result<IncidentState, DomainError>> {
    return this.load(incidentId, actor);
  }

  async timeline(
    incidentId: string,
    actor: Actor,
    afterSequence = 0,
    limit = 500,
  ): Promise<Result<{ incident: IncidentState; events: StoredIncidentEvent[]; latestSequence: number }, DomainError>> {
    const loaded = await this.load(incidentId, actor);
    if (!loaded.ok) return loaded;

    const events = await this.incidents.listEvents(incidentId, afterSequence, limit);
    const latestSequence = await this.incidents.latestSequence(incidentId);
    return ok({ incident: loaded.value, events, latestSequence });
  }

  async list(actor: Actor, query: IncidentQuery): Promise<Page<IncidentState>> {
    const isStaff = actor.role === UserRole.Operator || actor.role === UserRole.Admin;

    return this.incidents.query(
      {
        status: query.status as IncidentStatus | undefined,
        priority: query.priority,
        claimed: query.claimed,
        operatorId: actor.userId,
        // A plain user's list is scoped to themselves at the repository level, so there
        // is no route that can accidentally return someone else's incidents.
        userId: isStaff ? undefined : actor.userId,
        search: isStaff ? query.search : undefined,
      },
      { limit: normaliseLimit(query.limit), cursor: query.cursor },
    );
  }

  /**
   * Location updates from the subject's device.
   *
   * Only the subject may post location, and only while the incident is open. An operator
   * cannot inject a position, which keeps the track trustworthy: every point on the map
   * came from the device that was there.
   */
  async recordLocation(
    incidentId: string,
    actor: Actor,
    input: RecordLocationRequest,
  ): Promise<Result<{ accepted: number; rejected: number; latestSequence: number }, DomainError>> {
    const state = await this.incidents.findById(incidentId);
    if (state === null) return err(DomainErrors.notFound('Incident'));

    if (state.userId !== actor.userId) {
      return err(DomainErrors.forbidden('Only the subject of an incident can share location.'));
    }

    const parsed = collect(
      input.points.map((point) =>
        createGeoPoint({
          latitude: point.latitude,
          longitude: point.longitude,
          accuracyMetres: point.accuracyMetres,
          capturedAt: new Date(point.capturedAt),
        }),
      ),
    );
    if (!parsed.ok) return parsed;

    const settings = await this.privacy.findForUser(actor.userId);
    const points: GeoPoint[] = parsed.value;

    const transition = recordLocation({
      state,
      actorId: actor.userId,
      points,
      now: this.clock.now(),
    });
    if (!transition.ok) return transition;

    const saved = await this.incidents.save({
      state: transition.value.state,
      events: transition.value.events,
      expectedVersion: state.version,
    });
    if (!saved.ok) return saved;

    // Telemetry is written after the transactional record, and only if the user allows
    // precise history to be kept. Losing telemetry is survivable; losing the incident
    // timeline is not, so the ordering is deliberate.
    if (settings === null || settings.storePreciseLocationHistory) {
      await this.telemetry.append(incidentId, actor.userId, points);
    }

    this.realtime.incidentUpdated(saved.value.state, ['lastKnownLocation']);
    for (const event of saved.value.events) this.realtime.incidentEventAppended(event);

    return ok({
      accepted: points.length,
      rejected: 0,
      latestSequence: saved.value.events.at(-1)?.sequence ?? state.version,
    });
  }

  async claim(
    incidentId: string,
    actor: Actor,
    expectedVersion: number,
  ): Promise<Result<IncidentState, DomainError>> {
    return this.mutateAsOperator(incidentId, actor, (state, now) =>
      claim({ state, operatorId: actor.userId, expectedVersion, now }),
    );
  }

  async release(
    incidentId: string,
    actor: Actor,
    expectedVersion: number,
  ): Promise<Result<IncidentState, DomainError>> {
    return this.mutateAsOperator(incidentId, actor, (state, now) =>
      release({ state, operatorId: actor.userId, expectedVersion, now }),
    );
  }

  async addNote(
    incidentId: string,
    actor: Actor,
    input: AddOperatorNoteRequest,
  ): Promise<Result<IncidentState, DomainError>> {
    return this.mutateAsOperator(incidentId, actor, (state, now) =>
      addOperatorNote({
        state,
        operatorId: actor.userId,
        note: input.note,
        expectedVersion: input.expectedVersion,
        now,
      }),
    );
  }

  async changePriority(
    incidentId: string,
    actor: Actor,
    input: ChangePriorityRequest,
  ): Promise<Result<IncidentState, DomainError>> {
    return this.mutateAsOperator(incidentId, actor, (state, now) =>
      changePriority({
        state,
        operatorId: actor.userId,
        priority: input.priority,
        reason: input.reason ?? null,
        expectedVersion: input.expectedVersion,
        now,
      }),
    );
  }

  /**
   * Resolution is open to the subject and to the claiming operator.
   *
   * The subject being able to close their own incident matters. Someone who is fine and
   * wants the alert to stop should not have to wait for a stranger to notice.
   */
  async resolve(
    incidentId: string,
    actor: Actor,
    input: ResolveIncidentRequest,
  ): Promise<Result<IncidentState, DomainError>> {
    const loaded = await this.load(incidentId, actor);
    if (!loaded.ok) return loaded;

    const state = loaded.value;
    const isSubject = state.userId === actor.userId;
    const isStaff = actor.role === UserRole.Operator || actor.role === UserRole.Admin;
    if (!isSubject && !isStaff) return err(DomainErrors.forbidden());

    const transition = resolve({
      state,
      actorId: actor.userId,
      actorType: isSubject ? 'user' : 'operator',
      resolution: input.resolution,
      note: input.note ?? null,
      expectedVersion: input.expectedVersion,
      now: this.clock.now(),
    });
    if (!transition.ok) return transition;

    return this.persist(state, transition.value, ['status', 'resolvedAt', 'resolution']);
  }

  private async mutateAsOperator(
    incidentId: string,
    actor: Actor,
    apply: (
      state: IncidentState,
      now: Date,
    ) => Result<{ state: IncidentState; events: readonly import('../../domain/incident/incident-events').PendingIncidentEvent[] }, DomainError>,
  ): Promise<Result<IncidentState, DomainError>> {
    if (actor.role !== UserRole.Operator && actor.role !== UserRole.Admin) {
      return err(DomainErrors.forbidden('This action is available to operators only.'));
    }

    const state = await this.incidents.findById(incidentId);
    if (state === null) return err(DomainErrors.notFound('Incident'));

    const transition = apply(state, this.clock.now());
    if (!transition.ok) return transition;

    return this.persist(state, transition.value, ['claimedByOperatorId', 'priority', 'status']);
  }

  private async persist(
    previous: IncidentState,
    transition: {
      state: IncidentState;
      events: readonly import('../../domain/incident/incident-events').PendingIncidentEvent[];
    },
    changedFields: readonly string[],
  ): Promise<Result<IncidentState, DomainError>> {
    const saved = await this.incidents.save({
      state: transition.state,
      events: transition.events,
      expectedVersion: previous.version,
    });
    if (!saved.ok) return saved;

    this.realtime.incidentUpdated(saved.value.state, changedFields);
    for (const event of saved.value.events) this.realtime.incidentEventAppended(event);

    const activeCount = await this.incidents.countByStatus('active');
    const unclaimedCount = await this.incidents.countUnclaimed(this.clock.now());
    this.realtime.queueChanged({ activeCount, unclaimedCount });

    this.logger.info('incident updated', {
      incidentId: saved.value.state.id,
      version: saved.value.state.version,
      changedFields,
    });

    return ok(saved.value.state);
  }
}
