import { createHash, timingSafeEqual } from 'node:crypto';
import { hostHeaderValidation } from '@modelcontextprotocol/express';
import { env } from '../config/env.mjs';
import { AppError } from '../errors/AppError.mjs';

const digest = (value) => createHash('sha256').update(value).digest();

export function createMcpAccess() {
  let windowStart = 0;
  let requests = 0;
  return (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (Date.now() - windowStart >= 60000) {
      windowStart = Date.now();
      requests = 0;
    }
    if (++requests > env.mcp.requestsPerMinute) {
      res.set('Retry-After', '60');
      return next(new AppError(429, 'RATE_LIMIT', 'Too many MCP requests; try again later'));
    }
    if (env.mcp.token.length < 32) {
      return next(new AppError(503, 'MCP_DISABLED', 'MCP access is not configured'));
    }
    const expected = digest(`Bearer ${env.mcp.token}`);
    const supplied = digest(req.get('authorization') || '');
    if (!timingSafeEqual(expected, supplied)) {
      res.set('WWW-Authenticate', 'Bearer realm="campus-events"');
      return next(new AppError(401, 'UNAUTHORIZED', 'A valid MCP bearer token is required'));
    }
    if (req.headers.origin && !env.mcp.allowedOrigins.includes(req.headers.origin)) {
      return next(new AppError(403, 'FORBIDDEN', 'Origin is not allowed'));
    }
    hostHeaderValidation(env.mcp.allowedHosts)(req, res, next);
  };
}
