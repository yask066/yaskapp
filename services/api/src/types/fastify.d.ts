import type { AuthenticatedUser } from '../modules/auth/auth.repository.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string;
      username: string;
      sessionVersion: number;
    };
    user: {
      sub: string;
      username: string;
      sessionVersion: number;
    };
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    cookies: Record<string, string>;
    getCurrentUser(): Promise<AuthenticatedUser | null>;
  }
}
