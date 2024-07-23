import request from 'supertest';
import type { App } from 'supertest/types';

import { DEMO_PASSWORD } from '@guardianlink/test-fixtures';

import { PORTS } from '../../src/application/tokens';
import { createTestApp, type TestApp } from '../support/test-app';

/**
 * The GraphQL read model.
 *
 * The point of these tests is not that GraphQL works, it is that the authorisation rules
 * survive the second transport. A resolver looks like a pure data accessor, and every
 * field resolver is another place an unchecked read can appear, so each one gets a
 * cross-user test rather than a single "operators can query" test.
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

async function registerOperator(email: string) {
  const registered = await register(email);

  const users = harness.module.get<import('../../src/application/ports').UserRepository>(
    PORTS.UserRepository,
  );
  const user = await users.findById(registered.userId);
  if (user === null) throw new Error('user missing');
  await users.update({ ...user, role: 'operator' });

  const login = await request(http)
    .post('/api/v1/auth/login')
    .send({ email, password: DEMO_PASSWORD })
    .expect(200);

  return { userId: registered.userId, accessToken: login.body.tokens.accessToken as string };
}

async function activate(token: string, key: string) {
  const response = await request(http)
    .post('/api/v1/sos/activate')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', key)
    .send({ trigger: 'manual_panic' })
    .expect(201);
  return response.body.incident.id as string;
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
    const operator = await registerOperator('gql-operator@example.com');

    const response = await graphql(
      '{ queueCounts { activeCount unclaimedCount } }',
      {},
      operator.accessToken,
    ).expect(200);

    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.queueCounts).toEqual({ activeCount: 0, unclaimedCount: 0 });
  });

  it('exposes the schema the console was written against', async () => {
    const operator = await registerOperator('gql-introspect@example.com');

    const response = await graphql(
      '{ __type(name: "Incident") { fields { name } } }',
      {},
      operator.accessToken,
    ).expect(200);

    const fields = (response.body.data.__type.fields as Array<{ name: string }>).map(
      (field) => field.name,
    );

    expect(fields).toEqual(
      expect.arrayContaining(['id', 'status', 'priority', 'version', 'events', 'notifiedContactCount']),
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

  it('refuses an ordinary user, because the queue is the whole incident firehose', async () => {
    const user = await register('gql-user@example.com');

    const response = await graphql(
      '{ queueCounts { activeCount } }',
      {},
      user.accessToken,
    ).expect(200);

    expect(response.body.errors).toBeDefined();
  });

  it('lets an operator read the queue', async () => {
    const subject = await register('gql-subject@example.com');
    await activate(subject.accessToken, 'gql-key-0000000001');

    const operator = await registerOperator('gql-operator-2@example.com');

    const response = await graphql(
      '{ incidents(limit: 10) { items { id status priority } hasMore } }',
      {},
      operator.accessToken,
    ).expect(200);

    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.incidents.items).toHaveLength(1);
    expect(response.body.data.incidents.items[0].status).toBe('active');
  });
});

describe('field resolvers', () => {
  it('resolves the timeline only when it is asked for', async () => {
    const subject = await register('gql-timeline@example.com');
    const incidentId = await activate(subject.accessToken, 'gql-key-0000000002');
    const operator = await registerOperator('gql-operator-3@example.com');

    const withoutEvents = await graphql(
      'query($id: ID!) { incident(id: $id) { id status } }',
      { id: incidentId },
      operator.accessToken,
    ).expect(200);
    expect(withoutEvents.body.data.incident.events).toBeUndefined();

    const withEvents = await graphql(
      'query($id: ID!) { incident(id: $id) { id events { sequence type } } }',
      { id: incidentId },
      operator.accessToken,
    ).expect(200);

    const events = withEvents.body.data.incident.events as Array<{ sequence: number; type: string }>;
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.type).toBe('incident.activated');
  });

  it('supports fetching only the events after a known sequence', async () => {
    const subject = await register('gql-delta@example.com');
    const incidentId = await activate(subject.accessToken, 'gql-key-0000000003');

    await request(http)
      .post(`/api/v1/incidents/${incidentId}/location`)
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .send({
        points: [
          { latitude: 53.5, longitude: 3.2, accuracyMetres: 10, capturedAt: '2026-03-14T19:46:00.000Z' },
        ],
      })
      .expect(202);

    const operator = await registerOperator('gql-operator-4@example.com');

    const all = await graphql(
      'query($id: ID!) { incident(id: $id) { events { sequence } } }',
      { id: incidentId },
      operator.accessToken,
    ).expect(200);
    const total = all.body.data.incident.events.length;

    const delta = await graphql(
      'query($id: ID!) { incident(id: $id) { events(after: 1) { sequence } } }',
      { id: incidentId },
      operator.accessToken,
    ).expect(200);

    // The mechanism the console uses on reconnect: ask for what came after what it has.
    expect(delta.body.data.incident.events.length).toBe(total - 1);
    expect(delta.body.data.incident.events[0].sequence).toBe(2);
  });

  it('returns a count of notified contacts, never the contacts themselves', async () => {
    const subject = await register('gql-contacts@example.com');

    await request(http)
      .post('/api/v1/trusted-contacts')
      .set('Authorization', `Bearer ${subject.accessToken}`)
      .send({ name: 'Private Person', phone: '+1 555 0177' })
      .expect(201);

    const incidentId = await activate(subject.accessToken, 'gql-key-0000000004');
    const operator = await registerOperator('gql-operator-5@example.com');

    const response = await graphql(
      'query($id: ID!) { incident(id: $id) { notifiedContactCount } }',
      { id: incidentId },
      operator.accessToken,
    ).expect(200);

    expect(typeof response.body.data.incident.notifiedContactCount).toBe('number');
    // An operator needs to know whether anybody was reached. They do not need the name or
    // the number of the subject's family.
    expect(JSON.stringify(response.body)).not.toContain('Private Person');
    expect(JSON.stringify(response.body)).not.toContain('555 0177');
  });

  it('does not expose a field for contact details at all', async () => {
    const operator = await registerOperator('gql-operator-6@example.com');

    const response = await graphql(
      '{ __type(name: "Incident") { fields { name } } }',
      {},
      operator.accessToken,
    ).expect(200);

    const fields = (response.body.data.__type.fields as Array<{ name: string }>).map(
      (field) => field.name,
    );

    // Structural, not a filter. There is nowhere to put a contact detail even by accident.
    expect(fields).not.toContain('contacts');
    expect(fields).not.toContain('trustedContacts');
    expect(fields).not.toContain('notifications');
  });
});
