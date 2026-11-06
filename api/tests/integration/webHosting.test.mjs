import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import { createWebRouter } from '../../src/middleware/serveWeb.mjs';
import { createTestApp } from '../helpers/testApp.mjs';

describe('Production frontend hosting', () => {
  let app;
  let db;

  beforeEach(async () => {
    const testApp = await createTestApp();
    db = testApp.db;
    app = express();
    const directory = fileURLToPath(new URL('../fixtures/web/', import.meta.url));
    // The frontend router precedes the API app here to also prove it never swallows API paths.
    app.use(createWebRouter(directory));
    app.use(testApp.app);
  });

  for (const path of ['/', '/events/new', '/events/123', '/stats']) {
    it(`serves the Vue entry page for a direct visit to ${path}`, async () => {
      const response = await request(app).get(path);
      assert.equal(response.status, 200);
      assert.match(response.headers['content-type'], /text\/html/);
      assert.ok(response.text.includes('Campus Events test page'));
    });
  }

  it('serves built assets and leaves missing assets as 404 responses', async () => {
    const css = await request(app).get('/assets/example.css');
    assert.equal(css.status, 200);
    assert.match(css.headers['content-type'], /text\/css/);
    const missing = await request(app).get('/assets/missing.js');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'NOT_FOUND');
  });

  it('keeps API errors and validation as JSON even for browser navigation', async () => {
    for (const path of ['/api', '/api/missing', '/api/events/999']) {
      const response = await request(app).get(path).set('Accept', 'text/html');
      assert.equal(response.status, 404);
      assert.equal(response.body.error.code, 'NOT_FOUND');
    }
    const invalid = await request(app).get('/api/events/abc').set('Accept', 'text/html');
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, 'VALIDATION_ERROR');
  });

  it('keeps the database health check uncached and reports failure when the database is unavailable', async (t) => {
    const healthy = await request(app).get('/api/health');
    assert.equal(healthy.status, 200);
    assert.deepEqual(healthy.body, { status: 'ok' });
    t.mock.method(db.sequelize, 'authenticate', async () => { throw new Error('Database unavailable'); });
    const unhealthy = await request(app).get('/api/health');
    assert.equal(unhealthy.status, 500);
    assert.equal(unhealthy.body.error.code, 'INTERNAL_ERROR');
  });
});
