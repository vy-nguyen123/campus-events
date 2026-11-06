import { app } from './app.mjs';
import { env } from './config/env.mjs';
import { initializeDatabase } from './db/initialize.mjs';

await initializeDatabase();

const port = env.port;
app.listen(port, () => {
  console.log(`Campus Events API running on http://localhost:${port}/api`);
});
