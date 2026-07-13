import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';

import { env } from './config/env.js';
import { registerAuthRoutes } from './modules/auth/auth.routes.js';
import { getCurrentUser } from './modules/auth/auth.utils.js';
import { registerHealthRoutes } from './modules/health/health.routes.js';
import { registerPollRoutes } from './modules/polls/polls.routes.js';
import { registerRealtimeRoutes } from './realtime/realtime.routes.js';

export function buildApp() {
  const app = Fastify({
    logger: env.NODE_ENV !== 'test'
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
  registerRealtimeRoutes(app);

  return app;
}
