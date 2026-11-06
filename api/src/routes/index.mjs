import { Router } from 'express';
import * as events from '../controllers/eventController.mjs';
import * as registrations from '../controllers/registrationController.mjs';
import { health } from '../controllers/healthController.mjs';
import { stats } from '../controllers/statsController.mjs';
import { validate } from '../middleware/validate.mjs';
import { cacheResponse } from '../middleware/cacheResponse.mjs';
import { idSchema, createEventSchema, updateEventSchema, registrationSchema } from './schemas.mjs';

export const router = Router();

router.get('/api/health', health);
router.get('/api/events', cacheResponse, events.listEvents);
router.get('/api/events/:id', validate('params', idSchema), cacheResponse, events.getEvent);
router.post('/api/events', validate('body', createEventSchema), events.createEvent);
router.patch('/api/events/:id', validate('params', idSchema), validate('body', updateEventSchema), events.updateEvent);
router.delete('/api/events/:id', validate('params', idSchema), events.deleteEvent);
router.get('/api/events/:id/registrations', validate('params', idSchema), cacheResponse, registrations.listRegistrations);
router.post('/api/events/:id/registrations', validate('params', idSchema), validate('body', registrationSchema), registrations.registerParticipant);
router.get('/api/stats', cacheResponse, stats);
