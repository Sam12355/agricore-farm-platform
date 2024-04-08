import {
  type Clock,
  DomainErrors,
  SystemClock,
  type DomainError,
  type GeoPoint,
  type IncidentStatus,
  type Page,
  type PageRequest,
  type Result,
  decodeCursor,
  encodeCursor,
  err,
  ok,
} from '@guardianlink/shared-types';

import type { CountdownState } from '../../../domain/incident/countdown';
import type { IncidentState } from '../../../domain/incident/incident';
import type {
  PendingIncidentEvent,
  StoredIncidentEvent,
} from '../../../domain/incident/incident-events';
import type {
  AuditRecord,
  AuditRepository,
  CountdownRepository,
  IdempotencyRecord,
  IdempotencyStore,
  IncidentQueryFilter,
  IncidentRepository,
  LocationTelemetryRepository,
  NotificationRecord,
  NotificationRepository,
  OutboxMessage,
  OutboxRepository,
  PrivacySettingsRecord,
  PrivacySettingsRepository,
  RefreshTokenRecord,
  RefreshTokenRepository,
  SafetySessionRecord,
  SafetySessionRepository,
  SubscriptionRecord,
  SubscriptionRepository,
  TrustedContactRecord,
  TrustedContactRepository,
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
 *   - monotonic per-incident sequence allocation
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

export class MemoryTrustedContactRepository implements TrustedContactRepository {
  private readonly records = new Map<string, TrustedContactRecord>();

  async findById(id: string): Promise<TrustedContactRecord | null> {
    const found = this.records.get(id);
    return found ? clone(found) : null;
  }

  async listForUser(userId: string): Promise<TrustedContactRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.userId === userId && record.deletedAt === null)
      .map(clone);
  }

  async countForUser(userId: string): Promise<number> {
    return (await this.listForUser(userId)).length;
  }

  async insert(record: TrustedContactRecord): Promise<void> {
    this.records.set(record.id, clone(record));
  }

  async update(record: TrustedContactRecord): Promise<void> {
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

export class MemorySafetySessionRepository implements SafetySessionRepository {
  private readonly records = new Map<string, SafetySessionRecord>();

  async findById(id: string): Promise<SafetySessionRecord | null> {
    const found = this.records.get(id);
    return found ? clone(found) : null;
  }

  async findActiveForUser(userId: string): Promise<SafetySessionRecord | null> {
    for (const record of this.records.values()) {
      if (record.userId === userId && record.status === 'active') return clone(record);
    }
    return null;
  }

  async listForUser(userId: string, page: PageRequest): Promise<Page<SafetySessionRecord>> {
    const all = [...this.records.values()]
      .filter((record) => record.userId === userId)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime() || b.id.localeCompare(a.id));
    return paginate(all, page, (record) => ({
      sortValue: record.startedAt.toISOString(),
      id: record.id,
    }));
  }

  async insert(record: SafetySessionRecord): Promise<void> {
    this.records.set(record.id, clone(record));
  }

  async update(record: SafetySessionRecord): Promise<void> {
    this.records.set(record.id, clone(record));
  }

  async findOverdue(now: Date, limit: number): Promise<SafetySessionRecord[]> {
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

export class MemoryIncidentRepository implements IncidentRepository {
  private readonly incidents = new Map<string, IncidentState>();
  private readonly events = new Map<string, StoredIncidentEvent[]>();
  private readonly idempotency = new Map<string, string>();
  private eventIdCounter = 0;

  constructor(private readonly outbox?: MemoryOutboxRepository) {}

  async findById(id: string): Promise<IncidentState | null> {
    const found = this.incidents.get(id);
    return found ? clone(found) : null;
  }

  async findByIdempotencyKey(userId: string, key: string): Promise<IncidentState | null> {
    const incidentId = this.idempotency.get(`${userId}:${key}`);
    return incidentId ? this.findById(incidentId) : null;
  }

  /**
   * Creation is the one place where three different things have to land together: the
   * incident, its opening timeline events, and the outbox rows that become contact
   * notifications. The SQL adapter wraps them in a transaction. Here the equivalent is
   * that the whole block runs without an await between the check and the writes.
   */
  async create(input: {
    state: IncidentState;
    events: readonly PendingIncidentEvent[];
    idempotencyKey: string | null;
    outbox: readonly OutboxMessage[];
  }): Promise<Result<{ state: IncidentState; events: StoredIncidentEvent[] }, DomainError>> {
    const key =
      input.idempotencyKey === null ? null : `${input.state.userId}:${input.idempotencyKey}`;

    if (key !== null && this.idempotency.has(key)) {
      return err(DomainErrors.conflict('That activation was already recorded.'));
    }

    this.incidents.set(input.state.id, clone(input.state));
    if (key !== null) this.idempotency.set(key, input.state.id);

    const stored = this.appendEvents(input.state.id, input.events);
    if (this.outbox) for (const message of input.outbox) this.outbox.enqueue(message);

    return ok({ state: clone(input.state), events: stored });
  }

  async save(input: {
    state: IncidentState;
    events: readonly PendingIncidentEvent[];
    expectedVersion: number;
    outbox?: readonly OutboxMessage[];
  }): Promise<Result<{ state: IncidentState; events: StoredIncidentEvent[] }, DomainError>> {
    const current = this.incidents.get(input.state.id);
    if (current === undefined) return err(DomainErrors.notFound('Incident'));

    // The optimistic check. In SQL this is UPDATE ... WHERE id = $1 AND version = $2 and
    // a zero row count means somebody else got there first.
    if (current.version !== input.expectedVersion) {
      return err(DomainErrors.staleVersion(input.expectedVersion, current.version));
    }

    this.incidents.set(input.state.id, clone(input.state));
    const stored = this.appendEvents(input.state.id, input.events);
    if (this.outbox && input.outbox) for (const message of input.outbox) this.outbox.enqueue(message);

    return ok({ state: clone(input.state), events: stored });
  }

  private appendEvents(
    incidentId: string,
    pending: readonly PendingIncidentEvent[],
  ): StoredIncidentEvent[] {
    const existing = this.events.get(incidentId) ?? [];
    const highest = existing.reduce((max, event) => Math.max(max, event.sequence), 0);

    // Sequence is allocated here, by the store, never by the aggregate. That is the
    // whole point: two concurrent writers cannot both decide they are number seven,
    // because only the store hands numbers out. Postgres does the same job with a
    // per-incident sequence column inside the transaction.
    const stored: StoredIncidentEvent[] = pending.map((event, index) => {
      this.eventIdCounter += 1;
      return {
        ...event,
        id: `event-${this.eventIdCounter}`,
        incidentId,
        sequence: highest + index + 1,
        recordedAt: new Date(),
      };
    });

    this.events.set(incidentId, [...existing, ...stored]);
    return stored.map(clone);
  }

  async listEvents(
    incidentId: string,
    afterSequence: number,
    limit: number,
  ): Promise<StoredIncidentEvent[]> {
    return (this.events.get(incidentId) ?? [])
      .filter((event) => event.sequence > afterSequence)
      .sort((a, b) => a.sequence - b.sequence)
      .slice(0, limit)
      .map(clone);
  }

  async latestSequence(incidentId: string): Promise<number> {
    const events = this.events.get(incidentId) ?? [];
    return events.length === 0 ? 0 : Math.max(...events.map((event) => event.sequence));
  }

  async query(filter: IncidentQueryFilter, page: PageRequest): Promise<Page<IncidentState>> {
    const now = new Date();
    const filtered = [...this.incidents.values()].filter((incident) => {
      if (filter.userId !== undefined && incident.userId !== filter.userId) return false;
      if (filter.status !== undefined && incident.status !== filter.status) return false;
      if (filter.priority !== undefined && incident.priority !== filter.priority) return false;

      if (filter.claimed === 'mine' && incident.claimedByOperatorId !== filter.operatorId) {
        return false;
      }
      if (filter.claimed === 'unclaimed') {
        const held =
          incident.claimedByOperatorId !== null &&
          incident.claimExpiresAt !== null &&
          incident.claimExpiresAt.getTime() > now.getTime();
        if (held) return false;
      }
      if (filter.search !== undefined && filter.search.length > 0) {
        const haystack = `${incident.id} ${incident.userId} ${incident.trigger}`.toLowerCase();
        if (!haystack.includes(filter.search.toLowerCase())) return false;
      }
      return true;
    });

    // Newest first, with the id as a tiebreak so the order is total and the cursor
    // cannot land in the middle of a group of identical timestamps.
    filtered.sort(
      (a, b) => b.activatedAt.getTime() - a.activatedAt.getTime() || b.id.localeCompare(a.id),
    );

    return paginate(filtered, page, (incident) => ({
      sortValue: incident.activatedAt.toISOString(),
      id: incident.id,
    }));
  }

  async countByStatus(status: IncidentStatus): Promise<number> {
    return [...this.incidents.values()].filter((incident) => incident.status === status).length;
  }

  async countUnclaimed(now: Date): Promise<number> {
    return [...this.incidents.values()].filter((incident) => {
      if (incident.status !== 'active') return false;
      if (incident.claimedByOperatorId === null) return true;
      return incident.claimExpiresAt === null || incident.claimExpiresAt.getTime() <= now.getTime();
    }).length;
  }

  async deleteAllForUser(userId: string): Promise<void> {
    for (const [id, incident] of this.incidents) {
      if (incident.userId === userId) {
        this.incidents.delete(id);
        this.events.delete(id);
      }
    }
    for (const [key, incidentId] of this.idempotency) {
      if (!this.incidents.has(incidentId)) this.idempotency.delete(key);
    }
  }
}

export class MemoryLocationTelemetryRepository implements LocationTelemetryRepository {
  private readonly points = new Map<string, Array<GeoPoint & { userId: string }>>();

  async append(incidentId: string, userId: string, points: readonly GeoPoint[]): Promise<void> {
    const existing = this.points.get(incidentId) ?? [];
    this.points.set(incidentId, [...existing, ...points.map((point) => ({ ...point, userId }))]);
  }

  async listForIncident(incidentId: string, limit: number): Promise<GeoPoint[]> {
    return (this.points.get(incidentId) ?? [])
      .slice()
      .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime())
      .slice(0, limit)
      .map(({ userId: _userId, ...point }) => clone(point));
  }

  async deleteForUser(userId: string): Promise<void> {
    for (const [incidentId, points] of this.points) {
      const remaining = points.filter((point) => point.userId !== userId);
      if (remaining.length === 0) this.points.delete(incidentId);
      else this.points.set(incidentId, remaining);
    }
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    let removed = 0;
    for (const [incidentId, points] of this.points) {
      const remaining = points.filter((point) => point.capturedAt.getTime() >= cutoff.getTime());
      removed += points.length - remaining.length;
      if (remaining.length === 0) this.points.delete(incidentId);
      else this.points.set(incidentId, remaining);
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

  async listForIncident(incidentId: string): Promise<NotificationRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.incidentId === incidentId)
      .map(clone);
  }

  async insert(record: NotificationRecord): Promise<void> {
    this.records.set(record.id, clone(record));
  }

  async update(record: NotificationRecord): Promise<void> {
    this.records.set(record.id, clone(record));
  }

  async deleteForUser(): Promise<void> {
    // Notifications are keyed by incident; the incident sweep removes them in the SQL
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
 * reason the operator queue does not use it.
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
