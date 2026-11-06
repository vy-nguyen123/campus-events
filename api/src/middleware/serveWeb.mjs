import express from 'express';
import { join } from 'node:path';

export function createWebRouter(directory) {
  const router = express.Router();
  // API misses must keep their JSON error response, even when HTML is requested.
  router.use((req, res, next) => {
    if (req.path === '/api' || req.path.startsWith('/api/')) return next('router');
    next();
  });
  router.use(express.static(directory, { index: false, redirect: false }));
  // Serve the Vue entry page for its history routes, including direct visits/refreshes.
  router.get(/^\/(?:stats\/?|events\/(?:new|[^/]+)\/?)?$/, (req, res, next) => {
    res.sendFile(join(directory, 'index.html'), (err) => {
      if (err) next(err);
    });
  });
  return router;
}
