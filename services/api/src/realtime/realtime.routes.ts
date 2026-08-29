import type { FastifyInstance } from 'fastify';

import { addRealtimeClient } from './realtime.hub.js';
import { authenticate } from '../modules/auth/auth.utils.js';

export function registerRealtimeRoutes(app: FastifyInstance) {
  app.get('/realtime', { websocket: true, preHandler: [authenticate] }, (connection, request) => {
    const removeClient = addRealtimeClient(connection.socket, request.user.sub);

    connection.socket.on('message', (message: Buffer | ArrayBuffer | string) => {
      if (message.toString() === 'ping') {
        connection.socket.send(JSON.stringify({ type: 'pong' }));
      }
    });

    connection.socket.on('close', removeClient);
    connection.socket.on('error', removeClient);
  });
}
