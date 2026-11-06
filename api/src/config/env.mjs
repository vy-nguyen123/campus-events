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
