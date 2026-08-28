import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';

import { env } from './config/env.js';
import { rateLimit } from './config/rate-limit.js';
import { registerAuthRoutes } from './modules/auth/auth.routes.js';
import { getCurrentUser } from './modules/auth/auth.utils.js';
import { registerAdminRoutes } from './modules/admin/admin.routes.js';
import {
  buildAdminFailureLog,
  isAdminFailureRequest
} from './modules/admin/admin-request-logging.js';
import { registerHealthRoutes } from './modules/health/health.routes.js';
import { registerModerationRoutes } from './modules/moderation/moderation.routes.js';
import { registerPollRoutes } from './modules/polls/polls.routes.js';
import { registerPollImageRoutes } from './modules/polls/poll-image.routes.js';
import { registerProfileRoutes } from './modules/profiles/profiles.routes.js';
import { registerRealtimeRoutes } from './realtime/realtime.routes.js';

export function buildApp() {
  const app = Fastify({
    trustProxy: true,
    logger:
      env.NODE_ENV !== 'test'
        ? {
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.body.password',
                'req.body.accessToken',
                'req.body.refreshToken',
                'req.body.token',
                'password',
                'accessToken',
                'refreshToken',
                'JWT_SECRET',
                'S3_SECRET_ACCESS_KEY',
                'MINIO_ROOT_PASSWORD'
              ],
              censor: '[REDACTED]'
            }
          }
        : false
  });

  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send({
      error: 'not_found',
      message: 'Route was not found.'
    });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof app.multipartErrors.RequestFileTooLargeError) {
      return reply.status(400).send({
        error: 'poll_image_too_large',
        message: 'Poll image file must be 5 MB or smaller.'
      });
    }

    const errorStatusCode =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : undefined;
    const statusCode = errorStatusCode && errorStatusCode >= 400 ? errorStatusCode : 500;

    if (statusCode >= 500) {
      request.log.error({ err: error }, 'Unhandled request error');

      return reply.status(500).send({
        error: 'internal_server_error',
        message: 'An unexpected error occurred.'
      });
    }

    if (statusCode === 404) {
      return reply.status(404).send({
        error: 'not_found',
        message: 'Route was not found.'
      });
    }

    if (statusCode === 400) {
      return reply.status(400).send({
        error: 'validation_error',
        message: 'Request input is invalid.'
      });
    }

    return reply.status(statusCode).send({
      error: 'request_error',
      message: 'The request could not be processed.'
    });
  });

  app.register(cors, {
    origin: env.CORS_ORIGINS === '*'
      ? true
      : env.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
    credentials: true
  });

  app.register(multipart, {
    limits: {
      files: 1,
      fileSize: 5 * 1024 * 1024
    }
  });

  app.register(jwt, {
    secret: env.JWT_SECRET
  });

  app.decorateRequest('getCurrentUser', function () {
    return getCurrentUser(this);
  });

  app.register(websocket);

  app.addHook(
    'onRequest',
    rateLimit({
      keyPrefix: 'api',
      limit: 120,
      windowMs: 60_000
    })
  );

  app.addHook('onResponse', (request, reply, done) => {
    if (isAdminFailureRequest(request.url, reply.statusCode)) {
      const logEntry = buildAdminFailureLog({
        requestId: request.id,
        method: request.method,
        route: request.routeOptions.url ?? request.url.split('?', 1)[0],
        statusCode: reply.statusCode,
        actorUserId: request.user?.sub
      });

      if (reply.statusCode >= 500) {
        request.log.error(logEntry, 'Admin request failed');
      } else {
        request.log.warn(logEntry, 'Admin request failed');
      }
    }

    done();
  });

  registerAuthRoutes(app);
  registerAdminRoutes(app);
  registerHealthRoutes(app);
  registerModerationRoutes(app);
  registerPollRoutes(app);
  registerPollImageRoutes(app);
  registerProfileRoutes(app);
  registerRealtimeRoutes(app);

  return app;
}
