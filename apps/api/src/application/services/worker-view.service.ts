import { Inject, Injectable } from '@nestjs/common';

import { DEMO_NOTICE_FULL, type WorkerAlertView } from '@agricore/contracts';
import {
  type Clock,
  DomainErrors,
  type DomainError,
  type Result,
  err,
  ok,
} from '@agricore/shared-types';

import { acknowledge } from '../../domain/alert/alert';
import { PORTS } from '../tokens';
import type {
  AlertRepository,
  NotificationRepository,
  PrivacySettingsRepository,
  RealtimePublisher,
  StructuredLogger,
  TokenService,
  WorkerRepository,
  UserRepository,
} from '../ports';

/**
 * What an assigned worker sees, and what they can do.
 *
 * There is no account here. A worker gets a link in a message and taps it, possibly at
 * five in the morning during harvest, possibly on someone else's phone. Asking them to register first
 * would make the feature useless.
 *
 * The trade-off is that the link is the credential, so it is scoped as tightly as I can
 * make it: signed, one alert, one worker, time-boxed, and it grants a read of a
 * trimmed projection plus exactly one write (acknowledge). It cannot list alerts, it
 * cannot read the subject's profile, and it stops working when the alert closes.
 */
@Injectable()
export class WorkerViewService {
  constructor(
    @Inject(PORTS.AlertRepository) private readonly alerts: AlertRepository,
    @Inject(PORTS.WorkerRepository) private readonly workers: WorkerRepository,
    @Inject(PORTS.NotificationRepository) private readonly notifications: NotificationRepository,
    @Inject(PORTS.PrivacySettingsRepository) private readonly privacy: PrivacySettingsRepository,
    @Inject(PORTS.UserRepository) private readonly users: UserRepository,
    @Inject(PORTS.TokenService) private readonly tokens: TokenService,
    @Inject(PORTS.RealtimePublisher) private readonly realtime: RealtimePublisher,
    @Inject(PORTS.Clock) private readonly clock: Clock,
    @Inject(PORTS.Logger) private readonly logger: StructuredLogger,
  ) {}

  async view(token: string): Promise<Result<WorkerAlertView, DomainError>> {
    const claims = this.tokens.verifyWorkerViewToken(token);
    if (!claims.ok) return claims;

    const alert = await this.alerts.findById(claims.value.alertId);
    if (alert === null) return err(DomainErrors.notFound('Alert'));

    const worker = await this.workers.findById(claims.value.workerId);
    if (worker === null || worker.userId !== alert.userId) {
      return err(DomainErrors.notFound('Alert'));
    }

    const subject = await this.users.findById(alert.userId);
    const settings = await this.privacy.findForUser(alert.userId);

    // Location is shown only if the subject allows worker sharing and this particular
    // worker is permitted to see it. Two independent switches, both must be on.
    const maySeeLocation =
      (settings?.shareLocationWithWorkers ?? true) && worker.canViewLiveLocation;

    const location =
      maySeeLocation && alert.lastKnownLocation !== null
        ? {
            latitude: alert.lastKnownLocation.latitude,
            longitude: alert.lastKnownLocation.longitude,
            accuracyMetres: alert.lastKnownLocation.accuracyMetres,
            capturedAt: alert.lastKnownLocation.capturedAt.toISOString(),
          }
        : null;

    return ok({
      alertId: alert.id,
      status: alert.status,
      // First name only. The worker already knows who this is, and the full record
      // does not need to travel in a link that might be forwarded.
      subjectDisplayName: subject?.displayName.split(' ')[0] ?? 'A AgriCore user',
      activatedAt: alert.activatedAt.toISOString(),
      lastKnownLocation: location,
      acknowledgedAt: alert.acknowledgedAt?.toISOString() ?? null,
      demoNotice: DEMO_NOTICE_FULL,
    });
  }

  async acknowledge(token: string, note: string | null): Promise<Result<WorkerAlertView, DomainError>> {
    const claims = this.tokens.verifyWorkerViewToken(token);
    if (!claims.ok) return claims;

    const alert = await this.alerts.findById(claims.value.alertId);
    if (alert === null) return err(DomainErrors.notFound('Alert'));

    const worker = await this.workers.findById(claims.value.workerId);
    if (worker === null || worker.userId !== alert.userId) {
      return err(DomainErrors.notFound('Alert'));
    }

    const now = this.clock.now();
    const transition = acknowledge({
      state: alert,
      workerId: worker.id,
      note,
      now,
    });
    if (!transition.ok) return transition;

    if (transition.value.events.length > 0) {
      const saved = await this.alerts.save({
        state: transition.value.state,
        events: transition.value.events,
        expectedVersion: alert.version,
      });
      if (!saved.ok) return saved;

      // Mark the delivery acknowledged so the escalation chain stops chasing this
      // worker. Without this the secondary would still be notified on schedule.
      const deliveries = await this.notifications.listForAlert(alert.id);
      for (const delivery of deliveries) {
        if (delivery.workerId === worker.id && delivery.acknowledgedAt === null) {
          await this.notifications.update({ ...delivery, acknowledgedAt: now, updatedAt: now });
        }
      }

      this.realtime.alertUpdated(saved.value.state, ['status', 'acknowledgedAt']);
      for (const event of saved.value.events) this.realtime.alertEventAppended(event);

      this.logger.info('worker acknowledged alert', {
        alertId: alert.id,
        workerId: worker.id,
      });
    }

    return this.view(token);
  }
}
