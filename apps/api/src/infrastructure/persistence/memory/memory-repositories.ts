import {
  type Clock,
  DomainErrors,
  SystemClock,
  type DomainError,
  type GeoPoint,
  type AlertStatus,
  type Page,
  type PageRequest,
  type Result,
  decodeCursor,
  encodeCursor,
  err,
  ok,
} from '@agricore/shared-types';

import type { CountdownState } from '../../../domain/alert/countdown';
import type { AlertState } from '../../../domain/alert/alert';
import type {
  PendingAlertEvent,
  StoredAlertEvent,
} from '../../../domain/alert/alert-events';
import type {
  AuditRecord,
  AuditRepository,
  CountdownRepository,
  IdempotencyRecord,
  IdempotencyStore,
  AlertQueryFilter,
  AlertRepository,
  LocationTelemetryRepository,
  NotificationRecord,
  NotificationRepository,
  OutboxMessage,
  OutboxRepository,
  PrivacySettingsRecord,
  PrivacySettingsRepository,
  RefreshTokenRecord,
  RefreshTokenRepository,
  FieldOperationRecord,
  FieldOperationRepository,
  SubscriptionRecord,
  SubscriptionRepository,
  WorkerRecord,
  WorkerRepository,
  UserRecord,
  UserRepository,
} from '../../../application/ports';

/**
 * In-memory adapters for every persistence port.
 *
 * These are not throwaway stubs. They implement the same guarantees the Postgres
 * adapters do, which is what makes them worth testing against:
 *
 *   - optimistic version checks, rejecting a stale write
 *   - atomic append of aggregate state plus its events plus its outbox rows
 *   - monotonic per-alert sequence allocation
 *   - unique idempotency keys
 *   - cursor pagination with a stable sort
 *
 * Node runs the request handler on one thread, so "transaction" here means the mutation
 * happens in a single synchronous block with the checks in front of it. That is enough to
 * reproduce the ordering the SQL adapter enforces with a transaction, and enough for the
 * concurrency tests to be meaningful.
 */

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryUserRepository implements UserRepository {
  private readonly byId = new Map<string, UserRecord>();
  private readonly byEmail = new Map<string, string>();

  async findById(id: string): Promise<UserRecord | null> {
    const found = this.byId.get(id);
    return found ? clone(found) : null;
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const id = this.byEmail.get(email.toLowerCase());
    return id ? this.findById(id) : null;
  }

  async insert(user: UserRecord): Promise<Result<UserRecord, DomainError>> {
    if (this.byEmail.has(user.email.toLowerCase())) {
      return err(DomainErrors.conflict('That email address cannot be registered.'));
    }
    this.byId.set(user.id, clone(user));
    this.byEmail.set(user.email.toLowerCase(), user.id);
    return ok(user);
  }

  async update(user: UserRecord): Promise<void> {
    const existing = this.byId.get(user.id);
    if (existing === undefined) return;
    if (existing.email !== user.email) {
      this.byEmail.delete(existing.email.toLowerCase());
      this.byEmail.set(user.email.toLowerCase(), user.id);
    }
    this.byId.set(user.id, clone(user));
  }

  async anonymise(id: string, at: Date): Promise<void> {
    const existing = this.byId.get(id);
    if (existing === undefined) return;
    this.byEmail.delete(existing.email.toLowerCase());
    // The row survives so audit records still resolve, with every personal field gone.
    this.byId.set(id, {
      ...existing,
      email: `deleted+${id}@invalid`,
      displayName: 'Deleted account',
      passwordHash: '',
      deletedAt: at,
      deletionScheduledFor: null,
    });
  }

  /** Test helper. Not part of the port. */
  all(): UserRecord[] {
    return [...this.byId.values()].map(clone);
  }
}

export class MemoryRefreshTokenRepository implements RefreshTokenRepository {
  private readonly records = new Map<string, RefreshTokenRecord>();

