'use client';

import { useCallback, useRef, useState } from 'react';

import type { IncidentDto } from '@guardianlink/contracts';

import { claimLabel, formatAge, type IncidentRow } from '@/lib/incident-view-model';

/**
 * The operator queue.
 *
 * Built as a listbox rather than a table of buttons because an operator works this with
 * the keyboard while on a call. Arrow keys move, Home and End jump, Enter opens. Roving
 * tabindex keeps the whole list a single tab stop, so getting past it to the detail
 * panel does not mean pressing Tab forty times.
 */

export interface IncidentQueueProps {
  readonly rows: readonly IncidentRow[];
  readonly currentOperatorId: string;
  readonly now: Date;
  readonly selectedId: string | null;
  readonly onSelect: (incidentId: string) => void;
  readonly connectionState: 'connecting' | 'live' | 'reconnecting' | 'offline';
}

const PRIORITY_LABEL: Record<IncidentDto['priority'], string> = {
  critical: 'Critical',
  high: 'High',
  standard: 'Standard',
  low: 'Low',
};

const CLAIM_TEXT = {
  unclaimed: 'Unclaimed',
  mine: 'Claimed by you',
  other: 'Claimed by another operator',
} as const;

export function IncidentQueue({
  rows,
  currentOperatorId,
  now,
  selectedId,
  onSelect,
  connectionState,
}: IncidentQueueProps) {
  const [focusIndex, setFocusIndex] = useState(0);
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);

  const focusItem = useCallback((index: number) => {
    setFocusIndex(index);
    itemRefs.current[index]?.focus();
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLUListElement>) => {
      if (rows.length === 0) return;

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          focusItem(Math.min(focusIndex + 1, rows.length - 1));
          break;
        case 'ArrowUp':
          event.preventDefault();
          focusItem(Math.max(focusIndex - 1, 0));
          break;
        case 'Home':
          event.preventDefault();
          focusItem(0);
          break;
        case 'End':
          event.preventDefault();
          focusItem(rows.length - 1);
          break;
        case 'Enter':
        case ' ': {
          event.preventDefault();
          const row = rows[focusIndex];
          if (row) onSelect(row.incident.id);
          break;
        }
        default:
          break;
      }
    },
    [focusIndex, focusItem, onSelect, rows],
  );

  if (rows.length === 0) {
    return (
      <div className="queue queue--empty">
        <ConnectionBanner state={connectionState} />
        {/* An empty queue is good news, so it says so rather than looking like a
            loading failure. Empty states that look like errors make operators refresh. */}
        <p className="queue__empty-title">No active incidents</p>
        <p className="queue__empty-body">
          New incidents appear here as they are raised. Nothing needs refreshing.
        </p>
      </div>
    );
  }

  return (
    <div className="queue">
      <ConnectionBanner state={connectionState} />

      <ul
        className="queue__list"
        role="listbox"
        aria-label={`Active incidents, ${rows.length} in the queue`}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        {rows.map((row, index) => {
          const claim = claimLabel(row.incident, currentOperatorId, now);
          const isSelected = row.incident.id === selectedId;

          return (
            <li
              key={row.incident.id}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              role="option"
              aria-selected={isSelected}
              // Roving tabindex: one tab stop for the whole list.
              tabIndex={index === focusIndex ? 0 : -1}
              className={`queue__item queue__item--${row.incident.priority}${
                isSelected ? ' queue__item--selected' : ''
              }`}
              onClick={() => {
                setFocusIndex(index);
                onSelect(row.incident.id);
              }}
              onFocus={() => setFocusIndex(index)}
            >
              <span className={`badge badge--${row.incident.priority}`}>
                {PRIORITY_LABEL[row.incident.priority]}
              </span>

              <span className="queue__item-id">
                Incident {row.incident.id.slice(0, 8)}
              </span>

              <span className="queue__item-age">
                {/* The visible text is terse; the label is not, because a screen reader
                    user gets no benefit from the compactness. */}
                <span aria-hidden="true">{formatAge(row.incident.activatedAt, now)}</span>
                <span className="visually-hidden">
                  Raised {formatAge(row.incident.activatedAt, now)} ago
                </span>
              </span>

              <span className={`queue__item-claim queue__item-claim--${claim}`}>
                {CLAIM_TEXT[claim]}
              </span>

              {row.incident.status === 'acknowledged' && (
                <span className="badge badge--safe">Contact acknowledged</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Connection state, announced politely.
 *
 * An operator looking at a stale list needs to know it is stale. This is the difference
 * between "there are no incidents" and "I cannot currently see incidents", which are very
 * different pieces of information.
 */
export function ConnectionBanner({
  state,
}: {
  readonly state: IncidentQueueProps['connectionState'];
}) {
  if (state === 'live') {
    return (
      <p className="connection connection--live" role="status">
        <span className="connection__dot" aria-hidden="true" />
        Live
      </p>
    );
  }

  const message =
    state === 'connecting'
      ? 'Connecting to the incident stream'
      : state === 'reconnecting'
        ? 'Reconnecting. This list may be out of date.'
        : 'Disconnected. This list is not updating.';

  return (
    <p
      className={`connection connection--${state}`}
      role="status"
      // Assertive for a genuine disconnection: an operator must not keep working from a
      // list they believe is live. Polite for the transient states.
      aria-live={state === 'offline' ? 'assertive' : 'polite'}
    >
      {message}
    </p>
  );
}
