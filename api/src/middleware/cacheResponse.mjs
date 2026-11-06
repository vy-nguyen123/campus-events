import { env } from '../config/env.mjs';
import { responseCache, cacheGeneration, reportCacheFailure } from '../cache/responseCache.mjs';

export function cacheResponse(req, res, next) {
  if (req.method !== 'GET' || !env.cache.enabled) return next();

  const generation = cacheGeneration();
  // Keep the complete URL, including repeated query parameters and their ordering.
  const key = JSON.stringify([generation, req.originalUrl]);
  try {
    const cached = responseCache.get(key);
    if (cached !== undefined) return res.status(200).json(JSON.parse(cached));
  } catch {
    reportCacheFailure('get');
  }

  const json = res.json;
  res.json = function (body) {
    if (res.statusCode === 200 && generation === cacheGeneration()) {
      try {
        const expiresAt = Math.min(Date.now() + env.cache.ttlMs, res.locals.cacheExpiresAt ?? Infinity);
        if (expiresAt > Date.now()) responseCache.set(key, JSON.stringify(body), expiresAt);
      } catch {
        reportCacheFailure('set');
      }
    }
    return json.call(this, body);
  };
  next();
}
