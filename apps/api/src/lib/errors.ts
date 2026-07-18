import type { FastifyError, FastifyInstance } from 'fastify';
import { GraphQLError } from 'graphql';

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, 'FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(404, 'NOT_FOUND', message);
  }
}

export class InvalidDagError extends AppError {
  constructor(details: unknown) {
    super(422, 'INVALID_DAG', 'Workflow DAG failed validation', details);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Rate limit exceeded') {
    super(429, 'RATE_LIMITED', message);
  }
}

/**
 * `baseVersionId` (an optimistic-concurrency check, see workflows/repository.ts
 * and ai-subsystem-design.md §4.3) no longer matches `current_version_id` —
 * someone else moved the workflow first. Lives here, not in ai/errors.ts,
 * because both the CRUD PATCH path and the AI propose path throw it, and
 * nothing outside ai/ may import from inside it.
 */
export class BaseVersionStaleError extends AppError {
  constructor(message = 'Workflow has changed since this proposal was based on it') {
    super(409, 'BASE_VERSION_STALE', message);
  }
}

function envelope(code: string, message: string, details?: unknown) {
  return { error: { code, message, ...(details !== undefined ? { details } : {}) } };
}

/** Standard `{ error: { code, message, details? } }` envelope for every error response. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | AppError | GraphQLError, request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send(envelope(error.code, error.message, error.details));
      return;
    }

    // mercurius's `context` builder (graphql/routes.ts) throws GraphQLError for
    // auth/rate-limit failures — those happen before GraphQL execution starts,
    // so mercurius never gets a chance to format them; they land here instead,
    // carrying the same { code, statusCode } shape resolvers.ts's toGraphQLError sets.
    if (error instanceof GraphQLError) {
      const extensions = error.extensions as { code?: string; statusCode?: number } | undefined;
      const statusCode = extensions?.statusCode ?? 500;
      reply.status(statusCode).send(envelope(extensions?.code ?? 'INTERNAL_ERROR', error.message));
      return;
    }

    if (error.validation) {
      reply.status(400).send(envelope('VALIDATION_ERROR', 'Request validation failed', error.validation));
      return;
    }

    const statusCode = error.statusCode ?? 500;
    if (statusCode < 500) {
      reply.status(statusCode).send(envelope(error.code ?? 'REQUEST_ERROR', error.message));
      return;
    }

    request.log.error(error);
    reply.status(500).send(envelope('INTERNAL_ERROR', 'Internal server error'));
  });
}
