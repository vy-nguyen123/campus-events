import { app } from './app.mjs';
import { env } from './config/env.mjs';
import { initializeDatabase } from './db/initialize.mjs';
import { access } from 'node:fs/promises';
import { join } from 'node:path';

// Fail clearly on a missing frontend build instead of deploying an unusable UI.
if (env.web.enabled) await access(join(env.web.directory, 'index.html'));

await initializeDatabase();

const port = env.port;
app.listen(port, '0.0.0.0', () => {
  console.log(`Campus Events API running on http://localhost:${port}/api`);
});
