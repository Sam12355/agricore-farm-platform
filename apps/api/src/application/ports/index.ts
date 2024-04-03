import type {
  AuditOutcome,
  DeliveryStatus,
  DomainError,
  GeoPoint,
  IncidentPriority,
  IncidentStatus,
  NotificationChannel,
  Page,
  PageRequest,
  Result,
  SubscriptionStatus,
  SubscriptionTier,
  UserRole,
} from '@guardianlink/shared-types';

import type { CountdownState } from '../../domain/incident/countdown';
import type { IncidentState } from '../../domain/incident/incident';
import type {
  PendingIncidentEvent,
  StoredIncidentEvent,
} from '../../domain/incident/incident-events';

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

// Trusted contacts ------------------------------------------------------------

export interface TrustedContactRecord {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly relationship: string | null;
  readonly priority: number;
  readonly preferredChannel: 'email' | 'sms' | 'push' | 'any';
  readonly canViewLiveLocation: boolean;
  readonly verifiedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

export interface TrustedContactRepository {
  findById(id: string): Promise<TrustedContactRecord | null>;
  listForUser(userId: string): Promise<TrustedContactRecord[]>;
  countForUser(userId: string): Promise<number>;
  insert(record: TrustedContactRecord): Promise<void>;
  update(record: TrustedContactRecord): Promise<void>;
  softDelete(id: string, at: Date): Promise<void>;
  deleteAllForUser(userId: string): Promise<void>;
}

// Safety sessions and countdowns ----------------------------------------------

export interface SafetySessionRecord {
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

export interface SafetySessionRepository {
  findById(id: string): Promise<SafetySessionRecord | null>;
  findActiveForUser(userId: string): Promise<SafetySessionRecord | null>;
  listForUser(userId: string, page: PageRequest): Promise<Page<SafetySessionRecord>>;
  insert(record: SafetySessionRecord): Promise<void>;
  update(record: SafetySessionRecord): Promise<void>;
  findOverdue(now: Date, limit: number): Promise<SafetySessionRecord[]>;
  deleteAllForUser(userId: string): Promise<void>;
}

export interface CountdownRepository {
  findById(id: string): Promise<CountdownState | null>;
  insert(state: CountdownState): Promise<void>;
  update(state: CountdownState): Promise<void>;
  deleteAllForUser(userId: string): Promise<void>;
}

// Incidents -------------------------------------------------------------------

export interface IncidentQueryFilter {
  readonly status?: IncidentStatus | undefined;
  readonly priority?: IncidentPriority | undefined;
  readonly claimed?: 'any' | 'mine' | 'unclaimed' | undefined;
  readonly operatorId?: string | undefined;
  readonly userId?: string | undefined;
  readonly search?: string | undefined;
}

/**
 * The one write method that matters is `save`, which takes the new aggregate state, the
 * events it produced, and the version the caller believed it was updating. The adapter
 * performs the version check and the event append in a single transaction. Splitting
 * those into two calls would open a window where an incident advances without its
 * timeline entry, and that is precisely the thing that makes an audit trail worthless.
 */
export interface IncidentRepository {
  findById(id: string): Promise<IncidentState | null>;
  findByIdempotencyKey(userId: string, key: string): Promise<IncidentState | null>;

  create(input: {
    state: IncidentState;
    events: readonly PendingIncidentEvent[];
    idempotencyKey: string | null;
    outbox: readonly OutboxMessage[];
  }): Promise<Result<{ state: IncidentState; events: StoredIncidentEvent[] }, DomainError>>;

  save(input: {
    state: IncidentState;
    events: readonly PendingIncidentEvent[];
    expectedVersion: number;
    outbox?: readonly OutboxMessage[];
  }): Promise<Result<{ state: IncidentState; events: StoredIncidentEvent[] }, DomainError>>;

  listEvents(incidentId: string, afterSequence: number, limit: number): Promise<StoredIncidentEvent[]>;
  latestSequence(incidentId: string): Promise<number>;
  query(filter: IncidentQueryFilter, page: PageRequest): Promise<Page<IncidentState>>;
  countByStatus(status: IncidentStatus): Promise<number>;
  countUnclaimed(now: Date): Promise<number>;
  deleteAllForUser(userId: string): Promise<void>;
}

/**
 * Location telemetry. Backed by MongoDB in production with a TTL index, and by an array
 * in tests. Kept separate from IncidentRepository because it is append-only,
 * high-volume, and nothing about an incident's legal state depends on reading it back.
 */
export interface LocationTelemetryRepository {
  append(incidentId: string, userId: string, points: readonly GeoPoint[]): Promise<void>;
  listForIncident(incidentId: string, limit: number): Promise<GeoPoint[]>;
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
  /** Set for messages that must not be delivered twice, such as contact alerts. */
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
  readonly incidentId: string;
  readonly contactId: string;
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
  listForIncident(incidentId: string): Promise<NotificationRecord[]>;
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
  readonly shareLocationWithContacts: boolean;
  readonly shareLocationWithOperators: boolean;
  readonly storePreciseLocationHistory: boolean;
  readonly incidentRetentionDays: number;
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
  /** Signed, time-boxed, single-incident link for a trusted contact. */
  issueContactViewToken(input: { incidentId: string; contactId: string; ttlSeconds: number }): string;
  verifyContactViewToken(token: string): Result<{ incidentId: string; contactId: string }, DomainError>;
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
  incidentCreated(state: IncidentState): void;
  incidentUpdated(state: IncidentState, changedFields: readonly string[]): void;
  incidentEventAppended(event: StoredIncidentEvent): void;
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