  async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    for (const record of this.records.values()) {
      if (record.tokenHash === tokenHash) return clone(record);
    }
    return null;
  }

  async insert(record: RefreshTokenRecord): Promise<void> {
    this.records.set(record.id, clone(record));
  }

  async markUsed(id: string, at: Date): Promise<void> {
    const record = this.records.get(id);
    if (record) this.records.set(id, { ...record, usedAt: at });
  }

  async revokeFamily(familyId: string, at: Date): Promise<number> {
    let count = 0;
    for (const [id, record] of this.records) {
      if (record.familyId === familyId && record.revokedAt === null) {
        this.records.set(id, { ...record, revokedAt: at });
        count += 1;
      }
    }
    return count;
  }

  async revokeAllForUser(userId: string, at: Date): Promise<number> {
    let count = 0;
    for (const [id, record] of this.records) {
      if (record.userId === userId && record.revokedAt === null) {
        this.records.set(id, { ...record, revokedAt: at });
        count += 1;
      }
    }
    return count;
  }
}

export class MemoryWorkerRepository implements WorkerRepository {
  private readonly records = new Map<string, WorkerRecord>();

  async findById(id: string): Promise<WorkerRecord | null> {
    const found = this.records.get(id);
    return found ? clone(found) : null;
  }

  async listForUser(userId: string): Promise<WorkerRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.userId === userId && record.deletedAt === null)
      .map(clone);
  }

  async countForUser(userId: string): Promise<number> {
    return (await this.listForUser(userId)).length;
  }

  async insert(record: WorkerRecord): Promise<void> {
    this.records.set(record.id, clone(record));
  }

  async update(record: WorkerRecord): Promise<void> {
    this.records.set(record.id, clone(record));
  }

  async softDelete(id: string, at: Date): Promise<void> {
    const record = this.records.get(id);
    if (record) this.records.set(id, { ...record, deletedAt: at });
  }

  async deleteAllForUser(userId: string): Promise<void> {
    for (const [id, record] of this.records) {
      if (record.userId === userId) this.records.delete(id);
    }
  }
}

export class MemoryFieldOperationRepository implements FieldOperationRepository {
  private readonly records = new Map<string, FieldOperationRecord>();

  async findById(id: string): Promise<FieldOperationRecord | null> {
    const found = this.records.get(id);
    return found ? clone(found) : null;
  }

  async findActiveForUser(userId: string): Promise<FieldOperationRecord | null> {
    for (const record of this.records.values()) {
      if (record.userId === userId && record.status === 'active') return clone(record);
    }
    return null;
  }

  async listForUser(userId: string, page: PageRequest): Promise<Page<FieldOperationRecord>> {
    const all = [...this.records.values()]
      .filter((record) => record.userId === userId)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime() || b.id.localeCompare(a.id));
    return paginate(all, page, (record) => ({
      sortValue: record.startedAt.toISOString(),
      id: record.id,
    }));
  }

  async insert(record: FieldOperationRecord): Promise<void> {
    this.records.set(record.id, clone(record));
  }

  async update(record: FieldOperationRecord): Promise<void> {
    this.records.set(record.id, clone(record));
  }

  async findOverdue(now: Date, limit: number): Promise<FieldOperationRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.status === 'active' && record.expectedEndAt.getTime() <= now.getTime())
      .slice(0, limit)
      .map(clone);
  }

  async deleteAllForUser(userId: string): Promise<void> {
    for (const [id, record] of this.records) {
      if (record.userId === userId) this.records.delete(id);
    }
  }
}

export class MemoryCountdownRepository implements CountdownRepository {
  private readonly records = new Map<string, CountdownState>();

  async findById(id: string): Promise<CountdownState | null> {
    const found = this.records.get(id);
    return found ? clone(found) : null;
  }

  async insert(state: CountdownState): Promise<void> {
    this.records.set(state.id, clone(state));
  }

  async update(state: CountdownState): Promise<void> {
    this.records.set(state.id, clone(state));
  }

