import type {
  AuditOutcome,
  DeliveryStatus,
  DomainError,
  GeoPoint,
  AlertPriority,
  AlertStatus,
  NotificationChannel,
  Page,
  PageRequest,
  Result,
  SubscriptionStatus,
  SubscriptionTier,
  UserRole,
} from '@agricore/shared-types';

import type { CountdownState } from '../../domain/alert/countdown';
import type { AlertState } from '../../domain/alert/alert';
import type {
  PendingAlertEvent,
  StoredAlertEvent,
} from '../../domain/alert/alert-events';

/**
 * Every dependency a use case has, expressed as an interface it owns.
 *
 * The rule is that nothing in application/ or domain/ imports from infrastructure/. The
 * arrows only point inward. That is what lets the entire test suite run against
 * in-memory adapters with no Postgres, no Redis, no Mongo and no AWS, and it is also
 * what made swapping SQS for an in-process worker a configuration change rather than a
 * rewrite.
 */

// Identity --------------------------------------------------------------------

export interface UserRecord {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly role: UserRole;
  readonly createdAt: Date;
  readonly deletedAt: Date | null;
  readonly deletionScheduledFor: Date | null;
}

export interface UserRepository {
  findById(id: string): Promise<UserRecord | null>;
  findByEmail(email: string): Promise<UserRecord | null>;
  insert(user: UserRecord): Promise<Result<UserRecord, DomainError>>;
  update(user: UserRecord): Promise<void>;
  /** Overwrites personal fields in place. Used by the deletion workflow. */
  anonymise(id: string, at: Date): Promise<void>;
}

export interface RefreshTokenRecord {
  readonly id: string;
  readonly userId: string;
  /** Token family, so reuse detection can revoke every descendant at once. */
  readonly familyId: string;
  readonly tokenHash: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly deviceName: string | null;
}

export interface RefreshTokenRepository {
  findByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  insert(record: RefreshTokenRecord): Promise<void>;
  markUsed(id: string, at: Date): Promise<void>;
  revokeFamily(familyId: string, at: Date): Promise<number>;
  revokeAllForUser(userId: string, at: Date): Promise<number>;
}

// Assigned workers ------------------------------------------------------------

export interface WorkerRecord {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly jobRole: string | null;
  readonly priority: number;
  readonly preferredChannel: 'email' | 'sms' | 'push' | 'any';
  readonly canViewLiveLocation: boolean;
  readonly verifiedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

export interface WorkerRepository {
  findById(id: string): Promise<WorkerRecord | null>;
  listForUser(userId: string): Promise<WorkerRecord[]>;
  countForUser(userId: string): Promise<number>;
  insert(record: WorkerRecord): Promise<void>;
  update(record: WorkerRecord): Promise<void>;
  softDelete(id: string, at: Date): Promise<void>;
  deleteAllForUser(userId: string): Promise<void>;
}

// Field operations and countdowns ----------------------------------------------

export interface FieldOperationRecord {
  readonly id: string;
  readonly userId: string;
  readonly status: 'active' | 'completed' | 'expired' | 'escalated';
  readonly startedAt: Date;
  readonly expectedEndAt: Date;
  readonly endedAt: Date | null;
  readonly note: string | null;
  readonly destinationLabel: string | null;
  readonly shareLiveLocation: boolean;
}

export interface FieldOperationRepository {
  findById(id: string): Promise<FieldOperationRecord | null>;
  findActiveForUser(userId: string): Promise<FieldOperationRecord | null>;
  listForUser(userId: string, page: PageRequest): Promise<Page<FieldOperationRecord>>;
  insert(record: FieldOperationRecord): Promise<void>;
  update(record: FieldOperationRecord): Promise<void>;
  findOverdue(now: Date, limit: number): Promise<FieldOperationRecord[]>;
  deleteAllForUser(userId: string): Promise<void>;
}

export interface CountdownRepository {
  findById(id: string): Promise<CountdownState | null>;
  insert(state: CountdownState): Promise<void>;
  update(state: CountdownState): Promise<void>;
  deleteAllForUser(userId: string): Promise<void>;
}

// Alerts -------------------------------------------------------------------

export interface AlertQueryFilter {
  readonly status?: AlertStatus | undefined;
  readonly priority?: AlertPriority | undefined;
  readonly claimed?: 'any' | 'mine' | 'unclaimed' | undefined;
  readonly managerId?: string | undefined;
  readonly userId?: string | undefined;
  readonly search?: string | undefined;
}

/**
 * The one write method that matters is `save`, which takes the new aggregate state, the
 * events it produced, and the version the caller believed it was updating. The adapter
 * performs the version check and the event append in a single transaction. Splitting
 * those into two calls would open a window where an alert advances without its
 * timeline entry, and that is precisely the thing that makes an audit trail worthless.
 */
export interface AlertRepository {
  findById(id: string): Promise<AlertState | null>;
  findByIdempotencyKey(userId: string, key: string): Promise<AlertState | null>;

