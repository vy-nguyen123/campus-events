// `npm run seed`: wipes the database and fills it with demo data again.
import { sequelize } from './db/connection.mjs';
import { resetDatabase } from './db/initialize.mjs';

await resetDatabase();

console.log('Database reset with demo data.');
await sequelize.close();
