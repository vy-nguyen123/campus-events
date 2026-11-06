import { getHealth } from '../services/healthService.mjs';

export async function health(req, res) {
  res.status(200).json(await getHealth());
}
