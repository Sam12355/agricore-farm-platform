import { describe, expect, it } from 'vitest';

import type { IncidentDto, IncidentEventDto } from '@guardianlink/contracts';

import {
  applyEvent,
  claimLabel,
  formatAge,
  highestSequence,
  initialQueueState,
  queueReducer,
  sortQueue,
  thinTrack,
} from './incident-view-model';

const NOW = new Date('2026-03-14T20:00:00.000Z');

function anIncident(overrides: Partial<IncidentDto> = {}): IncidentDto {
  return {
    id: 'incident-1',
    userId: 'user-1',
    sessionId: null,
    status: 'active',
    priority: 'standard',
    trigger: 'sos_countdown',
    activatedAt: '2026-03-14T19:45:00.000Z',
    resolvedAt: null,
    resolvedBy: null,
    claimedByOperatorId: null,
    claimedAt: null,
    lastKnownLocation: null,
    version: 1,
    createdAt: '2026-03-14T19:45:00.000Z',
    updatedAt: '2026-03-14T19:45:00.000Z',
    ...overrides,
  };
}

function anEvent(sequence: number, type: IncidentEventDto['type'] = 'incident.activated'): IncidentEventDto {
  return {
    id: `event-${sequence}`,
    incidentId: 'incident-1',
    sequence,
    type,
    actorType: 'user',
    actorId: 'user-1',
    occurredAt: '2026-03-14T19:45:00.000Z',
    recordedAt: '2026-03-14T19:45:00.000Z',
    payload: {},
  };
}

describe('sortQueue', () => {
  it('puts critical above high above standard', () => {
    const rows = [
      { incident: anIncident({ id: 'a', priority: 'standard' }), appliedSequence: 1 },
      { incident: anIncident({ id: 'b', priority: 'critical' }), appliedSequence: 1 },
      { incident: anIncident({ id: 'c', priority: 'high' }), appliedSequence: 1 },
    ];
    expect(sortQueue(rows).map((row) => row.incident.id)).toEqual(['b', 'c', 'a']);
  });

  it('puts the oldest first within a priority band', () => {
    const rows = [
      {
        incident: anIncident({ id: 'newer', activatedAt: '2026-03-14T19:50:00.000Z' }),
        appliedSequence: 1,
      },
      {
        incident: anIncident({ id: 'older', activatedAt: '2026-03-14T19:40:00.000Z' }),
        appliedSequence: 1,
      },
    ];
    // The one that has been waiting longest is the one being neglected.
    expect(sortQueue(rows).map((row) => row.incident.id)).toEqual(['older', 'newer']);
  });
});

describe('queueReducer', () => {
  it('loads an initial set', () => {
    const state = queueReducer(initialQueueState, {
      type: 'loaded',
      incidents: [anIncident({ id: 'a' }), anIncident({ id: 'b' })],
    });
    expect(state.rows).toHaveLength(2);
  });

  it('adds a newly created incident', () => {
    const state = queueReducer(initialQueueState, { type: 'created', incident: anIncident() });
    expect(state.rows).toHaveLength(1);
  });

  it('treats a duplicate create as an update, which is what a reconnect produces', () => {
    const first = queueReducer(initialQueueState, { type: 'created', incident: anIncident() });
    const second = queueReducer(first, {
      type: 'created',
      incident: anIncident({ version: 2, priority: 'high' }),
    });

    expect(second.rows).toHaveLength(1);
    expect(second.rows[0]?.incident.priority).toBe('high');
  });

  it('applies a newer version', () => {
    const loaded = queueReducer(initialQueueState, {
      type: 'loaded',
      incidents: [anIncident({ version: 1 })],
    });
    const updated = queueReducer(loaded, {
      type: 'updated',
      incident: anIncident({ version: 2, priority: 'critical' }),
    });
    expect(updated.rows[0]?.incident.priority).toBe('critical');
  });

  it('ignores an update that arrives carrying an older version', () => {
    // A message that overtook a newer one on the wire. Applying it would show state the
    // console has already moved past.
    const loaded = queueReducer(initialQueueState, {
      type: 'loaded',
      incidents: [anIncident({ version: 5, priority: 'critical' })],
    });
    const stale = queueReducer(loaded, {
      type: 'updated',
      incident: anIncident({ version: 3, priority: 'low' }),
    });

    expect(stale.rows[0]?.incident.priority).toBe('critical');
  });

  it('ignores an update at exactly the applied version, because it is a duplicate', () => {
    const loaded = queueReducer(initialQueueState, {
      type: 'loaded',
      incidents: [anIncident({ version: 4, priority: 'high' })],
    });
    const duplicate = queueReducer(loaded, {
      type: 'updated',
      incident: anIncident({ version: 4, priority: 'low' }),
    });
    expect(duplicate.rows[0]?.incident.priority).toBe('high');
  });

  it('drops an incident from the queue once it resolves', () => {
    const loaded = queueReducer(initialQueueState, {
      type: 'loaded',
      incidents: [anIncident({ version: 1 })],
    });
    const resolved = queueReducer(loaded, {
      type: 'updated',
      incident: anIncident({ version: 2, status: 'resolved' }),
    });
    expect(resolved.rows).toHaveLength(0);
  });

  it('keeps an acknowledged incident in the queue, because it is still open', () => {
    const loaded = queueReducer(initialQueueState, {
      type: 'loaded',
      incidents: [anIncident({ version: 1 })],
    });
    const acknowledged = queueReducer(loaded, {
      type: 'updated',
      incident: anIncident({ version: 2, status: 'acknowledged' }),
    });
    expect(acknowledged.rows).toHaveLength(1);
  });

  it('tracks the connection state so the operator can see when it is stale', () => {
    const state = queueReducer(initialQueueState, { type: 'connection', state: 'reconnecting' });
    expect(state.connectionState).toBe('reconnecting');
  });
});

