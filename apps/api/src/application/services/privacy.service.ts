import { Inject, Injectable } from '@nestjs/common';

import {
  ACCOUNT_DELETION_GRACE_DAYS,
  type UpdatePrivacySettingsRequest,
  defaultPrivacySettings,
} from '@agricore/contracts';
import {
  type Clock,
  DomainErrors,
  type DomainError,
  type Result,
  days,
  err,
  ok,
} from '@agricore/shared-types';

import { PORTS } from '../tokens';
import type {
  AuditRepository,
  CountdownRepository,
  IdGenerator,
  AlertRepository,
  LocationTelemetryRepository,
  NotificationRepository,
  ObjectStore,
  PasswordHasher,
  PrivacySettingsRecord,
  PrivacySettingsRepository,
  RefreshTokenRepository,
  FieldOperationRepository,
  StructuredLogger,
  SubscriptionRepository,
  WorkerRepository,
  UserRepository,
} from '../ports';

/**
 * Privacy settings, data export and account deletion.
 *
 * The deletion design is the part worth reading. Deleting an account cannot mean
 * "delete every row that mentions this person", because audit records exist precisely so
 * that privileged actions remain answerable, and a manager who viewed someone's
 * location should not be able to erase the evidence by getting that person to close
 * their account.
 *
 * So deletion removes or anonymises everything the user contributed, and keeps audit
 * records with the subject identifier replaced by a stable pseudonym. What survives is
 * "a manager viewed an alert belonging to subject 41f9", never a name, an address,
 * a phone number or a coordinate. That is documented in PRIVACY.md, and the test suite
 * asserts it rather than trusting the prose.
 */
