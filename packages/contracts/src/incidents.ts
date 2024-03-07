import { z } from 'zod';

import { Limits, geoPointSchema, isoDateTimeSchema, uuidSchema } from './common';

export const safetySessionStatusSchema = z.enum(['active', 'completed', 'expired', 'escalated']);
export const countdownStatusSchema = z.enum(['pending', 'cancelled', 'activated']);
export const incidentStatusSchema = z.enum(['active', 'acknowledged', 'resolved', 'cancelled']);
export const incidentPrioritySchema = z.enum(['low', 'standard', 'high', 'critical']);
export const incidentTriggerSchema = z.enum([
  'sos_countdown',
  'manual_panic',
  'session_overdue',
  'operator_created',
]);

export const incidentEventTypeSchema = z.enum([
  'incident.activated',
  'incident.location_recorded',
  'incident.contact_notified',
  'incident.contact_acknowledged',
  'incident.notification_failed',
  'incident.operator_claimed',
  'incident.operator_released',
  'incident.operator_note_added',
  'incident.priority_changed',
  'incident.status_changed',
  'incident.resolved',
  'incident.cancelled',
]);

// Safety sessions ---------------------------------------------------------------

export const startSafetySessionSchema = z.object({
  /** How long the user expects to be out. The session escalates if it is not ended. */
  expectedDurationMinutes: z.number().int().min(1).max(720),
  note: z.string().trim().max(Limits.sessionNote).optional(),
  destinationLabel: z.string().trim().max(120).optional(),
  shareLiveLocation: z.boolean().default(true),
});

export const endSafetySessionSchema = z.object({
  outcome: z.enum(['arrived_safely', 'cancelled']),
});

export const safetySessionSchema = z.object({
  id: uuidSchema,
  status: safetySessionStatusSchema,
  startedAt: isoDateTimeSchema,
  expectedEndAt: isoDateTimeSchema,
  endedAt: isoDateTimeSchema.nullable(),
  note: z.string().nullable(),
  destinationLabel: z.string().nullable(),
  shareLiveLocation: z.boolean(),
});

// SOS countdown -----------------------------------------------------------------

export const COUNTDOWN_MIN_SECONDS = 5;
export const COUNTDOWN_MAX_SECONDS = 60;
export const COUNTDOWN_DEFAULT_SECONDS = 10;

export const startCountdownSchema = z.object({
  durationSeconds: z
    .number()
    .int()
    .min(COUNTDOWN_MIN_SECONDS)
    .max(COUNTDOWN_MAX_SECONDS)
    .default(COUNTDOWN_DEFAULT_SECONDS),
  sessionId: uuidSchema.optional(),
  /**
   * Generated on the device when the countdown starts, not when it fires. That way a
   * client that crashes mid-countdown and retries after restart still deduplicates.
   */
  activationIdempotencyKey: z.string().min(8).max(128),
});

export const cancelCountdownSchema = z.object({
  reason: z.enum(['user_cancelled', 'false_trigger']).default('user_cancelled'),
});

export const countdownSchema = z.object({
  id: uuidSchema,
  status: countdownStatusSchema,
  startedAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema,
  cancelledAt: isoDateTimeSchema.nullable(),
  incidentId: uuidSchema.nullable(),
});

// Incident activation -----------------------------------------------------------

export const activateIncidentSchema = z.object({
  countdownId: uuidSchema.optional(),
  sessionId: uuidSchema.optional(),
  trigger: incidentTriggerSchema.default('sos_countdown'),
  /** The fix the device had at the moment of activation, if it had one. */
  location: geoPointSchema.optional(),
  note: z.string().trim().max(Limits.reason).optional(),
  /**
   * Set when the client queued this while offline. The server uses it for the
   * timeline rather than trusting wall-clock arrival order.
   */
  occurredAt: isoDateTimeSchema.optional(),
});

