import { z } from 'zod';

import { isoDateTimeSchema, uuidSchema } from './common';
import { incidentEventSchema, incidentSchema } from './incidents';

/**
 * Socket.IO contract.
 *
 * Two rules make the real-time layer survivable:
 *
 *   1. Every server-to-client message carries the incident sequence it corresponds to.
 *      Clients drop anything at or below what they have already applied, so a duplicate
 *      delivery after a reconnect is harmless.
 *
 *   2. Reconnecting clients send the last sequence they applied. The server replays the
 *      gap from the event log. Nothing is lost because the socket dropped, and nothing
 *      needs the client to refetch the whole incident.
 */

export const SOCKET_NAMESPACE = '/realtime' as const;

export const ClientEvent = {
  SubscribeIncident: 'incident.subscribe',
  UnsubscribeIncident: 'incident.unsubscribe',
  SubscribeQueue: 'queue.subscribe',
  Resume: 'incident.resume',
} as const;

export const ServerEvent = {
  IncidentCreated: 'incident.created',
  IncidentUpdated: 'incident.updated',
  IncidentEventAppended: 'incident.event',
  QueueChanged: 'queue.changed',
  Resumed: 'incident.resumed',
  SubscriptionRejected: 'subscription.rejected',
} as const;

export type ClientEventName = (typeof ClientEvent)[keyof typeof ClientEvent];
export type ServerEventName = (typeof ServerEvent)[keyof typeof ServerEvent];

export const subscribeIncidentSchema = z.object({
  incidentId: uuidSchema,
});

export const resumeIncidentSchema = z.object({
  incidentId: uuidSchema,
  /** Highest sequence the client has already applied. Zero means "send me everything". */
  lastSequence: z.number().int().nonnegative(),
});

export const subscribeQueueSchema = z.object({
  /** Operators only. Ignored for other roles, which are rejected before this is read. */
  includeResolved: z.boolean().default(false),
});

export const incidentCreatedPayloadSchema = z.object({
  incident: incidentSchema,
  emittedAt: isoDateTimeSchema,
});

export const incidentUpdatedPayloadSchema = z.object({
  incident: incidentSchema,
  changedFields: z.array(z.string()),
  emittedAt: isoDateTimeSchema,
});

export const incidentEventPayloadSchema = z.object({
  event: incidentEventSchema,
  emittedAt: isoDateTimeSchema,
});

export const resumedPayloadSchema = z.object({
  incidentId: uuidSchema,
  events: z.array(incidentEventSchema),
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

export type SubscribeIncidentPayload = z.infer<typeof subscribeIncidentSchema>;
export type ResumeIncidentPayload = z.infer<typeof resumeIncidentSchema>;
export type SubscribeQueuePayload = z.infer<typeof subscribeQueueSchema>;
export type IncidentCreatedPayload = z.infer<typeof incidentCreatedPayloadSchema>;
export type IncidentUpdatedPayload = z.infer<typeof incidentUpdatedPayloadSchema>;
export type IncidentEventPayload = z.infer<typeof incidentEventPayloadSchema>;
export type ResumedPayload = z.infer<typeof resumedPayloadSchema>;
export type QueueChangedPayload = z.infer<typeof queueChangedPayloadSchema>;
export type SubscriptionRejectedPayload = z.infer<typeof subscriptionRejectedPayloadSchema>;

/** Beyond this many missed events we tell the client to refetch instead of replaying. */
export const MAX_REPLAY_EVENTS = 500;
