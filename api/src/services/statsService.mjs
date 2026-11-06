import { listEventsForStats } from '../repositories/eventRepository.mjs';
import { listRegistrationsForStats } from '../repositories/registrationRepository.mjs';

export async function getStats() {
  const events = await listEventsForStats();
  const result = [];
  let expiresAt = Infinity;
  for (const event of events) {
    const registrations = await listRegistrationsForStats(event.id);
    let pct = 0;
    if (event.capacity > 0) {
      pct = Math.round((registrations.length / event.capacity) * 100);
    }
    let status = 'open';
    if (registrations.length >= event.capacity) {
      status = 'full';
    } else if (new Date(event.startsAt) < new Date()) {
      status = 'past';
    }
    if (status === 'open') {
      expiresAt = Math.min(expiresAt, new Date(event.startsAt).getTime() + 1);
    }
    result.push({
      id: event.id,
      title: event.title,
      registered: registrations.length,
      capacity: event.capacity,
      occupancy: pct + '%',
      status: status
    });
  }
  return { stats: result, expiresAt };
}
