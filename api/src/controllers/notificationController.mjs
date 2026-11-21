import { notificationHub } from '../notifications/notificationHub.mjs';
import { env } from '../config/env.mjs';
import { AppError } from '../errors/AppError.mjs';

export function notifications(req, res, next) {
  if (notificationHub.size >= env.notifications.maxClients) {
    return next(new AppError(503, 'STREAM_LIMIT', 'Too many notification connections; try again later'));
  }
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-store, no-transform',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();

  const unsubscribe = notificationHub.subscribe((notification) => {
    write(`id: ${notification.id}\nevent: notification\ndata: ${JSON.stringify(notification)}\n\n`);
  });
  const heartbeat = setInterval(() => write(': heartbeat\n\n'), env.notifications.heartbeatMs);
  heartbeat.unref();

  function cleanup() {
    clearInterval(heartbeat);
    unsubscribe();
  }

  function write(frame) {
    // Disconnect slow clients instead of keeping an unbounded queue in memory.
    try {
      if (!res.destroyed && res.write(frame)) return;
    } catch {
      // Synchronous socket failures need the same cleanup as disconnects.
    }
    cleanup();
    res.destroy();
  }

  res.on('close', cleanup);
  res.on('error', cleanup);
  write('retry: 3000\n: connected\n\n');
}
