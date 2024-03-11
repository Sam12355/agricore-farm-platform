import { SeededRandom } from './random';
import {
  DEMO_PASSWORD,
  type SyntheticContact,
  syntheticContact,
  syntheticDestination,
  syntheticOperatorNote,
  syntheticPerson,
  syntheticTrack,
} from './synthetic';

/**
 * The scenarios the demo seeds and the end-to-end tests share.
 *
 * Keeping them here rather than inside either one means the walkthrough a reviewer runs
 * by hand and the workflow the test suite asserts are the same story, so a demo cannot
 * quietly diverge from what is actually covered.
 */

export interface DemoAccount {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
  readonly role: 'user' | 'operator' | 'admin';
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    email: 'demo.user@example.com',
    password: DEMO_PASSWORD,
    displayName: 'Demo User',
    role: 'user',
  },
  {
    email: 'demo.operator@example.com',
    password: DEMO_PASSWORD,
    displayName: 'Demo Operator',
    role: 'operator',
  },
  {
    email: 'second.operator@example.com',
    password: DEMO_PASSWORD,
    displayName: 'Second Operator',
    role: 'operator',
  },
  {
    email: 'demo.admin@example.com',
    password: DEMO_PASSWORD,
    displayName: 'Demo Admin',
    role: 'admin',
  },
];

export type ScenarioKind =
  | 'clean_resolution'
  | 'cancelled_countdown'
  | 'no_acknowledgement_escalation'
  | 'offline_backfill'
  | 'duplicate_activation';

export interface ScenarioLocationPoint {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyMetres: number;
  readonly capturedAt: Date;
}

export interface Scenario {
  readonly kind: ScenarioKind;
  readonly title: string;
  readonly narrative: string;
  readonly subject: { displayName: string; email: string; phone: string };
  readonly contacts: readonly SyntheticContact[];
  readonly destination: string;
  readonly track: readonly ScenarioLocationPoint[];
  readonly operatorNotes: readonly string[];
  readonly expectedOutcome: string;
}

const SCENARIO_DEFINITIONS: Record<
  ScenarioKind,
  { title: string; narrative: string; expectedOutcome: string; trackPoints: number; notes: number }
> = {
  clean_resolution: {
    title: 'Walk home, alert raised, resolved safely',
    narrative:
      'The subject starts a safety session on the way home, triggers SOS, does not cancel, and ' +
      'an operator works the incident until the subject confirms they are safe.',
    expectedOutcome: 'Incident resolves with resolution user_safe and a complete timeline.',
    trackPoints: 24,
    notes: 3,
  },
  cancelled_countdown: {
    title: 'Accidental trigger, cancelled during the countdown',
    narrative:
      'The subject triggers SOS by accident in a pocket and cancels it four seconds later.',
    expectedOutcome: 'No incident is created. The countdown is recorded as cancelled.',
    trackPoints: 0,
    notes: 0,
  },
  no_acknowledgement_escalation: {
    title: 'Primary contact does not answer',
    narrative:
      'The primary contact is notified and does not acknowledge inside the window, so the ' +
      'secondary contact is notified and priority rises.',
    expectedOutcome: 'Escalation fires once, the secondary acknowledges, priority reaches high.',
    trackPoints: 18,
    notes: 2,
  },
  offline_backfill: {
    title: 'Phone loses signal, queues events, flushes on reconnect',
    narrative:
      'The subject activates SOS with no connectivity. The device queues the activation and a ' +
      'backlog of location fixes, then flushes them when signal returns.',
    expectedOutcome:
      'One incident is created despite the retry, and backfilled points keep their capture times.',
    trackPoints: 30,
    notes: 1,
  },
  duplicate_activation: {
    title: 'Retry storm on a flaky connection',
    narrative:
      'The client retries the activation request five times because responses are being lost.',
    expectedOutcome: 'Exactly one incident exists and every response carries the same incident id.',
    trackPoints: 6,
    notes: 1,
  },
};

export function buildScenario(kind: ScenarioKind, seed = 20260101): Scenario {
  const random = new SeededRandom(seed);
  const definition = SCENARIO_DEFINITIONS[kind];
  const subject = syntheticPerson(random, 0);
  const contactCount = kind === 'no_acknowledgement_escalation' ? 3 : 2;
  const contacts = Array.from({ length: contactCount }, (_unused, index) =>
    syntheticContact(random, index + 1, index + 1),
  );

  const startedAt = new Date('2026-03-14T19:45:00.000Z');

  return {
    kind,
    title: definition.title,
    narrative: definition.narrative,
    subject,
    contacts,
    destination: syntheticDestination(random),
    track:
      definition.trackPoints === 0 ? [] : syntheticTrack(random, definition.trackPoints, startedAt),
    operatorNotes: Array.from({ length: definition.notes }, () => syntheticOperatorNote(random)),
    expectedOutcome: definition.expectedOutcome,
  };
}

export const ALL_SCENARIO_KINDS: readonly ScenarioKind[] = [
  'clean_resolution',
  'cancelled_countdown',
  'no_acknowledgement_escalation',
  'offline_backfill',
  'duplicate_activation',
];
