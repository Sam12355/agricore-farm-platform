import { Inject, Injectable } from '@nestjs/common';

import { DEMO_NOTICE_SHORT } from '@guardianlink/contracts';
import {
  type Clock,
  DeliveryStatus,
  IncidentEventType,
  NotificationChannel,
  type Result,
  err,
  minutes,
  ok,
  DomainErrors,
  type DomainError,
} from '@guardianlink/shared-types';

import { pendingEvent } from '../../domain/incident/incident-events';
import { OUTBOX_TOPIC_CONTACT_ALERT } from './sos.service';
import { PORTS } from '../tokens';
import type {
  IdGenerator,
  IncidentRepository,
  NotificationChannelAdapter,
  NotificationRecord,
  NotificationRepository,
  OutboxMessage,
  OutboxRepository,
  StructuredLogger,
  TokenService,
  TrustedContactRepository,
  UserRepository,
} from '../ports';

/** How long a contact has to acknowledge before the next one is brought in. */
export const ESCALATION_WINDOW_MS = minutes(3);
export const MAX_DELIVERY_ATTEMPTS = 5;

/**
 * Drains the outbox and turns messages into deliveries.
 *
 * Three things make this safe to run more than once, which matters because it will be:
 * a worker can crash after sending and before marking, a queue can deliver twice, and an
 * operator can replay a dead-lettered message by hand.
 *
 *   1. Every delivery has a dedupe key of incident plus contact. The consumer checks it
 *      before sending, so a replay is a no-op rather than a second message to a person
 *      who is already worried.
 *   2. Retries use exponential backoff with jitter, and the schedule is computed from an
 *      injected clock so the tests assert it without waiting.
 *   3. After the attempt budget the message is dead-lettered with its failure history
 *      intact, rather than dropped or retried forever.
 */
@Injectable()
export class NotificationDispatchService {
  constructor(
    @Inject(PORTS.OutboxRepository) private readonly outbox: OutboxRepository,
    @Inject(PORTS.NotificationRepository) private readonly notifications: NotificationRepository,
    @Inject(PORTS.TrustedContactRepository) private readonly contacts: TrustedContactRepository,
    @Inject(PORTS.IncidentRepository) private readonly incidents: IncidentRepository,
    @Inject(PORTS.UserRepository) private readonly users: UserRepository,
    @Inject(PORTS.TokenService) private readonly tokens: TokenService,
    @Inject(PORTS.NotificationChannels) private readonly channels: NotificationChannelAdapter[],
    @Inject(PORTS.IdGenerator) private readonly ids: IdGenerator,
    @Inject(PORTS.Clock) private readonly clock: Clock,
    @Inject(PORTS.Logger) private readonly logger: StructuredLogger,
  ) {}

  /** One pass over the outbox. Returns what it did, so the caller can log or assert it. */
  async drain(batchSize = 25): Promise<{ processed: number; failed: number; skipped: number }> {
    const now = this.clock.now();
    const batch = await this.outbox.claimBatch(batchSize, now);

    let processed = 0;
    let failed = 0;
    let skipped = 0;

    for (const message of batch) {
      const result = await this.handle(message);
      if (result.ok) {
        await this.outbox.markPublished(message.id, this.clock.now());
        if (result.value === 'sent') processed += 1;
        else skipped += 1;
      } else {
        failed += 1;
        const attempt = await this.recordFailure(message, result.error.message);
        this.logger.warn('outbox message failed', {
          outboxId: message.id,
          topic: message.topic,
          attempt,
          correlationId: message.correlationId,
        });
      }
    }

    return { processed, failed, skipped };
  }

  private async handle(message: OutboxMessage): Promise<Result<'sent' | 'deduplicated', DomainError>> {
    if (message.topic !== OUTBOX_TOPIC_CONTACT_ALERT) {
      return err(DomainErrors.validation(`Unknown outbox topic ${message.topic}.`));
    }

    const incidentId = String(message.payload['incidentId'] ?? '');
    const contactId = String(message.payload['contactId'] ?? '');
    const dedupeKey = message.dedupeKey ?? `${incidentId}:${contactId}`;

    const existing = await this.notifications.findByDedupeKey(dedupeKey);
    if (existing !== null && existing.status !== DeliveryStatus.Failed) {
      // Already delivered, or already in flight. This is the branch that makes a manual
      // replay of a dead-lettered message safe.
      return ok('deduplicated');
    }

    const incident = await this.incidents.findById(incidentId);
    if (incident === null) return err(DomainErrors.notFound('Incident'));

    const contact = await this.contacts.findById(contactId);
    if (contact === null) return err(DomainErrors.notFound('Trusted contact'));

    const subject = await this.users.findById(incident.userId);
    const subjectName = subject?.displayName.split(' ')[0] ?? 'Someone';

    const channel = this.chooseChannel(contact.preferredChannel, contact.email, contact.phone);
    if (channel === null) {
      return err(DomainErrors.validation('That contact has no reachable channel.'));
    }

    const adapter = this.channels.find((c) => c.channel === channel);
    if (adapter === undefined) {
      return err(DomainErrors.dependencyUnavailable(`${channel} channel`));
    }

    const now = this.clock.now();
    const viewToken = this.tokens.issueContactViewToken({
      incidentId,
      contactId,
      // The link outlives the incident by a margin so a contact who opens it later still
      // sees the outcome instead of a dead page.
      ttlSeconds: 24 * 60 * 60,
    });

    const record: NotificationRecord = existing ?? {
      id: this.ids.next(),
      incidentId,
      contactId,
      channel,
      status: DeliveryStatus.Pending,
      attempts: 0,
      lastError: null,
      dedupeKey,
      createdAt: now,
      updatedAt: now,
      acknowledgedAt: null,
    };

    await this.notifications.insert({ ...record, status: DeliveryStatus.Pending, updatedAt: now });

    const sent = await adapter.send({
      to: { name: contact.name, email: contact.email, phone: contact.phone },
      subject: `${subjectName} has raised a GuardianLink alert`,
      body: this.composeBody(subjectName, incident.activatedAt),
      linkUrl: `/contact-view/${viewToken}`,
      correlationId: message.correlationId,
    });

    if (!sent.ok) {
      await this.notifications.update({
        ...record,
        status: DeliveryStatus.Failed,
        attempts: record.attempts + 1,
        lastError: sent.error.message,
        updatedAt: this.clock.now(),
      });
      return err(sent.error);
    }

    await this.notifications.update({
      ...record,
      status: DeliveryStatus.Sent,
      attempts: record.attempts + 1,
      lastError: null,
      updatedAt: this.clock.now(),
    });

    // The timeline records that a contact was notified. It does not record the address
    // or number that was used; the operator does not need it and the audit trail is a
    // long-lived store.
    await this.incidents.save({
      state: incident,
      events: [
        pendingEvent(IncidentEventType.ContactNotified, 'system', null, this.clock.now(), {
          contactId,
          channel,
        }),
      ],
      expectedVersion: incident.version,
    });

    return ok('sent');
  }

