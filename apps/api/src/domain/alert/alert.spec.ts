import { AlertPriority, AlertStatus, type GeoPoint } from '@agricore/shared-types';

import {
  CLAIM_LEASE_MS,
  acknowledge,
  activate,
  addManagerNote,
  changePriority,
  claim,
  claimIsHeld,
  recordLocation,
  release,
  resolve,
  type AlertState,
} from './alert';

const NOW = new Date('2026-03-14T19:45:00.000Z');
const USER = 'user-1';
const MANAGER_A = 'manager-a';
const MANAGER_B = 'manager-b';

function point(overrides: Partial<GeoPoint> = {}): GeoPoint {
  return {
    latitude: 53.5,
    longitude: 3.2,
    accuracyMetres: 12,
    capturedAt: NOW,
    ...overrides,
  };
}

function anActiveAlert(overrides: Partial<AlertState> = {}): AlertState {
  const { state } = activate({
    id: 'alert-1',
    userId: USER,
    sessionId: null,
    trigger: 'field_countdown',
    location: null,
    note: null,
    occurredAt: NOW,
    now: NOW,
  });
  return { ...state, ...overrides };
}

describe('activate', () => {
  it('opens the alert as active and standard priority', () => {
    const { state } = activate({
      id: 'alert-1',
      userId: USER,
      sessionId: null,
      trigger: 'field_countdown',
      location: null,
      note: null,
      occurredAt: NOW,
      now: NOW,
    });

    expect(state.status).toBe(AlertStatus.Active);
    expect(state.priority).toBe(AlertPriority.Standard);
    expect(state.version).toBe(0);
    expect(state.claimedByManagerId).toBeNull();
  });

  it('emits exactly one event when there is no initial location', () => {
    const { events } = activate({
      id: 'alert-1',
      userId: USER,
      sessionId: null,
      trigger: 'field_countdown',
      location: null,
      note: null,
      occurredAt: NOW,
      now: NOW,
    });
    expect(events.map((e) => e.type)).toEqual(['alert.activated']);
  });

  it('records the initial fix as a separate timeline event', () => {
    const { state, events } = activate({
      id: 'alert-1',
      userId: USER,
      sessionId: null,
      trigger: 'manual_report',
      location: point(),
      note: null,
      occurredAt: NOW,
      now: NOW,
    });

    expect(events.map((e) => e.type)).toEqual([
      'alert.activated',
      'alert.location_recorded',
    ]);
    expect(state.lastKnownLocation).not.toBeNull();
  });

  it('uses the reported occurrence time, not the server time, when a client was offline', () => {
    const happenedAt = new Date('2026-03-14T19:30:00.000Z');
    const receivedAt = new Date('2026-03-14T19:52:00.000Z');

    const { state, events } = activate({
      id: 'alert-1',
      userId: USER,
      sessionId: null,
      trigger: 'field_countdown',
      location: null,
      note: null,
      occurredAt: happenedAt,
      now: receivedAt,
    });

    expect(state.activatedAt).toEqual(happenedAt);
    expect(state.createdAt).toEqual(receivedAt);
    expect(events[0]?.occurredAt).toEqual(happenedAt);
  });
});

