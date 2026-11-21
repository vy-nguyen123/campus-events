import { fileURLToPath } from 'node:url';

if (process.env.NODE_ENV !== 'test') {
  try {
    process.loadEnvFile();
  } catch {
    // no .env
  }
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

export const env = {
  port: process.env.PORT || 3000,
  logLevel: process.env.LOG_LEVEL || 'info',
  isTest: process.env.NODE_ENV === 'test',
  dbStorage: process.env.DB_STORAGE || './data/events.sqlite',
  mcp: {
    token: process.env.MCP_TOKEN || '',
    allowedHosts: (process.env.MCP_ALLOWED_HOSTS || 'localhost,127.0.0.1,[::1]').split(',').map((host) => host.trim()).filter(Boolean),
    allowedOrigins: (process.env.MCP_ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:5173').split(',').map((origin) => origin.trim()).filter(Boolean),
    requestsPerMinute: positiveInteger(process.env.MCP_REQUESTS_PER_MINUTE, 120)
  },
  notifications: {
    maxClients: positiveInteger(process.env.SSE_MAX_CLIENTS, 100),
    heartbeatMs: positiveInteger(process.env.SSE_HEARTBEAT_MS, 20000)
  },
  web: {
    enabled: process.env.SERVE_WEB === 'true',
    directory: fileURLToPath(new URL('../../../web/dist/', import.meta.url))
  },
  cache: {
    enabled: process.env.CACHE_ENABLED !== 'false',
    ttlMs: positiveInteger(process.env.CACHE_TTL_MS, 30000),
    maxEntries: positiveInteger(process.env.CACHE_MAX_ENTRIES, 500)
  },
  mail: {
    // Tests must never enable the real SMTP transport, even with inherited credentials.
    enabled: process.env.NODE_ENV !== 'test' && process.env.MAIL_ENABLED === 'true',
    from: process.env.MAIL_FROM,
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    timeoutMs: Number(process.env.SMTP_TIMEOUT_MS || 5000)
  }
};