  private composeBody(subjectName: string, activatedAt: Date): string {
    return [
      `${subjectName} raised a GuardianLink alert at ${activatedAt.toISOString()}.`,
      '',
      'Open the link below to see the latest status and let them know you have seen it.',
      '',
      DEMO_NOTICE_SHORT,
    ].join('\n');
  }

  private chooseChannel(
    preferred: 'email' | 'sms' | 'push' | 'any',
    email: string | null,
    phone: string | null,
  ): NotificationChannel | null {
    if (preferred === 'email' && email !== null) return NotificationChannel.Email;
    if (preferred === 'sms' && phone !== null) return NotificationChannel.Sms;
    if (preferred === 'push') return NotificationChannel.Push;
    // "any" prefers SMS: it arrives on a locked screen without an app installed, which
    // is the situation most trusted contacts are actually in.
    if (phone !== null) return NotificationChannel.Sms;
    if (email !== null) return NotificationChannel.Email;
    return null;
  }

  /**
   * Exponential backoff with full jitter.
   *
   * Without jitter, every message that failed during the same provider outage retries at
   * the same instant, and the recovering provider gets the whole backlog at once. Full
   * jitter spreads them across the window instead.
   */
  nextAttemptDelayMs(attempt: number, randomFraction: number): number {
    const base = 2_000;
    const capped = Math.min(base * 2 ** Math.max(0, attempt - 1), minutes(10));
    return Math.floor(capped * randomFraction);
  }

  private async recordFailure(message: OutboxMessage, error: string): Promise<number> {
    const now = this.clock.now();
    const dedupeKey = message.dedupeKey ?? message.id;
    const existing = await this.notifications.findByDedupeKey(dedupeKey);
    const attempts = (existing?.attempts ?? 0) + 1;

    if (attempts >= MAX_DELIVERY_ATTEMPTS) {
      if (existing !== null) {
        await this.notifications.update({
          ...existing,
          status: DeliveryStatus.DeadLettered,
          lastError: error,
          updatedAt: now,
        });
      }
      // No next attempt. The message stays in the outbox marked failed, with its history,
      // so an operator can inspect and replay it deliberately.
      await this.outbox.markFailed(message.id, error, now, null);
      this.logger.error('notification dead-lettered', {
        outboxId: message.id,
        attempts,
        correlationId: message.correlationId,
      });
      return attempts;
    }

    const delay = this.nextAttemptDelayMs(attempts, Math.random());
    await this.outbox.markFailed(message.id, error, now, new Date(now.getTime() + delay));
    return attempts;
  }

  /**
   * Brings in the next contact when the current one has not acknowledged in time.
   *
   * Runs on a schedule. Returns the escalations it performed so the job can log a real
   * number rather than "done".
   */
  async escalateStaleIncidents(limit = 50): Promise<{ escalated: number }> {
    const now = this.clock.now();
    const active = await this.incidents.query({ status: 'active' }, { limit });

    let escalated = 0;
    for (const incident of active.items) {
      if (incident.acknowledgedByContactId !== null) continue;
      if (now.getTime() - incident.activatedAt.getTime() < ESCALATION_WINDOW_MS) continue;

      const deliveries = await this.notifications.listForIncident(incident.id);
      const anyAcknowledged = deliveries.some((d) => d.acknowledgedAt !== null);
      if (anyAcknowledged) continue;

      const contacts = await this.contacts.listForUser(incident.userId);
      const alreadyTried = new Set(deliveries.map((d) => d.contactId));
      const next = contacts
        .slice()
        .sort((a, b) => a.priority - b.priority)
        .find((c) => !alreadyTried.has(c.id));

      if (next === undefined) continue;

      await this.notifications.insert({
        id: this.ids.next(),
        incidentId: incident.id,
        contactId: next.id,
        channel: NotificationChannel.Sms,
        status: DeliveryStatus.Pending,
        attempts: 0,
        lastError: null,
        dedupeKey: `${incident.id}:${next.id}`,
        createdAt: now,
        updatedAt: now,
        acknowledgedAt: null,
      });

      escalated += 1;
      this.logger.info('escalated to next contact', {
        incidentId: incident.id,
        contactId: next.id,
      });
    }

    return { escalated };
  }
}
