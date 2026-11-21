import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { EventEmitter } from 'node:events';
import request from 'supertest';
import { createTestApp, validEvent } from '../helpers/testApp.mjs';
import { startHttpServer, openNotifications } from '../helpers/httpServer.mjs';
import { notificationHub, createNotificationHub } from '../../src/notifications/notificationHub.mjs';
import { confirmationMailer } from '../../src/mail/confirmationMailer.mjs';
import { notifications } from '../../src/controllers/notificationController.mjs';
import { env } from '../../src/config/env.mjs';

describe('Privacy-safe SSE notifications', { timeout: 10000 }, () => {
  let app;
  let db;
  let http;
  let streams;
  let cleanups;

  beforeEach(async () => {
    ({ app, db } = await createTestApp());
    http = await startHttpServer(app);
    streams = [];
    cleanups = [];
  });

  afterEach(async () => {
    for (const cleanup of cleanups) cleanup();
    await Promise.all(streams.map((stream) => stream.close()));
    await http.close();
    assert.equal(notificationHub.size, 0);
  });

  async function openStream(headers) {
    const stream = await openNotifications(http.url, headers);
    streams.push(stream);
    return stream;
  }

  it('delivers one creation and one registration to each connected browser with only permitted fields', async () => {
    const first = await openStream();
    const second = await openStream();
    assert.match(first.response.headers.get('content-type'), /text\/event-stream/);
    assert.match(first.response.headers.get('cache-control'), /no-store/);
    const { body: event } = await request(app).post('/api/events').send(validEvent()).expect(201);
    const creations = await Promise.all([first.next(), second.next()]);
    assert.deepEqual(creations[0], creations[1]);
    assert.equal(creations[0].type, 'event.created');

    await request(app).post(`/api/events/${event.id}/registrations`).send({ name: 'Private Person', email: 'private@example.com' }).expect(201);
    const registrations = await Promise.all([first.next(), second.next()]);
    assert.deepEqual(registrations[0], registrations[1]);
    assert.equal(registrations[0].type, 'registration.created');
    assert.equal(registrations[0].eventId, event.id);
    assert.notEqual(registrations[0].id, creations[0].id);
    assert.deepEqual(Object.keys(registrations[0]).sort(), ['eventId', 'id', 'occurredAt', 'type']);
    assert.match(registrations[0].id, /^[0-9a-f-]{36}$/);
    assert.ok(!JSON.stringify(registrations).includes('Private Person'));
    assert.ok(!JSON.stringify(registrations).includes('private@example.com'));

    // A later creation acts as a barrier: an extra registration frame would fail here.
    await request(app).post('/api/events').send(validEvent()).expect(201);
    assert.equal((await first.next()).type, 'event.created');
    assert.equal((await second.next()).type, 'event.created');
  });

  it('publishes nothing for failed mutations, duplicates, event updates or deletes', async (t) => {
    const received = [];
    cleanups.push(notificationHub.subscribe((message) => received.push(message)));
    await request(app).post('/api/events').send({ title: 'x' }).expect(400);
    const failEvent = t.mock.method(db.Event, 'create', async () => { throw new Error('Database offline'); });
    await request(app).post('/api/events').send(validEvent()).expect(500);
    failEvent.mock.restore();
    assert.deepEqual(received, []);
    const { body: event } = await request(app).post('/api/events').send(validEvent()).expect(201);
    received.length = 0;
    const url = `/api/events/${event.id}/registrations`;
    const person = { name: 'Ada', email: 'ada@example.com' };
    await request(app).post(url).send({ ...person, email: 'invalid' }).expect(400);
    await request(app).post('/api/events/999/registrations').send(person).expect(404);
    const failRegistration = t.mock.method(db.Registration, 'create', async () => { throw new Error('Database offline'); });
    await request(app).post(url).send(person).expect(500);
    failRegistration.mock.restore();
    assert.deepEqual(received, []);
    await request(app).post(url).send(person).expect(201);
    await request(app).post(url).send(person).expect(409);
    await request(app).patch(`/api/events/${event.id}`).send({ title: 'Updated title' }).expect(200);
    await request(app).delete(`/api/events/${event.id}`).expect(204);
    assert.equal(received.length, 1);
  });

  it('handles concurrent REST duplicates and keeps the existing capacity condition', async (t) => {
    const { body: event } = await request(app).post('/api/events').send(validEvent({ capacity: 1 })).expect(201);
    const received = [];
    cleanups.push(notificationHub.subscribe((message) => received.push(message)));
    const mail = t.mock.method(confirmationMailer, 'sendConfirmation', async () => {});
    const url = `/api/events/${event.id}/registrations`;
    const attempts = await Promise.all(Array.from({ length: 8 }, () => request(app).post(url).send({ name: 'Ada', email: 'ADA@example.com' })));
    assert.equal(attempts.filter((response) => response.status === 201).length, 1);
    assert.equal(attempts.filter((response) => response.status === 409).length, 7);
    assert.equal(received.length, 1);
    // Deliberately preserve count > capacity: equality still allows one more save.
    await request(app).post(url).send({ name: 'Grace', email: 'grace@example.com' }).expect(201);
    await request(app).post(url).send({ name: 'Third', email: 'third@example.com' }).expect(409);
    assert.equal(received.length, 2);
    assert.equal(mail.mock.callCount(), 2);
  });

  it('broadcasts once before delayed email and releases the registration lock before SMTP', async (t) => {
    const { body: event } = await request(app).post('/api/events').send(validEvent()).expect(201);
    const stream = await openStream();
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    t.after(() => release.resolve());
    const mail = t.mock.method(confirmationMailer, 'sendConfirmation', async () => {
      entered.resolve();
      await release.promise;
      throw new Error('Fake email failure');
    });
    const url = `/api/events/${event.id}/registrations`;
    const person = { name: 'Ada', email: 'ada@example.com' };
    const pending = request(app).post(url).send(person).then((response) => response);
    await entered.promise;
    assert.equal((await stream.next()).type, 'registration.created');
    await request(app).post(url).send(person).expect(409);
    release.resolve();
    assert.equal((await pending).status, 201);
    assert.equal(mail.mock.callCount(), 1);
    await request(app).post('/api/events').send(validEvent()).expect(201);
    assert.equal((await stream.next()).type, 'event.created');
  });

  it('does not replay old notifications after a client reconnects', async () => {
    const original = await openStream();
    await request(app).post('/api/events').send(validEvent()).expect(201);
    const previous = await original.next();
    await original.close();
    const stream = await openStream({ 'Last-Event-ID': previous.id });
    const { body: event } = await request(app).post('/api/events').send(validEvent()).expect(201);
    assert.equal((await stream.next()).eventId, event.id);
  });

  it('bounds simultaneous connections', async () => {
    const originalLimit = env.notifications.maxClients;
    env.notifications.maxClients = 1;
    try {
      await openStream();
      await request(app).get('/api/notifications').expect(503);
      assert.equal(notificationHub.size, 1);
    } finally {
      env.notifications.maxClients = originalLimit;
    }
  });
});

