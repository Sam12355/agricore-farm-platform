import request from 'supertest';
import type { App } from 'supertest/types';

import { DEMO_PASSWORD } from '@agricore/test-fixtures';

import { PORTS } from '../../src/application/tokens';
import { PrivacyService } from '../../src/application/services/privacy.service';
import { createTestApp, type TestApp } from '../support/test-app';

/**
 * Authorisation, token rotation and privacy behaviour, wired through the real module.
 *
 * These are the checks I would want to see before believing a claim like "resource-level
 * authorisation at every sensitive operation". Each one describes an attack or a mistake
 * rather than a method call.
 */

const BASE = '/api/v1';

let harness: TestApp;
let http: App;

async function register(email: string) {
  const response = await request(http)
    .post(`${BASE}/auth/register`)
    .send({ email, password: DEMO_PASSWORD, displayName: 'Test', acceptedDemoNotice: true })
    .expect(201);
  return {
    userId: response.body.user.id as string,
    accessToken: response.body.tokens.accessToken as string,
    refreshToken: response.body.tokens.refreshToken as string,
  };
}

async function activate(token: string, key: string) {
  const response = await request(http)
    .post(`${BASE}/alerts/activate`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', key)
    .send({ trigger: 'manual_report' })
    .expect(201);
  return response.body.alert.id as string;
}

beforeEach(async () => {
  harness = await createTestApp();
  http = harness.app.getHttpServer();
});

afterEach(async () => {
  await harness.close();
});

describe('resource-level authorisation', () => {
  it('does not let one user read another user alert', async () => {
    const owner = await register('owner@example.com');
    const stranger = await register('stranger@example.com');
    const alertId = await activate(owner.accessToken, 'owner-key-000000001');

    // 404, not 403. A 403 would confirm that this alert id exists.
    await request(http)
      .get(`${BASE}/alerts/${alertId}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`)
      .expect(404);
  });

  it('does not let one user post location onto another user alert', async () => {
    const owner = await register('owner2@example.com');
    const stranger = await register('stranger2@example.com');
    const alertId = await activate(owner.accessToken, 'owner-key-000000002');

    await request(http)
      .post(`${BASE}/alerts/${alertId}/location`)
      .set('Authorization', `Bearer ${stranger.accessToken}`)
      .send({
        points: [
          { latitude: 0, longitude: 0, accuracyMetres: 5, capturedAt: '2026-03-14T19:46:00.000Z' },
        ],
      })
      .expect(403);
  });

  it('keeps one user assigned workers out of another user list', async () => {
    const owner = await register('owner3@example.com');
    const stranger = await register('stranger3@example.com');

    const created = await request(http)
      .post(`${BASE}/workers`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Private Worker', phone: '+1 555 0110' })
      .expect(201);

    const strangerList = await request(http)
      .get(`${BASE}/workers`)
      .set('Authorization', `Bearer ${stranger.accessToken}`)
      .expect(200);
    expect(strangerList.body.items).toHaveLength(0);

    await request(http)
      .patch(`${BASE}/workers/${created.body.id}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`)
      .send({ name: 'Hijacked' })
      .expect(404);

    await request(http)
      .delete(`${BASE}/workers/${created.body.id}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`)
      .expect(404);
  });

  it('scopes the alert list to the caller', async () => {
    const owner = await register('owner4@example.com');
    const stranger = await register('stranger4@example.com');
    await activate(owner.accessToken, 'owner-key-000000004');

    const list = await request(http)
      .get(`${BASE}/alerts`)
      .set('Authorization', `Bearer ${stranger.accessToken}`)
      .expect(200);

    expect(list.body.items).toHaveLength(0);
  });

  it('refuses manager-only actions to an ordinary user', async () => {
    const owner = await register('owner5@example.com');
    const alertId = await activate(owner.accessToken, 'owner-key-000000005');

    // Even on their own alert. Claiming is a manager concept.
    await request(http)
      .post(`${BASE}/alerts/${alertId}/claim`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ expectedVersion: 0 })
      .expect(403);

    await request(http)
      .post(`${BASE}/alerts/${alertId}/priority`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ priority: 'critical', expectedVersion: 0 })
      .expect(403);
  });

  it('rejects a request with no credentials at all', async () => {
    await request(http).get(`${BASE}/alerts`).expect(401);
    await request(http).get(`${BASE}/workers`).expect(401);
    await request(http).get(`${BASE}/privacy/settings`).expect(401);
  });

  it('rejects a tampered bearer token', async () => {
    const owner = await register('owner6@example.com');
    const tampered = `${owner.accessToken.slice(0, -4)}AAAA`;

    await request(http)
      .get(`${BASE}/alerts`)
      .set('Authorization', `Bearer ${tampered}`)
      .expect(401);
  });
});

