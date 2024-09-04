import request from 'supertest';
import type { App } from 'supertest/types';

import { DEMO_PASSWORD } from '@agricore/test-fixtures';

import { NotificationDispatchService } from '../../src/application/services/notification-dispatch.service';
import { PORTS } from '../../src/application/tokens';

import { createTestApp, type TestApp } from '../support/test-app';

/**
 * The flagship vertical slice, end to end, over real HTTP against a real Nest
 * application. Thirteen steps from the brief:
 *
 *   1  user starts an alert countdown
 *   2  user may cancel before expiry
 *   3  if not cancelled, an idempotent activation request is sent
 *   4  backend creates an alert
 *   5  the alert event is stored
 *   6  notification work is placed on the outbox for the queue
 *   7  worker notifications are processed
 *   8  the manager console receives a real-time update
 *   9  the client sends authorised location updates
 *   10 the manager console sees the updated location
 *   11 worker acknowledgement is recorded
 *   12 the user resolves the alert
 *   13 the final timeline remains auditable
 *
 * Nothing external is running. No Postgres, no Redis, no queue, no AWS.
 */

const BASE = '/api/v1';

let harness: TestApp;
let http: App;

async function registerUser(email: string) {
  const response = await request(http)
    .post(`${BASE}/auth/register`)
    .send({
      email,
      password: DEMO_PASSWORD,
      displayName: `Test ${email.split('@')[0]}`,
      acceptedDemoNotice: true,
    })
    .expect(201);

  return {
    userId: response.body.user.id as string,
    accessToken: response.body.tokens.accessToken as string,
    refreshToken: response.body.tokens.refreshToken as string,
  };
}

/**
 * Roles cannot be self-assigned through the API, which is the point. Managers are
 * provisioned out of band, so the test reaches into the repository to do what an admin
 * tool would, then logs in again.
 *
 * The second login is not alertal. The role is a claim inside an already-issued
 * access token, so changing the stored record does not retroactively change a token
 * somebody is already holding. That is the correct behaviour for a stateless access
 * token, and it means a privilege change only takes effect on the next issue.
 */
async function registerManager(email: string) {
  const registered = await registerUser(email);

  const users = harness.module.get<import('../../src/application/ports').UserRepository>(
    PORTS.UserRepository,
  );
  const user = await users.findById(registered.userId);
  if (user === null) throw new Error('user missing after registration');
  await users.update({ ...user, role: 'manager' });

  const login = await request(http)
    .post(`${BASE}/auth/login`)
    .send({ email, password: DEMO_PASSWORD })
    .expect(200);

  return {
    userId: registered.userId,
    accessToken: login.body.tokens.accessToken as string,
    refreshToken: login.body.tokens.refreshToken as string,
  };
}

beforeEach(async () => {
  harness = await createTestApp();
  http = harness.app.getHttpServer();
});

afterEach(async () => {
  await harness.close();
});

