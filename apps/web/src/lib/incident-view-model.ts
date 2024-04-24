import type { IncidentDto, IncidentEventDto } from '@guardianlink/contracts';

/**
 * The console's view model, kept out of React entirely.
 *
 * All the logic a live incident list needs is here as pure functions: applying an event
 * that may have arrived out of order, deciding whether a claim is still held, formatting
 * an age, thinning a location track. None of it needs a renderer to test, which is why
 * this file has the console's test coverage and the components have almost none.
 */

export interface IncidentRow {
  readonly incident: IncidentDto;
  /** Highest sequence applied. Anything at or below this is a duplicate and dropped. */
  readonly appliedSequence: number;
}

export type QueueState = {
  readonly rows: readonly IncidentRow[];
  readonly connectionState: 'connecting' | 'live' | 'reconnecting' | 'offline';
  readonly lastError: string | null;
};

export const initialQueueState: QueueState = {
  rows: [],
  connectionState: 'connecting',
  lastError: null,
};

export type QueueAction =
  | { type: 'loaded'; incidents: readonly IncidentDto[] }
  | { type: 'created'; incident: IncidentDto }
  | { type: 'updated'; incident: IncidentDto }
  | { type: 'connection'; state: QueueState['connectionState'] }
  | { type: 'error'; message: string };

/**
 * Sorted by priority, then by age.
 *
 * The list is what an operator's eye lands on first, so the ordering is doing real work:
 * critical always above high, and within a band the oldest first, because an incident
 * that has been waiting is the one being neglected.
 */
const PRIORITY_ORDER: Record<IncidentDto['priority'], number> = {
  critical: 0,
  high: 1,
  standard: 2,
  low: 3,
};

export function sortQueue(rows: readonly IncidentRow[]): IncidentRow[] {
  return [...rows].sort((a, b) => {
    const byPriority = PRIORITY_ORDER[a.incident.priority] - PRIORITY_ORDER[b.incident.priority];
    if (byPriority !== 0) return byPriority;
    return Date.parse(a.incident.activatedAt) - Date.parse(b.incident.activatedAt);
  });
}

export function queueReducer(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case 'loaded':
      return {
        ...state,
        rows: sortQueue(
          action.incidents.map((incident) => ({ incident, appliedSequence: incident.version })),
        ),
        lastError: null,
      };

    case 'created': {
      // A create for something already present happens after a reconnect, when the
      // initial fetch and the replayed stream overlap. Treat it as an update.
      const existing = state.rows.find((row) => row.incident.id === action.incident.id);
      if (existing !== undefined) return queueReducer(state, { type: 'updated', incident: action.incident });

      return {
        ...state,
        rows: sortQueue([
          ...state.rows,
          { incident: action.incident, appliedSequence: action.incident.version },
        ]),
      };
    }

    case 'updated': {
      const rows = state.rows.map((row) => {
        if (row.incident.id !== action.incident.id) return row;

        // The version is the ordering token. An update carrying an older version is a
        // message that overtook a newer one on the wire, and applying it would make the
        // console show state that has already been superseded.
        if (action.incident.version <= row.appliedSequence) return row;

        return { incident: action.incident, appliedSequence: action.incident.version };
      });

      // A resolved incident leaves the active queue. It is still reachable by id.
      return { ...state, rows: sortQueue(rows.filter((row) => isOpen(row.incident))) };
    }

    case 'connection':
      return { ...state, connectionState: action.state };

    case 'error':
      return { ...state, lastError: action.message };

    default: {
      const exhaustive: never = action;
      void exhaustive;
      return state;
    }
  }
}

export function isOpen(incident: IncidentDto): boolean {
  return incident.status === 'active' || incident.status === 'acknowledged';
}

export function claimIsHeld(incident: IncidentDto, now: Date, leaseMs = 5 * 60_000): boolean {
  if (incident.claimedByOperatorId === null || incident.claimedAt === null) return false;
  return Date.parse(incident.claimedAt) + leaseMs > now.getTime();
}

export function claimLabel(
  incident: IncidentDto,
  currentOperatorId: string,
  now: Date,
): 'unclaimed' | 'mine' | 'other' {
  if (!claimIsHeld(incident, now)) return 'unclaimed';
  return incident.claimedByOperatorId === currentOperatorId ? 'mine' : 'other';
}

/** Human-readable age. Deliberately coarse: exact seconds are noise at a glance. */
export function formatAge(from: string, now: Date): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - Date.parse(from)) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * Applies a timeline event in sequence order.
 *
 * Events arrive out of order and sometimes twice. The rule is: drop anything at or below
 * the highest sequence already applied, and insert the rest in the right place rather
 * than appending. Appending would render a note above the activation that preceded it.
 */
export function applyEvent(
  events: readonly IncidentEventDto[],
  incoming: IncidentEventDto,
): IncidentEventDto[] {
  if (events.some((event) => event.sequence === incoming.sequence)) return [...events];

  const merged = [...events, incoming];
  merged.sort((a, b) => a.sequence - b.sequence);
  return merged;
}

export function highestSequence(events: readonly IncidentEventDto[]): number {
  return events.reduce((max, event) => Math.max(max, event.sequence), 0);
}

/**
 * Reduces a location track to at most `maxPoints` while keeping its shape.
 *
 * A long incident produces thousands of fixes. Rendering all of them makes the map
 * stutter and tells the operator nothing extra, because consecutive points a few metres
 * apart overlap on screen anyway.
 *
 * This keeps the first and last points always, then keeps points that are far enough
 * from the last kept one. Distance-based rather than every-nth, because every-nth throws
 * away corners on a winding route and keeps redundant points on a straight one.
 */
export function thinTrack(
  points: readonly { latitude: number; longitude: number; capturedAt: string }[],
  maxPoints = 500,
  minSeparationMetres = 15,
): typeof points {
  if (points.length <= 2 || points.length <= maxPoints) return points;

  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return points;

  const kept: Array<(typeof points)[number]> = [first];
  let anchor = first;

  for (let i = 1; i < points.length - 1; i += 1) {
    const point = points[i];
    if (point === undefined) continue;
    if (distanceMetres(anchor, point) >= minSeparationMetres) {
      kept.push(point);
      anchor = point;
    }
  }

  kept.push(last);

  // Still too many after distance thinning, on a long fast route. Fall back to taking
  // an even sample of what survived, which at this point is already shape-preserving.
  if (kept.length > maxPoints) {
    const stride = Math.ceil(kept.length / maxPoints);
    const sampled = kept.filter((_point, index) => index % stride === 0);
    const lastKept = kept[kept.length - 1];
    if (lastKept !== undefined && sampled[sampled.length - 1] !== lastKept) sampled.push(lastKept);
    return sampled;
  }

  return kept;
}

const EARTH_RADIUS_METRES = 6_371_008.8;
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

export function distanceMetres(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude));
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
}
