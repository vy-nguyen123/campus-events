import { env } from '../config/env.mjs';
import { logger } from '../config/logger.mjs';

const entries = new Map();
let generation = 0;

export const responseCache = {
  get(key) {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      entries.delete(key);
      return undefined;
    }
    return entry.body;
  },
  set(key, body, expiresAt) {
    if (entries.size >= env.cache.maxEntries) {
      entries.delete(entries.keys().next().value);
    }
    entries.set(key, { body, expiresAt });
  },
  clear() {
    entries.clear();
  }
};

export function cacheGeneration() {
  return generation;
}

export function reportCacheFailure(operation) {
  logger.warn('Response cache unavailable', { operation });
}

export function invalidateResponses() {
  // Change keys before clearing: even a failed clear cannot make old entries usable.
  generation += 1;
  try {
    responseCache.clear();
  } catch {
    reportCacheFailure('clear');
  }
}