describe('Alert workflow, activation to resolution', () => {
  it('runs the whole thing and leaves an auditable timeline', async () => {
    // ---- setup: a subject with two assigned workers, and a manager -------------
    const subject = await registerUser('subject@example.com');
    const manager = await registerManager('manager@example.com');

    const primary = await request(http)
      .post(`${BASE}/workers`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .send({ name: 'Primary Worker', phone: '+1 555 0101', priority: 1 })
      .expect(201);

    await request(http)
      .post(`${BASE}/workers`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .send({ name: 'Secondary Worker', email: 'secondary@example.com', priority: 2 })
      .expect(201);

    // ---- 1. start the countdown --------------------------------------------------
    const countdown = await request(http)
      .post(`${BASE}/alerts/countdown`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .send({ durationSeconds: 10, activationIdempotencyKey: 'device-key-000000001' })
      .expect(201);

    expect(countdown.body.status).toBe('pending');

    // ---- 2. let it expire rather than cancelling ---------------------------------
    harness.clock.advanceBySeconds(11);

    // ---- 3 and 4. activate, idempotently ----------------------------------------
    const activation = await request(http)
      .post(`${BASE}/alerts/activate`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .set('Idempotency-Key', 'device-key-000000001')
      .send({
        countdownId: countdown.body.id,
        trigger: 'field_countdown',
        location: {
          latitude: 53.5,
          longitude: 3.2,
          accuracyMetres: 12,
          capturedAt: '2026-03-14T19:45:05.000Z',
        },
      })
      .expect(201);

    const alertId = activation.body.alert.id as string;
    expect(activation.body.deduplicated).toBe(false);
    expect(activation.body.alert.status).toBe('active');

    // ---- 5. the opening events are stored ----------------------------------------
    const openingTimeline = await request(http)
      .get(`${BASE}/alerts/${alertId}/timeline`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .expect(200);

    expect(openingTimeline.body.events.map((e: { type: string }) => e.type)).toEqual([
      'alert.activated',
      'alert.location_recorded',
    ]);

    // ---- 6. notification work is queued in the same transaction ------------------
    expect(await harness.outbox.pendingCount()).toBe(2);

    // ---- 7. the worker processes worker notifications ---------------------------
    const dispatch = harness.module.get(NotificationDispatchService);
    const drained = await dispatch.drain();
    expect(drained.processed).toBe(2);
    expect(await harness.outbox.pendingCount()).toBe(0);

    const deliveries = harness.notifications.all();
    expect(deliveries).toHaveLength(2);
    expect(deliveries.every((d) => d.status === 'sent')).toBe(true);

    // ---- 8. the manager console was told, in real time --------------------------
    expect(harness.realtime.created.map((alert) => alert.id)).toContain(alertId);

    // ---- 9. the subject streams location -----------------------------------------
    await request(http)
      .post(`${BASE}/alerts/${alertId}/location`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .send({
        points: [
          {
            latitude: 53.501,
            longitude: 3.201,
            accuracyMetres: 9,
            capturedAt: '2026-03-14T19:46:00.000Z',
          },
          {
            latitude: 53.502,
            longitude: 3.202,
            accuracyMetres: 8,
            capturedAt: '2026-03-14T19:46:30.000Z',
          },
        ],
      })
      .expect(202);

    // ---- 10. the manager sees the new position ----------------------------------
    const managerView = await request(http)
      .get(`${BASE}/alerts/${alertId}`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .expect(200);

    expect(managerView.body.lastKnownLocation.latitude).toBeCloseTo(53.502, 5);
    expect(harness.realtime.updated.some((u) => u.changedFields.includes('lastKnownLocation'))).toBe(
      true,
    );

    // the manager claims it before doing anything to it
    const claimed = await request(http)
      .post(`${BASE}/alerts/${alertId}/claim`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .send({ expectedVersion: managerView.body.version })
      .expect(200);

    expect(claimed.body.claimedByManagerId).toBe(manager.userId);

    await request(http)
      .post(`${BASE}/alerts/${alertId}/notes`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .send({ note: 'Called the subject, no answer. Monitoring position.', expectedVersion: claimed.body.version })
      .expect(201);

    // ---- 11. an assigned worker acknowledges through their link -------------------
    const tokens = harness.module.get<import('../../src/application/ports').TokenService>(
      PORTS.TokenService,
    );
    const viewToken = tokens.issueWorkerViewToken({
      alertId,
      workerId: primary.body.id,
      ttlSeconds: 3600,
    });

    const acknowledged = await request(http)
      .post(`${BASE}/worker-view/${viewToken}/acknowledge`)
      .send({ note: 'On my way' })
      .expect(200);

    expect(acknowledged.body.status).toBe('acknowledged');
    expect(acknowledged.body.acknowledgedAt).not.toBeNull();

    // ---- 12. the subject resolves it ---------------------------------------------
    const current = await request(http)
      .get(`${BASE}/alerts/${alertId}`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .expect(200);

    const resolved = await request(http)
      .post(`${BASE}/alerts/${alertId}/resolve`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .send({ resolution: 'issue_cleared', note: 'Home safe.', expectedVersion: current.body.version })
      .expect(200);

    expect(resolved.body.status).toBe('resolved');
    expect(resolved.body.resolvedBy).toBe(subject.userId);

    // ---- 13. the timeline is complete, ordered and append-only -------------------
    const finalTimeline = await request(http)
      .get(`${BASE}/alerts/${alertId}/timeline`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .expect(200);

    const events = finalTimeline.body.events as Array<{ sequence: number; type: string }>;
    const sequences = events.map((event) => event.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(new Set(sequences).size).toBe(sequences.length);

    const types = events.map((event) => event.type);
    expect(types).toContain('alert.activated');
    expect(types).toContain('alert.location_recorded');
    expect(types).toContain('alert.worker_notified');
    expect(types).toContain('alert.manager_claimed');
    expect(types).toContain('alert.manager_note_added');
    expect(types).toContain('alert.worker_acknowledged');
    expect(types).toContain('alert.resolved');

    // Nothing that happened earlier was rewritten by anything that happened later.
    const openingEventIds = (openingTimeline.body.events as Array<{ id: string }>).map((e) => e.id);
    const finalEventIds = events.map((event) => (event as unknown as { id: string }).id);
    expect(finalEventIds.slice(0, openingEventIds.length)).toEqual(openingEventIds);
  });
});

describe('cancellation during the countdown', () => {
  it('creates no alert when the user cancels in time', async () => {
    const subject = await registerUser('canceller@example.com');

    const countdown = await request(http)
      .post(`${BASE}/alerts/countdown`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .send({ durationSeconds: 10, activationIdempotencyKey: 'cancel-key-000000001' })
      .expect(201);

    harness.clock.advanceBySeconds(4);

    const cancelled = await request(http)
      .post(`${BASE}/alerts/countdown/${countdown.body.id}/cancel`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .send({ reason: 'false_trigger' })
      .expect(200);

    expect(cancelled.body.status).toBe('cancelled');

    // A late activation for a cancelled countdown must not resurrect it.
    await request(http)
      .post(`${BASE}/alerts/activate`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .set('Idempotency-Key', 'cancel-key-000000001')
      .send({ countdownId: countdown.body.id })
      .expect(422);

    const alerts = await request(http)
      .get(`${BASE}/alerts`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .expect(200);

    expect(alerts.body.items).toHaveLength(0);
    expect(await harness.outbox.pendingCount()).toBe(0);
  });

  it('refuses a cancellation that arrives after the countdown finished', async () => {
    const subject = await registerUser('late-canceller@example.com');

    const countdown = await request(http)
      .post(`${BASE}/alerts/countdown`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .send({ durationSeconds: 5, activationIdempotencyKey: 'late-key-000000001' })
      .expect(201);

    harness.clock.advanceBySeconds(6);

    // The user is told the truth: the alert is going out. Showing a cancelled screen
    // while workers receive messages would be worse than an error.
    await request(http)
      .post(`${BASE}/alerts/countdown/${countdown.body.id}/cancel`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .send({ reason: 'user_cancelled' })
      .expect(412);
  });
});

describe('duplicate activation', () => {
  it('creates exactly one alert no matter how many times the client retries', async () => {
    const subject = await registerUser('retrier@example.com');

    await request(http)
      .post(`${BASE}/workers`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .send({ name: 'Only Worker', phone: '+1 555 0102' })
      .expect(201);

    const send = () =>
      request(http)
        .post(`${BASE}/alerts/activate`)
        .set('Authorization', `Bearer ${subject.accessToken}`)
        .set('Idempotency-Key', 'retry-storm-000000001')
        .send({ trigger: 'manual_report' });

    const first = await send().expect(201);
    const alertId = first.body.alert.id as string;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const repeat = await send();
      expect([200, 201]).toContain(repeat.status);
      expect(repeat.body.alert.id).toBe(alertId);
    }

    const alerts = await request(http)
      .get(`${BASE}/alerts`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .expect(200);

    expect(alerts.body.items).toHaveLength(1);

    // One worker, one outbox message, regardless of five attempts.
    expect(await harness.outbox.pendingCount()).toBe(1);
  });

  it('rejects the same key used with a different body', async () => {
    const subject = await registerUser('key-reuser@example.com');

    await request(http)
      .post(`${BASE}/alerts/activate`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .set('Idempotency-Key', 'shared-key-000000001')
      .send({ trigger: 'manual_report' })
      .expect(201);

    await request(http)
      .post(`${BASE}/alerts/activate`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .set('Idempotency-Key', 'shared-key-000000001')
      .send({ trigger: 'operation_overdue' })
      .expect(409);
  });

  it('refuses activation with no idempotency key at all', async () => {
    const subject = await registerUser('no-key@example.com');

    await request(http)
      .post(`${BASE}/alerts/activate`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .send({ trigger: 'manual_report' })
      .expect(400);
  });
});

describe('offline recovery', () => {
  it('accepts a backlog flushed late and keeps the original capture times', async () => {
    const subject = await registerUser('offline@example.com');

    // The device was offline at 19:45 and only reaches the server at 20:05.
    harness.clock.set('2026-03-14T20:05:00.000Z');

    const activation = await request(http)
      .post(`${BASE}/alerts/activate`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .set('Idempotency-Key', 'offline-key-000000001')
      .send({ trigger: 'manual_report', occurredAt: '2026-03-14T19:45:00.000Z' })
      .expect(201);

    const alertId = activation.body.alert.id as string;
    expect(activation.body.alert.activatedAt).toBe('2026-03-14T19:45:00.000Z');

    // A backlog of fixes, deliberately not in order, as a flushed queue often is.
    await request(http)
      .post(`${BASE}/alerts/${alertId}/location`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .send({
        points: [
          { latitude: 53.5, longitude: 3.2, accuracyMetres: 20, capturedAt: '2026-03-14T19:50:00.000Z' },
          { latitude: 53.51, longitude: 3.21, accuracyMetres: 15, capturedAt: '2026-03-14T19:47:00.000Z' },
          { latitude: 53.52, longitude: 3.22, accuracyMetres: 10, capturedAt: '2026-03-14T19:55:00.000Z' },
        ],
      })
      .expect(202);

    const alert = await request(http)
      .get(`${BASE}/alerts/${alertId}`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .expect(200);

    // The newest capture time wins, not the last one in the array.
    expect(alert.body.lastKnownLocation.capturedAt).toBe('2026-03-14T19:55:00.000Z');

    const timeline = await request(http)
      .get(`${BASE}/alerts/${alertId}/timeline`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .expect(200);

    const locationEvents = (timeline.body.events as Array<{ type: string; occurredAt: string }>)
      .filter((event) => event.type === 'alert.location_recorded')
      .map((event) => event.occurredAt);

    // Every point is on the timeline with the time it was captured, not the time it
    // arrived. The map draws the pass that was actually driven, not a spike at 20:05.
    expect(locationEvents).toEqual([
      '2026-03-14T19:50:00.000Z',
      '2026-03-14T19:47:00.000Z',
      '2026-03-14T19:55:00.000Z',
    ]);
  });
});