  async deleteAllForUser(userId: string): Promise<void> {
    for (const [id, record] of this.records) {
      if (record.userId === userId) this.records.delete(id);
    }
  }
}

export class MemoryAlertRepository implements AlertRepository {
  private readonly alerts = new Map<string, AlertState>();
  private readonly events = new Map<string, StoredAlertEvent[]>();
  private readonly idempotency = new Map<string, string>();
  private eventIdCounter = 0;

  constructor(private readonly outbox?: MemoryOutboxRepository) {}

  async findById(id: string): Promise<AlertState | null> {
    const found = this.alerts.get(id);
    return found ? clone(found) : null;
  }

  async findByIdempotencyKey(userId: string, key: string): Promise<AlertState | null> {
    const alertId = this.idempotency.get(`${userId}:${key}`);
    return alertId ? this.findById(alertId) : null;
  }

  /**
   * Creation is the one place where three different things have to land together: the
   * alert, its opening timeline events, and the outbox rows that become worker
   * notifications. The SQL adapter wraps them in a transaction. Here the equivalent is
   * that the whole block runs without an await between the check and the writes.
   */
  async create(input: {
    state: AlertState;
    events: readonly PendingAlertEvent[];
    idempotencyKey: string | null;
    outbox: readonly OutboxMessage[];
  }): Promise<Result<{ state: AlertState; events: StoredAlertEvent[] }, DomainError>> {
    const key =
      input.idempotencyKey === null ? null : `${input.state.userId}:${input.idempotencyKey}`;

    if (key !== null && this.idempotency.has(key)) {
      return err(DomainErrors.conflict('That activation was already recorded.'));
    }

    this.alerts.set(input.state.id, clone(input.state));
    if (key !== null) this.idempotency.set(key, input.state.id);

    const stored = this.appendEvents(input.state.id, input.events);
    if (this.outbox) for (const message of input.outbox) this.outbox.enqueue(message);

    return ok({ state: clone(input.state), events: stored });
  }

  async save(input: {
    state: AlertState;
    events: readonly PendingAlertEvent[];
    expectedVersion: number;
    outbox?: readonly OutboxMessage[];
  }): Promise<Result<{ state: AlertState; events: StoredAlertEvent[] }, DomainError>> {
    const current = this.alerts.get(input.state.id);
    if (current === undefined) return err(DomainErrors.notFound('Alert'));

    // The optimistic check. In SQL this is UPDATE ... WHERE id = $1 AND version = $2 and
    // a zero row count means somebody else got there first.
    if (current.version !== input.expectedVersion) {
      return err(DomainErrors.staleVersion(input.expectedVersion, current.version));
    }

    this.alerts.set(input.state.id, clone(input.state));
    const stored = this.appendEvents(input.state.id, input.events);
    if (this.outbox && input.outbox) for (const message of input.outbox) this.outbox.enqueue(message);

    return ok({ state: clone(input.state), events: stored });
  }

  private appendEvents(
    alertId: string,
    pending: readonly PendingAlertEvent[],
  ): StoredAlertEvent[] {
    const existing = this.events.get(alertId) ?? [];
    const highest = existing.reduce((max, event) => Math.max(max, event.sequence), 0);

    // Sequence is allocated here, by the store, never by the aggregate. That is the
    // whole point: two concurrent writers cannot both decide they are number seven,
    // because only the store hands numbers out. Postgres does the same job with a
    // per-alert sequence column inside the transaction.
    const stored: StoredAlertEvent[] = pending.map((event, index) => {
      this.eventIdCounter += 1;
      return {
        ...event,
        id: `event-${this.eventIdCounter}`,
        alertId,
        sequence: highest + index + 1,
        recordedAt: new Date(),
      };
    });

    this.events.set(alertId, [...existing, ...stored]);
    return stored.map(clone);
  }

