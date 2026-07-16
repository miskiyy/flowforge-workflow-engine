import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config.js';
import type { UserRole } from '../db/schema.js';
import { ForbiddenError, UnauthorizedError } from '../lib/errors.js';

export interface AuthUser {
  tenantId: string;
  userId: string;
  role: UserRole;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthUser;
    user: AuthUser;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireWrite: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    authUser: AuthUser;
  }
}

/**
 * Registers JWT support plus two centrally-enforced preHandlers so route
 * files never hand-roll auth checks: `authenticate` verifies the token and
 * derives tenantId/role server-side (never trusted from the request body or
 * params), `requireWrite` blocks the viewer role from any non-GET method.
 */
export function registerAuth(app: FastifyInstance): void {
  app.register(fastifyJwt, {
    secret: env.jwtSecret,
    sign: { expiresIn: env.jwtExpiresIn },
  });

  app.decorate('authenticate', async (request: FastifyRequest) => {
    try {
      await request.jwtVerify();
    } catch {
      throw new UnauthorizedError('Invalid or expired token');
    }
    request.authUser = request.user;
  });

  app.decorate('requireWrite', async (request: FastifyRequest) => {
    if (request.method !== 'GET' && request.authUser.role === 'viewer') {
      throw new ForbiddenError('Viewer role cannot perform write operations');
    }
  });
}
