import type { FastifyInstance } from 'fastify';

import { addRealtimeClient } from './realtime.hub.js';

export function registerRealtimeRoutes(app: FastifyInstance) {
  app.get('/realtime', { websocket: true }, (connection) => {
    const removeClient = addRealtimeClient(connection.socket);

    connection.socket.on('message', (message: Buffer | ArrayBuffer | string) => {
      if (message.toString() === 'ping') {
        connection.socket.send(JSON.stringify({ type: 'pong' }));
      }
    });

    connection.socket.on('close', removeClient);
    connection.socket.on('error', removeClient);
  });
}