  async listEvents(
    alertId: string,
    afterSequence: number,
    limit: number,
  ): Promise<StoredAlertEvent[]> {
    return (this.events.get(alertId) ?? [])
      .filter((event) => event.sequence > afterSequence)
      .sort((a, b) => a.sequence - b.sequence)
      .slice(0, limit)
      .map(clone);
  }

  async latestSequence(alertId: string): Promise<number> {
    const events = this.events.get(alertId) ?? [];
    return events.length === 0 ? 0 : Math.max(...events.map((event) => event.sequence));
  }

  async query(filter: AlertQueryFilter, page: PageRequest): Promise<Page<AlertState>> {
    const now = new Date();
    const filtered = [...this.alerts.values()].filter((alert) => {
      if (filter.userId !== undefined && alert.userId !== filter.userId) return false;
      if (filter.status !== undefined && alert.status !== filter.status) return false;
      if (filter.priority !== undefined && alert.priority !== filter.priority) return false;

      if (filter.claimed === 'mine' && alert.claimedByManagerId !== filter.managerId) {
        return false;
      }
      if (filter.claimed === 'unclaimed') {
        const held =
          alert.claimedByManagerId !== null &&
          alert.claimExpiresAt !== null &&
          alert.claimExpiresAt.getTime() > now.getTime();
        if (held) return false;
      }
      if (filter.search !== undefined && filter.search.length > 0) {
        const haystack = `${alert.id} ${alert.userId} ${alert.trigger}`.toLowerCase();
        if (!haystack.includes(filter.search.toLowerCase())) return false;
      }
      return true;
    });

    // Newest first, with the id as a tiebreak so the order is total and the cursor
    // cannot land in the middle of a group of identical timestamps.
    filtered.sort(
      (a, b) => b.activatedAt.getTime() - a.activatedAt.getTime() || b.id.localeCompare(a.id),
    );

    return paginate(filtered, page, (alert) => ({
      sortValue: alert.activatedAt.toISOString(),
      id: alert.id,
    }));
  }

  async countByStatus(status: AlertStatus): Promise<number> {
    return [...this.alerts.values()].filter((alert) => alert.status === status).length;
  }

  async countUnclaimed(now: Date): Promise<number> {
    return [...this.alerts.values()].filter((alert) => {
      if (alert.status !== 'active') return false;
      if (alert.claimedByManagerId === null) return true;
      return alert.claimExpiresAt === null || alert.claimExpiresAt.getTime() <= now.getTime();
    }).length;
  }

  async deleteAllForUser(userId: string): Promise<void> {
    for (const [id, alert] of this.alerts) {
      if (alert.userId === userId) {
        this.alerts.delete(id);
        this.events.delete(id);
      }
    }
    for (const [key, alertId] of this.idempotency) {
      if (!this.alerts.has(alertId)) this.idempotency.delete(key);
    }
  }
}

export class MemoryLocationTelemetryRepository implements LocationTelemetryRepository {
  private readonly points = new Map<string, Array<GeoPoint & { userId: string }>>();

  async append(alertId: string, userId: string, points: readonly GeoPoint[]): Promise<void> {
    const existing = this.points.get(alertId) ?? [];
    this.points.set(alertId, [...existing, ...points.map((point) => ({ ...point, userId }))]);
  }

  async listForAlert(alertId: string, limit: number): Promise<GeoPoint[]> {
    return (this.points.get(alertId) ?? [])
      .slice()
      .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime())
      .slice(0, limit)
      .map(({ userId: _userId, ...point }) => clone(point));
  }

  async deleteForUser(userId: string): Promise<void> {
    for (const [alertId, points] of this.points) {
      const remaining = points.filter((point) => point.userId !== userId);
      if (remaining.length === 0) this.points.delete(alertId);
      else this.points.set(alertId, remaining);
    }
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    let removed = 0;
    for (const [alertId, points] of this.points) {
      const remaining = points.filter((point) => point.capturedAt.getTime() >= cutoff.getTime());
      removed += points.length - remaining.length;
      if (remaining.length === 0) this.points.delete(alertId);
      else this.points.set(alertId, remaining);
    }
    return removed;
  }
}

