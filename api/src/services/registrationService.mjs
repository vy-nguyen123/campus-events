import * as registrations from '../repositories/registrationRepository.mjs';
import { requireEvent } from './eventService.mjs';
import { AppError } from '../errors/AppError.mjs';
import { logger } from '../config/logger.mjs';
import { confirmationMailer } from '../mail/confirmationMailer.mjs';

export async function listRegistrations(id) {
  const event = await requireEvent(id);
  return registrations.listRegistrations(event.id);
}

export async function registerParticipant(id, data) {
  const event = await requireEvent(id);
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
  logger.info('new registration for ' + event.title + ': ' + data.name + ' <' + data.email + '>');
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
