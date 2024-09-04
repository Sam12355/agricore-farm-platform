import request from 'supertest';
import type { App } from 'supertest/types';

import { DEMO_PASSWORD } from '@agricore/test-fixtures';

import { PORTS } from '../../src/application/tokens';
import { createTestApp, type TestApp } from '../support/test-app';

/**
 * The GraphQL read model.
 *
 * The point of these tests is not that GraphQL works, it is that the authorisation rules
 * survive the second transport. A resolver looks like a pure data accessor, and every
 * field resolver is another place an unchecked read can appear, so each one gets a
 * cross-user test rather than a single "managers can query" test.
 */

let harness: TestApp;
let http: App;

async function register(email: string) {
  const response = await request(http)
    .post('/api/v1/auth/register')
    .send({ email, password: DEMO_PASSWORD, displayName: 'Test User', acceptedDemoNotice: true })
    .expect(201);
  return {
    userId: response.body.user.id as string,
    accessToken: response.body.tokens.accessToken as string,
  };
}

async function registerManager(email: string) {
  const registered = await register(email);

  const users = harness.module.get<import('../../src/application/ports').UserRepository>(
    PORTS.UserRepository,
  );
  const user = await users.findById(registered.userId);
  if (user === null) throw new Error('user missing');
  await users.update({ ...user, role: 'manager' });

  const login = await request(http)
    .post('/api/v1/auth/login')
    .send({ email, password: DEMO_PASSWORD })
    .expect(200);

  return { userId: registered.userId, accessToken: login.body.tokens.accessToken as string };
}

async function activate(token: string, key: string) {
  const response = await request(http)
    .post('/api/v1/alerts/activate')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', key)
    .send({ trigger: 'manual_report' })
    .expect(201);
  return response.body.alert.id as string;
}

function graphql(query: string, variables: Record<string, unknown> = {}, token?: string) {
  const req = request(http).post('/graphql').send({ query, variables });
  return token === undefined ? req : req.set('Authorization', `Bearer ${token}`);
}

beforeEach(async () => {
  harness = await createTestApp();
  http = harness.app.getHttpServer();
});

afterEach(async () => {
  await harness.close();
});

describe('the GraphQL endpoint', () => {
  it('is served', async () => {
    const manager = await registerManager('gql-manager@example.com');

    const response = await graphql(
      '{ queueCounts { activeCount unclaimedCount } }',
      {},
      manager.accessToken,
    ).expect(200);

    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.queueCounts).toEqual({ activeCount: 0, unclaimedCount: 0 });
  });

  it('exposes the schema the console was written against', async () => {
    const manager = await registerManager('gql-introspect@example.com');

    const response = await graphql(
      '{ __type(name: "Alert") { fields { name } } }',
      {},
      manager.accessToken,
    ).expect(200);

    const fields = (response.body.data.__type.fields as Array<{ name: string }>).map(
      (field) => field.name,
    );

    expect(fields).toEqual(
      expect.arrayContaining(['id', 'status', 'priority', 'version', 'events', 'notifiedWorkerCount']),
    );
  });
});

describe('authorisation on the GraphQL surface', () => {
  it('refuses an unauthenticated query', async () => {
    const response = await graphql('{ queueCounts { activeCount } }').expect(200);
    // GraphQL returns 200 with an errors array rather than a status code. That flattening
    // is exactly why the mutations stayed on REST.
    expect(response.body.errors).toBeDefined();
    expect(response.body.data?.queueCounts ?? null).toBeNull();
  });

  it('refuses an ordinary user, because the queue is the whole alert firehose', async () => {
    const user = await register('gql-user@example.com');

    const response = await graphql(
      '{ queueCounts { activeCount } }',
      {},
      user.accessToken,
    ).expect(200);

    expect(response.body.errors).toBeDefined();
  });

  it('lets a manager read the queue', async () => {
    const subject = await register('gql-subject@example.com');
    await activate(subject.accessToken, 'gql-key-0000000001');

    const manager = await registerManager('gql-manager-2@example.com');

    const response = await graphql(
      '{ alerts(limit: 10) { items { id status priority } hasMore } }',
      {},
      manager.accessToken,
    ).expect(200);

    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.alerts.items).toHaveLength(1);
    expect(response.body.data.alerts.items[0].status).toBe('active');
  });
});