export const incidentSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  sessionId: uuidSchema.nullable(),
  status: incidentStatusSchema,
  priority: incidentPrioritySchema,
  trigger: incidentTriggerSchema,
  activatedAt: isoDateTimeSchema,
  resolvedAt: isoDateTimeSchema.nullable(),
  resolvedBy: uuidSchema.nullable(),
  claimedByOperatorId: uuidSchema.nullable(),
  claimedAt: isoDateTimeSchema.nullable(),
  lastKnownLocation: geoPointSchema.nullable(),
  /** Optimistic concurrency token. Send it back on every mutation. */
  version: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const incidentEventSchema = z.object({
  id: uuidSchema,
  incidentId: uuidSchema,
  /**
   * Per-incident monotonic sequence allocated by the database. Clients order by this,
   * never by timestamp, because device and server clocks disagree and out-of-order
   * delivery is normal on mobile networks.
   */
  sequence: z.number().int().positive(),
  type: incidentEventTypeSchema,
  actorType: z.enum(['user', 'operator', 'contact', 'system']),
  actorId: uuidSchema.nullable(),
  occurredAt: isoDateTimeSchema,
  recordedAt: isoDateTimeSchema,
  payload: z.record(z.unknown()),
});

export const incidentTimelineSchema = z.object({
  incident: incidentSchema,
  events: z.array(incidentEventSchema),
  latestSequence: z.number().int().nonnegative(),
});

// Location --------------------------------------------------------------------

export const recordLocationSchema = z.object({
  points: z
    .array(geoPointSchema)
    .min(1)
    .max(50)
    .describe('Batched so an offline client can flush a backlog in one request.'),
});

export const locationBatchAcceptedSchema = z.object({
  accepted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  latestSequence: z.number().int().nonnegative(),
});

// Operator actions -------------------------------------------------------------

export const claimIncidentSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
});

export const releaseIncidentSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
});

export const addOperatorNoteSchema = z.object({
  note: z.string().trim().min(1).max(Limits.note),
  expectedVersion: z.number().int().nonnegative(),
});

export const changePrioritySchema = z.object({
  priority: incidentPrioritySchema,
  reason: z.string().trim().max(Limits.reason).optional(),
  expectedVersion: z.number().int().nonnegative(),
});

export const resolveIncidentSchema = z.object({
  resolution: z.enum(['user_safe', 'false_alarm', 'handled_offline', 'duplicate']),
  note: z.string().trim().max(Limits.note).optional(),
  expectedVersion: z.number().int().nonnegative(),
});

export const incidentQuerySchema = z.object({
  status: incidentStatusSchema.optional(),
  priority: incidentPrioritySchema.optional(),
  claimed: z.enum(['any', 'mine', 'unclaimed']).optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(512).optional(),
});

export type StartSafetySessionRequest = z.infer<typeof startSafetySessionSchema>;
export type EndSafetySessionRequest = z.infer<typeof endSafetySessionSchema>;
export type SafetySessionDto = z.infer<typeof safetySessionSchema>;
export type StartCountdownRequest = z.infer<typeof startCountdownSchema>;
export type CancelCountdownRequest = z.infer<typeof cancelCountdownSchema>;
export type CountdownDto = z.infer<typeof countdownSchema>;
export type ActivateIncidentRequest = z.infer<typeof activateIncidentSchema>;
export type IncidentDto = z.infer<typeof incidentSchema>;
export type IncidentEventDto = z.infer<typeof incidentEventSchema>;
export type IncidentTimelineDto = z.infer<typeof incidentTimelineSchema>;
export type RecordLocationRequest = z.infer<typeof recordLocationSchema>;
export type LocationBatchAccepted = z.infer<typeof locationBatchAcceptedSchema>;
export type ClaimIncidentRequest = z.infer<typeof claimIncidentSchema>;
export type AddOperatorNoteRequest = z.infer<typeof addOperatorNoteSchema>;
export type ChangePriorityRequest = z.infer<typeof changePrioritySchema>;
export type ResolveIncidentRequest = z.infer<typeof resolveIncidentSchema>;
export type IncidentQuery = z.infer<typeof incidentQuerySchema>;
