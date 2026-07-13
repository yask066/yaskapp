import type { PublicUser } from '../modules/auth/auth.repository.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string;
      username: string;
    };
    user: {
      sub: string;
      username: string;
    };
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    getCurrentUser(): Promise<PublicUser | null>;
  }
}
