import { Event } from '../models/index.mjs';

export async function listEvents() {
  const events = await Event.findAll({ order: [['startsAt', 'ASC']] });
  return events.map((event) => event.toJSON());
}

export async function listEventsForStats() {
  const events = await Event.findAll();
  return events.map((event) => event.toJSON());
}

export async function findEvent(id) {
  const event = await Event.findByPk(id);
  return event ? event.toJSON() : null;
}

export async function createEvent(data) {
  const event = await Event.create(data);
  return event.toJSON();
}

export async function updateEvent(id, data) {
  const event = await Event.findByPk(id);
  if (!event) return null;
  await event.update(data);
  return event.toJSON();
}

export function deleteEvent(id) {
  return Event.destroy({ where: { id } });
}

export function countEvents() {
  return Event.count();
}

export async function createEvents(data) {
  await Event.bulkCreate(data);
}
