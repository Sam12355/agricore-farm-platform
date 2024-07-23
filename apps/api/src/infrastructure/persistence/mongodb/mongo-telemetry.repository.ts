import type { Collection, Db } from 'mongodb';

import type { GeoPoint } from '@guardianlink/shared-types';

import type { LocationTelemetryRepository } from '../../../application/ports';

/**
 * Location telemetry in MongoDB.
 *
 * This is the only thing MongoDB stores, and the justification is in ADR-0004. In short:
 * location pings are append-only, written in bursts when an offline client flushes a
 * backlog, never joined against anything, queried only as "all points for this incident in
 * time order", and they expire on a schedule.
 *
 * The TTL index is the part that matters most. Expiry is enforced by the database rather
 * than by a job that might not run, and for the most sensitive data this product holds
 * that is worth something on its own.
 *
 * The boundary that keeps this honest: **if MongoDB is unavailable, incidents still work.**
 * The subject's last known position lives on the incident row in Postgres. Losing this
 * costs the detailed track on the operator's map, not the incident, the timeline, the
 * notifications or the audit trail.
 */

interface TelemetryDocument {
  incidentId: string;
  userId: string;
  latitude: number;
  longitude: number;
  accuracyMetres: number;
  capturedAt: Date;
  /** Set at insert, and what the TTL index expires on. */
  receivedAt: Date;
}

export class MongoTelemetryRepository implements LocationTelemetryRepository {
  private readonly points: Collection<TelemetryDocument>;

  constructor(db: Db) {
    this.points = db.collection<TelemetryDocument>('location_points');
  }

  /**
   * Creates the indexes. Idempotent, so it is safe to call on every boot.
   *
   * The TTL expires on `receivedAt` rather than `capturedAt` deliberately. A backlog
   * flushed a week late carries capture times a week old, and expiring on those would
   * delete it moments after it arrived.
   */
  async ensureIndexes(retentionDays = 30): Promise<void> {
    await this.points.createIndex(
      { incidentId: 1, capturedAt: 1 },
      { name: 'incident_time' },
    );

    await this.points.createIndex(
      { receivedAt: 1 },
      { name: 'ttl_received', expireAfterSeconds: retentionDays * 86_400 },
    );

    // Used by the deletion path. Without it, deleting a user's telemetry is a collection
    // scan, which is exactly the wrong performance profile for something that has to
    // happen promptly when somebody asks to be forgotten.
    await this.points.createIndex({ userId: 1 }, { name: 'user' });
  }

  async append(incidentId: string, userId: string, points: readonly GeoPoint[]): Promise<void> {
    if (points.length === 0) return;

    const now = new Date();

    await this.points.insertMany(
      points.map((point) => ({
        incidentId,
        userId,
        latitude: point.latitude,
        longitude: point.longitude,
        accuracyMetres: point.accuracyMetres,
        capturedAt: point.capturedAt,
        receivedAt: now,
      })),
      // Unordered, so one bad document does not abort the rest of a flushed backlog.
      // Telemetry is best-effort by design; the incident record is not.
      { ordered: false },
    );
  }

  async listForIncident(incidentId: string, limit: number): Promise<GeoPoint[]> {
    const documents = await this.points
      .find({ incidentId }, { projection: { _id: 0 } })
      .sort({ capturedAt: 1 })
      .limit(limit)
      .toArray();

    return documents.map((document) => ({
      latitude: document.latitude,
      longitude: document.longitude,
      accuracyMetres: document.accuracyMetres,
      capturedAt: document.capturedAt,
    }));
  }

  async deleteForUser(userId: string): Promise<void> {
    await this.points.deleteMany({ userId });
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    // The TTL index handles routine expiry. This exists for the retention sweep, which
    // applies a shorter per-user setting than the collection-wide TTL, and for the case
    // where the TTL monitor has fallen behind.
    const result = await this.points.deleteMany({ receivedAt: { $lt: cutoff } });
    return result.deletedCount;
  }
}
