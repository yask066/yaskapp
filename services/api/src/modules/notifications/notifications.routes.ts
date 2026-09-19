import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { authenticate } from '../auth/auth.utils.js';
import { realtimeBus } from '../../realtime/realtime.bus.js';
import { sendToUser } from '../../realtime/realtime.hub.js';
import { AdminCursorError } from '../admin/pagination.js';
import {
  countUnreadNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead
} from './notifications.repository.js';
import { getNotificationPreferences, updateNotificationPreferences } from './notification-preferences.repository.js';
import { registerNotificationDevice, revokeNotificationDevice } from './notification-devices.repository.js';
import { rateLimit } from '../../config/rate-limit.js';
import { incrementNotificationMetric } from './notifications.metrics.js';

const notificationReadRateLimit = rateLimit({ keyPrefix: 'notifications-read', limit: 60, windowMs: 60_000, keyBy: 'user' });
const notificationListRateLimit = rateLimit({ keyPrefix: 'notifications-list', limit: 120, windowMs: 60_000, keyBy: 'user' });
const notificationDeviceRateLimit = rateLimit({ keyPrefix: 'notification-devices', limit: 20, windowMs: 60_000, keyBy: 'user' });

const preferenceSchema = z.object({
  inApp: z.boolean().optional(),
  push: z.boolean().optional()
}).strict();
const preferencesBodySchema = z.object({
  poll_vote: preferenceSchema.optional(),
  comment: preferenceSchema.optional(),
  comment_reply: preferenceSchema.optional(),
  like: preferenceSchema.optional(),
  follow: preferenceSchema.optional()
}).strict();
const deviceBodySchema = z.object({
  token: z.string().trim().min(16).max(4096),
  platform: z.enum(['android', 'ios'])
}).strict();

const notificationIdSchema = z.object({ id: z.string().uuid() }).strict();
const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().trim().max(512).optional(),
  unreadOnly: z.enum(['true', 'false']).transform((value) => value === 'true').default('false')
}).strict();

export function registerNotificationRoutes(app: FastifyInstance) {
  app.post('/notification-devices', { preHandler: [authenticate, notificationDeviceRateLimit] }, async (request, reply) => {
    const parsed = deviceBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(422).send({ error: 'validation_error', message: 'Request input is invalid.' });
    return reply.status(201).send(await registerNotificationDevice(request.user.sub, parsed.data.token, parsed.data.platform));
  });

  app.delete('/notification-devices', { preHandler: [authenticate, notificationDeviceRateLimit] }, async (request, reply) => {
    const parsed = deviceBodySchema.pick({ token: true }).safeParse(request.body);
    if (!parsed.success) return reply.status(422).send({ error: 'validation_error', message: 'Request input is invalid.' });
    await revokeNotificationDevice(request.user.sub, parsed.data.token);
    return reply.status(204).send();
  });

  app.get('/notification-preferences', { preHandler: [authenticate] }, async (request, reply) => {
    return reply.send(await getNotificationPreferences(request.user.sub));
  });

  app.patch('/notification-preferences', { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = preferencesBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(422).send({ error: 'validation_error', message: 'Request input is invalid.' });
    return reply.send(await updateNotificationPreferences(request.user.sub, parsed.data));
  });

  app.get('/notifications', { preHandler: [authenticate, notificationListRateLimit] }, async (request, reply) => {
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

  app.get('/notifications/unread-count', { preHandler: [authenticate, notificationListRateLimit] }, async (request, reply) => {
    return reply.send({ unreadCount: await countUnreadNotifications(request.user.sub) });
  });

  app.post('/notifications/:id/read', { preHandler: [authenticate, notificationReadRateLimit] }, async (request, reply) => {
    const parsed = notificationIdSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(422).send({ error: 'validation_error', message: 'Request input is invalid.' });
    }

    const result = await markNotificationRead(parsed.data.id, request.user.sub);
    if (!result) {
      return reply.status(404).send({ error: 'not_found', message: 'Notification was not found.' });
    }

    const event = {
      version: 1 as const,
      type: 'notification.read' as const,
      payload: {
        notificationId: result.notificationId,
        readAt: result.readAt,
        unreadCount: result.unreadCount
      }
    };
    sendToUser(request.user.sub, event);
    void realtimeBus.publish(request.user.sub, event).catch(() => incrementNotificationMetric('publishFailed'));
    incrementNotificationMetric('read');

    return reply.send(result);
  });

  app.post('/notifications/read-all', { preHandler: [authenticate, notificationReadRateLimit] }, async (request, reply) => {
    const result = await markAllNotificationsRead(request.user.sub);
    const event = {
      version: 1,
      type: 'notifications.read_all',
      payload: {
        readAt: result.readAt,
        unreadCount: 0
      }
    } as const;
    sendToUser(request.user.sub, event);
    void realtimeBus.publish(request.user.sub, event).catch(() => incrementNotificationMetric('publishFailed'));
    return reply.send(result);
  });

}
