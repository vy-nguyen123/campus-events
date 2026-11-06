import { authenticateDatabase } from '../repositories/healthRepository.mjs';

export async function getHealth() {
  await authenticateDatabase();
  return { status: 'ok' };
}
