import {
  DomainErrors,
  AlertEventType,
  AlertPriority,
  AlertStatus,
  type DomainError,
  type GeoPoint,
  type AlertTrigger,
  err,
  ok,
  type Result,
} from '@agricore/shared-types';

import { pendingEvent, type PendingAlertEvent } from './alert-events';

/**
 * The alert aggregate.
 *
 * Everything here is pure: no database, no clock of its own, no framework. Time arrives
 * as an argument. That makes each rule below directly testable, and it is why the
 * alert tests run in milliseconds without a container.
 *
 * Two rules drive most of the design:
 *
 *   1. The timeline is append-only. No method mutates or removes an event. What
 *      happened, happened, and the record of it is what makes the alert auditable.
 *
 *   2. Every mutation takes an expected version. A console that has been sitting on a
 *      stale alert for two minutes cannot overwrite the work of a manager who has
 *      been actively handling it.
 */

export type AlertResolution = 'issue_cleared' | 'false_alarm' | 'handled_offline' | 'duplicate';

export interface AlertState {
  readonly id: string;
  readonly userId: string;
  readonly sessionId: string | null;
  readonly status: AlertStatus;
  readonly priority: AlertPriority;
  readonly trigger: AlertTrigger;
  readonly activatedAt: Date;
  readonly resolvedAt: Date | null;
  readonly resolvedBy: string | null;
  readonly resolution: AlertResolution | null;
  readonly claimedByManagerId: string | null;
  readonly claimedAt: Date | null;
  readonly claimExpiresAt: Date | null;
  readonly lastKnownLocation: GeoPoint | null;
  readonly acknowledgedByWorkerId: string | null;
  readonly acknowledgedAt: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface Transition {
  readonly state: AlertState;
  readonly events: readonly PendingAlertEvent[];
}

/**
 * How long a claim survives without the manager doing anything.
 *
 * Without a lease, a manager who closes their laptop holds an alert forever and
 * nobody else can pick it up. Five minutes is short enough that a genuinely abandoned
 * alert returns to the queue quickly, and long enough that reading a timeline does
 * not lose you the claim.
 */
export const CLAIM_LEASE_MS = 5 * 60 * 1000;

const ACTIVE_STATUSES: readonly AlertStatus[] = [
  AlertStatus.Active,
  AlertStatus.Acknowledged,
];

export function isOpen(state: AlertState): boolean {
  return ACTIVE_STATUSES.includes(state.status);
}

export function claimIsHeld(state: AlertState, now: Date): boolean {
  if (state.claimedByManagerId === null || state.claimExpiresAt === null) return false;
  return state.claimExpiresAt.getTime() > now.getTime();
}

function bump(state: AlertState, now: Date, changes: Partial<AlertState>): AlertState {
  return { ...state, ...changes, version: state.version + 1, updatedAt: now };
}

function requireVersion(state: AlertState, expectedVersion: number): DomainError | null {
  if (state.version !== expectedVersion) {
    return DomainErrors.staleVersion(expectedVersion, state.version);
  }
  return null;
}

function requireOpen(state: AlertState): DomainError | null {
  if (!isOpen(state)) {
    return DomainErrors.invalidState(`This alert is already ${state.status}.`, {
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
  readonly trigger: AlertTrigger;
  readonly location: GeoPoint | null;
  readonly note: string | null;
  /** When the device says it happened. Falls back to now for an online client. */
  readonly occurredAt: Date;
  readonly now: Date;
}

export function activate(input: ActivateInput): Transition {
  const state: AlertState = {
    id: input.id,
    userId: input.userId,
    sessionId: input.sessionId,
    status: AlertStatus.Active,
    // Everything starts standard. A manager raises it based on what they see, which
    // keeps the priority signal meaningful instead of every alert arriving critical.
    priority: AlertPriority.Standard,
    trigger: input.trigger,
    activatedAt: input.occurredAt,
    resolvedAt: null,
    resolvedBy: null,
    resolution: null,
    claimedByManagerId: null,
    claimedAt: null,
    claimExpiresAt: null,
    lastKnownLocation: input.location,
    acknowledgedByWorkerId: null,
    acknowledgedAt: null,
    version: 0,
    createdAt: input.now,
    updatedAt: input.now,
  };

  const events: PendingAlertEvent[] = [
    pendingEvent(AlertEventType.Activated, 'user', input.userId, input.occurredAt, {
      trigger: input.trigger,
      hasInitialLocation: input.location !== null,
      note: input.note,
    }),
  ];

  if (input.location !== null) {
    events.push(
      pendingEvent(
        AlertEventType.LocationRecorded,
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
  readonly state: AlertState;
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
 * even if it does not become the latest, because the manager wants the path, not just
 * the endpoint.
 */
export function recordLocation(input: RecordLocationInput): Result<Transition, DomainError> {
  const openError = requireOpen(input.state);
  if (openError) return err(openError);

  if (input.points.length === 0) {
    return err(DomainErrors.validation('At least one location point is required.'));
  }

  const events = input.points.map((point) =>
    pendingEvent(AlertEventType.LocationRecorded, 'user', input.actorId, point.capturedAt, {
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

// Manager claim --------------------------------------------------------------

export interface ClaimInput {
  readonly state: AlertState;
  readonly managerId: string;
  readonly expectedVersion: number;
  readonly now: Date;
}

export function claim(input: ClaimInput): Result<Transition, DomainError> {
  const openError = requireOpen(input.state);
  if (openError) return err(openError);

  const versionError = requireVersion(input.state, input.expectedVersion);
  if (versionError) return err(versionError);

  const heldByAnother =
    claimIsHeld(input.state, input.now) && input.state.claimedByManagerId !== input.managerId;

  if (heldByAnother) {
    return err(
      DomainErrors.conflict('Another manager is already handling this alert.', {
        claimedByManagerId: input.state.claimedByManagerId,
        claimExpiresAt: input.state.claimExpiresAt?.toISOString() ?? null,
      }),
    );
  }

  // Re-claiming your own alert is allowed and simply extends the lease. Managers
  // keep a tab open for a long time and should not lose an alert to their own idle.
  const isExtension = input.state.claimedByManagerId === input.managerId;

  return ok({
    state: bump(input.state, input.now, {
      claimedByManagerId: input.managerId,
      claimedAt: isExtension ? input.state.claimedAt : input.now,
      claimExpiresAt: new Date(input.now.getTime() + CLAIM_LEASE_MS),
    }),
    events: isExtension
      ? []
      : [
          pendingEvent(AlertEventType.ManagerClaimed, 'manager', input.managerId, input.now, {
            previousManagerId: input.state.claimedByManagerId,
          }),
        ],
  });
}

export function release(input: ClaimInput): Result<Transition, DomainError> {
  const versionError = requireVersion(input.state, input.expectedVersion);
  if (versionError) return err(versionError);

  if (input.state.claimedByManagerId !== input.managerId) {
    return err(DomainErrors.forbidden('You do not hold the claim on this alert.'));
  }

  return ok({
    state: bump(input.state, input.now, {
      claimedByManagerId: null,
      claimedAt: null,
      claimExpiresAt: null,
    }),
    events: [
      pendingEvent(AlertEventType.ManagerReleased, 'manager', input.managerId, input.now, {}),
    ],
  });
}

// Manager actions ------------------------------------------------------------

export interface ManagerNoteInput {
  readonly state: AlertState;
  readonly managerId: string;
  readonly note: string;
  readonly expectedVersion: number;
  readonly now: Date;
}

export function addManagerNote(input: ManagerNoteInput): Result<Transition, DomainError> {
  const versionError = requireVersion(input.state, input.expectedVersion);
  if (versionError) return err(versionError);

  const trimmed = input.note.trim();
  if (trimmed.length === 0) {
    return err(DomainErrors.validation('A note cannot be empty.'));
  }

  // Notes are allowed after resolution. Post-alert review is a real activity and
  // blocking it would push managers into keeping notes somewhere unauditable.
  return ok({
    state: bump(input.state, input.now, {}),
    events: [
      pendingEvent(AlertEventType.ManagerNoteAdded, 'manager', input.managerId, input.now, {
        note: trimmed,
      }),
    ],
  });
}

export interface ChangePriorityInput {
  readonly state: AlertState;
  readonly managerId: string;
  readonly priority: AlertPriority;
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
      DomainErrors.validation('The alert already has that priority.', {
        priority: input.priority,
      }),
    );
  }

  return ok({
    state: bump(input.state, input.now, { priority: input.priority }),
    events: [
      pendingEvent(AlertEventType.PriorityChanged, 'manager', input.managerId, input.now, {
        from: input.state.priority,
        to: input.priority,
        reason: input.reason,
      }),
    ],
  });
}

// Worker acknowledgement -----------------------------------------------------

export interface AcknowledgeInput {
  readonly state: AlertState;
  readonly workerId: string;
  readonly note: string | null;
  readonly now: Date;
}

/**
 * An assigned worker confirming they have seen the alert.
 *
 * There is no expectedVersion here on purpose. The worker is on a phone, following a
 * link from a text message, with no idea what a version number is. Acknowledgement is
 * idempotent instead: the second tap is accepted and changes nothing.
 */
export function acknowledge(input: AcknowledgeInput): Result<Transition, DomainError> {
  const openError = requireOpen(input.state);
  if (openError) return err(openError);

  if (input.state.acknowledgedByWorkerId !== null) {
    return ok({ state: input.state, events: [] });
  }

  return ok({
    state: bump(input.state, input.now, {
      status: AlertStatus.Acknowledged,
      acknowledgedByWorkerId: input.workerId,
      acknowledgedAt: input.now,
    }),
    events: [
      pendingEvent(
        AlertEventType.WorkerAcknowledged,
        'worker',
        input.workerId,
        input.now,
        input.note === null ? {} : { note: input.note },
      ),
      pendingEvent(AlertEventType.StatusChanged, 'worker', input.workerId, input.now, {
        from: input.state.status,
        to: AlertStatus.Acknowledged,
      }),
    ],
  });
}

// Resolution ------------------------------------------------------------------

export interface ResolveInput {
  readonly state: AlertState;
  readonly actorId: string;
  readonly actorType: 'user' | 'manager';
  readonly resolution: AlertResolution;
  readonly note: string | null;
  readonly expectedVersion: number;
  readonly now: Date;
}

export function resolve(input: ResolveInput): Result<Transition, DomainError> {
  const openError = requireOpen(input.state);
  if (openError) return err(openError);

  const versionError = requireVersion(input.state, input.expectedVersion);
  if (versionError) return err(versionError);

  // A manager has to hold the claim to resolve. Otherwise two managers can both
  // decide an alert is finished from two different tabs, and the timeline records
  // a resolution by someone who was not actually working it.
  if (input.actorType === 'manager' && input.state.claimedByManagerId !== input.actorId) {
    return err(DomainErrors.forbidden('Claim the alert before resolving it.'));
  }

  const events: PendingAlertEvent[] = [
    pendingEvent(AlertEventType.Resolved, input.actorType, input.actorId, input.now, {
      resolution: input.resolution,
      note: input.note,
    }),
    pendingEvent(AlertEventType.StatusChanged, input.actorType, input.actorId, input.now, {
      from: input.state.status,
      to: AlertStatus.Resolved,
    }),
  ];

  return ok({
    state: bump(input.state, input.now, {
      status: AlertStatus.Resolved,
      resolvedAt: input.now,
      resolvedBy: input.actorId,
      resolution: input.resolution,
      claimedByManagerId: null,
      claimExpiresAt: null,
    }),
    events,
  });
}
