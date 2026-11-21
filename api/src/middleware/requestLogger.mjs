import { logger } from '../config/logger.mjs';

export function requestLogger(req, res, next) {
  const start = performance.now();
  res.on('finish', () => {
    logger.info('request', {
      method: req.method,
      url: req.path === '/api/mcp' ? '/api/mcp' : req.originalUrl,
      status: res.statusCode,
      durationMs: Math.round(performance.now() - start)
    });
  });
  next();
}
