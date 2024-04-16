import request from 'supertest';
import type { App } from 'supertest/types';

import { DEMO_PASSWORD } from '@guardianlink/test-fixtures';

import { NotificationDispatchService } from '../../src/application/services/notification-dispatch.service';
import { PORTS } from '../../src/application/tokens';

import { createTestApp, type TestApp } from '../support/test-app';

/**
 * The flagship vertical slice, end to end, over real HTTP against a real Nest
 * application. Thirteen steps from the brief:
 *
 *   1  user starts an SOS countdown
 *   2  user may cancel before expiry
 *   3  if not cancelled, an idempotent activation request is sent
 *   4  backend creates an incident
 *   5  the incident event is stored
 *   6  notification work is placed on the outbox for the queue
 *   7  trusted-contact notifications are processed
 *   8  the operator console receives a real-time update
 *   9  the client sends authorised location updates
 *   10 the operator console sees the updated location
 *   11 contact acknowledgement is recorded
 *   12 the user resolves the incident
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
 * Roles cannot be self-assigned through the API, which is the point. Operators are
 * provisioned out of band, so the test reaches into the repository to do what an admin
 * tool would, then logs in again.
 *
 * The second login is not incidental. The role is a claim inside an already-issued
 * access token, so changing the stored record does not retroactively change a token
 * somebody is already holding. That is the correct behaviour for a stateless access
 * token, and it means a privilege change only takes effect on the next issue.
 */
