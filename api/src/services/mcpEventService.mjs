import * as events from './eventService.mjs';
import { registerParticipant } from './registrationService.mjs';
import { AppError } from '../errors/AppError.mjs';

export async function listEventsByTime(past, now = Date.now()) {
  const all = await events.listEvents();
  return all.filter((event) => (new Date(event.startsAt).getTime() < now) === past)
    .map(({ id, title, description, location, startsAt, capacity }) => ({
      id, title, description: description ?? '', location, startsAt: new Date(startsAt).toISOString(), capacity
    }));
}

export async function registerConfirmedParticipant({ eventId, name, email, confirmed }) {
  if (confirmed !== true) throw new AppError(400, 'CONFIRMATION_REQUIRED', 'Confirm the chosen event and participant before registering');
  await registerParticipant(eventId, { name, email }, { upcomingOnly: true });
  return { eventId, status: 'registered' };
}
