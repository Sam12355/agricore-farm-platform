import type { IncidentEventType } from '@guardianlink/shared-types';

/**
 * A domain event as the aggregate produces it: no identifier, no sequence number.
 *
 * Sequence allocation belongs to the repository, because it has to be atomic with the
 * write. If the aggregate invented sequence numbers, two concurrent transactions could
 * both decide they were number 7 and the timeline would fork. Letting the database
 * allocate on insert is the only version of this that survives concurrency.
 */
export interface PendingIncidentEvent {
  readonly type: IncidentEventType;
  readonly actorType: 'user' | 'operator' | 'contact' | 'system';
  readonly actorId: string | null;
  /**
   * When the thing happened, which is not always when the server heard about it.
   * An offline client sends its own capture time and we keep it.
   */
  readonly occurredAt: Date;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** A stored event, with the identity and ordering the repository assigned it. */
export interface StoredIncidentEvent extends PendingIncidentEvent {
  readonly id: string;
  readonly incidentId: string;
  readonly sequence: number;
  readonly recordedAt: Date;
}

export function pendingEvent(
  type: IncidentEventType,
  actorType: PendingIncidentEvent['actorType'],
  actorId: string | null,
  occurredAt: Date,
  payload: Readonly<Record<string, unknown>> = {},
): PendingIncidentEvent {
  return { type, actorType, actorId, occurredAt, payload };
}