describe('optimistic concurrency', () => {
  it('rejects a mutation that carries a stale version and reports the current one', async () => {
    const owner = await register('concurrent@example.com');
    const alertId = await activate(owner.accessToken, 'concurrent-key-00001');

    const before = await request(http)
      .get(`${BASE}/alerts/${alertId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    // Something else moves the alert forward.
    await request(http)
      .post(`${BASE}/alerts/${alertId}/location`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        points: [
          { latitude: 1, longitude: 1, accuracyMetres: 5, capturedAt: '2026-03-14T19:47:00.000Z' },
        ],
      })
      .expect(202);

    const stale = await request(http)
      .post(`${BASE}/alerts/${alertId}/resolve`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ resolution: 'issue_cleared', expectedVersion: before.body.version })
      .expect(409);

    expect(stale.body.error.code).toBe('STALE_VERSION');
    // The client is told what the version actually is, so the UI can reload and show
    // what changed rather than making the user guess.
    expect(stale.body.error.details.currentVersion).toBeGreaterThan(before.body.version);
  });
});

describe('refresh token rotation', () => {
  it('issues a new refresh token on every exchange', async () => {
    const user = await register('rotate@example.com');

    const refreshed = await request(http)
      .post(`${BASE}/auth/refresh`)
      .send({ refreshToken: user.refreshToken })
      .expect(200);

    expect(refreshed.body.tokens.refreshToken).not.toBe(user.refreshToken);
  });

  it('revokes the whole family when a token is presented twice', async () => {
    const user = await register('reuse@example.com');

    const first = await request(http)
      .post(`${BASE}/auth/refresh`)
      .send({ refreshToken: user.refreshToken })
      .expect(200);

    // Replaying the original is either a client bug or a stolen token. We cannot tell
    // which, so everything descended from it stops working.
    await request(http)
      .post(`${BASE}/auth/refresh`)
      .send({ refreshToken: user.refreshToken })
      .expect(401);

    await request(http)
      .post(`${BASE}/auth/refresh`)
      .send({ refreshToken: first.body.tokens.refreshToken })
      .expect(401);
  });

  it('stops accepting a refresh token after logout', async () => {
    const user = await register('logout@example.com');

    await request(http)
      .post(`${BASE}/auth/logout`)
      .send({ refreshToken: user.refreshToken })
      .expect(204);

    await request(http)
      .post(`${BASE}/auth/refresh`)
      .send({ refreshToken: user.refreshToken })
      .expect(401);
  });

  it('does not reveal whether an email address is registered', async () => {
    await register('known@example.com');

    const known = await request(http)
      .post(`${BASE}/auth/login`)
      .send({ email: 'known@example.com', password: 'definitely-the-wrong-password' })
      .expect(401);

    const unknown = await request(http)
      .post(`${BASE}/auth/login`)
      .send({ email: 'never-registered@example.com', password: 'definitely-the-wrong-password' })
      .expect(401);

    expect(known.body.error.message).toBe(unknown.body.error.message);
  });

  it('refuses to register the same address twice without saying why', async () => {
    await register('dupe@example.com');

    const second = await request(http)
      .post(`${BASE}/auth/register`)
      .send({
        email: 'dupe@example.com',
        password: DEMO_PASSWORD,
        displayName: 'Someone else',
        acceptedDemoNotice: true,
      })
      .expect(409);

    expect(second.body.error.message).not.toMatch(/already|exists|taken/i);
  });
});

describe('privacy', () => {
  it('exports only the requesting user data', async () => {
    const owner = await register('exporter@example.com');
    const stranger = await register('other@example.com');

    await activate(owner.accessToken, 'export-key-000000001');
    await activate(stranger.accessToken, 'export-key-000000002');

    await request(http)
      .post(`${BASE}/workers`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Owner Worker', phone: '+1 555 0111' })
      .expect(201);

    const exported = await request(http)
      .post(`${BASE}/privacy/export`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ includeLocationHistory: true })
      .expect(202);

    const objects = harness.module.get<
      import('../../src/infrastructure/services/support-adapters').MemoryObjectStore
    >(PORTS.ObjectStore);
    const raw = objects.read(exported.body.downloadUrl.replace('memory://', ''));
    expect(raw).not.toBeNull();

    const document = JSON.parse(raw ?? '{}');
    expect(document.account.id).toBe(owner.userId);
    expect(document.workers).toHaveLength(1);
    expect(document.alerts).toHaveLength(1);
    // Nothing belonging to the other account leaked in.
    expect(JSON.stringify(document)).not.toContain(stranger.userId);
  });

  it('requires the current password before scheduling a deletion', async () => {
    const owner = await register('deleter@example.com');

    await request(http)
      .post(`${BASE}/privacy/deletion`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ password: 'not-the-right-password', confirmation: 'DELETE MY ACCOUNT' })
      .expect(401);

    await request(http)
      .post(`${BASE}/privacy/deletion`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ password: DEMO_PASSWORD, confirmation: 'DELETE MY ACCOUNT' })
      .expect(202);
  });

  it('rejects a deletion request without the typed confirmation', async () => {
    const owner = await register('half-deleter@example.com');

    await request(http)
      .post(`${BASE}/privacy/deletion`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ password: DEMO_PASSWORD })
      .expect(400);
  });

  it('ends every session immediately when deletion is scheduled', async () => {
    const owner = await register('session-ender@example.com');

    await request(http)
      .post(`${BASE}/privacy/deletion`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ password: DEMO_PASSWORD, confirmation: 'DELETE MY ACCOUNT' })
      .expect(202);

    await request(http)
      .post(`${BASE}/auth/refresh`)
      .send({ refreshToken: owner.refreshToken })
      .expect(401);
  });

  it('removes personal data on execution but keeps the audit record of the deletion', async () => {
    const owner = await register('erased@example.com');
    await activate(owner.accessToken, 'erase-key-000000001');

    await request(http)
      .post(`${BASE}/workers`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Worker To Erase', phone: '+1 555 0112' })
      .expect(201);

    const privacy = harness.module.get(PrivacyService);
    await privacy.executeDeletion(owner.userId);

    const users = harness.module.get<
      import('../../src/infrastructure/persistence/memory/memory-repositories').MemoryUserRepository
    >(PORTS.UserRepository);
    const remaining = await users.findById(owner.userId);

    expect(remaining).not.toBeNull();
    expect(remaining?.email).not.toContain('erased@example.com');
    expect(remaining?.displayName).toBe('Deleted account');
    expect(remaining?.passwordHash).toBe('');
    expect(remaining?.deletedAt).not.toBeNull();

    const audit = harness.module.get<
      import('../../src/infrastructure/persistence/memory/memory-repositories').MemoryAuditRepository
    >(PORTS.AuditRepository);
    const deletionRecords = audit.all().filter((record) => record.action === 'account.deleted');
    expect(deletionRecords).toHaveLength(1);
    // The record survives, and it says nothing about who the person was.
    expect(JSON.stringify(deletionRecords[0])).not.toContain('erased@example.com');
  });

  it('lets a scheduled deletion be cancelled during the grace period', async () => {
    const owner = await register('regretful@example.com');

    await request(http)
      .post(`${BASE}/privacy/deletion`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ password: DEMO_PASSWORD, confirmation: 'DELETE MY ACCOUNT' })
      .expect(202);

    const scheduled = await request(http)
      .get(`${BASE}/privacy/deletion`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(scheduled.body.status).toBe('scheduled');

    await request(http)
      .delete(`${BASE}/privacy/deletion`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(204);

    const cancelled = await request(http)
      .get(`${BASE}/privacy/deletion`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(cancelled.body.status).toBe('none');
  });
});

describe('operational endpoints', () => {
  it('answers liveness without touching a dependency', async () => {
    const response = await request(http).get('/health').expect(200);
    expect(response.body.status).toBe('ok');
  });

  it('answers readiness with a per-dependency breakdown', async () => {
    const response = await request(http).get('/ready').expect(200);
    expect(response.body.status).toBe('ready');
    expect(response.body.checks.map((check: { name: string }) => check.name)).toEqual([
      'users',
      'alerts',
      'outbox',
    ]);
  });

  it('puts a correlation id on every response', async () => {
    const response = await request(http).get('/health').expect(200);
    expect(response.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('echoes a caller-supplied correlation id when it is safe to reuse', async () => {
    const response = await request(http)
      .get('/health')
      .set('X-Correlation-Id', 'client-supplied-1234')
      .expect(200);
    expect(response.headers['x-correlation-id']).toBe('client-supplied-1234');
  });

  it('ignores a correlation id that is not url-safe', async () => {
    // A newline here would be a log-injection vector, splitting one log line into two.
    // Node's HTTP client refuses to send a header containing a raw newline at all, so
    // the case that actually reaches an application is the one with other unexpected
    // characters in it. Either way the value is regenerated rather than trusted.
    const response = await request(http)
      .get('/health')
      .set('X-Correlation-Id', 'bad value with spaces and <script>')
      .expect(200);

    expect(response.headers['x-correlation-id']).not.toContain(' ');
    expect(response.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('ignores a correlation id that is absurdly long', async () => {
    const response = await request(http)
      .get('/health')
      .set('X-Correlation-Id', 'a'.repeat(500))
      .expect(200);

    expect(response.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
