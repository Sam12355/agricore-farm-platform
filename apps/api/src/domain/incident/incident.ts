import {
  DomainErrors,
  IncidentEventType,
  IncidentPriority,
  IncidentStatus,
  type DomainError,
  type GeoPoint,
  type IncidentTrigger,
  err,
  ok,
  type Result,
} from '@guardianlink/shared-types';

import { pendingEvent, type PendingIncidentEvent } from './incident-events';

/**
 * The incident aggregate.
 *
 * Everything here is pure: no database, no clock of its own, no framework. Time arrives
 * as an argument. That makes each rule below directly testable, and it is why the
 * incident tests run in milliseconds without a container.
 *
 * Two rules drive most of the design:
 *
 *   1. The timeline is append-only. No method mutates or removes an event. What
 *      happened, happened, and the record of it is what makes the incident auditable.
 *
 *   2. Every mutation takes an expected version. A console that has been sitting on a
 *      stale incident for two minutes cannot overwrite the work of an operator who has
 *      been actively handling it.
 */

export type IncidentResolution = 'user_safe' | 'false_alarm' | 'handled_offline' | 'duplicate';

export interface IncidentState {
  readonly id: string;
  readonly userId: string;
  readonly sessionId: string | null;
  readonly status: IncidentStatus;
  readonly priority: IncidentPriority;
  readonly trigger: IncidentTrigger;
  readonly activatedAt: Date;
  readonly resolvedAt: Date | null;
  readonly resolvedBy: string | null;
  readonly resolution: IncidentResolution | null;
  readonly claimedByOperatorId: string | null;
  readonly claimedAt: Date | null;
  readonly claimExpiresAt: Date | null;
  readonly lastKnownLocation: GeoPoint | null;
  readonly acknowledgedByContactId: string | null;
  readonly acknowledgedAt: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface Transition {
  readonly state: IncidentState;
  readonly events: readonly PendingIncidentEvent[];
}

/**
 * How long a claim survives without the operator doing anything.
 *
 * Without a lease, an operator who closes their laptop holds an incident forever and
 * nobody else can pick it up. Five minutes is short enough that a genuinely abandoned
 * incident returns to the queue quickly, and long enough that reading a timeline does
 * not lose you the claim.
 */
export const CLAIM_LEASE_MS = 5 * 60 * 1000;

const ACTIVE_STATUSES: readonly IncidentStatus[] = [
  IncidentStatus.Active,
  IncidentStatus.Acknowledged,
];

export function isOpen(state: IncidentState): boolean {
  return ACTIVE_STATUSES.includes(state.status);
}

export function claimIsHeld(state: IncidentState, now: Date): boolean {
  if (state.claimedByOperatorId === null || state.claimExpiresAt === null) return false;
  return state.claimExpiresAt.getTime() > now.getTime();
}

function bump(state: IncidentState, now: Date, changes: Partial<IncidentState>): IncidentState {
  return { ...state, ...changes, version: state.version + 1, updatedAt: now };
}

function requireVersion(state: IncidentState, expectedVersion: number): DomainError | null {
  if (state.version !== expectedVersion) {
    return DomainErrors.staleVersion(expectedVersion, state.version);
  }
  return null;
}

function requireOpen(state: IncidentState): DomainError | null {
  if (!isOpen(state)) {
    return DomainErrors.invalidState(`This incident is already ${state.status}.`, {
      status: state.status,
    });
  }
  return null;
}

// Creation --------------------------------------------------------------------

export interface ActivateInput {
  readonly id: string;
  readonly userId: string;
  readonly sessionId: string | null;
  readonly trigger: IncidentTrigger;
  readonly location: GeoPoint | null;
  readonly note: string | null;
  /** When the device says it happened. Falls back to now for an online client. */
  readonly occurredAt: Date;
  readonly now: Date;
}

export function activate(input: ActivateInput): Transition {
  const state: IncidentState = {
    id: input.id,
    userId: input.userId,
    sessionId: input.sessionId,
    status: IncidentStatus.Active,
    // Everything starts standard. An operator raises it based on what they see, which
    // keeps the priority signal meaningful instead of every incident arriving critical.
    priority: IncidentPriority.Standard,
    trigger: input.trigger,
    activatedAt: input.occurredAt,
    resolvedAt: null,
    resolvedBy: null,
    resolution: null,
    claimedByOperatorId: null,
    claimedAt: null,
    claimExpiresAt: null,
    lastKnownLocation: input.location,
    acknowledgedByContactId: null,
    acknowledgedAt: null,
    version: 0,
    createdAt: input.now,
    updatedAt: input.now,
  };

  const events: PendingIncidentEvent[] = [
    pendingEvent(IncidentEventType.Activated, 'user', input.userId, input.occurredAt, {
      trigger: input.trigger,
      hasInitialLocation: input.location !== null,
      note: input.note,
    }),
  ];

  if (input.location !== null) {
    events.push(
      pendingEvent(
        IncidentEventType.LocationRecorded,
        'user',
        input.userId,
        input.location.capturedAt,
        {
          latitude: input.location.latitude,
          longitude: input.location.longitude,
          accuracyMetres: input.location.accuracyMetres,
        },
      ),
    );
  }

  return { state, events };
}

// Location --------------------------------------------------------------------

export interface RecordLocationInput {
  readonly state: IncidentState;
  readonly actorId: string;
  readonly points: readonly GeoPoint[];
  readonly now: Date;
}

/**
 * Location points arrive in batches from a client that may have been offline.
 *
 * Two things matter here. First, a point older than the one we already hold must not
 * overwrite lastKnownLocation, because a flushed backlog arrives newest-last but not
 * always newest-last-per-batch. Second, every point is still appended to the timeline
 * even if it does not become the latest, because the operator wants the path, not just
 * the endpoint.
 */
export function recordLocation(input: RecordLocationInput): Result<Transition, DomainError> {
  const openError = requireOpen(input.state);
  if (openError) return err(openError);

  if (input.points.length === 0) {
    return err(DomainErrors.validation('At least one location point is required.'));
  }

  const events = input.points.map((point) =>
    pendingEvent(IncidentEventType.LocationRecorded, 'user', input.actorId, point.capturedAt, {
      latitude: point.latitude,
      longitude: point.longitude,
      accuracyMetres: point.accuracyMetres,
    }),
  );

  const newest = input.points.reduce((latest, point) =>
    point.capturedAt.getTime() > latest.capturedAt.getTime() ? point : latest,
  );

  const current = input.state.lastKnownLocation;
  const shouldReplace =
    current === null || newest.capturedAt.getTime() > current.capturedAt.getTime();

  return ok({
    state: bump(input.state, input.now, {
      lastKnownLocation: shouldReplace ? newest : current,
    }),
    events,
  });
}

// Operator claim --------------------------------------------------------------

export interface ClaimInput {
  readonly state: IncidentState;
  readonly operatorId: string;
  readonly expectedVersion: number;
  readonly now: Date;
}

export function claim(input: ClaimInput): Result<Transition, DomainError> {
  const openError = requireOpen(input.state);
  if (openError) return err(openError);

  const versionError = requireVersion(input.state, input.expectedVersion);
  if (versionError) return err(versionError);

  const heldByAnother =
    claimIsHeld(input.state, input.now) && input.state.claimedByOperatorId !== input.operatorId;

  if (heldByAnother) {
    return err(
      DomainErrors.conflict('Another operator is already handling this incident.', {
        claimedByOperatorId: input.state.claimedByOperatorId,
        claimExpiresAt: input.state.claimExpiresAt?.toISOString() ?? null,
      }),
    );
  }

  // Re-claiming your own incident is allowed and simply extends the lease. Operators
  // keep a tab open for a long time and should not lose an incident to their own idle.
  const isExtension = input.state.claimedByOperatorId === input.operatorId;

  return ok({
    state: bump(input.state, input.now, {
      claimedByOperatorId: input.operatorId,
      claimedAt: isExtension ? input.state.claimedAt : input.now,
      claimExpiresAt: new Date(input.now.getTime() + CLAIM_LEASE_MS),
    }),
    events: isExtension
      ? []
      : [
          pendingEvent(IncidentEventType.OperatorClaimed, 'operator', input.operatorId, input.now, {
            previousOperatorId: input.state.claimedByOperatorId,
          }),
        ],
  });
}

export function release(input: ClaimInput): Result<Transition, DomainError> {
  const versionError = requireVersion(input.state, input.expectedVersion);
  if (versionError) return err(versionError);

  if (input.state.claimedByOperatorId !== input.operatorId) {
    return err(DomainErrors.forbidden('You do not hold the claim on this incident.'));
  }

  return ok({
    state: bump(input.state, input.now, {
      claimedByOperatorId: null,
      claimedAt: null,
      claimExpiresAt: null,
    }),
    events: [
      pendingEvent(IncidentEventType.OperatorReleased, 'operator', input.operatorId, input.now, {}),
    ],
  });
}

// Operator actions ------------------------------------------------------------

export interface OperatorNoteInput {
  readonly state: IncidentState;
  readonly operatorId: string;
  readonly note: string;
  readonly expectedVersion: number;
  readonly now: Date;
}

export function addOperatorNote(input: OperatorNoteInput): Result<Transition, DomainError> {
  const versionError = requireVersion(input.state, input.expectedVersion);
  if (versionError) return err(versionError);

  const trimmed = input.note.trim();
  if (trimmed.length === 0) {
    return err(DomainErrors.validation('A note cannot be empty.'));
  }

  // Notes are allowed after resolution. Post-incident review is a real activity and
  // blocking it would push operators into keeping notes somewhere unauditable.
  return ok({
    state: bump(input.state, input.now, {}),
    events: [
      pendingEvent(IncidentEventType.OperatorNoteAdded, 'operator', input.operatorId, input.now, {
        note: trimmed,
      }),
    ],
  });
}

export interface ChangePriorityInput {
  readonly state: IncidentState;
  readonly operatorId: string;
  readonly priority: IncidentPriority;
  readonly reason: string | null;
  readonly expectedVersion: number;
  readonly now: Date;
}

export function changePriority(input: ChangePriorityInput): Result<Transition, DomainError> {
  const openError = requireOpen(input.state);
  if (openError) return err(openError);

  const versionError = requireVersion(input.state, input.expectedVersion);
  if (versionError) return err(versionError);

  if (input.state.priority === input.priority) {
    return err(
      DomainErrors.validation('The incident already has that priority.', {
        priority: input.priority,
      }),
    );
  }

  return ok({
    state: bump(input.state, input.now, { priority: input.priority }),
    events: [
      pendingEvent(IncidentEventType.PriorityChanged, 'operator', input.operatorId, input.now, {
        from: input.state.priority,
        to: input.priority,
        reason: input.reason,
      }),
    ],
  });
}

// Contact acknowledgement -----------------------------------------------------

export interface AcknowledgeInput {
  readonly state: IncidentState;
  readonly contactId: string;
  readonly note: string | null;
  readonly now: Date;
}

/**
 * A trusted contact confirming they have seen the alert.
 *
 * There is no expectedVersion here on purpose. The contact is on a phone, following a
 * link from a text message, with no idea what a version number is. Acknowledgement is
 * idempotent instead: the second tap is accepted and changes nothing.
 */
export function acknowledge(input: AcknowledgeInput): Result<Transition, DomainError> {
  const openError = requireOpen(input.state);
  if (openError) return err(openError);

  if (input.state.acknowledgedByContactId !== null) {
    return ok({ state: input.state, events: [] });
  }

  return ok({
    state: bump(input.state, input.now, {
      status: IncidentStatus.Acknowledged,
      acknowledgedByContactId: input.contactId,
      acknowledgedAt: input.now,
    }),
    events: [
      pendingEvent(
        IncidentEventType.ContactAcknowledged,
        'contact',
        input.contactId,
        input.now,
        input.note === null ? {} : { note: input.note },
      ),
      pendingEvent(IncidentEventType.StatusChanged, 'contact', input.contactId, input.now, {
        from: input.state.status,
        to: IncidentStatus.Acknowledged,
      }),
    ],
  });
}

// Resolution ------------------------------------------------------------------

export interface ResolveInput {
  readonly state: IncidentState;
  readonly actorId: string;
  readonly actorType: 'user' | 'operator';
  readonly resolution: IncidentResolution;
  readonly note: string | null;
  readonly expectedVersion: number;
  readonly now: Date;
}

export function resolve(input: ResolveInput): Result<Transition, DomainError> {
  const openError = requireOpen(input.state);
  if (openError) return err(openError);

  const versionError = requireVersion(input.state, input.expectedVersion);
  if (versionError) return err(versionError);

  // An operator has to hold the claim to resolve. Otherwise two operators can both
  // decide an incident is finished from two different tabs, and the timeline records
  // a resolution by someone who was not actually working it.
  if (input.actorType === 'operator' && input.state.claimedByOperatorId !== input.actorId) {
    return err(DomainErrors.forbidden('Claim the incident before resolving it.'));
  }

  const events: PendingIncidentEvent[] = [
    pendingEvent(IncidentEventType.Resolved, input.actorType, input.actorId, input.now, {
      resolution: input.resolution,
      note: input.note,
    }),
    pendingEvent(IncidentEventType.StatusChanged, input.actorType, input.actorId, input.now, {
      from: input.state.status,
      to: IncidentStatus.Resolved,
    }),
  ];

  return ok({
    state: bump(input.state, input.now, {
      status: IncidentStatus.Resolved,
      resolvedAt: input.now,
      resolvedBy: input.actorId,
      resolution: input.resolution,
      claimedByOperatorId: null,
      claimExpiresAt: null,
    }),
    events,
  });
}
