import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createTestApp, validEvent } from '../helpers/testApp.mjs';
import { startHttpServer, openNotifications } from '../helpers/httpServer.mjs';
import { env } from '../../src/config/env.mjs';
import { confirmationMailer } from '../../src/mail/confirmationMailer.mjs';
import { listEventsByTime } from '../../src/services/mcpEventService.mjs';
import { notificationHub } from '../../src/notifications/notificationHub.mjs';

describe('MCP over authenticated Streamable HTTP', { timeout: 15000 }, () => {
  let app;
  let db;
  let http;
  let client;
  let originalConfig;
  let cleanups;
  const token = 'assignment-two-test-token-not-a-real-secret';

  beforeEach(async () => {
    ({ app, db } = await createTestApp());
    originalConfig = { ...env.mcp };
    env.mcp.token = token;
    cleanups = [];
    http = await startHttpServer(app);
  });

  afterEach(async () => {
    for (const cleanup of cleanups) await cleanup();
    await client?.close();
    client = undefined;
    await http.close();
    Object.assign(env.mcp, originalConfig);
  });

  async function connect(mode = 'auto') {
    client = new Client({ name: 'assignment-two-test', version: '1.0.0' }, { versionNegotiation: { mode } });
    const transport = new StreamableHTTPClientTransport(new URL(`${http.url}/api/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } }
    });
    await client.connect(transport);
    return client;
  }

  const call = (name, args = {}) => client.callTool({ name, arguments: args });
  const create = (overrides) => request(app).post('/api/events').send(validEvent(overrides)).expect(201);

  it('discovers exactly three tools with confirmation and side-effect annotations', async () => {
    await connect();
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), ['get_past_events', 'get_upcoming_events', 'register_participant']);
    const registration = tools.find((tool) => tool.name === 'register_participant');
    assert.equal(registration.annotations.readOnlyHint, false);
    assert.ok(registration.inputSchema.required.includes('confirmed'));
    assert.ok(client.getInstructions().includes('human approval'));
  });

  it('also supports a legacy client initialization handshake', async () => {
    await connect('legacy');
    assert.equal((await client.listTools()).tools.length, 3);
    assert.deepEqual((await call('get_upcoming_events')).structuredContent, { events: [] });
  });

  it('lists all events by time, with stable ordering, empty results and the exact boundary', async () => {
    await connect();
    assert.deepEqual((await call('get_upcoming_events')).structuredContent, { events: [] });
    assert.deepEqual((await call('get_past_events')).structuredContent, { events: [] });
    const now = Date.now();
    const past = await create({ startsAt: new Date(now - 60000).toISOString() });
    const later = await create({ startsAt: new Date(now + 120000).toISOString() });
    const sooner = await create({ startsAt: new Date(now + 60000).toISOString() });
    const upcoming = (await call('get_upcoming_events')).structuredContent.events;
    assert.deepEqual(upcoming.map((event) => event.id), [sooner.body.id, later.body.id]);
    assert.deepEqual((await call('get_past_events')).structuredContent.events.map((event) => event.id), [past.body.id]);
    assert.deepEqual((await listEventsByTime(false, now + 60000)).map((event) => event.id), [sooner.body.id, later.body.id]);
    assert.deepEqual(Object.keys(upcoming[0]).sort(), ['capacity', 'description', 'id', 'location', 'startsAt', 'title']);
  });

  it('saves through existing services, invalidates caches and broadcasts before best-effort email', async (t) => {
    const { body: event } = await create();
    await request(app).get(`/api/events/${event.id}`).expect(200);
    await request(app).get(`/api/events/${event.id}/registrations`).expect(200);
    const stream = await openNotifications(http.url);
    cleanups.push(() => stream.close());
    const messages = [];
    const unsubscribe = notificationHub.subscribe((message) => messages.push(message));
    cleanups.push(unsubscribe);
    const mail = t.mock.method(confirmationMailer, 'sendConfirmation', async (registration) => {
      assert.equal(registration.email, 'ada@example.com');
      assert.equal(messages.length, 1);
      assert.equal((await request(app).get(`/api/events/${event.id}`)).body.registered, 1);
      throw new Error('Fake SMTP failure');
    });
    await connect();
    const receipt = await call('register_participant', { eventId: event.id, name: 'Ada', email: 'ADA@example.com', confirmed: true });
    assert.equal(receipt.isError, false);
    assert.deepEqual(receipt.structuredContent, { eventId: event.id, status: 'registered' });
    assert.equal(mail.mock.callCount(), 1);
    assert.equal((await stream.next()).type, 'registration.created');
    const registrations = await request(app).get(`/api/events/${event.id}/registrations`);
    assert.equal(registrations.body.length, 1);
    assert.equal(registrations.body[0].name, 'Ada');
    const duplicate = await call('register_participant', { eventId: event.id, name: 'Ada', email: 'ada@example.com', confirmed: true });
    assert.equal(duplicate.isError, true);
    assert.equal(duplicate.structuredContent.error.code, 'CONFLICT');
    assert.equal(messages.length, 1);
    assert.equal(mail.mock.callCount(), 1);
  });

  it('rejects unconfirmed, invalid, guessed, unknown and past-event registrations without side effects', async (t) => {
    const { body: past } = await create({ startsAt: new Date(Date.now() - 60000).toISOString() });
    const messages = [];
    cleanups.push(notificationHub.subscribe((message) => messages.push(message)));
    const mail = t.mock.method(confirmationMailer, 'sendConfirmation', async () => {});
    await connect();
    const valid = { eventId: past.id, name: 'Ada', email: 'ada@example.com', confirmed: true };
    for (const overrides of [{ confirmed: false }, { confirmed: undefined }, { eventId: 'Bootcamp' }, { eventId: 0 }, { email: 'invalid' }, { name: 'A' }]) {
      const failed = await call('register_participant', { ...valid, ...overrides });
      assert.equal(failed.isError, true);
    }
    const unknown = await call('register_participant', { ...valid, eventId: 999 });
    assert.equal(unknown.structuredContent.error.code, 'NOT_FOUND');
    const expired = await call('register_participant', valid);
    assert.equal(expired.structuredContent.error.code, 'EVENT_PAST');
    assert.equal(mail.mock.callCount(), 0);
    assert.deepEqual(messages, []);
    assert.deepEqual((await request(app).get(`/api/events/${past.id}/registrations`)).body, []);
  });

  it('serializes concurrent MCP and REST duplicate registrations into one save, email and notification', async (t) => {
    const { body: event } = await create();
    const messages = [];
    cleanups.push(notificationHub.subscribe((message) => messages.push(message)));
    const mail = t.mock.method(confirmationMailer, 'sendConfirmation', async () => {});
    await connect();
    const participant = { name: 'Ada', email: 'ada@example.com' };
    const [mcp, rest] = await Promise.all([
      call('register_participant', { eventId: event.id, ...participant, confirmed: true }),
      request(app).post(`/api/events/${event.id}/registrations`).send({ ...participant, email: 'ADA@example.com' })
    ]);
    assert.equal(Number(!mcp.isError) + Number(rest.status === 201), 1);
    assert.equal(Number(mcp.isError) + Number(rest.status === 409), 1);
    assert.equal((await request(app).get(`/api/events/${event.id}/registrations`)).body.length, 1);
    assert.equal(mail.mock.callCount(), 1);
    assert.equal(messages.length, 1);
  });

  it('requires authentication for every MCP HTTP method and fails closed without a strong token', async () => {
    for (const method of ['get', 'post', 'delete']) {
      await request(app)[method]('/api/mcp').expect(401);
      await request(app)[method]('/api/mcp').set('Authorization', 'Bearer wrong').expect(401);
    }
    await request(app).post(`/api/mcp?token=${token}`).expect(401);
    env.mcp.token = '';
    await request(app).post('/api/mcp').expect(503);
    env.mcp.token = 'short';
    await request(app).post('/api/mcp').expect(503);
  });

  it('blocks hostile hosts/origins and oversized request bodies', async () => {
    const auth = { Authorization: `Bearer ${token}` };
    await request(app).post('/api/mcp').set(auth).set('Host', 'evil.example').send({}).expect(403);
    await request(app).post('/api/mcp').set(auth).set('Origin', 'https://evil.example').send({}).expect(403);
    await request(app).post('/api/mcp').set(auth).send({ padding: 'x'.repeat(17000) }).expect(413);
  });

  it('does not expose private database exception text in MCP errors', async (t) => {
    await connect();
    t.mock.method(db.Event, 'findAll', async () => { throw new Error('Private SQL values: ada@example.com'); });
    const failed = await call('get_upcoming_events');
    assert.equal(failed.isError, true);
    assert.deepEqual(failed.structuredContent, { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
    assert.ok(!JSON.stringify(failed).includes('ada@example.com'));
  });
});