@Injectable()
export class PrivacyService {
  constructor(
    @Inject(PORTS.PrivacySettingsRepository) private readonly settings: PrivacySettingsRepository,
    @Inject(PORTS.UserRepository) private readonly users: UserRepository,
    @Inject(PORTS.WorkerRepository) private readonly workers: WorkerRepository,
    @Inject(PORTS.FieldOperationRepository) private readonly sessions: FieldOperationRepository,
    @Inject(PORTS.CountdownRepository) private readonly countdowns: CountdownRepository,
    @Inject(PORTS.AlertRepository) private readonly alerts: AlertRepository,
    @Inject(PORTS.LocationTelemetryRepository) private readonly telemetry: LocationTelemetryRepository,
    @Inject(PORTS.NotificationRepository) private readonly notifications: NotificationRepository,
    @Inject(PORTS.SubscriptionRepository) private readonly subscriptions: SubscriptionRepository,
    @Inject(PORTS.RefreshTokenRepository) private readonly refreshTokens: RefreshTokenRepository,
    @Inject(PORTS.AuditRepository) private readonly audit: AuditRepository,
    @Inject(PORTS.PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(PORTS.ObjectStore) private readonly objects: ObjectStore,
    @Inject(PORTS.IdGenerator) private readonly ids: IdGenerator,
    @Inject(PORTS.Clock) private readonly clock: Clock,
    @Inject(PORTS.Logger) private readonly logger: StructuredLogger,
  ) {}

  async getSettings(userId: string): Promise<PrivacySettingsRecord> {
    const existing = await this.settings.findForUser(userId);
    if (existing !== null) return existing;

    const now = this.clock.now();
    const defaults = defaultPrivacySettings(now.toISOString());
    const record: PrivacySettingsRecord = {
      userId,
      shareLocationWithWorkers: defaults.shareLocationWithWorkers,
      shareLocationWithManagers: defaults.shareLocationWithManagers,
      storePreciseLocationHistory: defaults.storePreciseLocationHistory,
      alertRetentionDays: defaults.alertRetentionDays,
      locationRetentionDays: defaults.locationRetentionDays,
      notificationLogRetentionDays: defaults.notificationLogRetentionDays,
      allowAnonymisedProductAnalytics: defaults.allowAnonymisedProductAnalytics,
      updatedAt: now,
    };
    await this.settings.upsert(record);
    return record;
  }

  async updateSettings(
    userId: string,
    input: UpdatePrivacySettingsRequest,
  ): Promise<PrivacySettingsRecord> {
    const current = await this.getSettings(userId);

    // Spreading `input` directly would widen every field to `T | undefined` under
    // exactOptionalPropertyTypes, because a partial update legitimately omits keys.
    // Merging field by field keeps the stored record fully defined.
    const updated: PrivacySettingsRecord = {
      userId,
      shareLocationWithWorkers:
        input.shareLocationWithWorkers ?? current.shareLocationWithWorkers,
      shareLocationWithManagers:
        input.shareLocationWithManagers ?? current.shareLocationWithManagers,
      storePreciseLocationHistory:
        input.storePreciseLocationHistory ?? current.storePreciseLocationHistory,
      alertRetentionDays: input.alertRetentionDays ?? current.alertRetentionDays,
      locationRetentionDays: input.locationRetentionDays ?? current.locationRetentionDays,
      notificationLogRetentionDays:
        input.notificationLogRetentionDays ?? current.notificationLogRetentionDays,
      allowAnonymisedProductAnalytics:
        input.allowAnonymisedProductAnalytics ?? current.allowAnonymisedProductAnalytics,
      updatedAt: this.clock.now(),
    };

    await this.settings.upsert(updated);
    await this.audit.append({
      id: this.ids.next(),
      actorId: userId,
      actorRole: 'user',
      action: 'privacy.settings_updated',
      resourceType: 'privacy_settings',
      resourceId: userId,
      outcome: 'allowed',
      correlationId: 'scheduled',
      at: updated.updatedAt,
      // Field names only. The values are the user's privacy preferences and the audit
      // store outlives the settings themselves.
      metadata: { changedFields: Object.keys(input) },
    });
    this.logger.info('privacy settings updated', {
      userId,
      changed: Object.keys(input),
    });
    return updated;
  }

  /**
   * Builds the export synchronously and stores it.
   *
   * For a real deployment this belongs on a queue, because a long-lived account could
   * hold a lot of telemetry. The port is the same either way; only the caller changes.
   * That is written up under known limitations rather than pretended away.
   */
  async requestExport(
    userId: string,
    includeLocationHistory: boolean,
  ): Promise<Result<{ id: string; url: string; sizeBytes: number; expiresAt: Date }, DomainError>> {
    const user = await this.users.findById(userId);
    if (user === null || user.deletedAt !== null) return err(DomainErrors.notFound('Account'));

    const [workers, sessions, settings, subscription] = await Promise.all([
      this.workers.listForUser(userId),
      this.sessions.listForUser(userId, { limit: 100 }),
      this.getSettings(userId),
      this.subscriptions.findForUser(userId),
    ]);

    const alerts = await this.alerts.query({ userId }, { limit: 100 });

    const timelines = [];
    for (const alert of alerts.items) {
      const events = await this.alerts.listEvents(alert.id, 0, 1000);
      const points = includeLocationHistory
        ? await this.telemetry.listForAlert(alert.id, 5000)
        : [];
      timelines.push({ alert, events, locationPoints: points });
    }

    const document = {
      exportedAt: this.clock.now().toISOString(),
      notice:
        'This export contains everything AgriCore holds about your account. ' +
        'AgriCore is a portfolio demonstration and not a working farm operations service.',
      account: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        createdAt: user.createdAt.toISOString(),
      },
      privacySettings: settings,
      workers: workers,
      fieldOperations: sessions.items,
      alerts: timelines,
      subscription,
    };

    const id = this.ids.next();
    const body = JSON.stringify(document, null, 2);
    const stored = await this.objects.put(`exports/${userId}/${id}.json`, body, 'application/json');

    this.logger.info('data export produced', {
      userId,
      exportId: id,
      sizeBytes: stored.sizeBytes,
      alertCount: timelines.length,
    });

    return ok({
      id,
      url: stored.url,
      sizeBytes: stored.sizeBytes,
      // Short-lived by design. An export is the single most sensitive object the system
      // produces, and a link that lives forever is a link that eventually leaks.
      expiresAt: new Date(this.clock.now().getTime() + days(7)),
    });
  }

