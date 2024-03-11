import { describe, expect, it } from 'vitest';

import { SeededRandom } from './random';
import { ALL_SCENARIO_KINDS, DEMO_ACCOUNTS, buildScenario } from './scenarios';
import { syntheticPerson, syntheticTrack } from './synthetic';

describe('SeededRandom', () => {
  it('produces the same sequence for the same seed', () => {
    const a = new SeededRandom(42);
    const b = new SeededRandom(42);
    const first = Array.from({ length: 20 }, () => a.next());
    const second = Array.from({ length: 20 }, () => b.next());
    expect(first).toEqual(second);
  });

  it('produces a different sequence for a different seed', () => {
    const a = new SeededRandom(1);
    const b = new SeededRandom(2);
    expect(a.next()).not.toBe(b.next());
  });

  it('stays inside the unit interval', () => {
    const random = new SeededRandom(7);
    for (let i = 0; i < 1000; i += 1) {
      const value = random.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('respects integer bounds', () => {
    const random = new SeededRandom(9);
    for (let i = 0; i < 500; i += 1) {
      const value = random.int(3, 7);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(7);
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('generates uuid-shaped identifiers', () => {
    const random = new SeededRandom(11);
    for (let i = 0; i < 50; i += 1) {
      expect(random.uuid()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });

  it('refuses to pick from an empty list rather than returning undefined', () => {
    expect(() => new SeededRandom(1).pick([])).toThrow();
  });
});

describe('synthetic identities', () => {
  it('only ever uses reserved example domains', () => {
    const random = new SeededRandom(3);
    for (let i = 0; i < 200; i += 1) {
      expect(syntheticPerson(random, i).email).toMatch(/@example\.(com|org)$/);
    }
  });

  it('only ever uses phone ranges reserved for fiction', () => {
    const random = new SeededRandom(4);
    for (let i = 0; i < 200; i += 1) {
      const { phone } = syntheticPerson(random, i);
      const isNorthAmericanFiction = /^\+1 555 01\d{2}$/.test(phone);
      const isUkDrama = /^\+44 7700 900\d{3}$/.test(phone);
      expect(isNorthAmericanFiction || isUkDrama, phone).toBe(true);
    }
  });

  it('gives every generated person a unique email even when names repeat', () => {
    const random = new SeededRandom(5);
    const emails = new Set<string>();
    for (let i = 0; i < 300; i += 1) emails.add(syntheticPerson(random, i).email);
    expect(emails.size).toBe(300);
  });
});

describe('synthetic tracks', () => {
  it('produces a walkable path rather than teleporting between points', () => {
    const random = new SeededRandom(6);
    const track = syntheticTrack(random, 40, new Date('2026-03-14T19:45:00.000Z'), 20);

    for (let i = 1; i < track.length; i += 1) {
      const previous = track[i - 1];
      const current = track[i];
      if (!previous || !current) throw new Error('track is unexpectedly sparse');

      const metresPerDegree = 111_320;
      const dLat = (current.latitude - previous.latitude) * metresPerDegree;
      const dLon = (current.longitude - previous.longitude) * metresPerDegree * Math.cos((53.5 * Math.PI) / 180);
      const stepMetres = Math.hypot(dLat, dLon);

      // 20 seconds apart, so anything over 100 m would be roughly 18 km/h on foot.
      expect(stepMetres).toBeLessThan(100);
    }
  });

  it('advances capture times monotonically', () => {
    const random = new SeededRandom(8);
    const track = syntheticTrack(random, 10, new Date('2026-03-14T19:45:00.000Z'), 20);
    for (let i = 1; i < track.length; i += 1) {
      const previous = track[i - 1];
      const current = track[i];
      if (!previous || !current) throw new Error('track is unexpectedly sparse');
      expect(current.capturedAt.getTime()).toBeGreaterThan(previous.capturedAt.getTime());
    }
  });

  it('stays near the invented origin and nowhere near a real city', () => {
    const random = new SeededRandom(10);
    const track = syntheticTrack(random, 50, new Date('2026-03-14T19:45:00.000Z'));
    for (const point of track) {
      expect(Math.abs(point.latitude - 53.5)).toBeLessThan(0.2);
      expect(Math.abs(point.longitude - 3.2)).toBeLessThan(0.3);
    }
  });
});

describe('demo accounts', () => {
  it('uses reserved domains', () => {
    for (const account of DEMO_ACCOUNTS) {
      expect(account.email).toMatch(/@example\.com$/);
    }
  });

  it('includes two operators so multi-operator behaviour can be demonstrated', () => {
    expect(DEMO_ACCOUNTS.filter((a) => a.role === 'operator')).toHaveLength(2);
  });
});

describe('scenarios', () => {
  it.each(ALL_SCENARIO_KINDS)('%s builds deterministically', (kind) => {
    const first = buildScenario(kind, 999);
    const second = buildScenario(kind, 999);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('gives the cancelled countdown no location track, because nothing was activated', () => {
    expect(buildScenario('cancelled_countdown').track).toHaveLength(0);
  });

  it('gives the escalation scenario three contacts so there is somewhere to escalate to', () => {
    expect(buildScenario('no_acknowledgement_escalation').contacts).toHaveLength(3);
  });

  it('orders contact priority from one upwards', () => {
    const scenario = buildScenario('clean_resolution');
    expect(scenario.contacts.map((c) => c.priority)).toEqual([1, 2]);
  });

  it('states an expected outcome for every scenario', () => {
    for (const kind of ALL_SCENARIO_KINDS) {
      expect(buildScenario(kind).expectedOutcome.length).toBeGreaterThan(10);
    }
  });
});
