import { AppError } from '../errors/AppError.mjs';
import { logger } from '../config/logger.mjs';

// Express recognises an error handler by its FOUR parameters.
export function errorHandler(err, req, res, _next) {
  if (err.type === 'entity.too.large' && req.path === '/api/mcp') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'MCP request body exceeds 16kb' } });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
  }
  if (err instanceof AppError) {
    const error = { code: err.code, message: err.message };
    if (err.details !== undefined) error.details = err.details;
    return res.status(err.status).json({ error });
  }
  logger.error(err.message, { stack: err.stack });
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
}
