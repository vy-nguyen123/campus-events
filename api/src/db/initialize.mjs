import { sequelize } from './connection.mjs';
import { seedDemoData } from './demoData.mjs';
import { countEvents } from '../repositories/eventRepository.mjs';
import { invalidateResponses } from '../cache/responseCache.mjs';

export async function initializeDatabase() {
  await sequelize.sync();
  // First start on a fresh clone: fill the empty database so the UI has something to show.
  if ((await countEvents()) === 0) {
    await seedDemoData();
    invalidateResponses();
    console.log('Empty database – demo data added');
  }
}

export async function resetDatabase() {
  await sequelize.sync({ force: true });
  invalidateResponses();
  await seedDemoData();
  invalidateResponses();
}