async function registerOperator(email: string) {
  const registered = await registerUser(email);

  const users = harness.module.get<import('../../src/application/ports').UserRepository>(
    PORTS.UserRepository,
  );
  const user = await users.findById(registered.userId);
  if (user === null) throw new Error('user missing after registration');
  await users.update({ ...user, role: 'operator' });

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

describe('SOS workflow, activation to resolution', () => {
  it('runs the whole thing and leaves an auditable timeline', async () => {
    // ---- setup: a subject with two trusted contacts, and an operator -------------
    const subject = await registerUser('subject@example.com');
    const operator = await registerOperator('operator@example.com');

    const primary = await request(http)
      .post(`${BASE}/trusted-contacts`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .send({ name: 'Primary Contact', phone: '+1 555 0101', priority: 1 })
      .expect(201);

    await request(http)
      .post(`${BASE}/trusted-contacts`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .send({ name: 'Secondary Contact', email: 'secondary@example.com', priority: 2 })
      .expect(201);

    // ---- 1. start the countdown --------------------------------------------------
    const countdown = await request(http)
      .post(`${BASE}/sos/countdown`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .send({ durationSeconds: 10, activationIdempotencyKey: 'device-key-000000001' })
      .expect(201);

    expect(countdown.body.status).toBe('pending');

    // ---- 2. let it expire rather than cancelling ---------------------------------
    harness.clock.advanceBySeconds(11);

    // ---- 3 and 4. activate, idempotently ----------------------------------------
    const activation = await request(http)
      .post(`${BASE}/sos/activate`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .set('Idempotency-Key', 'device-key-000000001')
      .send({
        countdownId: countdown.body.id,
        trigger: 'sos_countdown',
        location: {
          latitude: 53.5,
          longitude: 3.2,
          accuracyMetres: 12,
          capturedAt: '2026-03-14T19:45:05.000Z',
        },
      })
      .expect(201);

    const incidentId = activation.body.incident.id as string;
    expect(activation.body.deduplicated).toBe(false);
    expect(activation.body.incident.status).toBe('active');

    // ---- 5. the opening events are stored ----------------------------------------
    const openingTimeline = await request(http)
      .get(`${BASE}/incidents/${incidentId}/timeline`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .expect(200);

    expect(openingTimeline.body.events.map((e: { type: string }) => e.type)).toEqual([
      'incident.activated',
      'incident.location_recorded',
    ]);

    // ---- 6. notification work is queued in the same transaction ------------------
    expect(await harness.outbox.pendingCount()).toBe(2);

    // ---- 7. the worker processes contact notifications ---------------------------
    const dispatch = harness.module.get(NotificationDispatchService);
    const drained = await dispatch.drain();
    expect(drained.processed).toBe(2);
    expect(await harness.outbox.pendingCount()).toBe(0);

    const deliveries = harness.notifications.all();
    expect(deliveries).toHaveLength(2);
    expect(deliveries.every((d) => d.status === 'sent')).toBe(true);

    // ---- 8. the operator console was told, in real time --------------------------
    expect(harness.realtime.created.map((incident) => incident.id)).toContain(incidentId);

    // ---- 9. the subject streams location -----------------------------------------
    await request(http)
      .post(`${BASE}/incidents/${incidentId}/location`)
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

    // ---- 10. the operator sees the new position ----------------------------------
    const operatorView = await request(http)
      .get(`${BASE}/incidents/${incidentId}`)
      .set('Authorization', `Bearer ${operator.accessToken}`)
      .expect(200);

    expect(operatorView.body.lastKnownLocation.latitude).toBeCloseTo(53.502, 5);
    expect(harness.realtime.updated.some((u) => u.changedFields.includes('lastKnownLocation'))).toBe(
      true,
    );

    // the operator claims it before doing anything to it
    const claimed = await request(http)
      .post(`${BASE}/incidents/${incidentId}/claim`)
      .set('Authorization', `Bearer ${operator.accessToken}`)
      .send({ expectedVersion: operatorView.body.version })
      .expect(200);

    expect(claimed.body.claimedByOperatorId).toBe(operator.userId);

    await request(http)
      .post(`${BASE}/incidents/${incidentId}/notes`)
      .set('Authorization', `Bearer ${operator.accessToken}`)
      .send({ note: 'Called the subject, no answer. Monitoring position.', expectedVersion: claimed.body.version })
      .expect(201);

    // ---- 11. a trusted contact acknowledges through their link -------------------
    const tokens = harness.module.get<import('../../src/application/ports').TokenService>(
      PORTS.TokenService,
    );
    const viewToken = tokens.issueContactViewToken({
      incidentId,
      contactId: primary.body.id,
      ttlSeconds: 3600,
    });

    const acknowledged = await request(http)
      .post(`${BASE}/contact-view/${viewToken}/acknowledge`)
      .send({ note: 'On my way' })
      .expect(200);

    expect(acknowledged.body.status).toBe('acknowledged');
    expect(acknowledged.body.acknowledgedAt).not.toBeNull();

    // ---- 12. the subject resolves it ---------------------------------------------
    const current = await request(http)
      .get(`${BASE}/incidents/${incidentId}`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .expect(200);

    const resolved = await request(http)
      .post(`${BASE}/incidents/${incidentId}/resolve`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .send({ resolution: 'user_safe', note: 'Home safe.', expectedVersion: current.body.version })
      .expect(200);

    expect(resolved.body.status).toBe('resolved');
    expect(resolved.body.resolvedBy).toBe(subject.userId);

    // ---- 13. the timeline is complete, ordered and append-only -------------------
    const finalTimeline = await request(http)
      .get(`${BASE}/incidents/${incidentId}/timeline`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .expect(200);

    const events = finalTimeline.body.events as Array<{ sequence: number; type: string }>;
    const sequences = events.map((event) => event.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(new Set(sequences).size).toBe(sequences.length);

    const types = events.map((event) => event.type);
    expect(types).toContain('incident.activated');
    expect(types).toContain('incident.location_recorded');
    expect(types).toContain('incident.contact_notified');
    expect(types).toContain('incident.operator_claimed');
    expect(types).toContain('incident.operator_note_added');
    expect(types).toContain('incident.contact_acknowledged');
    expect(types).toContain('incident.resolved');

    // Nothing that happened earlier was rewritten by anything that happened later.
    const openingEventIds = (openingTimeline.body.events as Array<{ id: string }>).map((e) => e.id);
    const finalEventIds = events.map((event) => (event as unknown as { id: string }).id);
    expect(finalEventIds.slice(0, openingEventIds.length)).toEqual(openingEventIds);
  });
});

describe('cancellation during the countdown', () => {
  it('creates no incident when the user cancels in time', async () => {
    const subject = await registerUser('canceller@example.com');

    const countdown = await request(http)
      .post(`${BASE}/sos/countdown`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .send({ durationSeconds: 10, activationIdempotencyKey: 'cancel-key-000000001' })
      .expect(201);

    harness.clock.advanceBySeconds(4);

    const cancelled = await request(http)
      .post(`${BASE}/sos/countdown/${countdown.body.id}/cancel`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .send({ reason: 'false_trigger' })
      .expect(200);

    expect(cancelled.body.status).toBe('cancelled');

    // A late activation for a cancelled countdown must not resurrect it.
    await request(http)
      .post(`${BASE}/sos/activate`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .set('Idempotency-Key', 'cancel-key-000000001')
      .send({ countdownId: countdown.body.id })
      .expect(422);

    const incidents = await request(http)
      .get(`${BASE}/incidents`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .expect(200);

    expect(incidents.body.items).toHaveLength(0);
    expect(await harness.outbox.pendingCount()).toBe(0);
  });

  it('refuses a cancellation that arrives after the countdown finished', async () => {
    const subject = await registerUser('late-canceller@example.com');

    const countdown = await request(http)
      .post(`${BASE}/sos/countdown`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .send({ durationSeconds: 5, activationIdempotencyKey: 'late-key-000000001' })
      .expect(201);

    harness.clock.advanceBySeconds(6);

    // The user is told the truth: the alert is going out. Showing a cancelled screen
    // while contacts receive messages would be worse than an error.
    await request(http)
      .post(`${BASE}/sos/countdown/${countdown.body.id}/cancel`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .send({ reason: 'user_cancelled' })
      .expect(412);
  });
});

describe('duplicate activation', () => {
  it('creates exactly one incident no matter how many times the client retries', async () => {
    const subject = await registerUser('retrier@example.com');

    await request(http)
      .post(`${BASE}/trusted-contacts`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .send({ name: 'Only Contact', phone: '+1 555 0102' })
      .expect(201);

    const send = () =>
      request(http)
        .post(`${BASE}/sos/activate`)
        .set('Authorization', `Bearer ${subject.accessToken}`)
        .set('Idempotency-Key', 'retry-storm-000000001')
        .send({ trigger: 'manual_panic' });

    const first = await send().expect(201);
    const incidentId = first.body.incident.id as string;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const repeat = await send();
      expect([200, 201]).toContain(repeat.status);
      expect(repeat.body.incident.id).toBe(incidentId);
    }

    const incidents = await request(http)
      .get(`${BASE}/incidents`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .expect(200);

    expect(incidents.body.items).toHaveLength(1);

    // One contact, one outbox message, regardless of five attempts.
    expect(await harness.outbox.pendingCount()).toBe(1);
  });

  it('rejects the same key used with a different body', async () => {
    const subject = await registerUser('key-reuser@example.com');

    await request(http)
      .post(`${BASE}/sos/activate`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .set('Idempotency-Key', 'shared-key-000000001')
      .send({ trigger: 'manual_panic' })
      .expect(201);

    await request(http)
      .post(`${BASE}/sos/activate`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .set('Idempotency-Key', 'shared-key-000000001')
      .send({ trigger: 'session_overdue' })
      .expect(409);
  });

  it('refuses activation with no idempotency key at all', async () => {
    const subject = await registerUser('no-key@example.com');

    await request(http)
      .post(`${BASE}/sos/activate`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .send({ trigger: 'manual_panic' })
      .expect(400);
  });
});

describe('offline recovery', () => {
  it('accepts a backlog flushed late and keeps the original capture times', async () => {
    const subject = await registerUser('offline@example.com');

    // The device was offline at 19:45 and only reaches the server at 20:05.
    harness.clock.set('2026-03-14T20:05:00.000Z');

    const activation = await request(http)
      .post(`${BASE}/sos/activate`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .set('Idempotency-Key', 'offline-key-000000001')
      .send({ trigger: 'manual_panic', occurredAt: '2026-03-14T19:45:00.000Z' })
      .expect(201);

    const incidentId = activation.body.incident.id as string;
    expect(activation.body.incident.activatedAt).toBe('2026-03-14T19:45:00.000Z');

    // A backlog of fixes, deliberately not in order, as a flushed queue often is.
    await request(http)
      .post(`${BASE}/incidents/${incidentId}/location`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .send({
        points: [
          { latitude: 53.5, longitude: 3.2, accuracyMetres: 20, capturedAt: '2026-03-14T19:50:00.000Z' },
          { latitude: 53.51, longitude: 3.21, accuracyMetres: 15, capturedAt: '2026-03-14T19:47:00.000Z' },
          { latitude: 53.52, longitude: 3.22, accuracyMetres: 10, capturedAt: '2026-03-14T19:55:00.000Z' },
        ],
      })
      .expect(202);

    const incident = await request(http)
      .get(`${BASE}/incidents/${incidentId}`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .expect(200);

    // The newest capture time wins, not the last one in the array.
    expect(incident.body.lastKnownLocation.capturedAt).toBe('2026-03-14T19:55:00.000Z');

    const timeline = await request(http)
      .get(`${BASE}/incidents/${incidentId}/timeline`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .expect(200);

    const locationEvents = (timeline.body.events as Array<{ type: string; occurredAt: string }>)
      .filter((event) => event.type === 'incident.location_recorded')
      .map((event) => event.occurredAt);

    // Every point is on the timeline with the time it was captured, not the time it
    // arrived. The map draws the walk that happened, not a spike at 20:05.
    expect(locationEvents).toEqual([
      '2026-03-14T19:50:00.000Z',
      '2026-03-14T19:47:00.000Z',
      '2026-03-14T19:55:00.000Z',
    ]);
  });
});
