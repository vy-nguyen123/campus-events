import * as registrations from '../services/registrationService.mjs';

export async function listRegistrations(req, res) {
  res.json(await registrations.listRegistrations(req.validated.params.id));
}

export async function registerParticipant(req, res) {
  const registration = await registrations.registerParticipant(req.validated.params.id, req.validated.body);
  res.status(201).json(registration);
}
