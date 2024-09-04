'use client';

import { useMemo, useReducer, useState } from 'react';

import { AlertQueue } from '@/components/AlertQueue';
import {
  initialQueueState,
  queueReducer,
  type QueueAction,
} from '@/lib/alert-view-model';

/**
 * Manager console.
 *
 * The socket wiring lives in a client hook that dispatches into the same reducer this
 * page uses, so the reducer is fully testable without a socket. That split is why the
 * console's coverage sits in alert-view-model.spec.ts rather than in a component test
 * pretending to be one.
 *
 * The demo path renders from seeded state so the page is reviewable without a running
 * API. Real usage replaces the initial dispatch with a fetch and subscribes to the
 * gateway; both go through queueReducer.
 */
export default function ConsolePage() {
  const [state, dispatch] = useReducer(queueReducer, initialQueueState);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Frozen so the age labels are stable in a screenshot and in a test. In the live
  // console this ticks on an interval.
  const now = useMemo(() => new Date(), []);

  return (
    <div className="page">
      <h1>Manager console</h1>
      <p className="lead">
        Active alerts, updated over a socket. Nothing on this page polls.
      </p>

      <section aria-labelledby="queue-heading">
        <h2 id="queue-heading">Alert queue</h2>
        <AlertQueue
          rows={state.rows}
          currentManagerId="demo-manager"
          now={now}
          selectedId={selectedId}
          onSelect={setSelectedId}
          connectionState={state.connectionState}
        />
      </section>

      <section aria-labelledby="keyboard-heading">
        <h2 id="keyboard-heading">Keyboard</h2>
        <dl className="shortcuts">
          <dt>Arrow up and down</dt>
          <dd>Move through the queue</dd>
          <dt>Home and End</dt>
          <dd>Jump to the first or last alert</dd>
          <dt>Enter or Space</dt>
          <dd>Open the focused alert</dd>
        </dl>
        <p>
          The queue is a single tab stop. A manager working with the keyboard while on a
          call does not have to press Tab past every row to reach the detail panel.
        </p>
      </section>

      {/* Kept so the page is inspectable without a backend. Removed once the socket
          hook is wired in this route. */}
      <button
        type="button"
        className="button"
        onClick={() => dispatch(demoAlert(state.rows.length + 1))}
      >
        Add a demonstration alert
      </button>
    </div>
  );
}

function demoAlert(index: number): QueueAction {
  const priorities = ['critical', 'high', 'standard', 'low'] as const;
  const priority = priorities[index % priorities.length] ?? 'standard';
  const activatedAt = new Date(Date.now() - index * 4 * 60_000).toISOString();

  return {
    type: 'created',
    alert: {
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      userId: '00000000-0000-4000-8000-000000000001',
      sessionId: null,
      status: 'active',
      priority,
      trigger: 'field_countdown',
      activatedAt,
      resolvedAt: null,
      resolvedBy: null,
      claimedByManagerId: null,
      claimedAt: null,
      lastKnownLocation: null,
      version: 1,
      createdAt: activatedAt,
      updatedAt: activatedAt,
    },
  };
}
