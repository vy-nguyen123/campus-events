import * as registrations from '../repositories/registrationRepository.mjs';
import { requireEvent } from './eventService.mjs';
import { AppError } from '../errors/AppError.mjs';
import { logger } from '../config/logger.mjs';
import { confirmationMailer } from '../mail/confirmationMailer.mjs';
import { invalidateResponses } from '../cache/responseCache.mjs';
import { notificationHub } from '../notifications/notificationHub.mjs';
import { withRegistrationLock } from './registrationLock.mjs';

export async function listRegistrations(id) {
  const event = await requireEvent(id);
  return registrations.listRegistrations(event.id);
}

async function saveParticipant(id, data, upcomingOnly) {
  const event = await requireEvent(id);
  if (upcomingOnly && new Date(event.startsAt).getTime() < Date.now()) {
    throw new AppError(409, 'EVENT_PAST', 'This event has already started');
  }
  const existing = await registrations.findRegistration(event.id, data.email);
  if (existing) {
    throw new AppError(409, 'CONFLICT', `${data.email} is already registered for this event`);
  }

  const count = await registrations.countRegistrations(event.id);
  // Preserve the original condition during refactoring. Potential off-by-one bug:
  // count === capacity still allows a registration. Fix separately with a regression test.
  if (count > event.capacity) {
    throw new AppError(409, 'CONFLICT', 'Event is full');
  }

  const registration = await registrations.createRegistration({ eventId: event.id, name: data.name, email: data.email });
  // Invalidate immediately after saving, before the potentially slow email attempt.
  invalidateResponses();
  notificationHub.publish('registration.created', event.id);
  return { registration, event };
}

export async function registerParticipant(id, data, { upcomingOnly = false } = {}) {
  const { registration, event } = await withRegistrationLock(id, () => saveParticipant(id, data, upcomingOnly));
  logger.info('new registration', { registrationId: registration.id, eventId: event.id });
  // Persistence has succeeded. Email is best effort and must never change that result.
  try {
    await confirmationMailer.sendConfirmation(registration, event);
  } catch (err) {
    logger.warn('Confirmation email failed', {
      registrationId: registration.id,
      eventId: event.id,
      code: err?.code || 'MAIL_ERROR'
    });
  }
  return registration;
}
