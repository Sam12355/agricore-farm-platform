import { IncidentPriority, IncidentStatus, type GeoPoint } from '@guardianlink/shared-types';

import {
  CLAIM_LEASE_MS,
  acknowledge,
  activate,
  addOperatorNote,
  changePriority,
  claim,
  claimIsHeld,
  recordLocation,
  release,
  resolve,
  type IncidentState,
} from './incident';

const NOW = new Date('2026-03-14T19:45:00.000Z');
const USER = 'user-1';
const OPERATOR_A = 'operator-a';
const OPERATOR_B = 'operator-b';

function point(overrides: Partial<GeoPoint> = {}): GeoPoint {
  return {
    latitude: 53.5,
    longitude: 3.2,
    accuracyMetres: 12,
    capturedAt: NOW,
    ...overrides,
  };
}

function anActiveIncident(overrides: Partial<IncidentState> = {}): IncidentState {
  const { state } = activate({
    id: 'incident-1',
    userId: USER,
    sessionId: null,
    trigger: 'sos_countdown',
    location: null,
    note: null,
    occurredAt: NOW,
    now: NOW,
  });
  return { ...state, ...overrides };
}

describe('activate', () => {
  it('opens the incident as active and standard priority', () => {
    const { state } = activate({
      id: 'incident-1',
      userId: USER,
      sessionId: null,
      trigger: 'sos_countdown',
      location: null,
      note: null,
      occurredAt: NOW,
      now: NOW,
    });

    expect(state.status).toBe(IncidentStatus.Active);
    expect(state.priority).toBe(IncidentPriority.Standard);
    expect(state.version).toBe(0);
    expect(state.claimedByOperatorId).toBeNull();
  });

  it('emits exactly one event when there is no initial location', () => {
    const { events } = activate({
      id: 'incident-1',
      userId: USER,
      sessionId: null,
      trigger: 'sos_countdown',
      location: null,
      note: null,
      occurredAt: NOW,
      now: NOW,
    });
    expect(events.map((e) => e.type)).toEqual(['incident.activated']);
  });

  it('records the initial fix as a separate timeline event', () => {
    const { state, events } = activate({
      id: 'incident-1',
      userId: USER,
      sessionId: null,
      trigger: 'manual_panic',
      location: point(),
      note: null,
      occurredAt: NOW,
      now: NOW,
    });

    expect(events.map((e) => e.type)).toEqual([
      'incident.activated',
      'incident.location_recorded',
    ]);
    expect(state.lastKnownLocation).not.toBeNull();
  });

  it('uses the reported occurrence time, not the server time, when a client was offline', () => {
    const happenedAt = new Date('2026-03-14T19:30:00.000Z');
    const receivedAt = new Date('2026-03-14T19:52:00.000Z');

    const { state, events } = activate({
      id: 'incident-1',
      userId: USER,
      sessionId: null,
      trigger: 'sos_countdown',
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
    const state = anActiveIncident();
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
    const state = anActiveIncident();
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
    const state = anActiveIncident({ lastKnownLocation: current });

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

  it('refuses location updates once the incident is resolved', () => {
    const state = anActiveIncident({ status: IncidentStatus.Resolved });
    const result = recordLocation({ state, actorId: USER, points: [point()], now: NOW });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_STATE');
  });

  it('rejects an empty batch', () => {
    const result = recordLocation({
      state: anActiveIncident(),
      actorId: USER,
      points: [],
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });
});

describe('claim', () => {
  it('lets an unclaimed incident be claimed and sets a lease', () => {
    const state = anActiveIncident();
    const result = claim({ state, operatorId: OPERATOR_A, expectedVersion: 0, now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.claimedByOperatorId).toBe(OPERATOR_A);
    expect(result.value.state.claimExpiresAt?.getTime()).toBe(NOW.getTime() + CLAIM_LEASE_MS);
    expect(result.value.events.map((e) => e.type)).toEqual(['incident.operator_claimed']);
  });

  it('refuses a second operator while the lease is live', () => {
    const claimed = claim({
      state: anActiveIncident(),
      operatorId: OPERATOR_A,
      expectedVersion: 0,
      now: NOW,
    });
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;

    const result = claim({
      state: claimed.value.state,
      operatorId: OPERATOR_B,
      expectedVersion: claimed.value.state.version,
      now: new Date(NOW.getTime() + 1000),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONFLICT');
    expect(result.error.details?.['claimedByOperatorId']).toBe(OPERATOR_A);
  });

  it('lets another operator take over once the lease has expired', () => {
    const claimed = claim({
      state: anActiveIncident(),
      operatorId: OPERATOR_A,
      expectedVersion: 0,
      now: NOW,
    });
    if (!claimed.ok) throw new Error('setup failed');

    const afterLease = new Date(NOW.getTime() + CLAIM_LEASE_MS + 1);
    const result = claim({
      state: claimed.value.state,
      operatorId: OPERATOR_B,
      expectedVersion: claimed.value.state.version,
      now: afterLease,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.claimedByOperatorId).toBe(OPERATOR_B);
  });

  it('extends the lease without emitting a duplicate claim event for the same operator', () => {
    const first = claim({
      state: anActiveIncident(),
      operatorId: OPERATOR_A,
      expectedVersion: 0,
      now: NOW,
    });
    if (!first.ok) throw new Error('setup failed');

    const later = new Date(NOW.getTime() + 60_000);
    const second = claim({
      state: first.value.state,
      operatorId: OPERATOR_A,
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
    const state = anActiveIncident({ version: 4 });
    const result = claim({ state, operatorId: OPERATOR_A, expectedVersion: 2, now: NOW });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('STALE_VERSION');
    expect(result.error.details).toEqual({ expectedVersion: 2, currentVersion: 4 });
  });
});

describe('claimIsHeld', () => {
  it('is false for an unclaimed incident', () => {
    expect(claimIsHeld(anActiveIncident(), NOW)).toBe(false);
  });

  it('is false once the lease has lapsed', () => {
    const state = anActiveIncident({
      claimedByOperatorId: OPERATOR_A,
      claimExpiresAt: new Date(NOW.getTime() - 1),
    });
    expect(claimIsHeld(state, NOW)).toBe(false);
  });
});

describe('release', () => {
  it('clears the claim for the holder', () => {
    const claimed = claim({
      state: anActiveIncident(),
      operatorId: OPERATOR_A,
      expectedVersion: 0,
      now: NOW,
    });
    if (!claimed.ok) throw new Error('setup failed');

    const result = release({
      state: claimed.value.state,
      operatorId: OPERATOR_A,
      expectedVersion: claimed.value.state.version,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.claimedByOperatorId).toBeNull();
  });

  it('refuses to let someone release a claim they do not hold', () => {
    const claimed = claim({
      state: anActiveIncident(),
      operatorId: OPERATOR_A,
      expectedVersion: 0,
      now: NOW,
    });
    if (!claimed.ok) throw new Error('setup failed');

    const result = release({
      state: claimed.value.state,
      operatorId: OPERATOR_B,
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
      state: anActiveIncident(),
      operatorId: OPERATOR_A,
      priority: IncidentPriority.High,
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
      state: anActiveIncident(),
      operatorId: OPERATOR_A,
      priority: IncidentPriority.Standard,
      reason: null,
      expectedVersion: 0,
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a change on a resolved incident', () => {
    const result = changePriority({
      state: anActiveIncident({ status: IncidentStatus.Resolved }),
      operatorId: OPERATOR_A,
      priority: IncidentPriority.High,
      reason: null,
      expectedVersion: 0,
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });
});

describe('addOperatorNote', () => {
  it('trims the note', () => {
    const result = addOperatorNote({
      state: anActiveIncident(),
      operatorId: OPERATOR_A,
      note: '   called the subject, no answer   ',
      expectedVersion: 0,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.events[0]?.payload['note']).toBe('called the subject, no answer');
  });

  it('rejects a note that is only whitespace', () => {
    const result = addOperatorNote({
      state: anActiveIncident(),
      operatorId: OPERATOR_A,
      note: '    ',
      expectedVersion: 0,
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it('allows a note after resolution, because post-incident review is real work', () => {
    const result = addOperatorNote({
      state: anActiveIncident({ status: IncidentStatus.Resolved }),
      operatorId: OPERATOR_A,
      note: 'Debrief: contact chain worked as expected.',
      expectedVersion: 0,
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });
});

describe('acknowledge', () => {
  it('moves the incident to acknowledged and records who did it', () => {
    const result = acknowledge({
      state: anActiveIncident(),
      contactId: 'contact-1',
      note: 'Calling her now',
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.status).toBe(IncidentStatus.Acknowledged);
    expect(result.value.state.acknowledgedByContactId).toBe('contact-1');
    expect(result.value.events.map((e) => e.type)).toEqual([
      'incident.contact_acknowledged',
      'incident.status_changed',
    ]);
  });

  it('is idempotent, because a contact will tap the link more than once', () => {
    const first = acknowledge({
      state: anActiveIncident(),
      contactId: 'contact-1',
      note: null,
      now: NOW,
    });
    if (!first.ok) throw new Error('setup failed');

    const second = acknowledge({
      state: first.value.state,
      contactId: 'contact-2',
      note: null,
      now: new Date(NOW.getTime() + 5000),
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.events).toHaveLength(0);
    expect(second.value.state.version).toBe(first.value.state.version);
    expect(second.value.state.acknowledgedByContactId).toBe('contact-1');
  });

  it('refuses acknowledgement of a resolved incident', () => {
    const result = acknowledge({
      state: anActiveIncident({ status: IncidentStatus.Resolved }),
      contactId: 'contact-1',
      note: null,
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });
});

describe('resolve', () => {
  it('lets the subject resolve their own incident without a claim', () => {
    const result = resolve({
      state: anActiveIncident(),
      actorId: USER,
      actorType: 'user',
      resolution: 'user_safe',
      note: null,
      expectedVersion: 0,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.status).toBe(IncidentStatus.Resolved);
    expect(result.value.state.resolution).toBe('user_safe');
  });

  it('requires an operator to hold the claim first', () => {
    const result = resolve({
      state: anActiveIncident(),
      actorId: OPERATOR_A,
      actorType: 'operator',
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
      state: anActiveIncident(),
      operatorId: OPERATOR_A,
      expectedVersion: 0,
      now: NOW,
    });
    if (!claimed.ok) throw new Error('setup failed');

    const result = resolve({
      state: claimed.value.state,
      actorId: OPERATOR_A,
      actorType: 'operator',
      resolution: 'user_safe',
      note: 'Subject confirmed safe by phone.',
      expectedVersion: claimed.value.state.version,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.claimedByOperatorId).toBeNull();
    expect(result.value.state.resolvedBy).toBe(OPERATOR_A);
  });

  it('refuses to resolve twice', () => {
    const state = anActiveIncident({ status: IncidentStatus.Resolved });
    const result = resolve({
      state,
      actorId: USER,
      actorType: 'user',
      resolution: 'user_safe',
      note: null,
      expectedVersion: state.version,
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a resolution carrying a stale version', () => {
    const state = anActiveIncident({ version: 7 });
    const result = resolve({
      state,
      actorId: USER,
      actorType: 'user',
      resolution: 'user_safe',
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
    const state = anActiveIncident();
    const transitions = [
      recordLocation({ state, actorId: USER, points: [point()], now: NOW }),
      claim({ state, operatorId: OPERATOR_A, expectedVersion: 0, now: NOW }),
      addOperatorNote({ state, operatorId: OPERATOR_A, note: 'x', expectedVersion: 0, now: NOW }),
      acknowledge({ state, contactId: 'c1', note: null, now: NOW }),
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