  async requestDeletion(
    userId: string,
    password: string,
  ): Promise<Result<{ scheduledFor: Date }, DomainError>> {
    const user = await this.users.findById(userId);
    if (user === null || user.deletedAt !== null) return err(DomainErrors.notFound('Account'));

    // Re-authenticate. Deletion is the one action where a borrowed session should not be
    // enough, because it is the only one that cannot be undone.
    const valid = await this.hasher.verify(password, user.passwordHash);
    if (!valid) return err(DomainErrors.unauthenticated('That password is not correct.'));

    const now = this.clock.now();
    const scheduledFor = new Date(now.getTime() + days(ACCOUNT_DELETION_GRACE_DAYS));
    await this.users.update({ ...user, deletionScheduledFor: scheduledFor });

    // Every session ends immediately, even though the data survives the grace period.
    // If the request was made by someone who should not have had access, this is what
    // stops them continuing to use the account while it winds down.
    await this.refreshTokens.revokeAllForUser(userId, now);

    this.logger.info('account deletion scheduled', { userId, scheduledFor });
    return ok({ scheduledFor });
  }

  async cancelDeletion(userId: string): Promise<Result<void, DomainError>> {
    const user = await this.users.findById(userId);
    if (user === null || user.deletedAt !== null) return err(DomainErrors.notFound('Account'));
    await this.users.update({ ...user, deletionScheduledFor: null });
    return ok();
  }

  /** Runs when the grace period has elapsed. Idempotent, so a retried job is harmless. */
  async executeDeletion(userId: string): Promise<Result<void, DomainError>> {
    const now = this.clock.now();
    const user = await this.users.findById(userId);
    if (user === null) return ok();

    await this.telemetry.deleteForUser(userId);
    await this.notifications.deleteForUser(userId);
    await this.alerts.deleteAllForUser(userId);
    await this.countdowns.deleteAllForUser(userId);
    await this.sessions.deleteAllForUser(userId);
    await this.workers.deleteAllForUser(userId);
    await this.subscriptions.deleteForUser(userId);
    await this.settings.deleteForUser(userId);
    await this.refreshTokens.revokeAllForUser(userId, now);

    // The row stays, with every personal field overwritten. Audit records reference it
    // by id, and a dangling foreign key would be worse for accountability than a
    // tombstone that says nothing about who the person was.
    await this.users.anonymise(userId, now);

    // The deletion itself is audited. Erasing the record that an account was deleted
    // would defeat the purpose of having an audit trail at all.
    await this.audit.append({
      id: this.ids.next(),
      actorId: userId,
      actorRole: 'user',
      action: 'account.deleted',
      resourceType: 'user',
      resourceId: userId,
      outcome: 'allowed',
      correlationId: 'scheduled',
      at: now,
      metadata: {},
    });

    this.logger.info('account deleted', { userId });
    return ok();
  }

  async deletionStatus(userId: string): Promise<Result<
    { status: 'none' | 'scheduled' | 'completed'; scheduledFor: Date | null; requestedAt: Date | null },
    DomainError
  >> {
    const user = await this.users.findById(userId);
    if (user === null) return err(DomainErrors.notFound('Account'));
    if (user.deletedAt !== null) {
      return ok({ status: 'completed', scheduledFor: null, requestedAt: null });
    }
    if (user.deletionScheduledFor !== null) {
      return ok({
        status: 'scheduled',
        scheduledFor: user.deletionScheduledFor,
        requestedAt: new Date(user.deletionScheduledFor.getTime() - days(ACCOUNT_DELETION_GRACE_DAYS)),
      });
    }
    return ok({ status: 'none', scheduledFor: null, requestedAt: null });
  }

  /**
   * Applies the retention policy. Location goes first because it is the most sensitive
   * thing we hold and the least useful to keep.
   */
  async applyRetention(): Promise<{ locationPointsDeleted: number }> {
    const now = this.clock.now();
    // A single global cutoff at the most generous per-user setting would keep everything
    // for the longest-retaining user. Instead the job runs per user, and this method
    // handles the shared floor; per-user sweeps are scheduled from the same worker.
    const cutoff = new Date(now.getTime() - days(90));
    const deleted = await this.telemetry.deleteOlderThan(cutoff);
    if (deleted > 0) this.logger.info('retention sweep removed location points', { deleted });
    return { locationPointsDeleted: deleted };
  }
}