export class MemoryOutboxRepository implements OutboxRepository {
  private readonly messages = new Map<
    string,
    OutboxMessage & {
      publishedAt: Date | null;
      failedAt: Date | null;
      attempts: number;
      nextAttemptAt: Date | null;
      lastError: string | null;
      claimedAt: Date | null;
    }
  >();

  enqueue(message: OutboxMessage): void {
    this.messages.set(message.id, {
      ...clone(message),
      publishedAt: null,
      failedAt: null,
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
      claimedAt: null,
    });
  }

  /**
   * Mirrors SELECT ... FOR UPDATE SKIP LOCKED: a message already claimed by another
   * worker is passed over rather than blocking the batch.
   */
  async claimBatch(limit: number, now: Date): Promise<OutboxMessage[]> {
    const claimable = [...this.messages.values()]
      .filter((message) => message.publishedAt === null)
      .filter((message) => message.nextAttemptAt === null || message.nextAttemptAt <= now)
      .filter((message) => message.claimedAt === null || now.getTime() - message.claimedAt.getTime() > 30_000)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit);

    for (const message of claimable) {
      this.messages.set(message.id, { ...message, claimedAt: now });
    }

    return claimable.map(({ publishedAt: _p, failedAt: _f, attempts: _a, nextAttemptAt: _n, lastError: _l, claimedAt: _c, ...message }) =>
      clone(message),
    );
  }

  async markPublished(id: string, at: Date): Promise<void> {
    const message = this.messages.get(id);
    if (message) this.messages.set(id, { ...message, publishedAt: at, claimedAt: null });
  }

  async markFailed(id: string, error: string, at: Date, nextAttemptAt: Date | null): Promise<void> {
    const message = this.messages.get(id);
    if (message) {
      this.messages.set(id, {
        ...message,
        failedAt: at,
        attempts: message.attempts + 1,
        lastError: error,
        nextAttemptAt,
        claimedAt: null,
      });
    }
  }

  async pendingCount(): Promise<number> {
    return [...this.messages.values()].filter((message) => message.publishedAt === null).length;
  }

  /** Test helper: messages that ran out of attempts and are awaiting manual replay. */
  deadLettered(): OutboxMessage[] {
    return [...this.messages.values()]
      .filter((message) => message.publishedAt === null && message.nextAttemptAt === null && message.attempts > 0)
      .map(({ publishedAt: _p, failedAt: _f, attempts: _a, nextAttemptAt: _n, lastError: _l, claimedAt: _c, ...message }) =>
        clone(message),
      );
  }
}

export class MemoryNotificationRepository implements NotificationRepository {
  private readonly records = new Map<string, NotificationRecord>();

  async findByDedupeKey(key: string): Promise<NotificationRecord | null> {
    for (const record of this.records.values()) {
      if (record.dedupeKey === key) return clone(record);
    }
    return null;
  }

  async listForAlert(alertId: string): Promise<NotificationRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.alertId === alertId)
      .map(clone);
  }

  async insert(record: NotificationRecord): Promise<void> {
    this.records.set(record.id, clone(record));
  }

  async update(record: NotificationRecord): Promise<void> {
    this.records.set(record.id, clone(record));
  }

  async deleteForUser(): Promise<void> {
    // Notifications are keyed by alert; the alert sweep removes them in the SQL
    // adapter through a cascade. Kept here so the port stays honest.
    this.records.clear();
  }

  all(): NotificationRecord[] {
    return [...this.records.values()].map(clone);
  }
}

export class MemorySubscriptionRepository implements SubscriptionRepository {
  private readonly records = new Map<string, SubscriptionRecord>();

  async findForUser(userId: string): Promise<SubscriptionRecord | null> {
    const found = this.records.get(userId);
    return found ? clone(found) : null;
  }

  async upsert(record: SubscriptionRecord): Promise<void> {
    this.records.set(record.userId, clone(record));
  }

