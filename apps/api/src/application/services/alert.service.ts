import { Inject, Injectable } from '@nestjs/common';

import type {
  AddManagerNoteRequest,
  ChangePriorityRequest,
  AlertQuery,
  RecordLocationRequest,
  ResolveAlertRequest,
} from '@agricore/contracts';
import {
  type Clock,
  DomainErrors,
  type DomainError,
  type GeoPoint,
  type AlertStatus,
  type Page,
  type Result,
  UserRole,
  collect,
  createGeoPoint,
  err,
  normaliseLimit,
  ok,
} from '@agricore/shared-types';

import {
  addManagerNote,
  changePriority,
  claim,
  recordLocation,
  release,
  resolve,
  type AlertState,
} from '../../domain/alert/alert';
import type { StoredAlertEvent } from '../../domain/alert/alert-events';
import { PORTS } from '../tokens';
import type {
  AlertRepository,
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
 * Everything an authenticated caller can do to an alert after it exists.
 *
 * Authorisation is enforced here, in the service, not only in the HTTP guard. The guard
 * knows whether you are logged in and what role you hold; only this layer knows whether
 * this particular alert is yours. Route-level checks alone are how "any logged-in
 * user can read any alert by guessing an id" happens, so the ownership predicate
 * lives in one place and every read and write goes through it.
 */
@Injectable()
export class AlertService {
  constructor(
    @Inject(PORTS.AlertRepository) private readonly alerts: AlertRepository,
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
   * A subject may see their own alerts. Managers and admins may see any alert,
   * because that is the job. Anyone else gets a not-found rather than a forbidden, so a
   * caller cannot use the error to confirm that an alert id exists.
   */
  private authorise(state: AlertState, actor: Actor): DomainError | null {
    if (actor.role === UserRole.Manager || actor.role === UserRole.Admin) return null;
    if (state.userId === actor.userId) return null;
    return DomainErrors.notFound('Alert');
  }

  private async load(alertId: string, actor: Actor): Promise<Result<AlertState, DomainError>> {
    const state = await this.alerts.findById(alertId);
    if (state === null) return err(DomainErrors.notFound('Alert'));
    const denied = this.authorise(state, actor);
    if (denied) return err(denied);
    return ok(state);
  }

  async get(alertId: string, actor: Actor): Promise<Result<AlertState, DomainError>> {
    return this.load(alertId, actor);
  }

  async timeline(
    alertId: string,
    actor: Actor,
    afterSequence = 0,
    limit = 500,
  ): Promise<Result<{ alert: AlertState; events: StoredAlertEvent[]; latestSequence: number }, DomainError>> {
    const loaded = await this.load(alertId, actor);
    if (!loaded.ok) return loaded;

    const events = await this.alerts.listEvents(alertId, afterSequence, limit);
    const latestSequence = await this.alerts.latestSequence(alertId);
    return ok({ alert: loaded.value, events, latestSequence });
  }

  async list(actor: Actor, query: AlertQuery): Promise<Page<AlertState>> {
    const isStaff = actor.role === UserRole.Manager || actor.role === UserRole.Admin;

    return this.alerts.query(
      {
        status: query.status as AlertStatus | undefined,
        priority: query.priority,
        claimed: query.claimed,
        managerId: actor.userId,
        // A plain user's list is scoped to themselves at the repository level, so there
        // is no route that can accidentally return someone else's alerts.
        userId: isStaff ? undefined : actor.userId,
        search: isStaff ? query.search : undefined,
      },
      { limit: normaliseLimit(query.limit), cursor: query.cursor },
    );
  }

  /**
   * Location updates from the subject's device.
   *
   * Only the subject may post location, and only while the alert is open. A manager
   * cannot inject a position, which keeps the track trustworthy: every point on the map
   * came from the device that was there.
   */
  async recordLocation(
    alertId: string,
    actor: Actor,
    input: RecordLocationRequest,
  ): Promise<Result<{ accepted: number; rejected: number; latestSequence: number }, DomainError>> {
    const state = await this.alerts.findById(alertId);
    if (state === null) return err(DomainErrors.notFound('Alert'));

    if (state.userId !== actor.userId) {
      return err(DomainErrors.forbidden('Only the subject of an alert can share location.'));
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

    const saved = await this.alerts.save({
      state: transition.value.state,
      events: transition.value.events,
      expectedVersion: state.version,
    });
    if (!saved.ok) return saved;

    // Telemetry is written after the transactional record, and only if the user allows
    // precise history to be kept. Losing telemetry is survivable; losing the alert
    // timeline is not, so the ordering is deliberate.
    if (settings === null || settings.storePreciseLocationHistory) {
      await this.telemetry.append(alertId, actor.userId, points);
    }

    this.realtime.alertUpdated(saved.value.state, ['lastKnownLocation']);
    for (const event of saved.value.events) this.realtime.alertEventAppended(event);

    return ok({
      accepted: points.length,
      rejected: 0,
      latestSequence: saved.value.events.at(-1)?.sequence ?? state.version,
    });
  }

  async claim(
    alertId: string,
    actor: Actor,
    expectedVersion: number,
  ): Promise<Result<AlertState, DomainError>> {
    return this.mutateAsManager(alertId, actor, (state, now) =>
      claim({ state, managerId: actor.userId, expectedVersion, now }),
    );
  }

  async release(
    alertId: string,
    actor: Actor,
    expectedVersion: number,
  ): Promise<Result<AlertState, DomainError>> {
    return this.mutateAsManager(alertId, actor, (state, now) =>
      release({ state, managerId: actor.userId, expectedVersion, now }),
    );
  }

  async addNote(
    alertId: string,
    actor: Actor,
    input: AddManagerNoteRequest,
  ): Promise<Result<AlertState, DomainError>> {
    return this.mutateAsManager(alertId, actor, (state, now) =>
      addManagerNote({
        state,
        managerId: actor.userId,
        note: input.note,
        expectedVersion: input.expectedVersion,
        now,
      }),
    );
  }

  async changePriority(
    alertId: string,
    actor: Actor,
    input: ChangePriorityRequest,
  ): Promise<Result<AlertState, DomainError>> {
    return this.mutateAsManager(alertId, actor, (state, now) =>
      changePriority({
        state,
        managerId: actor.userId,
        priority: input.priority,
        reason: input.reason ?? null,
        expectedVersion: input.expectedVersion,
        now,
      }),
    );
  }

  /**
   * Resolution is open to the subject and to the claiming manager.
   *
   * The subject being able to close their own alert matters. Someone who is fine and
   * wants the alert to stop should not have to wait for a stranger to notice.
   */
  async resolve(
    alertId: string,
    actor: Actor,
    input: ResolveAlertRequest,
  ): Promise<Result<AlertState, DomainError>> {
    const loaded = await this.load(alertId, actor);
    if (!loaded.ok) return loaded;

    const state = loaded.value;
    const isSubject = state.userId === actor.userId;
    const isStaff = actor.role === UserRole.Manager || actor.role === UserRole.Admin;
    if (!isSubject && !isStaff) return err(DomainErrors.forbidden());

    const transition = resolve({
      state,
      actorId: actor.userId,
      actorType: isSubject ? 'user' : 'manager',
      resolution: input.resolution,
      note: input.note ?? null,
      expectedVersion: input.expectedVersion,
      now: this.clock.now(),
    });
    if (!transition.ok) return transition;

    return this.persist(state, transition.value, ['status', 'resolvedAt', 'resolution']);
  }

  private async mutateAsManager(
    alertId: string,
    actor: Actor,
    apply: (
      state: AlertState,
      now: Date,
    ) => Result<{ state: AlertState; events: readonly import('../../domain/alert/alert-events').PendingAlertEvent[] }, DomainError>,
  ): Promise<Result<AlertState, DomainError>> {
    if (actor.role !== UserRole.Manager && actor.role !== UserRole.Admin) {
      return err(DomainErrors.forbidden('This action is available to managers only.'));
    }

    const state = await this.alerts.findById(alertId);
    if (state === null) return err(DomainErrors.notFound('Alert'));

    const transition = apply(state, this.clock.now());
    if (!transition.ok) return transition;

    return this.persist(state, transition.value, ['claimedByManagerId', 'priority', 'status']);
  }

  private async persist(
    previous: AlertState,
    transition: {
      state: AlertState;
      events: readonly import('../../domain/alert/alert-events').PendingAlertEvent[];
    },
    changedFields: readonly string[],
  ): Promise<Result<AlertState, DomainError>> {
    const saved = await this.alerts.save({
      state: transition.state,
      events: transition.events,
      expectedVersion: previous.version,
    });
    if (!saved.ok) return saved;

    this.realtime.alertUpdated(saved.value.state, changedFields);
    for (const event of saved.value.events) this.realtime.alertEventAppended(event);

    const activeCount = await this.alerts.countByStatus('active');
    const unclaimedCount = await this.alerts.countUnclaimed(this.clock.now());
    this.realtime.queueChanged({ activeCount, unclaimedCount });

    this.logger.info('alert updated', {
      alertId: saved.value.state.id,
      version: saved.value.state.version,
      changedFields,
    });

    return ok(saved.value.state);
  }
}
