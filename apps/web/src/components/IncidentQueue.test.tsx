import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';

import type { IncidentDto } from '@guardianlink/contracts';

import { IncidentQueue } from './IncidentQueue';
import type { IncidentRow } from '@/lib/incident-view-model';

const NOW = new Date('2026-03-14T20:00:00.000Z');
const OPERATOR = 'operator-a';

function row(overrides: Partial<IncidentDto> = {}): IncidentRow {
  const incident: IncidentDto = {
    id: 'incident-00000001',
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
  return { incident, appliedSequence: incident.version };
}

function renderQueue(rows: IncidentRow[], onSelect = vi.fn()) {
  const result = render(
    <IncidentQueue
      rows={rows}
      currentOperatorId={OPERATOR}
      now={NOW}
      selectedId={null}
      onSelect={onSelect}
      connectionState="live"
    />,
  );
  return { ...result, onSelect };
}

/** axe against the rendered DOM. Serious and critical violations fail the test. */
async function expectNoSeriousAccessibilityViolations(container: HTMLElement) {
  const results = await axe.run(container, {
    // Colour contrast is enforced by the design-token test against the real palette.
    // jsdom has no layout or computed colours, so running it here produces noise.
    rules: { 'color-contrast': { enabled: false } },
  });

  const serious = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );

  expect(
    serious.map((violation) => `${violation.id}: ${violation.help}`),
  ).toEqual([]);
}

describe('IncidentQueue', () => {
  it('renders one option per incident', () => {
    renderQueue([row({ id: 'a' }), row({ id: 'b' })]);
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('says how many incidents there are, for a screen reader', () => {
    renderQueue([row({ id: 'a' }), row({ id: 'b' })]);
    expect(screen.getByRole('listbox')).toHaveAccessibleName(
      'Active incidents, 2 in the queue',
    );
  });

  it('shows an empty state that does not look like a failure', () => {
    renderQueue([]);
    expect(screen.getByText('No active incidents')).toBeInTheDocument();
    expect(screen.getByText(/Nothing needs refreshing/)).toBeInTheDocument();
  });

  it('shows who holds a claim', () => {
    renderQueue([
      row({ id: 'a', claimedByOperatorId: 'operator-b', claimedAt: '2026-03-14T19:58:00.000Z' }),
    ]);
    expect(screen.getByText('Claimed by another operator')).toBeInTheDocument();
  });

  it('shows a lapsed claim as unclaimed, so the incident gets picked up', () => {
    renderQueue([
      // Ten minutes ago; the lease is five.
      row({ id: 'a', claimedByOperatorId: 'operator-b', claimedAt: '2026-03-14T19:50:00.000Z' }),
    ]);
    expect(screen.getByText('Unclaimed')).toBeInTheDocument();
  });

  it('gives the age a full label rather than only the terse visible text', () => {
    renderQueue([row({ id: 'a' })]);
    const option = screen.getByRole('option');
    expect(within(option).getByText('Raised 15m ago')).toBeInTheDocument();
  });

  describe('keyboard operation', () => {
    it('is a single tab stop, using a roving tabindex', () => {
      renderQueue([row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })]);
      const options = screen.getAllByRole('option');
      expect(options[0]).toHaveAttribute('tabindex', '0');
      expect(options[1]).toHaveAttribute('tabindex', '-1');
      expect(options[2]).toHaveAttribute('tabindex', '-1');
    });

    it('moves down with the arrow key', async () => {
      const user = userEvent.setup();
      renderQueue([row({ id: 'a' }), row({ id: 'b' })]);

      const options = screen.getAllByRole('option');
      options[0]?.focus();
      await user.keyboard('{ArrowDown}');

      expect(options[1]).toHaveFocus();
    });

    it('does not wrap past the end', async () => {
      const user = userEvent.setup();
      renderQueue([row({ id: 'a' }), row({ id: 'b' })]);

      const options = screen.getAllByRole('option');
      options[0]?.focus();
      await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');

      // Wrapping in a queue an operator is scanning under pressure is disorienting.
      expect(options[1]).toHaveFocus();
    });

    it('jumps to the ends with Home and End', async () => {
      const user = userEvent.setup();
      renderQueue([row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })]);

      const options = screen.getAllByRole('option');
      options[0]?.focus();
      await user.keyboard('{End}');
      expect(options[2]).toHaveFocus();

      await user.keyboard('{Home}');
      expect(options[0]).toHaveFocus();
    });

    it('opens the focused incident with Enter', async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      renderQueue([row({ id: 'incident-a' }), row({ id: 'incident-b' })], onSelect);

      const options = screen.getAllByRole('option');
      options[0]?.focus();
      await user.keyboard('{ArrowDown}{Enter}');

      expect(onSelect).toHaveBeenCalledWith('incident-b');
    });

    it('opens with Space as well, which is what a listbox is expected to do', async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      renderQueue([row({ id: 'incident-a' })], onSelect);

      screen.getAllByRole('option')[0]?.focus();
      await user.keyboard(' ');

      expect(onSelect).toHaveBeenCalledWith('incident-a');
    });
  });

  describe('connection state', () => {
    it('announces a disconnection assertively, because a stale list is dangerous here', () => {
      render(
        <IncidentQueue
          rows={[]}
          currentOperatorId={OPERATOR}
          now={NOW}
          selectedId={null}
          onSelect={vi.fn()}
          connectionState="offline"
        />,
      );

      const status = screen.getByRole('status');
      expect(status).toHaveAttribute('aria-live', 'assertive');
      expect(status).toHaveTextContent('not updating');
    });

    it('announces reconnection politely', () => {
      render(
        <IncidentQueue
          rows={[]}
          currentOperatorId={OPERATOR}
          now={NOW}
          selectedId={null}
          onSelect={vi.fn()}
          connectionState="reconnecting"
        />,
      );
      expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    });
  });

  describe('accessibility', () => {
    it('has no serious axe violations with incidents present', async () => {
      const { container } = renderQueue([
        row({ id: 'a', priority: 'critical' }),
        row({ id: 'b', claimedByOperatorId: OPERATOR, claimedAt: '2026-03-14T19:59:00.000Z' }),
        row({ id: 'c', status: 'acknowledged' }),
      ]);
      await expectNoSeriousAccessibilityViolations(container);
    });

    it('has no serious axe violations when empty', async () => {
      const { container } = renderQueue([]);
      await expectNoSeriousAccessibilityViolations(container);
    });
  });
});
