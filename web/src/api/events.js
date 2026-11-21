import { request } from './client.js';

export const getEvents = () => request('/events');
export const getEvent = (id) => request(`/events/${id}`);
export const createEvent = (event) => request('/events', { method: 'POST', body: event });
export const deleteEvent = (id) => request(`/events/${id}`, { method: 'DELETE' });

export const getRegistrations = (eventId) => request(`/events/${eventId}/registrations`);
export const register = (eventId, participant) =>
  request(`/events/${eventId}/registrations`, { method: 'POST', body: participant });

export const getStats = () => request('/stats');

export function subscribeToNotifications(onNotification) {
  const source = new EventSource('/api/notifications');
  const receive = (event) => {
    let notification;
    try {
      notification = JSON.parse(event.data);
    } catch {
      return;
    }
    onNotification(notification);
  };
  source.addEventListener('notification', receive);
  // EventSource reconnects automatically; do not create a second source on error.
  return () => {
    source.removeEventListener('notification', receive);
    source.close();
  };
}
