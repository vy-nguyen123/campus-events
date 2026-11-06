import { getStats } from '../services/statsService.mjs';

export async function stats(req, res) {
  res.json(await getStats());
}