describe('recordLocation', () => {
  it('accepts a batch and appends one event per point', () => {
    const state = anActiveAlert();
    const result = recordLocation({
      state,
      actorId: USER,
      points: [
        point({ capturedAt: new Date(NOW.getTime() + 1000) }),
        point({ capturedAt: new Date(NOW.getTime() + 2000) }),
      ],
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.events).toHaveLength(2);
    expect(result.value.state.version).toBe(state.version + 1);
  });

  it('takes the newest point as the last known location, whatever order it arrived in', () => {
    const state = anActiveAlert();
    const older = point({ capturedAt: new Date(NOW.getTime() + 1000), latitude: 1 });
    const newer = point({ capturedAt: new Date(NOW.getTime() + 9000), latitude: 2 });

    // Deliberately out of order, which is what a flushed offline queue looks like.
    const result = recordLocation({ state, actorId: USER, points: [newer, older], now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.lastKnownLocation?.latitude).toBe(2);
  });

  it('does not let a stale backfilled point overwrite a newer known position', () => {
    const current = point({ capturedAt: new Date(NOW.getTime() + 60_000), latitude: 9 });
    const state = anActiveAlert({ lastKnownLocation: current });

    const result = recordLocation({
      state,
      actorId: USER,
      points: [point({ capturedAt: new Date(NOW.getTime() + 5_000), latitude: 1 })],
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The old point is still on the timeline, it just is not "where they are now".
    expect(result.value.state.lastKnownLocation?.latitude).toBe(9);
    expect(result.value.events).toHaveLength(1);
  });

  it('refuses location updates once the alert is resolved', () => {
    const state = anActiveAlert({ status: AlertStatus.Resolved });
    const result = recordLocation({ state, actorId: USER, points: [point()], now: NOW });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_STATE');
  });

  it('rejects an empty batch', () => {
    const result = recordLocation({
      state: anActiveAlert(),
      actorId: USER,
      points: [],
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });
});

describe('claim', () => {
  it('lets an unclaimed alert be claimed and sets a lease', () => {
    const state = anActiveAlert();
    const result = claim({ state, managerId: MANAGER_A, expectedVersion: 0, now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.claimedByManagerId).toBe(MANAGER_A);
    expect(result.value.state.claimExpiresAt?.getTime()).toBe(NOW.getTime() + CLAIM_LEASE_MS);
    expect(result.value.events.map((e) => e.type)).toEqual(['alert.manager_claimed']);
  });

  it('refuses a second manager while the lease is live', () => {
    const claimed = claim({
      state: anActiveAlert(),
      managerId: MANAGER_A,
      expectedVersion: 0,
      now: NOW,
    });
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;

    const result = claim({
      state: claimed.value.state,
      managerId: MANAGER_B,
      expectedVersion: claimed.value.state.version,
      now: new Date(NOW.getTime() + 1000),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONFLICT');
    expect(result.error.details?.['claimedByManagerId']).toBe(MANAGER_A);
  });

  it('lets another manager take over once the lease has expired', () => {
    const claimed = claim({
      state: anActiveAlert(),
      managerId: MANAGER_A,
      expectedVersion: 0,
      now: NOW,
    });
    if (!claimed.ok) throw new Error('setup failed');

    const afterLease = new Date(NOW.getTime() + CLAIM_LEASE_MS + 1);
    const result = claim({
      state: claimed.value.state,
      managerId: MANAGER_B,
      expectedVersion: claimed.value.state.version,
      now: afterLease,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.claimedByManagerId).toBe(MANAGER_B);
  });

  it('extends the lease without emitting a duplicate claim event for the same manager', () => {
    const first = claim({
      state: anActiveAlert(),
      managerId: MANAGER_A,
      expectedVersion: 0,
      now: NOW,
    });
    if (!first.ok) throw new Error('setup failed');

    const later = new Date(NOW.getTime() + 60_000);
    const second = claim({
      state: first.value.state,
      managerId: MANAGER_A,
      expectedVersion: first.value.state.version,
      now: later,
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.events).toHaveLength(0);
    expect(second.value.state.claimedAt).toEqual(NOW);
    expect(second.value.state.claimExpiresAt?.getTime()).toBe(later.getTime() + CLAIM_LEASE_MS);
  });

  it('rejects a claim carrying a stale version', () => {
    const state = anActiveAlert({ version: 4 });
    const result = claim({ state, managerId: MANAGER_A, expectedVersion: 2, now: NOW });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('STALE_VERSION');
    expect(result.error.details).toEqual({ expectedVersion: 2, currentVersion: 4 });
  });
});

describe('claimIsHeld', () => {
  it('is false for an unclaimed alert', () => {
    expect(claimIsHeld(anActiveAlert(), NOW)).toBe(false);
  });

  it('is false once the lease has lapsed', () => {
    const state = anActiveAlert({
      claimedByManagerId: MANAGER_A,
      claimExpiresAt: new Date(NOW.getTime() - 1),
    });
    expect(claimIsHeld(state, NOW)).toBe(false);
  });
});

describe('release', () => {
  it('clears the claim for the holder', () => {
    const claimed = claim({
      state: anActiveAlert(),
      managerId: MANAGER_A,
      expectedVersion: 0,
      now: NOW,
    });
    if (!claimed.ok) throw new Error('setup failed');

    const result = release({
      state: claimed.value.state,
      managerId: MANAGER_A,
      expectedVersion: claimed.value.state.version,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.claimedByManagerId).toBeNull();
  });

  it('refuses to let someone release a claim they do not hold', () => {
    const claimed = claim({
      state: anActiveAlert(),
      managerId: MANAGER_A,
      expectedVersion: 0,
      now: NOW,
    });
    if (!claimed.ok) throw new Error('setup failed');

    const result = release({
      state: claimed.value.state,
      managerId: MANAGER_B,
      expectedVersion: claimed.value.state.version,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('FORBIDDEN');
  });
});

describe('changePriority', () => {
  it('records the transition with both ends of the change', () => {
    const result = changePriority({
      state: anActiveAlert(),
      managerId: MANAGER_A,
      priority: AlertPriority.High,
      reason: 'No position update for four minutes',
      expectedVersion: 0,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.events[0]?.payload).toMatchObject({ from: 'standard', to: 'high' });
  });

  it('rejects a change to the priority it already has', () => {
    const result = changePriority({
      state: anActiveAlert(),
      managerId: MANAGER_A,
      priority: AlertPriority.Standard,
      reason: null,
      expectedVersion: 0,
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a change on a resolved alert', () => {
    const result = changePriority({
      state: anActiveAlert({ status: AlertStatus.Resolved }),
      managerId: MANAGER_A,
      priority: AlertPriority.High,
      reason: null,
      expectedVersion: 0,
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });
});

describe('addManagerNote', () => {
  it('trims the note', () => {
    const result = addManagerNote({
      state: anActiveAlert(),
      managerId: MANAGER_A,
      note: '   called the subject, no answer   ',
      expectedVersion: 0,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.events[0]?.payload['note']).toBe('called the subject, no answer');
  });

  it('rejects a note that is only whitespace', () => {
    const result = addManagerNote({
      state: anActiveAlert(),
      managerId: MANAGER_A,
      note: '    ',
      expectedVersion: 0,
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it('allows a note after resolution, because post-alert review is real work', () => {
    const result = addManagerNote({
      state: anActiveAlert({ status: AlertStatus.Resolved }),
      managerId: MANAGER_A,
      note: 'Debrief: worker chain worked as expected.',
      expectedVersion: 0,
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });
});

describe('acknowledge', () => {
  it('moves the alert to acknowledged and records who did it', () => {
    const result = acknowledge({
      state: anActiveAlert(),
      workerId: 'worker-1',
      note: 'Calling her now',
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.status).toBe(AlertStatus.Acknowledged);
    expect(result.value.state.acknowledgedByWorkerId).toBe('worker-1');
    expect(result.value.events.map((e) => e.type)).toEqual([
      'alert.worker_acknowledged',
      'alert.status_changed',
    ]);
  });

  it('is idempotent, because a worker will tap the link more than once', () => {
    const first = acknowledge({
      state: anActiveAlert(),
      workerId: 'worker-1',
      note: null,
      now: NOW,
    });
    if (!first.ok) throw new Error('setup failed');

    const second = acknowledge({
      state: first.value.state,
      workerId: 'worker-2',
      note: null,
      now: new Date(NOW.getTime() + 5000),
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.events).toHaveLength(0);
    expect(second.value.state.version).toBe(first.value.state.version);
    expect(second.value.state.acknowledgedByWorkerId).toBe('worker-1');
  });

  it('refuses acknowledgement of a resolved alert', () => {
    const result = acknowledge({
      state: anActiveAlert({ status: AlertStatus.Resolved }),
      workerId: 'worker-1',
      note: null,
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });
});

describe('resolve', () => {
  it('lets the subject resolve their own alert without a claim', () => {
    const result = resolve({
      state: anActiveAlert(),
      actorId: USER,
      actorType: 'user',
      resolution: 'issue_cleared',
      note: null,
      expectedVersion: 0,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.status).toBe(AlertStatus.Resolved);
    expect(result.value.state.resolution).toBe('issue_cleared');
  });

  it('requires a manager to hold the claim first', () => {
    const result = resolve({
      state: anActiveAlert(),
      actorId: MANAGER_A,
      actorType: 'manager',
      resolution: 'false_alarm',
      note: null,
      expectedVersion: 0,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('FORBIDDEN');
  });

  it('lets the claim holder resolve, and drops the claim on the way out', () => {
    const claimed = claim({
      state: anActiveAlert(),
      managerId: MANAGER_A,
      expectedVersion: 0,
      now: NOW,
    });
    if (!claimed.ok) throw new Error('setup failed');

    const result = resolve({
      state: claimed.value.state,
      actorId: MANAGER_A,
      actorType: 'manager',
      resolution: 'issue_cleared',
      note: 'Worker confirmed the block is clear, over the radio.',
      expectedVersion: claimed.value.state.version,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.claimedByManagerId).toBeNull();
    expect(result.value.state.resolvedBy).toBe(MANAGER_A);
  });

  it('refuses to resolve twice', () => {
    const state = anActiveAlert({ status: AlertStatus.Resolved });
    const result = resolve({
      state,
      actorId: USER,
      actorType: 'user',
      resolution: 'issue_cleared',
      note: null,
      expectedVersion: state.version,
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a resolution carrying a stale version', () => {
    const state = anActiveAlert({ version: 7 });
    const result = resolve({
      state,
      actorId: USER,
      actorType: 'user',
      resolution: 'issue_cleared',
      note: null,
      expectedVersion: 3,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('STALE_VERSION');
  });
});

describe('append-only guarantee', () => {
  it('never produces a transition that removes or edits an earlier event', () => {
    // Every transition returns only new events. There is no code path in the aggregate
    // that takes existing events as input, which is the structural reason the timeline
    // cannot be rewritten. This test exists so that stays true.
    const state = anActiveAlert();
    const transitions = [
      recordLocation({ state, actorId: USER, points: [point()], now: NOW }),
      claim({ state, managerId: MANAGER_A, expectedVersion: 0, now: NOW }),
      addManagerNote({ state, managerId: MANAGER_A, note: 'x', expectedVersion: 0, now: NOW }),
      acknowledge({ state, workerId: 'c1', note: null, now: NOW }),
    ];

    for (const transition of transitions) {
      expect(transition.ok).toBe(true);
      if (!transition.ok) continue;
      for (const event of transition.value.events) {
        expect(event).not.toHaveProperty('sequence');
        expect(event).not.toHaveProperty('id');
      }
    }
  });
});
