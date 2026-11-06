import { getStats } from '../services/statsService.mjs';

export async function stats(req, res) {
  const { stats, expiresAt } = await getStats();
  // Statistics can change with the clock even when no database write occurs.
  res.locals.cacheExpiresAt = expiresAt;
  res.json(stats);
}
