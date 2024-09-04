import { z } from 'zod';

import { Limits, geoPointSchema, isoDateTimeSchema, uuidSchema } from './common';

export const fieldOperationStatusSchema = z.enum(['active', 'completed', 'expired', 'escalated']);
export const countdownStatusSchema = z.enum(['pending', 'cancelled', 'activated']);
export const alertStatusSchema = z.enum(['active', 'acknowledged', 'resolved', 'cancelled']);
export const alertPrioritySchema = z.enum(['low', 'standard', 'high', 'critical']);
export const alertTriggerSchema = z.enum([
  'field_countdown',
  'manual_report',
  'operation_overdue',
  'manager_created',
]);

export const alertEventTypeSchema = z.enum([
  'alert.activated',
  'alert.location_recorded',
  'alert.worker_notified',
  'alert.worker_acknowledged',
  'alert.notification_failed',
  'alert.manager_claimed',
  'alert.manager_released',
  'alert.manager_note_added',
  'alert.priority_changed',
  'alert.status_changed',
  'alert.resolved',
  'alert.cancelled',
]);

// Field operations ---------------------------------------------------------------

export const startFieldOperationSchema = z.object({
  /** How long the user expects to be out. The session escalates if it is not ended. */
  expectedDurationMinutes: z.number().int().min(1).max(720),
  note: z.string().trim().max(Limits.sessionNote).optional(),
  destinationLabel: z.string().trim().max(120).optional(),
  shareLiveLocation: z.boolean().default(true),
});

export const endFieldOperationSchema = z.object({
  outcome: z.enum(['finished', 'cancelled']),
});

export const fieldOperationSchema = z.object({
  id: uuidSchema,
  status: fieldOperationStatusSchema,
  startedAt: isoDateTimeSchema,
  expectedEndAt: isoDateTimeSchema,
  endedAt: isoDateTimeSchema.nullable(),
  note: z.string().nullable(),
  destinationLabel: z.string().nullable(),
  shareLiveLocation: z.boolean(),
});

// alert countdown -----------------------------------------------------------------

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
  alertId: uuidSchema.nullable(),
});

// Alert activation -----------------------------------------------------------

export const activateAlertSchema = z.object({
  countdownId: uuidSchema.optional(),
  sessionId: uuidSchema.optional(),
  trigger: alertTriggerSchema.default('field_countdown'),
  /** The fix the device had at the moment of activation, if it had one. */
  location: geoPointSchema.optional(),
  note: z.string().trim().max(Limits.reason).optional(),
  /**
   * Set when the client queued this while offline. The server uses it for the
   * timeline rather than trusting wall-clock arrival order.
   */
  occurredAt: isoDateTimeSchema.optional(),
});

export const alertSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  sessionId: uuidSchema.nullable(),
  status: alertStatusSchema,
  priority: alertPrioritySchema,
  trigger: alertTriggerSchema,
  activatedAt: isoDateTimeSchema,
  resolvedAt: isoDateTimeSchema.nullable(),
  resolvedBy: uuidSchema.nullable(),
  claimedByManagerId: uuidSchema.nullable(),
  claimedAt: isoDateTimeSchema.nullable(),
  lastKnownLocation: geoPointSchema.nullable(),
  /** Optimistic concurrency token. Send it back on every mutation. */
  version: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const alertEventSchema = z.object({
  id: uuidSchema,
  alertId: uuidSchema,
  /**
   * Per-alert monotonic sequence allocated by the database. Clients order by this,
   * never by timestamp, because device and server clocks disagree and out-of-order
   * delivery is normal on mobile networks.
   */
  sequence: z.number().int().positive(),
  type: alertEventTypeSchema,
  actorType: z.enum(['user', 'manager', 'worker', 'system']),
  actorId: uuidSchema.nullable(),
  occurredAt: isoDateTimeSchema,
  recordedAt: isoDateTimeSchema,
  payload: z.record(z.unknown()),
});

export const alertTimelineSchema = z.object({
  alert: alertSchema,
  events: z.array(alertEventSchema),
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

// Manager actions -------------------------------------------------------------

export const claimAlertSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
});

export const releaseAlertSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
});

export const addManagerNoteSchema = z.object({
  note: z.string().trim().min(1).max(Limits.note),
  expectedVersion: z.number().int().nonnegative(),
});

export const changePrioritySchema = z.object({
  priority: alertPrioritySchema,
  reason: z.string().trim().max(Limits.reason).optional(),
  expectedVersion: z.number().int().nonnegative(),
});

export const resolveAlertSchema = z.object({
  resolution: z.enum(['issue_cleared', 'false_alarm', 'handled_offline', 'duplicate']),
  note: z.string().trim().max(Limits.note).optional(),
  expectedVersion: z.number().int().nonnegative(),
});

export const alertQuerySchema = z.object({
  status: alertStatusSchema.optional(),
  priority: alertPrioritySchema.optional(),
  claimed: z.enum(['any', 'mine', 'unclaimed']).optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(512).optional(),
});

export type StartFieldOperationRequest = z.infer<typeof startFieldOperationSchema>;
export type EndFieldOperationRequest = z.infer<typeof endFieldOperationSchema>;
export type FieldOperationDto = z.infer<typeof fieldOperationSchema>;
export type StartCountdownRequest = z.infer<typeof startCountdownSchema>;
export type CancelCountdownRequest = z.infer<typeof cancelCountdownSchema>;
export type CountdownDto = z.infer<typeof countdownSchema>;
export type ActivateAlertRequest = z.infer<typeof activateAlertSchema>;
export type AlertDto = z.infer<typeof alertSchema>;
export type AlertEventDto = z.infer<typeof alertEventSchema>;
export type AlertTimelineDto = z.infer<typeof alertTimelineSchema>;
export type RecordLocationRequest = z.infer<typeof recordLocationSchema>;
export type LocationBatchAccepted = z.infer<typeof locationBatchAcceptedSchema>;
export type ClaimAlertRequest = z.infer<typeof claimAlertSchema>;
export type AddManagerNoteRequest = z.infer<typeof addManagerNoteSchema>;
export type ChangePriorityRequest = z.infer<typeof changePrioritySchema>;
export type ResolveAlertRequest = z.infer<typeof resolveAlertSchema>;
export type AlertQuery = z.infer<typeof alertQuerySchema>;
