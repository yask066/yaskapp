import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';

import { env } from './config/env.js';
import { registerAuthRoutes } from './modules/auth/auth.routes.js';
import { getCurrentUser } from './modules/auth/auth.utils.js';
import { registerHealthRoutes } from './modules/health/health.routes.js';
import { registerPollRoutes } from './modules/polls/polls.routes.js';
import { registerProfileRoutes } from './modules/profiles/profiles.routes.js';
import { registerRealtimeRoutes } from './realtime/realtime.routes.js';

export function buildApp() {
  const app = Fastify({
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
    origin: true,
    credentials: true
  });

  app.register(jwt, {
    secret: env.JWT_SECRET
  });

  app.decorateRequest('getCurrentUser', function () {
    return getCurrentUser(this);
  });

  app.register(websocket);

  registerAuthRoutes(app);
  registerHealthRoutes(app);
  registerPollRoutes(app);
  registerProfileRoutes(app);
  registerRealtimeRoutes(app);

  return app;
}
