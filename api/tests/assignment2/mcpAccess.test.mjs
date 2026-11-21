import assert from 'node:assert/strict';
import { it } from 'node:test';
import express from 'express';
import request from 'supertest';
import { createMcpAccess } from '../../src/middleware/mcpAccess.mjs';
import { errorHandler } from '../../src/middleware/errorHandler.mjs';
import { env } from '../../src/config/env.mjs';

it('limits MCP traffic with a bounded process-wide window and recovers after a minute', async (t) => {
  const originalLimit = env.mcp.requestsPerMinute;
  t.after(() => { env.mcp.requestsPerMinute = originalLimit; });
  env.mcp.requestsPerMinute = 1;
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const app = express();
  app.use(createMcpAccess());
  app.use(errorHandler);
  await request(app).post('/').expect(503);
  const limited = await request(app).post('/').expect(429);
  assert.equal(limited.body.error.code, 'RATE_LIMIT');
  assert.equal(limited.headers['retry-after'], '60');
  t.mock.timers.tick(60000);
  await request(app).post('/').expect(503);
});
