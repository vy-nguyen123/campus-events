import express from 'express';
import { router } from './routes/index.mjs';
import { requestLogger } from './middleware/requestLogger.mjs';
import { notFound } from './middleware/notFound.mjs';
import { errorHandler } from './middleware/errorHandler.mjs';
import { createWebRouter } from './middleware/serveWeb.mjs';
import { env } from './config/env.mjs';

// Keep the existing imports used by the integration test helper compatible.
export { sequelize } from './db/connection.mjs';
export { Event, Registration } from './models/index.mjs';
export { seedDemoData } from './db/demoData.mjs';

export const app = express();
app.use(express.json());
app.use(requestLogger);
app.use(router);
if (env.web.enabled) app.use(createWebRouter(env.web.directory));
app.use(notFound);
app.use(errorHandler);