  async deleteForUser(userId: string): Promise<void> {
    this.records.delete(userId);
  }
}

export class MemoryPrivacySettingsRepository implements PrivacySettingsRepository {
  private readonly records = new Map<string, PrivacySettingsRecord>();

  async findForUser(userId: string): Promise<PrivacySettingsRecord | null> {
    const found = this.records.get(userId);
    return found ? clone(found) : null;
  }

  async upsert(record: PrivacySettingsRecord): Promise<void> {
    this.records.set(record.userId, clone(record));
  }

  async deleteForUser(userId: string): Promise<void> {
    this.records.delete(userId);
  }
}

export class MemoryAuditRepository implements AuditRepository {
  private readonly records: AuditRecord[] = [];

  async append(record: AuditRecord): Promise<void> {
    this.records.push(clone(record));
  }

  async query(
    filter: { actorId?: string; resourceId?: string },
    page: PageRequest,
  ): Promise<Page<AuditRecord>> {
    const filtered = this.records
      .filter((record) => filter.actorId === undefined || record.actorId === filter.actorId)
      .filter((record) => filter.resourceId === undefined || record.resourceId === filter.resourceId)
      .sort((a, b) => b.at.getTime() - a.at.getTime() || b.id.localeCompare(a.id));

    return paginate(filtered, page, (record) => ({
      sortValue: record.at.toISOString(),
      id: record.id,
    }));
  }

  all(): AuditRecord[] {
    return this.records.map(clone);
  }
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  /**
   * Takes a clock rather than calling Date.now().
   *
   * The first version called Date.now() here while the records were written with the
   * injected clock. Under a FixedClock set to a date in the past, every stored record
   * looked expired the instant it was written, so the duplicate-request test saw a
   * fresh 201 instead of a 409. Mixing two sources of time in one component is a bug
   * every time; this is just where it happened to bite.
   */
  constructor(private readonly clock: Clock = new SystemClock()) {}

  private key(key: string, subjectId: string, route: string): string {
    return `${subjectId}|${route}|${key}`;
  }

  async find(key: string, subjectId: string, route: string): Promise<IdempotencyRecord | null> {
    const found = this.records.get(this.key(key, subjectId, route));
    if (found === undefined) return null;
    if (found.expiresAt.getTime() <= this.clock.now().getTime()) {
      this.records.delete(this.key(key, subjectId, route));
      return null;
    }
    return clone(found);
  }

  async save(record: IdempotencyRecord): Promise<void> {
    this.records.set(this.key(record.key, record.subjectId, record.route), clone(record));
  }

  async purgeExpired(now: Date): Promise<number> {
    let removed = 0;
    for (const [key, record] of this.records) {
      if (record.expiresAt.getTime() <= now.getTime()) {
        this.records.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}

/**
 * Shared cursor pagination.
 *
 * The list is already sorted by the caller. The cursor names the last item that was
 * returned, so the next page starts strictly after it. Items inserted at the top between
 * two requests do not shift the window, which is the failure mode OFFSET has and the
 * reason the manager queue does not use it.
 */
function paginate<T>(
  sorted: readonly T[],
  page: PageRequest,
  keyOf: (item: T) => { sortValue: string; id: string },
): Page<T> {
  let startIndex = 0;

  if (page.cursor !== undefined) {
    const decoded = decodeCursor(page.cursor);
    if (decoded !== null) {
      const index = sorted.findIndex((item) => {
        const key = keyOf(item);
        return key.sortValue === decoded.sortValue && key.id === decoded.id;
      });
      startIndex = index >= 0 ? index + 1 : 0;
    }
  }

  const slice = sorted.slice(startIndex, startIndex + page.limit).map(clone);
  const hasMore = startIndex + page.limit < sorted.length;
  const last = slice.at(-1);

  return {
    items: slice,
    nextCursor: hasMore && last !== undefined ? encodeCursor(keyOf(last)) : null,
    hasMore,
  };
}