describe('Notification connection lifecycle', () => {
  it('removes failed subscribers without interrupting healthy delivery', () => {
    const hub = createNotificationHub();
    const received = [];
    hub.subscribe(() => { throw new Error('Disconnected'); });
    const unsubscribe = hub.subscribe((message) => received.push(message));
    hub.publish('registration.created', 7);
    assert.equal(hub.size, 1);
    assert.equal(received.length, 1);
    hub.publish('unknown', 7);
    assert.equal(received.length, 1);
    unsubscribe();
    assert.equal(hub.size, 0);
  });

  function fakeResponse() {
    const res = new EventEmitter();
    res.frames = [];
    res.set = () => {};
    res.flushHeaders = () => {};
    res.write = (frame) => { res.frames.push(frame); return true; };
    res.destroy = () => { res.destroyed = true; res.emit('close'); };
    return res;
  }

  it('sends heartbeat comments, then clears the timer and subscription on disconnect', (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const res = fakeResponse();
    notifications({}, res, assert.fail);
    assert.equal(notificationHub.size, 1);
    t.mock.timers.tick(env.notifications.heartbeatMs);
    assert.equal(res.frames.at(-1), ': heartbeat\n\n');
    res.emit('close');
    assert.equal(notificationHub.size, 0);
    const length = res.frames.length;
    t.mock.timers.tick(env.notifications.heartbeatMs);
    assert.equal(res.frames.length, length);
  });

  it('disconnects clients whose outgoing buffer is full', () => {
    const res = fakeResponse();
    notifications({}, res, assert.fail);
    res.write = () => false;
    notificationHub.publish('registration.created', 7);
    assert.equal(res.destroyed, true);
    assert.equal(notificationHub.size, 0);
  });

  it('cleans up when a socket write throws', () => {
    const res = fakeResponse();
    notifications({}, res, assert.fail);
    res.write = () => { throw new Error('Socket closed'); };
    notificationHub.publish('registration.created', 7);
    assert.equal(res.destroyed, true);
    assert.equal(notificationHub.size, 0);
  });

  it('allows a new connection after the previous one disconnects', () => {
    const first = fakeResponse();
    notifications({}, first, assert.fail);
    first.emit('close');
    const second = fakeResponse();
    notifications({}, second, assert.fail);
    assert.equal(notificationHub.size, 1);
    second.emit('close');
    assert.equal(notificationHub.size, 0);
  });
});