describe('claimLabel', () => {
  it('reports unclaimed when nobody holds it', () => {
    expect(claimLabel(anIncident(), 'operator-a', NOW)).toBe('unclaimed');
  });

  it('reports mine for the holder', () => {
    const incident = anIncident({
      claimedByOperatorId: 'operator-a',
      claimedAt: '2026-03-14T19:58:00.000Z',
    });
    expect(claimLabel(incident, 'operator-a', NOW)).toBe('mine');
  });

  it('reports other for somebody else', () => {
    const incident = anIncident({
      claimedByOperatorId: 'operator-b',
      claimedAt: '2026-03-14T19:58:00.000Z',
    });
    expect(claimLabel(incident, 'operator-a', NOW)).toBe('other');
  });

  it('reports unclaimed once the lease has lapsed', () => {
    const incident = anIncident({
      claimedByOperatorId: 'operator-b',
      claimedAt: '2026-03-14T19:50:00.000Z',
    });
    // Ten minutes ago, lease is five. The console must show it as available or the
    // operator will not pick up an incident nobody is working.
    expect(claimLabel(incident, 'operator-a', NOW)).toBe('unclaimed');
  });
});

describe('formatAge', () => {
  it.each([
    ['2026-03-14T19:59:30.000Z', 'just now'],
    ['2026-03-14T19:57:00.000Z', '3m'],
    ['2026-03-14T18:30:00.000Z', '1h 30m'],
    ['2026-03-12T20:00:00.000Z', '2d'],
  ])('formats %s as %s', (from, expected) => {
    expect(formatAge(from, NOW)).toBe(expected);
  });

  it('never shows a negative age when a device clock runs ahead', () => {
    expect(formatAge('2026-03-14T20:05:00.000Z', NOW)).toBe('just now');
  });
});

describe('applyEvent', () => {
  it('inserts an out-of-order event in the right place rather than appending', () => {
    const events = [anEvent(1), anEvent(3)];
    const merged = applyEvent(events, anEvent(2));
    expect(merged.map((event) => event.sequence)).toEqual([1, 2, 3]);
  });

  it('drops a duplicate sequence', () => {
    const events = [anEvent(1), anEvent(2)];
    expect(applyEvent(events, anEvent(2))).toHaveLength(2);
  });

  it('does not mutate the array it was given', () => {
    const events = [anEvent(1)];
    applyEvent(events, anEvent(2));
    expect(events).toHaveLength(1);
  });

  it('handles a whole stream delivered backwards', () => {
    let events: IncidentEventDto[] = [];
    for (const sequence of [5, 4, 3, 2, 1]) events = applyEvent(events, anEvent(sequence));
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('highestSequence', () => {
  it('is zero for an empty timeline, meaning nothing applied yet', () => {
    expect(highestSequence([])).toBe(0);
  });

  it('finds the maximum even if the list is unsorted', () => {
    expect(highestSequence([anEvent(3), anEvent(1), anEvent(7)])).toBe(7);
  });
});

describe('thinTrack', () => {
  const track = (count: number, stepDegrees: number) =>
    Array.from({ length: count }, (_unused, index) => ({
      latitude: 53.5 + index * stepDegrees,
      longitude: 3.2,
      capturedAt: new Date(Date.parse('2026-03-14T19:45:00.000Z') + index * 20_000).toISOString(),
    }));

  it('leaves a short track alone', () => {
    const points = track(10, 0.001);
    expect(thinTrack(points, 500)).toHaveLength(10);
  });

  it('always keeps the first and last points', () => {
    const points = track(5000, 0.00002);
    const thinned = thinTrack(points, 500);
    expect(thinned[0]).toEqual(points[0]);
    expect(thinned[thinned.length - 1]).toEqual(points[points.length - 1]);
  });

  it('respects the point cap', () => {
    expect(thinTrack(track(5000, 0.00002), 500).length).toBeLessThanOrEqual(501);
  });

  it('drops points that are too close together to be distinguishable on screen', () => {
    // Roughly 1 m apart. Rendering all of these tells an operator nothing extra.
    const points = track(2000, 0.000009);
    expect(thinTrack(points, 1000, 15).length).toBeLessThan(points.length);
  });

  it('keeps every point when they are far apart, because none are redundant', () => {
    const points = track(100, 0.01);
    expect(thinTrack(points, 1000, 15)).toHaveLength(100);
  });

  it('preserves chronological order', () => {
    const thinned = thinTrack(track(3000, 0.00002), 300);
    for (let i = 1; i < thinned.length; i += 1) {
      const previous = thinned[i - 1];
      const current = thinned[i];
      if (!previous || !current) continue;
      expect(Date.parse(current.capturedAt)).toBeGreaterThan(Date.parse(previous.capturedAt));
    }
  });
});
