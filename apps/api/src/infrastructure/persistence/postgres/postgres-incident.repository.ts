import type { Pool, PoolClient } from 'pg';

import {
  DomainErrors,
  type DomainError,
  type IncidentStatus,
  type Page,
  type PageRequest,
  type Result,
  decodeCursor,
  encodeCursor,
  err,
  ok,
} from '@guardianlink/shared-types';

import type { IncidentState } from '../../../domain/incident/incident';
import type {
  PendingIncidentEvent,
  StoredIncidentEvent,
} from '../../../domain/incident/incident-events';
import type {
  IncidentQueryFilter,
  IncidentRepository,
  OutboxMessage,
} from '../../../application/ports';

/**
 * PostgreSQL incident repository.
 *
 * The interesting method is `create`. It writes the incident, the idempotency key, the
 * opening timeline events and the outbox rows in one transaction, and it relies on two
 * database guarantees that no amount of application code can substitute for:
 *
 *   1. The unique index on (user_id, key). Two concurrent retries both miss the lookup;
 *      one wins the insert and the other catches 23505 and reads back the winner. A
 *      check-then-write without the constraint is a race, and it is the race that actually
 *      happens under load.
 *
 *   2. Sequence allocation inside the transaction. The application never picks a sequence
 *      number, so two writers cannot both decide they are number seven and fork the
 *      timeline.
 *
 * SQL is written out rather than generated. The schema and the queries are the part of
 * this system a reviewer most needs to be able to read, and generated SQL is not readable.
 */
