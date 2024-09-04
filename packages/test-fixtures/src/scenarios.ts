import { SeededRandom } from './random';
import {
  DEMO_PASSWORD,
  type SyntheticWorker,
  syntheticWorker,
  syntheticDestination,
  syntheticManagerNote,
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
  readonly role: 'user' | 'manager' | 'admin';
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    email: 'demo.user@example.com',
    password: DEMO_PASSWORD,
    displayName: 'Demo User',
    role: 'user',
  },
  {
    email: 'demo.manager@example.com',
    password: DEMO_PASSWORD,
    displayName: 'Demo Manager',
    role: 'manager',
  },
  {
    email: 'second.manager@example.com',
    password: DEMO_PASSWORD,
    displayName: 'Second Manager',
    role: 'manager',
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
  readonly workers: readonly SyntheticWorker[];
  readonly destination: string;
  readonly track: readonly ScenarioLocationPoint[];
  readonly managerNotes: readonly string[];
  readonly expectedOutcome: string;
}

const SCENARIO_DEFINITIONS: Record<
  ScenarioKind,
  { title: string; narrative: string; expectedOutcome: string; trackPoints: number; notes: number }
> = {
  clean_resolution: {
    title: 'Spraying pass, alert raised in the block, resolved',
    narrative:
      'A worker starts a field operation on the west block, raises an alert when the sprayer ' +
      'jams, does not cancel it, and a manager works the alert until the job is confirmed done.',
    expectedOutcome: 'Alert resolves with resolution issue_cleared and a complete timeline.',
    trackPoints: 24,
    notes: 3,
  },
  cancelled_countdown: {
    title: 'Accidental trigger, cancelled during the countdown',
    narrative:
      'A worker knocks the alert button in a cab pocket and cancels it four seconds later.',
    expectedOutcome: 'No alert is created. The countdown is recorded as cancelled.',
    trackPoints: 0,
    notes: 0,
  },
  no_acknowledgement_escalation: {
    title: 'Primary worker does not answer',
    narrative:
      'The primary worker is notified and does not acknowledge inside the window, so the ' +
      'secondary worker is notified and priority rises.',
    expectedOutcome: 'Escalation fires once, the secondary acknowledges, priority reaches high.',
    trackPoints: 18,
    notes: 2,
  },
  offline_backfill: {
    title: 'No signal in the far block, events queued, flushed on reconnect',
    narrative:
      'A worker raises an alert with no connectivity. The device queues the activation and a ' +
      'backlog of position fixes, then flushes them on the way back into coverage.',
    expectedOutcome:
      'One alert is created despite the retry, and backfilled points keep their capture times.',
    trackPoints: 30,
    notes: 1,
  },
  duplicate_activation: {
    title: 'Retry storm on a flaky connection',
    narrative:
      'The client retries the activation request five times because responses are being lost.',
    expectedOutcome: 'Exactly one alert exists and every response carries the same alert id.',
    trackPoints: 6,
    notes: 1,
  },
};

export function buildScenario(kind: ScenarioKind, seed = 20260101): Scenario {
  const random = new SeededRandom(seed);
  const definition = SCENARIO_DEFINITIONS[kind];
  const subject = syntheticPerson(random, 0);
  const workerCount = kind === 'no_acknowledgement_escalation' ? 3 : 2;
  const workers = Array.from({ length: workerCount }, (_unused, index) =>
    syntheticWorker(random, index + 1, index + 1),
  );

  const startedAt = new Date('2026-03-14T19:45:00.000Z');

  return {
    kind,
    title: definition.title,
    narrative: definition.narrative,
    subject,
    workers,
    destination: syntheticDestination(random),
    track:
      definition.trackPoints === 0 ? [] : syntheticTrack(random, definition.trackPoints, startedAt),
    managerNotes: Array.from({ length: definition.notes }, () => syntheticManagerNote(random)),
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
