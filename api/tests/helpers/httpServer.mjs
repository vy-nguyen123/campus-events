import { once } from 'node:events';

export async function startHttpServer(app) {
  const server = app.listen(0, '127.0.0.1');
  const responses = new Set();
  server.on('request', (_req, res) => {
    let closed;
    const pending = new Promise((resolve) => { closed = resolve; });
    responses.add(pending);
    res.on('close', () => { responses.delete(pending); closed(); });
  });
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    async close() {
      const closed = new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
      server.closeAllConnections();
      await closed;
      await Promise.all(responses);
    }
  };
}

export async function openNotifications(url, headers = {}) {
  const response = await fetch(`${url}/api/notifications`, { headers });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return {
    response,
    close: () => reader.cancel(),
    async next() {
      while (true) {
        const end = buffer.indexOf('\n\n');
        if (end >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const line = frame.split('\n').find((part) => part.startsWith('data: '));
          if (line) return JSON.parse(line.slice(6));
        } else {
          const { done, value } = await reader.read();
          if (done) throw new Error('Notification connection ended unexpectedly');
          buffer += decoder.decode(value, { stream: true });
        }
      }
    }
  };
}
