import { randomUUID } from 'node:crypto';

// Only explicit public fields cross this boundary. Never accept a registration object.
export function createNotificationHub() {
  const clients = new Set();
  return {
    get size() { return clients.size; },
    subscribe(send) {
      clients.add(send);
      return () => clients.delete(send);
    },
    publish(type, eventId) {
      if (!['event.created', 'registration.created'].includes(type)) return;
      const notification = { id: randomUUID(), type, eventId, occurredAt: new Date().toISOString() };
      for (const send of clients) {
        try {
          send(notification);
        } catch {
          // A failed client must never fail a successful database mutation.
          clients.delete(send);
        }
      }
    }
  };
}

export const notificationHub = createNotificationHub();