/** Postgres unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = '23505';

export class PostgresIncidentRepository implements IncidentRepository {
  constructor(private readonly pool: Pool) {}

  async findById(id: string): Promise<IncidentState | null> {
    const { rows } = await this.pool.query(`${SELECT_INCIDENT} WHERE id = $1`, [id]);
    return rows[0] ? mapIncident(rows[0]) : null;
  }

  async findByIdempotencyKey(userId: string, key: string): Promise<IncidentState | null> {
    const { rows } = await this.pool.query(
      `${SELECT_INCIDENT}
         WHERE id = (SELECT incident_id FROM incident_idempotency WHERE user_id = $1 AND key = $2)`,
      [userId, key],
    );
    return rows[0] ? mapIncident(rows[0]) : null;
  }

  async create(input: {
    state: IncidentState;
    events: readonly PendingIncidentEvent[];
    idempotencyKey: string | null;
    outbox: readonly OutboxMessage[];
  }): Promise<Result<{ state: IncidentState; events: StoredIncidentEvent[] }, DomainError>> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO incidents (
           id, user_id, session_id, status, priority, trigger, activated_at,
           last_latitude, last_longitude, last_accuracy_metres, last_location_captured_at,
           version, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          input.state.id,
          input.state.userId,
          input.state.sessionId,
          input.state.status,
          input.state.priority,
          input.state.trigger,
          input.state.activatedAt,
          input.state.lastKnownLocation?.latitude ?? null,
          input.state.lastKnownLocation?.longitude ?? null,
          input.state.lastKnownLocation?.accuracyMetres ?? null,
          input.state.lastKnownLocation?.capturedAt ?? null,
          input.state.version,
          input.state.createdAt,
          input.state.updatedAt,
        ],
      );

      if (input.idempotencyKey !== null) {
        // This is the line that makes deduplication a database guarantee. If a concurrent
        // request already inserted this key, the unique index rejects it here, inside the
        // transaction, and the whole thing rolls back rather than leaving a second
        // incident behind.
        await client.query(
          `INSERT INTO incident_idempotency (user_id, key, incident_id) VALUES ($1,$2,$3)`,
          [input.state.userId, input.idempotencyKey, input.state.id],
        );
      }

      const events = await appendEvents(client, input.state.id, input.events);
      await insertOutbox(client, input.outbox);

      await client.query('COMMIT');
      return ok({ state: input.state, events });
    } catch (error) {
      await client.query('ROLLBACK');

      if (isUniqueViolation(error)) {
        // A concurrent request won the race. The caller reads back the winner rather than
        // surfacing a conflict the client can do nothing useful with.
        return err(DomainErrors.conflict('That activation was already recorded.'));
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async save(input: {
    state: IncidentState;
    events: readonly PendingIncidentEvent[];
    expectedVersion: number;
    outbox?: readonly OutboxMessage[];
  }): Promise<Result<{ state: IncidentState; events: StoredIncidentEvent[] }, DomainError>> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // The optimistic check. A zero row count means somebody else committed first, and
      // the WHERE clause is what makes that atomic rather than a read followed by a write.
      const updated = await client.query(
        `UPDATE incidents SET
           status = $1, priority = $2, resolved_at = $3, resolved_by = $4, resolution = $5,
           claimed_by_operator_id = $6, claimed_at = $7, claim_expires_at = $8,
           last_latitude = $9, last_longitude = $10, last_accuracy_metres = $11,
           last_location_captured_at = $12, acknowledged_by_contact_id = $13,
           acknowledged_at = $14, version = $15, updated_at = $16
         WHERE id = $17 AND version = $18`,
        [
          input.state.status,
          input.state.priority,
          input.state.resolvedAt,
          input.state.resolvedBy,
          input.state.resolution,
          input.state.claimedByOperatorId,
          input.state.claimedAt,
          input.state.claimExpiresAt,
          input.state.lastKnownLocation?.latitude ?? null,
          input.state.lastKnownLocation?.longitude ?? null,
          input.state.lastKnownLocation?.accuracyMetres ?? null,
          input.state.lastKnownLocation?.capturedAt ?? null,
          input.state.acknowledgedByContactId,
          input.state.acknowledgedAt,
          input.state.version,
          input.state.updatedAt,
          input.state.id,
          input.expectedVersion,
        ],
      );

      if (updated.rowCount === 0) {
        await client.query('ROLLBACK');

        const current = await this.findById(input.state.id);
        if (current === null) return err(DomainErrors.notFound('Incident'));

        // The current version travels back with the error so the console can reload and
        // show what changed rather than making the operator guess.
        return err(DomainErrors.staleVersion(input.expectedVersion, current.version));
      }

      const events = await appendEvents(client, input.state.id, input.events);
      if (input.outbox) await insertOutbox(client, input.outbox);

      await client.query('COMMIT');
      return ok({ state: input.state, events });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listEvents(
    incidentId: string,
    afterSequence: number,
    limit: number,
  ): Promise<StoredIncidentEvent[]> {
    const { rows } = await this.pool.query(
      `SELECT id, incident_id, sequence, type, actor_type, actor_id, occurred_at, recorded_at, payload
         FROM incident_events
        WHERE incident_id = $1 AND sequence > $2
        ORDER BY sequence ASC
        LIMIT $3`,
      [incidentId, afterSequence, limit],
    );
    return rows.map(mapEvent);
  }

  async latestSequence(incidentId: string): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT COALESCE(MAX(sequence), 0) AS latest FROM incident_events WHERE incident_id = $1`,
      [incidentId],
    );
    return Number(rows[0]?.latest ?? 0);
  }

  /**
   * Cursor pagination, never OFFSET.
   *
   * The operator queue receives inserts continuously. With OFFSET, an incident arriving
   * between page one and page two shifts everything down and the operator silently skips a
   * row. The (activated_at, id) tuple comparison does not have that problem, and it uses
   * the incidents_queue_idx index directly.
   */
  async query(filter: IncidentQueryFilter, page: PageRequest): Promise<Page<IncidentState>> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    const add = (clause: string, value: unknown): void => {
      params.push(value);
      conditions.push(clause.replace('$?', `$${params.length}`));
    };

    if (filter.userId !== undefined) add('user_id = $?', filter.userId);
    if (filter.status !== undefined) add('status = $?', filter.status);
    if (filter.priority !== undefined) add('priority = $?', filter.priority);

    if (filter.claimed === 'mine' && filter.operatorId !== undefined) {
      add('claimed_by_operator_id = $?', filter.operatorId);
      conditions.push('claim_expires_at > now()');
    }
    if (filter.claimed === 'unclaimed') {
      conditions.push('(claimed_by_operator_id IS NULL OR claim_expires_at <= now())');
    }
    if (filter.search !== undefined && filter.search.length > 0) {
      // One parameter referenced twice, rather than binding the same value into two
      // placeholders. Search is operator-only and is never an unbounded scan: both
      // columns are uuid, so ILIKE on their text form matches a prefix an operator
      // pasted from somewhere.
      params.push(`%${filter.search}%`);
      conditions.push(`(id::text ILIKE $${params.length} OR user_id::text ILIKE $${params.length})`);
    }

    const cursor = page.cursor === undefined ? null : decodeCursor(page.cursor);
    if (cursor !== null) {
      params.push(cursor.sortValue, cursor.id);
      conditions.push(`(activated_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }

    params.push(page.limit + 1);

    const { rows } = await this.pool.query(
      `${SELECT_INCIDENT}
        ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
        ORDER BY activated_at DESC, id DESC
        LIMIT $${params.length}`,
      params,
    );

    // One extra row is fetched to decide hasMore without a second COUNT query.
    const hasMore = rows.length > page.limit;
    const items = rows.slice(0, page.limit).map(mapIncident);
    const last = items.at(-1);

    return {
      items,
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeCursor({ sortValue: last.activatedAt.toISOString(), id: last.id })
          : null,
    };
  }

  async countByStatus(status: IncidentStatus): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS total FROM incidents WHERE status = $1`,
      [status],
    );
    return Number(rows[0]?.total ?? 0);
  }

  async countUnclaimed(now: Date): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS total FROM incidents
        WHERE status = 'active'
          AND (claimed_by_operator_id IS NULL OR claim_expires_at <= $1)`,
      [now],
    );
    return Number(rows[0]?.total ?? 0);
  }

  async deleteAllForUser(userId: string): Promise<void> {
    // Events, idempotency records and notifications all cascade from the incident.
    await this.pool.query(`DELETE FROM incidents WHERE user_id = $1`, [userId]);
  }
}

const SELECT_INCIDENT = `
  SELECT id, user_id, session_id, status, priority, trigger, activated_at,
         resolved_at, resolved_by, resolution,
         claimed_by_operator_id, claimed_at, claim_expires_at,
         last_latitude, last_longitude, last_accuracy_metres, last_location_captured_at,
         acknowledged_by_contact_id, acknowledged_at,
         version, created_at, updated_at
    FROM incidents`;

/**
 * Appends events with sequence numbers allocated by the database.
 *
 * The subquery reads the current maximum for this incident inside the transaction. The
 * unique constraint on (incident_id, sequence) is what makes it safe: if two transactions
 * somehow computed the same number, the second fails rather than forking the timeline.
 */
async function appendEvents(
  client: PoolClient,
  incidentId: string,
  events: readonly PendingIncidentEvent[],
): Promise<StoredIncidentEvent[]> {
  const stored: StoredIncidentEvent[] = [];

  for (const event of events) {
    const { rows } = await client.query(
      `INSERT INTO incident_events (incident_id, sequence, type, actor_type, actor_id, occurred_at, payload)
       VALUES (
         $1,
         COALESCE((SELECT MAX(sequence) FROM incident_events WHERE incident_id = $1), 0) + 1,
         $2, $3, $4, $5, $6
       )
       RETURNING id, incident_id, sequence, type, actor_type, actor_id, occurred_at, recorded_at, payload`,
      [incidentId, event.type, event.actorType, event.actorId, event.occurredAt, event.payload],
    );

    const row = rows[0];
    if (row) stored.push(mapEvent(row));
  }

  return stored;
}

async function insertOutbox(client: PoolClient, messages: readonly OutboxMessage[]): Promise<void> {
  for (const message of messages) {
    await client.query(
      `INSERT INTO outbox_messages (id, topic, payload, correlation_id, dedupe_key, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        message.id,
        message.topic,
        message.payload,
        message.correlationId,
        message.dedupeKey,
        message.createdAt,
      ],
    );
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === UNIQUE_VIOLATION
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapIncident(row: any): IncidentState {
  return {
    id: row.id,
    userId: row.user_id,
    sessionId: row.session_id,
    status: row.status,
    priority: row.priority,
    trigger: row.trigger,
    activatedAt: row.activated_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    resolution: row.resolution,
    claimedByOperatorId: row.claimed_by_operator_id,
    claimedAt: row.claimed_at,
    claimExpiresAt: row.claim_expires_at,
    lastKnownLocation:
      row.last_latitude === null
        ? null
        : {
            latitude: Number(row.last_latitude),
            longitude: Number(row.last_longitude),
            accuracyMetres: Number(row.last_accuracy_metres),
            capturedAt: row.last_location_captured_at,
          },
    acknowledgedByContactId: row.acknowledged_by_contact_id,
    acknowledgedAt: row.acknowledged_at,
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEvent(row: any): StoredIncidentEvent {
  return {
    id: row.id,
    incidentId: row.incident_id,
    sequence: Number(row.sequence),
    type: row.type,
    actorType: row.actor_type,
    actorId: row.actor_id,
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
    payload: row.payload ?? {},
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
