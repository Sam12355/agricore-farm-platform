'use client';

import { useCallback, useRef, useState } from 'react';

import type { AlertDto } from '@agricore/contracts';

import { claimLabel, formatAge, type AlertRow } from '@/lib/alert-view-model';

/**
 * The manager queue.
 *
 * Built as a listbox rather than a table of buttons because a manager works this with
 * the keyboard while on a call. Arrow keys move, Home and End jump, Enter opens. Roving
 * tabindex keeps the whole list a single tab stop, so getting past it to the detail
 * panel does not mean pressing Tab forty times.
 */

export interface AlertQueueProps {
  readonly rows: readonly AlertRow[];
  readonly currentManagerId: string;
  readonly now: Date;
  readonly selectedId: string | null;
  readonly onSelect: (alertId: string) => void;
  readonly connectionState: 'connecting' | 'live' | 'reconnecting' | 'offline';
}

const PRIORITY_LABEL: Record<AlertDto['priority'], string> = {
  critical: 'Critical',
  high: 'High',
  standard: 'Standard',
  low: 'Low',
};

const CLAIM_TEXT = {
  unclaimed: 'Unclaimed',
  mine: 'Claimed by you',
  other: 'Claimed by another manager',
} as const;

export function AlertQueue({
  rows,
  currentManagerId,
  now,
  selectedId,
  onSelect,
  connectionState,
}: AlertQueueProps) {
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
          if (row) onSelect(row.alert.id);
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
            loading failure. Empty states that look like errors make managers refresh. */}
        <p className="queue__empty-title">No active alerts</p>
        <p className="queue__empty-body">
          New alerts appear here as they are raised. Nothing needs refreshing.
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
        aria-label={`Active alerts, ${rows.length} in the queue`}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        {rows.map((row, index) => {
          const claim = claimLabel(row.alert, currentManagerId, now);
          const isSelected = row.alert.id === selectedId;

          return (
            <li
              key={row.alert.id}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              role="option"
              aria-selected={isSelected}
              // Roving tabindex: one tab stop for the whole list.
              tabIndex={index === focusIndex ? 0 : -1}
              className={`queue__item queue__item--${row.alert.priority}${
                isSelected ? ' queue__item--selected' : ''
              }`}
              onClick={() => {
                setFocusIndex(index);
                onSelect(row.alert.id);
              }}
              onFocus={() => setFocusIndex(index)}
            >
              <span className={`badge badge--${row.alert.priority}`}>
                {PRIORITY_LABEL[row.alert.priority]}
              </span>

              <span className="queue__item-id">
                Alert {row.alert.id.slice(0, 8)}
              </span>

              <span className="queue__item-age">
                {/* The visible text is terse; the label is not, because a screen reader
                    user gets no benefit from the compactness. */}
                <span aria-hidden="true">{formatAge(row.alert.activatedAt, now)}</span>
                <span className="visually-hidden">
                  Raised {formatAge(row.alert.activatedAt, now)} ago
                </span>
              </span>

              <span className={`queue__item-claim queue__item-claim--${claim}`}>
                {CLAIM_TEXT[claim]}
              </span>

              {row.alert.status === 'acknowledged' && (
                <span className="badge badge--safe">Worker acknowledged</span>
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
 * A manager looking at a stale list needs to know it is stale. This is the difference
 * between "there are no alerts" and "I cannot currently see alerts", which are very
 * different pieces of information.
 */
export function ConnectionBanner({
  state,
}: {
  readonly state: AlertQueueProps['connectionState'];
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
      ? 'Connecting to the alert stream'
      : state === 'reconnecting'
        ? 'Reconnecting. This list may be out of date.'
        : 'Disconnected. This list is not updating.';

  return (
    <p
      className={`connection connection--${state}`}
      role="status"
      // Assertive for a genuine disconnection: a manager must not keep working from a
      // list they believe is live. Polite for the transient states.
      aria-live={state === 'offline' ? 'assertive' : 'polite'}
    >
      {message}
    </p>
  );
}
