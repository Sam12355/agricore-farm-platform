import { Inject, Injectable } from '@nestjs/common';

import type { ActivateIncidentRequest, StartCountdownRequest } from '@guardianlink/contracts';
import {
  type Clock,
  DomainErrors,
  type DomainError,
  type GeoPoint,
  type Result,
  createGeoPoint,
  err,
  ok,
} from '@guardianlink/shared-types';

import {
  canActivate,
  cancel,
  markActivated,
  startCountdown,
  type CountdownState,
} from '../../domain/incident/countdown';
import { activate, type IncidentState } from '../../domain/incident/incident';
import { PORTS } from '../tokens';
import type {
  CountdownRepository,
  IdGenerator,
  IncidentRepository,
  OutboxMessage,
  RealtimePublisher,
  SafetySessionRepository,
  StructuredLogger,
  TrustedContactRepository,
} from '../ports';

export const OUTBOX_TOPIC_CONTACT_ALERT = 'notification.contact_alert';

export interface ActivationContext {
  readonly userId: string;
  readonly correlationId: string;
  /** From the Idempotency-Key header, or from the countdown that produced it. */
  readonly idempotencyKey: string;
}

/**
 * The SOS path: countdown, cancellation, activation.
 *
 * This is the part of the product where being wrong has a real cost in both directions,
 * so a few decisions are worth spelling out.
 *
 * Activation is idempotent on a key the device generates when the countdown starts. A
 * phone on a bad connection will retry, and it will sometimes retry after the response
 * was actually delivered but lost. Every one of those retries has to land on the same
 * incident. The alternative is a family receiving five alerts for one event.
 *
 * The incident row, its first timeline events, and the outbox rows that will become
 * contact notifications are written in a single transaction. If the notification work
 * cannot be recorded, the incident does not exist either. Half an incident is worse than
 * none, because the user believes help is coming.
 */
@Injectable()
export class SosService {
  constructor(
    @Inject(PORTS.CountdownRepository) private readonly countdowns: CountdownRepository,
    @Inject(PORTS.IncidentRepository) private readonly incidents: IncidentRepository,
    @Inject(PORTS.TrustedContactRepository) private readonly contacts: TrustedContactRepository,
    @Inject(PORTS.SafetySessionRepository) private readonly sessions: SafetySessionRepository,
    @Inject(PORTS.RealtimePublisher) private readonly realtime: RealtimePublisher,
    @Inject(PORTS.IdGenerator) private readonly ids: IdGenerator,
    @Inject(PORTS.Clock) private readonly clock: Clock,
    @Inject(PORTS.Logger) private readonly logger: StructuredLogger,
  ) {}

  async startCountdown(
    userId: string,
    input: StartCountdownRequest,
  ): Promise<Result<CountdownState, DomainError>> {
    if (input.sessionId !== undefined) {
      const session = await this.sessions.findById(input.sessionId);
      if (session === null || session.userId !== userId) {
        return err(DomainErrors.notFound('Safety session'));
      }
    }

    const state = startCountdown({
      id: this.ids.next(),
      userId,
      sessionId: input.sessionId ?? null,
      durationSeconds: input.durationSeconds,
      activationIdempotencyKey: input.activationIdempotencyKey,
      now: this.clock.now(),
    });

    await this.countdowns.insert(state);
    this.logger.info('countdown started', {
      countdownId: state.id,
      userId,
      durationSeconds: input.durationSeconds,
    });
    return ok(state);
  }

  async cancelCountdown(
    userId: string,
    countdownId: string,
    reason: string,
  ): Promise<Result<CountdownState, DomainError>> {
    const state = await this.countdowns.findById(countdownId);
    if (state === null) return err(DomainErrors.notFound('Countdown'));

    // Ownership is checked before anything else is revealed about the countdown.
    if (state.userId !== userId) return err(DomainErrors.forbidden());

    const cancelled = cancel(state, reason, this.clock.now());
    if (!cancelled.ok) return cancelled;

    await this.countdowns.update(cancelled.value);
    this.logger.info('countdown cancelled', { countdownId, userId, reason });
    return ok(cancelled.value);
  }

