import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { authenticate } from '../auth/auth.utils.js';
import { AdminCursorError } from '../admin/pagination.js';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead
} from './notifications.repository.js';

const notificationIdSchema = z.object({ id: z.string().uuid() }).strict();
const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().trim().max(512).optional(),
  unreadOnly: z.enum(['true', 'false']).transform((value) => value === 'true').default('false')
}).strict();

export function registerNotificationRoutes(app: FastifyInstance) {
  app.get('/notifications', { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(422).send({ error: 'validation_error', message: 'Request input is invalid.' });
    }

    try {
      return reply.send(await listNotifications({
        recipientUserId: request.user.sub,
        ...parsed.data
      }));
    } catch (error) {
      if (error instanceof AdminCursorError) {
        return reply.status(422).send({ error: 'invalid_cursor', message: error.message });
      }
      throw error;
    }
  });

  app.post('/notifications/:id/read', { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = notificationIdSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(422).send({ error: 'validation_error', message: 'Request input is invalid.' });
    }

    const found = await markNotificationRead(parsed.data.id, request.user.sub);
    if (!found) {
      return reply.status(404).send({ error: 'not_found', message: 'Notification was not found.' });
    }

    return reply.status(204).send();
  });

  app.post('/notifications/read-all', { preHandler: [authenticate] }, async (request, reply) => {
    const result = await markAllNotificationsRead(request.user.sub);
    return reply.send(result);
  });

}
