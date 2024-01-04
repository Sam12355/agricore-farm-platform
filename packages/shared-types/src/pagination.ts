/**
 * Cursor pagination rather than offset.
 *
 * The operator queue receives inserts continuously. With OFFSET, an incident arriving
 * between page one and page two shifts everything down and the operator silently skips
 * a row. An opaque cursor anchored on (sortKey, id) does not have that problem.
 */

export interface PageRequest {
  readonly limit: number;
  readonly cursor?: string | undefined;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export function normaliseLimit(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return DEFAULT_PAGE_SIZE;
  const floored = Math.floor(requested);
  if (floored < 1) return 1;
  if (floored > MAX_PAGE_SIZE) return MAX_PAGE_SIZE;
  return floored;
}

export interface CursorPayload {
  readonly sortValue: string;
  readonly id: string;
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(`${payload.sortValue}|${payload.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const separator = decoded.lastIndexOf('|');
    if (separator <= 0) return null;
    const sortValue = decoded.slice(0, separator);
    const id = decoded.slice(separator + 1);
    if (sortValue.length === 0 || id.length === 0) return null;
    return { sortValue, id };
  } catch {
    return null;
  }
}

export function emptyPage<T>(): Page<T> {
  return { items: [], nextCursor: null, hasMore: false };
}
