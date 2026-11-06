import * as events from '../repositories/eventRepository.mjs';
import { countRegistrations } from '../repositories/registrationRepository.mjs';
import { AppError } from '../errors/AppError.mjs';

function eventNotFound(id) {
  return new AppError(404, 'NOT_FOUND', `Event with id ${id} not found`);
}

export async function requireEvent(id) {
  const event = await events.findEvent(id);
  if (!event) throw eventNotFound(id);
  return event;
}

export function listEvents() {
  return events.listEvents();
}

export async function getEvent(id) {
  const event = await requireEvent(id);
  const count = await countRegistrations(event.id);
  return { ...event, registered: count, spotsLeft: Math.max(event.capacity - count, 0) };
}

export function createEvent(data) {
  return events.createEvent(data);
}

export async function updateEvent(id, data) {
  const event = await events.updateEvent(id, data);
  if (!event) throw eventNotFound(id);
  return event;
}

export async function deleteEvent(id) {
  const deleted = await events.deleteEvent(id);
  if (deleted === 0) throw eventNotFound(id);
}
