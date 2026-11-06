import { Registration } from '../models/index.mjs';

export function countRegistrations(eventId) {
  return Registration.count({ where: { eventId } });
}

export async function listRegistrations(eventId) {
  const registrations = await Registration.findAll({ where: { eventId }, order: [['createdAt', 'ASC']] });
  return registrations.map((registration) => registration.toJSON());
}

export async function listRegistrationsForStats(eventId) {
  const registrations = await Registration.findAll({ where: { eventId } });
  return registrations.map((registration) => registration.toJSON());
}

export async function findRegistration(eventId, email) {
  const registration = await Registration.findOne({ where: { eventId, email } });
  return registration ? registration.toJSON() : null;
}

export async function createRegistration(data) {
  const registration = await Registration.create(data);
  return registration.toJSON();
}

export async function createRegistrations(data) {
  await Registration.bulkCreate(data);
}
