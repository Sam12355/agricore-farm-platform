import { describe, expect, it } from 'vitest';

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, decodeCursor, encodeCursor, normaliseLimit } from './pagination';

describe('normaliseLimit', () => {
  it('falls back to the default when nothing is asked for', () => {
    expect(normaliseLimit(undefined)).toBe(DEFAULT_PAGE_SIZE);
  });

  it('caps at the maximum so a client cannot ask for the whole table', () => {
    expect(normaliseLimit(10_000)).toBe(MAX_PAGE_SIZE);
  });

  it('raises a zero or negative limit to one', () => {
    expect(normaliseLimit(0)).toBe(1);
    expect(normaliseLimit(-5)).toBe(1);
  });

  it('floors a fractional limit', () => {
    expect(normaliseLimit(7.9)).toBe(7);
  });

  it('ignores a non-finite limit', () => {
    expect(normaliseLimit(Number.POSITIVE_INFINITY)).toBe(DEFAULT_PAGE_SIZE);
  });
});

describe('cursor encoding', () => {
  it('round-trips', () => {
    const payload = { sortValue: '2026-01-01T00:00:00.000Z', id: 'incident-123' };
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
  });

  it('round-trips when the sort value itself contains the separator', () => {
    const payload = { sortValue: 'a|b|c', id: 'incident-9' };
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
  });

  it('returns null for a cursor that is not ours', () => {
    expect(decodeCursor('not-a-cursor')).toBeNull();
  });

  it('returns null for a structurally wrong cursor rather than throwing', () => {
    const malformed = Buffer.from('nosseparator', 'utf8').toString('base64url');
    expect(decodeCursor(malformed)).toBeNull();
  });

  it('produces a url-safe string', () => {
    const cursor = encodeCursor({ sortValue: '2026-01-01T00:00:00.000Z', id: 'a/b+c' });
    expect(cursor).not.toMatch(/[+/=]/);
  });
});