  create(input: {
    state: AlertState;
    events: readonly PendingAlertEvent[];
    idempotencyKey: string | null;
    outbox: readonly OutboxMessage[];
  }): Promise<Result<{ state: AlertState; events: StoredAlertEvent[] }, DomainError>>;

  save(input: {
    state: AlertState;
    events: readonly PendingAlertEvent[];
    expectedVersion: number;
    outbox?: readonly OutboxMessage[];
  }): Promise<Result<{ state: AlertState; events: StoredAlertEvent[] }, DomainError>>;

  listEvents(alertId: string, afterSequence: number, limit: number): Promise<StoredAlertEvent[]>;
  latestSequence(alertId: string): Promise<number>;
  query(filter: AlertQueryFilter, page: PageRequest): Promise<Page<AlertState>>;
  countByStatus(status: AlertStatus): Promise<number>;
  countUnclaimed(now: Date): Promise<number>;
  deleteAllForUser(userId: string): Promise<void>;
}

/**
 * Location telemetry. Backed by MongoDB in production with a TTL index, and by an array
 * in tests. Kept separate from AlertRepository because it is append-only,
 * high-volume, and nothing about an alert's legal state depends on reading it back.
 */
export interface LocationTelemetryRepository {
  append(alertId: string, userId: string, points: readonly GeoPoint[]): Promise<void>;
  listForAlert(alertId: string, limit: number): Promise<GeoPoint[]>;
  deleteForUser(userId: string): Promise<void>;
  deleteOlderThan(cutoff: Date): Promise<number>;
}

// Outbox and notifications ----------------------------------------------------

export interface OutboxMessage {
  readonly id: string;
  readonly topic: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
  readonly correlationId: string;
  /** Set for messages that must not be delivered twice, such as worker alerts. */
  readonly dedupeKey: string | null;
}

export interface OutboxRepository {
  /** Claims a batch for this worker. Implementations use SKIP LOCKED semantics. */
  claimBatch(limit: number, now: Date): Promise<OutboxMessage[]>;
  markPublished(id: string, at: Date): Promise<void>;
  markFailed(id: string, error: string, at: Date, nextAttemptAt: Date | null): Promise<void>;
  pendingCount(): Promise<number>;
}

export interface NotificationRecord {
  readonly id: string;
  readonly alertId: string;
  readonly workerId: string;
  readonly channel: NotificationChannel;
  readonly status: DeliveryStatus;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly dedupeKey: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly acknowledgedAt: Date | null;
}

export interface NotificationRepository {
  findByDedupeKey(key: string): Promise<NotificationRecord | null>;
  listForAlert(alertId: string): Promise<NotificationRecord[]>;
  insert(record: NotificationRecord): Promise<void>;
  update(record: NotificationRecord): Promise<void>;
  deleteForUser(userId: string): Promise<void>;
}

export interface NotificationMessage {
  readonly to: { name: string; email: string | null; phone: string | null };
  readonly subject: string;
  readonly body: string;
  readonly linkUrl: string | null;
  readonly correlationId: string;
}

export interface NotificationChannelAdapter {
  readonly channel: NotificationChannel;
  send(message: NotificationMessage): Promise<Result<{ providerRef: string }, DomainError>>;
}

// Subscriptions ---------------------------------------------------------------

export interface SubscriptionRecord {
  readonly id: string;
  readonly userId: string;
  readonly tier: SubscriptionTier;
  readonly status: SubscriptionStatus;
  readonly platform: 'apple' | 'google' | 'none';
  readonly productId: string | null;
  readonly startedAt: Date | null;
  readonly expiresAt: Date | null;
  readonly autoRenewing: boolean;
  readonly originalTransactionId: string | null;
}

export interface SubscriptionRepository {
  findForUser(userId: string): Promise<SubscriptionRecord | null>;
  upsert(record: SubscriptionRecord): Promise<void>;
  deleteForUser(userId: string): Promise<void>;
}

export interface StoreReceiptVerifier {
  verify(input: {
    platform: 'apple' | 'google';
    productId: string;
    signedPayload: string;
  }): Promise<
    Result<
      {
        productId: string;
        expiresAt: Date | null;
        autoRenewing: boolean;
        originalTransactionId: string;
      },
      DomainError
    >
  >;
}

// Privacy ---------------------------------------------------------------------

export interface PrivacySettingsRecord {
  readonly userId: string;
  readonly shareLocationWithWorkers: boolean;
  readonly shareLocationWithManagers: boolean;
  readonly storePreciseLocationHistory: boolean;
  readonly alertRetentionDays: number;
  readonly locationRetentionDays: number;
  readonly notificationLogRetentionDays: number;
  readonly allowAnonymisedProductAnalytics: boolean;
  readonly updatedAt: Date;
}

export interface PrivacySettingsRepository {
  findForUser(userId: string): Promise<PrivacySettingsRecord | null>;
  upsert(record: PrivacySettingsRecord): Promise<void>;
  deleteForUser(userId: string): Promise<void>;
}

// Audit -----------------------------------------------------------------------

export interface AuditRecord {
  readonly id: string;
  readonly actorId: string | null;
  readonly actorRole: UserRole | 'anonymous';
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly outcome: AuditOutcome;
  readonly correlationId: string;
  readonly at: Date;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface AuditRepository {
  append(record: AuditRecord): Promise<void>;
  query(filter: { actorId?: string; resourceId?: string }, page: PageRequest): Promise<Page<AuditRecord>>;
}

// Idempotency -----------------------------------------------------------------

export interface IdempotencyRecord {
  readonly key: string;
  readonly subjectId: string;
  readonly route: string;
  readonly requestFingerprint: string;
  readonly statusCode: number;
  readonly responseBody: unknown;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface IdempotencyStore {
  find(key: string, subjectId: string, route: string): Promise<IdempotencyRecord | null>;
  save(record: IdempotencyRecord): Promise<void>;
  purgeExpired(now: Date): Promise<number>;
}

// Infrastructure services -----------------------------------------------------

export interface IdGenerator {
  next(): string;
}

export interface PasswordHasher {
  hash(plaintext: string): Promise<string>;
  verify(plaintext: string, hash: string): Promise<boolean>;
  /** True when the stored hash used weaker parameters and should be upgraded on login. */
  needsRehash(hash: string): boolean;
}

export interface AccessTokenPayload {
  readonly userId: string;
  readonly role: UserRole;
  readonly familyId: string;
}

export interface TokenService {
  issueAccessToken(payload: AccessTokenPayload): { token: string; expiresInSeconds: number };
  verifyAccessToken(token: string): Result<AccessTokenPayload, DomainError>;
  issueRefreshToken(): { token: string; hash: string; expiresInSeconds: number };
  hashRefreshToken(token: string): string;
  /** Signed, time-boxed, single-alert link for an assigned worker. */
  issueWorkerViewToken(input: { alertId: string; workerId: string; ttlSeconds: number }): string;
  verifyWorkerViewToken(token: string): Result<{ alertId: string; workerId: string }, DomainError>;
}

export interface RateLimiter {
  /** Returns how many requests remain, or a retry-after when the bucket is empty. */
  consume(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ allowed: true; remaining: number } | { allowed: false; retryAfterSeconds: number }>;
}

export interface DistributedLock {
  acquire(key: string, ttlMs: number): Promise<{ release: () => Promise<void> } | null>;
}

export interface RealtimePublisher {
  alertCreated(state: AlertState): void;
  alertUpdated(state: AlertState, changedFields: readonly string[]): void;
  alertEventAppended(event: StoredAlertEvent): void;
  queueChanged(counts: { activeCount: number; unclaimedCount: number }): void;
}

export interface StructuredLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): StructuredLogger;
}

export interface ObjectStore {
  put(key: string, body: string, contentType: string): Promise<{ url: string; sizeBytes: number }>;
  delete(key: string): Promise<void>;
}
