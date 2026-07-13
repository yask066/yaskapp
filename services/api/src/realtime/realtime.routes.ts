import type { FastifyInstance } from 'fastify';

export function registerRealtimeRoutes(app: FastifyInstance) {
  app.get('/realtime', { websocket: true }, (connection) => {
    connection.socket.send(
      JSON.stringify({
        type: 'connection.ready'
      })
    );

    connection.socket.on('message', (message: Buffer | ArrayBuffer | string) => {
      connection.socket.send(
        JSON.stringify({
          type: 'echo',
          payload: message.toString()
        })
      );
    });
  });
}
