import type { AlertEventType } from '@agricore/shared-types';

/**
 * A domain event as the aggregate produces it: no identifier, no sequence number.
 *
 * Sequence allocation belongs to the repository, because it has to be atomic with the
 * write. If the aggregate invented sequence numbers, two concurrent transactions could
 * both decide they were number 7 and the timeline would fork. Letting the database
 * allocate on insert is the only version of this that survives concurrency.
 */
export interface PendingAlertEvent {
  readonly type: AlertEventType;
  readonly actorType: 'user' | 'manager' | 'worker' | 'system';
  readonly actorId: string | null;
  /**
   * When the thing happened, which is not always when the server heard about it.
   * An offline client sends its own capture time and we keep it.
   */
  readonly occurredAt: Date;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** A stored event, with the identity and ordering the repository assigned it. */
export interface StoredAlertEvent extends PendingAlertEvent {
  readonly id: string;
  readonly alertId: string;
  readonly sequence: number;
  readonly recordedAt: Date;
}

export function pendingEvent(
  type: AlertEventType,
  actorType: PendingAlertEvent['actorType'],
  actorId: string | null,
  occurredAt: Date,
  payload: Readonly<Record<string, unknown>> = {},
): PendingAlertEvent {
  return { type, actorType, actorId, occurredAt, payload };
}
