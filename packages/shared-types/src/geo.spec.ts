import { describe, expect, it } from 'vitest';

import { coarsen, createGeoPoint, distanceMetres, isCoarse } from './geo';

const captured = new Date('2026-01-01T12:00:00.000Z');

describe('createGeoPoint', () => {
  it('accepts a valid fix', () => {
    const result = createGeoPoint({
      latitude: 52.3676,
      longitude: 4.9041,
      accuracyMetres: 12,
      capturedAt: captured,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.latitude).toBeCloseTo(52.3676);
      expect(result.value.accuracyMetres).toBe(12);
    }
  });

  it.each([
    ['latitude above range', 91, 0],
    ['latitude below range', -91, 0],
    ['longitude above range', 0, 181],
    ['longitude below range', 0, -181],
  ])('rejects %s', (_label, latitude, longitude) => {
    const result = createGeoPoint({
      latitude,
      longitude,
      accuracyMetres: 10,
      capturedAt: captured,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-finite coordinate', () => {
    const result = createGeoPoint({
      latitude: Number.NaN,
      longitude: 0,
      accuracyMetres: 10,
      capturedAt: captured,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects negative accuracy', () => {
    const result = createGeoPoint({
      latitude: 0,
      longitude: 0,
      accuracyMetres: -1,
      capturedAt: captured,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid capture time', () => {
    const result = createGeoPoint({
      latitude: 0,
      longitude: 0,
      accuracyMetres: 10,
      capturedAt: new Date('not a date'),
    });
    expect(result.ok).toBe(false);
  });
});

describe('isCoarse', () => {
  it('flags a fix worse than the threshold', () => {
    const point = createGeoPoint({
      latitude: 0,
      longitude: 0,
      accuracyMetres: 1200,
      capturedAt: captured,
    });
    expect(point.ok && isCoarse(point.value)).toBe(true);
  });

  it('does not flag a precise fix', () => {
    const point = createGeoPoint({
      latitude: 0,
      longitude: 0,
      accuracyMetres: 8,
      capturedAt: captured,
    });
    expect(point.ok && isCoarse(point.value)).toBe(false);
  });
});

describe('distanceMetres', () => {
  it('is zero for the same point', () => {
    expect(distanceMetres({ latitude: 10, longitude: 10 }, { latitude: 10, longitude: 10 })).toBe(0);
  });

  it('gives roughly 111 km for one degree of latitude', () => {
    const distance = distanceMetres(
      { latitude: 0, longitude: 0 },
      { latitude: 1, longitude: 0 },
    );
    expect(distance).toBeGreaterThan(110_000);
    expect(distance).toBeLessThan(112_000);
  });

  it('is symmetric', () => {
    const a = { latitude: 52.37, longitude: 4.9 };
    const b = { latitude: 51.92, longitude: 4.48 };
    expect(distanceMetres(a, b)).toBeCloseTo(distanceMetres(b, a), 6);
  });
});

describe('coarsen', () => {
  it('reduces precision to the requested number of decimals', () => {
    const result = coarsen({ latitude: 52.376712, longitude: 4.904139 }, 3);
    expect(result.latitude).toBe(52.377);
    expect(result.longitude).toBe(4.904);
  });

  it('drops enough precision that a street address cannot be recovered', () => {
    const exact = { latitude: 52.376712, longitude: 4.904139 };
    const rounded = coarsen(exact, 3);
    expect(distanceMetres(exact, rounded)).toBeLessThan(120);
    expect(rounded.latitude).not.toBe(exact.latitude);
  });
});