  /**
   * Turns a finished countdown into an incident.
   *
   * Ordering here matters. The idempotency check comes first, so a retry never even
   * reaches the countdown state machine. Then the countdown is checked for cancellation,
   * because a cancelled countdown must never produce an incident no matter how late the
   * activation arrives. Only then do we build the aggregate and write.
   */
  async activate(
    context: ActivationContext,
    input: ActivateIncidentRequest,
  ): Promise<Result<{ incident: IncidentState; deduplicated: boolean }, DomainError>> {
    const now = this.clock.now();

    const existing = await this.incidents.findByIdempotencyKey(context.userId, context.idempotencyKey);
    if (existing !== null) {
      this.logger.info('activation deduplicated', {
        incidentId: existing.id,
        userId: context.userId,
      });
      return ok({ incident: existing, deduplicated: true });
    }

    let countdown: CountdownState | null = null;
    if (input.countdownId !== undefined) {
      countdown = await this.countdowns.findById(input.countdownId);
      if (countdown === null) return err(DomainErrors.notFound('Countdown'));
      if (countdown.userId !== context.userId) return err(DomainErrors.forbidden());

      const allowed = canActivate(countdown);
      if (!allowed.ok) return allowed;
    }

    let sessionId: string | null = input.sessionId ?? countdown?.sessionId ?? null;
    if (sessionId !== null) {
      const session = await this.sessions.findById(sessionId);
      if (session === null || session.userId !== context.userId) sessionId = null;
    }

    const location = this.parseLocation(input);
    if (!location.ok) return location;

    /*
     * Occurrence time, in order of preference:
     *   1. what the client says, for an event it queued while offline
     *   2. when the countdown was due to expire
     *   3. now
     * The server time of arrival is never the answer, because a backlog flushed twenty
     * minutes late would otherwise look like it happened twenty minutes late.
     */
    const occurredAt = input.occurredAt
      ? new Date(input.occurredAt)
      : (countdown?.expiresAt ?? now);

    const transition = activate({
      id: this.ids.next(),
      userId: context.userId,
      sessionId,
      trigger: input.trigger,
      location: location.value,
      note: input.note ?? null,
      occurredAt,
      now,
    });

    const outbox = await this.buildContactAlerts(
      transition.state.id,
      context.userId,
      context.correlationId,
      now,
    );

    const created = await this.incidents.create({
      state: transition.state,
      events: transition.events,
      idempotencyKey: context.idempotencyKey,
      outbox,
    });

    if (!created.ok) {
      // A unique-violation on the idempotency key means a concurrent request won the
      // race. Read back what it created rather than reporting a conflict the caller
      // cannot do anything about.
      if (created.error.code === 'CONFLICT') {
        const raced = await this.incidents.findByIdempotencyKey(
          context.userId,
          context.idempotencyKey,
        );
        if (raced !== null) return ok({ incident: raced, deduplicated: true });
      }
      return created;
    }

    if (countdown !== null) {
      const activated = markActivated(countdown, created.value.state.id);
      if (activated.ok) await this.countdowns.update(activated.value);
    }

    this.realtime.incidentCreated(created.value.state);
    for (const event of created.value.events) this.realtime.incidentEventAppended(event);

    this.logger.info('incident activated', {
      incidentId: created.value.state.id,
      userId: context.userId,
      trigger: input.trigger,
      contactsQueued: outbox.length,
    });

    return ok({ incident: created.value.state, deduplicated: false });
  }

  private parseLocation(input: ActivateIncidentRequest): Result<GeoPoint | null, DomainError> {
    if (input.location === undefined) return ok(null);
    const point = createGeoPoint({
      latitude: input.location.latitude,
      longitude: input.location.longitude,
      accuracyMetres: input.location.accuracyMetres,
      capturedAt: new Date(input.location.capturedAt),
    });
    if (!point.ok) return point;
    return ok(point.value);
  }

  /**
   * One outbox message per trusted contact, ordered by priority.
   *
   * The dedupe key is incident plus contact. It is what stops a replayed outbox message
   * from producing a second text to the same person, and it is checked by the consumer
   * rather than here, because the consumer is the thing that can be replayed.
   */
  private async buildContactAlerts(
    incidentId: string,
    userId: string,
    correlationId: string,
    now: Date,
  ): Promise<OutboxMessage[]> {
    const contacts = await this.contacts.listForUser(userId);
    return contacts
      .slice()
      .sort((a, b) => a.priority - b.priority || a.createdAt.getTime() - b.createdAt.getTime())
      .map((contact) => ({
        id: this.ids.next(),
        topic: OUTBOX_TOPIC_CONTACT_ALERT,
        payload: {
          incidentId,
          contactId: contact.id,
          userId,
          priority: contact.priority,
        },
        createdAt: now,
        correlationId,
        dedupeKey: `${incidentId}:${contact.id}`,
      }));
  }
}
