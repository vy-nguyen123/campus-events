import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp, validEvent } from '../helpers/testApp.mjs';
import { responseCache, invalidateResponses, cacheGeneration } from '../../src/cache/responseCache.mjs';
import { env } from '../../src/config/env.mjs';
import { confirmationMailer } from '../../src/mail/confirmationMailer.mjs';

describe('GET response cache', () => {
  let app;
  let db;
  let event;
  let detailUrl;
  let registrationsUrl;

  beforeEach(async () => {
    ({ app, db } = await createTestApp());
    invalidateResponses();
    const created = await request(app).post('/api/events').send(validEvent());
    event = created.body;
    detailUrl = `/api/events/${event.id}`;
    registrationsUrl = `${detailUrl}/registrations`;
  });

  for (const endpoint of ['events', 'detail', 'registrations', 'stats']) {
    it(`loads ${endpoint} on a miss and skips database queries on a hit`, async (t) => {
      const urls = { events: '/api/events', detail: detailUrl, registrations: registrationsUrl, stats: '/api/stats' };
      const queries = t.mock.method(db.sequelize, 'query');
      const first = await request(app).get(urls[endpoint]);
      assert.equal(first.status, 200);
      assert.ok(queries.mock.callCount() > 0);
      const queryCount = queries.mock.callCount();
      const second = await request(app).get(urls[endpoint]);
      assert.equal(second.status, 200);
      assert.deepEqual(second.body, first.body);
      assert.equal(queries.mock.callCount(), queryCount);
    });
  }

  it('includes the full query string, repeated values and their order in keys', async (t) => {
    const set = t.mock.method(responseCache, 'set');
    await request(app).get('/api/events?tag=a&tag=b');
    await request(app).get('/api/events?tag=a&tag=b');
    assert.equal(set.mock.callCount(), 1);
    await request(app).get('/api/events?tag=b&tag=a');
    await request(app).get('/api/events?tag=a');
    await request(app).get('/api/events');
    assert.equal(set.mock.callCount(), 4);
    const keys = set.mock.calls.map((call) => call.arguments[0]);
    assert.equal(new Set(keys).size, 4);
  });

  it('invalidates lists and statistics after event creation, including query variants', async () => {
    await request(app).get('/api/events');
    await request(app).get('/api/events?sort=soonest');
    await request(app).get('/api/stats');
    const created = await request(app).post('/api/events').send(validEvent({ title: 'Another event' }));
    assert.equal(created.status, 201);
    for (const url of ['/api/events', '/api/events?sort=soonest', '/api/stats']) {
      const response = await request(app).get(url);
      assert.equal(response.body.length, 2);
      assert.ok(response.body.some((row) => row.id === created.body.id));
    }
  });

  it('invalidates event details, list ordering and statistics after PATCH', async () => {
    const earlier = await request(app).post('/api/events').send(validEvent({
      title: 'Earlier event', startsAt: new Date(Date.now() + 86400000).toISOString()
    }));
    const before = await request(app).get('/api/events');
    assert.equal(before.body[0].id, earlier.body.id);
    await request(app).get(detailUrl);
    await request(app).get('/api/stats');
    const patched = await request(app).patch(detailUrl).send({
      title: 'Updated event', capacity: 20, startsAt: new Date(Date.now() - 86400000).toISOString()
    });
    assert.equal(patched.status, 200);
    const detail = await request(app).get(detailUrl);
    assert.equal(detail.body.title, 'Updated event');
    assert.equal(detail.body.spotsLeft, 20);
    const list = await request(app).get('/api/events');
    assert.equal(list.body[0].id, event.id);
    const stats = await request(app).get('/api/stats');
    const row = stats.body.find((item) => item.id === event.id);
    assert.equal(row.title, 'Updated event');
    assert.equal(row.capacity, 20);
    assert.equal(row.status, 'past');
  });

  it('invalidates registrations, seat counts and statistics before the email attempt', async (t) => {
    await request(app).get(registrationsUrl);
    await request(app).get(detailUrl);
    await request(app).get('/api/stats');
    let observed;
    t.mock.method(confirmationMailer, 'sendConfirmation', async () => {
      observed = (await request(app).get(detailUrl)).body.registered;
      throw new Error('SMTP offline');
    });
    const registered = await request(app).post(registrationsUrl).send({ name: 'Ada', email: 'ada@example.com' });
    assert.equal(registered.status, 201);
    assert.equal(observed, 1);
    const registrations = await request(app).get(registrationsUrl);
    assert.deepEqual(registrations.body, [registered.body]);
    const detail = await request(app).get(detailUrl);
    assert.equal(detail.body.spotsLeft, event.capacity - 1);
    const stats = await request(app).get('/api/stats');
    assert.equal(stats.body[0].registered, 1);
    assert.equal(stats.body[0].occupancy, '10%');
  });

  it('invalidates all affected GETs after DELETE and preserves cascading deletion', async () => {
    await request(app).post(registrationsUrl).send({ name: 'Ada', email: 'ada@example.com' });
    for (const url of ['/api/events', detailUrl, registrationsUrl, '/api/stats']) {
      await request(app).get(url);
    }
    const deleted = await request(app).delete(detailUrl);
    assert.equal(deleted.status, 204);
    assert.equal((await request(app).get(detailUrl)).status, 404);
    assert.equal((await request(app).get(registrationsUrl)).status, 404);
    assert.deepEqual((await request(app).get('/api/events')).body, []);
    assert.deepEqual((await request(app).get('/api/stats')).body, []);
    assert.equal(await db.Registration.count(), 0);
  });

  it('never caches invalid requests, missing resources or server errors', async (t) => {
    const set = t.mock.method(responseCache, 'set');
    assert.equal((await request(app).get('/api/events/abc')).status, 400);
    assert.equal((await request(app).get('/api/events/999')).status, 404);
    assert.equal((await request(app).get('/api/events/999/registrations')).status, 404);
    assert.equal((await request(app).get('/api/missing')).status, 404);
    const query = t.mock.method(db.sequelize, 'query', async () => { throw new Error('Database offline'); });
    assert.equal((await request(app).get('/api/events')).status, 500);
    query.mock.restore();
    assert.equal(set.mock.callCount(), 0);
    assert.equal((await request(app).get('/api/events')).status, 200);
    assert.equal(set.mock.callCount(), 1);
  });

  it('does not invalidate entries for rejected mutations', async () => {
    await request(app).get('/api/events');
    const generation = cacheGeneration();
    assert.equal((await request(app).post('/api/events').send({})).status, 400);
    assert.equal((await request(app).patch('/api/events/999').send({ capacity: 3 })).status, 404);
    assert.equal((await request(app).delete('/api/events/999')).status, 404);
    assert.equal((await request(app).post(registrationsUrl).send({ name: 'Ada', email: 'invalid' })).status, 400);
    assert.equal(cacheGeneration(), generation);
  });

  for (const operation of ['get', 'set']) {
    it(`falls back to the database when cache ${operation} fails`, async (t) => {
      t.mock.method(responseCache, operation, () => { throw new Error('Cache unavailable'); });
      const response = await request(app).get(detailUrl);
      assert.equal(response.status, 200);
      assert.equal(response.body.id, event.id);
      assert.equal(response.body.registered, 0);
    });
  }

  it('keeps writes successful and old keys unusable when cache clearing fails', async (t) => {
    await request(app).get(detailUrl);
    await request(app).get('/api/events');
    t.mock.method(responseCache, 'clear', () => { throw new Error('Cache unavailable'); });
    const patched = await request(app).patch(detailUrl).send({ title: 'Fresh title' });
    assert.equal(patched.status, 200);
    assert.equal((await request(app).get(detailUrl)).body.title, 'Fresh title');
    assert.equal((await request(app).get('/api/events')).body[0].title, 'Fresh title');
    const registered = await request(app).post(registrationsUrl).send({ name: 'Ada', email: 'ada@example.com' });
    assert.equal(registered.status, 201);
    assert.equal((await request(app).get(detailUrl)).body.registered, 1);
  });

  it('expires entries after the configured TTL', async (t) => {
    const now = Date.now();
    const clock = t.mock.method(Date, 'now', () => now);
    const set = t.mock.method(responseCache, 'set');
    await request(app).get('/api/events');
    await request(app).get('/api/events');
    assert.equal(set.mock.callCount(), 1);
    clock.mock.mockImplementation(() => now + env.cache.ttlMs);
    await request(app).get('/api/events');
    assert.equal(set.mock.callCount(), 2);
  });

  it('expires statistics when an open event becomes past without a mutation', async (t) => {
    const startsAt = Date.now() + 10000;
    await request(app).patch(detailUrl).send({ startsAt: new Date(startsAt).toISOString() });
    t.mock.timers.enable({ apis: ['Date'], now: startsAt - 1 });
    const before = await request(app).get('/api/stats');
    assert.equal(before.body[0].status, 'open');
    t.mock.timers.tick(2);
    const after = await request(app).get('/api/stats');
    assert.equal(after.body[0].status, 'past');
  });

  it('does not cache health checks', async (t) => {
    const get = t.mock.method(responseCache, 'get');
    const set = t.mock.method(responseCache, 'set');
    await request(app).get('/api/health');
    await request(app).get('/api/health');
    assert.equal(get.mock.callCount(), 0);
    assert.equal(set.mock.callCount(), 0);
  });

  it('bypasses the cache when disabled', async (t) => {
    const enabled = env.cache.enabled;
    env.cache.enabled = false;
    t.after(() => { env.cache.enabled = enabled; });
    const get = t.mock.method(responseCache, 'get');
    const set = t.mock.method(responseCache, 'set');
    const queries = t.mock.method(db.sequelize, 'query');
    await request(app).get(detailUrl);
    const count = queries.mock.callCount();
    await request(app).get(detailUrl);
    assert.ok(queries.mock.callCount() > count);
    assert.equal(get.mock.callCount(), 0);
    assert.equal(set.mock.callCount(), 0);
  });

  it('evicts the oldest entry when the configured size limit is reached', async (t) => {
    const maxEntries = env.cache.maxEntries;
    env.cache.maxEntries = 2;
    t.after(() => { env.cache.maxEntries = maxEntries; });
    const set = t.mock.method(responseCache, 'set');
    await request(app).get('/api/events?variant=1');
    await request(app).get('/api/events?variant=2');
    await request(app).get('/api/events?variant=3');
    await request(app).get('/api/events?variant=2');
    assert.equal(set.mock.callCount(), 3);
    await request(app).get('/api/events?variant=1');
    assert.equal(set.mock.callCount(), 4);
  });

  it('does not repopulate the cache from an old read that overlaps a successful write', async (t) => {
    let readFinished;
    let releaseRead;
    const finished = new Promise((resolve) => { readFinished = resolve; });
    const released = new Promise((resolve) => { releaseRead = resolve; });
    const originalQuery = db.sequelize.query;
    let blocked = false;
    t.mock.method(db.sequelize, 'query', async function (...args) {
      const result = await originalQuery.apply(this, args);
      if (!blocked) {
        blocked = true;
        readFinished();
        await released;
      }
      return result;
    });
    const set = t.mock.method(responseCache, 'set');
    const pendingRead = request(app).get('/api/events').then((response) => response);
    await finished;
    try {
      const patched = await request(app).patch(detailUrl).send({ title: 'Changed during read' });
      assert.equal(patched.status, 200);
    } finally {
      releaseRead();
    }
    const oldRead = await pendingRead;
    assert.equal(oldRead.status, 200);
    assert.equal(set.mock.callCount(), 0);
    const fresh = await request(app).get('/api/events');
    assert.equal(fresh.body[0].title, 'Changed during read');
    assert.equal(set.mock.callCount(), 1);
  });
});
