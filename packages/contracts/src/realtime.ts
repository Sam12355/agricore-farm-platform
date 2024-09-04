import { z } from 'zod';

import { isoDateTimeSchema, uuidSchema } from './common';
import { alertEventSchema, alertSchema } from './alerts';

/**
 * Socket.IO contract.
 *
 * Two rules make the real-time layer survivable:
 *
 *   1. Every server-to-client message carries the alert sequence it corresponds to.
 *      Clients drop anything at or below what they have already applied, so a duplicate
 *      delivery after a reconnect is harmless.
 *
 *   2. Reconnecting clients send the last sequence they applied. The server replays the
 *      gap from the event log. Nothing is lost because the socket dropped, and nothing
 *      needs the client to refetch the whole alert.
 */

export const SOCKET_NAMESPACE = '/realtime' as const;

export const ClientEvent = {
  SubscribeAlert: 'alert.subscribe',
  UnsubscribeAlert: 'alert.unsubscribe',
  SubscribeQueue: 'queue.subscribe',
  Resume: 'alert.resume',
} as const;

export const ServerEvent = {
  AlertCreated: 'alert.created',
  AlertUpdated: 'alert.updated',
  AlertEventAppended: 'alert.event',
  QueueChanged: 'queue.changed',
  Resumed: 'alert.resumed',
  SubscriptionRejected: 'subscription.rejected',
} as const;

export type ClientEventName = (typeof ClientEvent)[keyof typeof ClientEvent];
export type ServerEventName = (typeof ServerEvent)[keyof typeof ServerEvent];

export const subscribeAlertSchema = z.object({
  alertId: uuidSchema,
});

export const resumeAlertSchema = z.object({
  alertId: uuidSchema,
  /** Highest sequence the client has already applied. Zero means "send me everything". */
  lastSequence: z.number().int().nonnegative(),
});

export const subscribeQueueSchema = z.object({
  /** Managers only. Ignored for other roles, which are rejected before this is read. */
  includeResolved: z.boolean().default(false),
});

export const alertCreatedPayloadSchema = z.object({
  alert: alertSchema,
  emittedAt: isoDateTimeSchema,
});

export const alertUpdatedPayloadSchema = z.object({
  alert: alertSchema,
  changedFields: z.array(z.string()),
  emittedAt: isoDateTimeSchema,
});

export const alertEventPayloadSchema = z.object({
  event: alertEventSchema,
  emittedAt: isoDateTimeSchema,
});

export const resumedPayloadSchema = z.object({
  alertId: uuidSchema,
  events: z.array(alertEventSchema),
  latestSequence: z.number().int().nonnegative(),
  /** True when the gap was larger than the replay window and the client must refetch. */
  truncated: z.boolean(),
});

export const queueChangedPayloadSchema = z.object({
  activeCount: z.number().int().nonnegative(),
  unclaimedCount: z.number().int().nonnegative(),
  emittedAt: isoDateTimeSchema,
});

export const subscriptionRejectedPayloadSchema = z.object({
  event: z.string(),
  code: z.enum(['FORBIDDEN', 'NOT_FOUND', 'VALIDATION_FAILED', 'RATE_LIMITED']),
  message: z.string(),
});

export type SubscribeAlertPayload = z.infer<typeof subscribeAlertSchema>;
export type ResumeAlertPayload = z.infer<typeof resumeAlertSchema>;
export type SubscribeQueuePayload = z.infer<typeof subscribeQueueSchema>;
export type AlertCreatedPayload = z.infer<typeof alertCreatedPayloadSchema>;
export type AlertUpdatedPayload = z.infer<typeof alertUpdatedPayloadSchema>;
export type AlertEventPayload = z.infer<typeof alertEventPayloadSchema>;
export type ResumedPayload = z.infer<typeof resumedPayloadSchema>;
export type QueueChangedPayload = z.infer<typeof queueChangedPayloadSchema>;
export type SubscriptionRejectedPayload = z.infer<typeof subscriptionRejectedPayloadSchema>;

/** Beyond this many missed events we tell the client to refetch instead of replaying. */
export const MAX_REPLAY_EVENTS = 500;