describe('field resolvers', () => {
  it('resolves the timeline only when it is asked for', async () => {
    const subject = await register('gql-timeline@example.com');
    const alertId = await activate(subject.accessToken, 'gql-key-0000000002');
    const manager = await registerManager('gql-manager-3@example.com');

    const withoutEvents = await graphql(
      'query($id: ID!) { alert(id: $id) { id status } }',
      { id: alertId },
      manager.accessToken,
    ).expect(200);
    expect(withoutEvents.body.data.alert.events).toBeUndefined();

    const withEvents = await graphql(
      'query($id: ID!) { alert(id: $id) { id events { sequence type } } }',
      { id: alertId },
      manager.accessToken,
    ).expect(200);

    const events = withEvents.body.data.alert.events as Array<{ sequence: number; type: string }>;
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.type).toBe('alert.activated');
  });

  it('supports fetching only the events after a known sequence', async () => {
    const subject = await register('gql-delta@example.com');
    const alertId = await activate(subject.accessToken, 'gql-key-0000000003');

    await request(http)
      .post(`/api/v1/alerts/${alertId}/location`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .send({
        points: [
          { latitude: 53.5, longitude: 3.2, accuracyMetres: 10, capturedAt: '2026-03-14T19:46:00.000Z' },
        ],
      })
      .expect(202);

    const manager = await registerManager('gql-manager-4@example.com');

    const all = await graphql(
      'query($id: ID!) { alert(id: $id) { events { sequence } } }',
      { id: alertId },
      manager.accessToken,
    ).expect(200);
    const total = all.body.data.alert.events.length;

    const delta = await graphql(
      'query($id: ID!) { alert(id: $id) { events(after: 1) { sequence } } }',
      { id: alertId },
      manager.accessToken,
    ).expect(200);

    // The mechanism the console uses on reconnect: ask for what came after what it has.
    expect(delta.body.data.alert.events.length).toBe(total - 1);
    expect(delta.body.data.alert.events[0].sequence).toBe(2);
  });

  it('returns a count of notified workers, never the workers themselves', async () => {
    const subject = await register('gql-workers@example.com');

    await request(http)
      .post('/api/v1/workers')
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .send({ name: 'Private Person', phone: '+1 555 0177' })
      .expect(201);

    const alertId = await activate(subject.accessToken, 'gql-key-0000000004');
    const manager = await registerManager('gql-manager-5@example.com');

    const response = await graphql(
      'query($id: ID!) { alert(id: $id) { notifiedWorkerCount } }',
      { id: alertId },
      manager.accessToken,
    ).expect(200);

    expect(typeof response.body.data.alert.notifiedWorkerCount).toBe('number');
    // A manager needs to know whether anybody was reached. They do not need the name or
    // the number of an assigned worker.
    expect(JSON.stringify(response.body)).not.toContain('Private Person');
    expect(JSON.stringify(response.body)).not.toContain('555 0177');
  });

  it('does not expose a field for worker details at all', async () => {
    const manager = await registerManager('gql-manager-6@example.com');

    const response = await graphql(
      '{ __type(name: "Alert") { fields { name } } }',
      {},
      manager.accessToken,
    ).expect(200);

    const fields = (response.body.data.__type.fields as Array<{ name: string }>).map(
      (field) => field.name,
    );

    // Structural, not a filter. There is nowhere to put a worker detail even by accident.
    expect(fields).not.toContain('workers');
    expect(fields).not.toContain('workers');
    expect(fields).not.toContain('notifications');
  });
});
