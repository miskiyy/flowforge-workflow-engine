import type { FastifyInstance, FastifyRequest } from 'fastify';
import mercurius from 'mercurius';
import type { AuthUser } from '../auth/plugin.js';
import { UnauthorizedError, TooManyRequestsError } from '../lib/errors.js';
import { TokenBucketLimiter } from '../lib/rate-limit.js';
import type { GraphQLContext } from './resolvers.js';
import { resolvers, toGraphQLError } from './resolvers.js';
import { typeDefs } from './schema.js';

/**
 * One /graphql endpoint alongside the REST API — same JWT, same tenant
 * isolation, same rate limiter shape as workflows/routes.ts and
 * execution/routes.ts, just built as a mercurius `context` instead of
 * Fastify preHandlers (mercurius owns the route, so REST's preHandler
 * array doesn't apply here). See graphql/README.md for what's in scope
 * and what deliberately isn't.
 */
export function registerGraphqlRoutes(app: FastifyInstance): void {
  const limiter = new TokenBucketLimiter({ capacity: 50, refillPerSecond: 25 });

  app.register(mercurius, {
    schema: typeDefs,
    resolvers,
    graphiql: process.env.NODE_ENV !== 'production',
    // Mercurius merges this partial into its own base context (app/reply/pubsub/etc.)
    // before resolvers see it — only the field we actually add needs declaring here.
    context: async (request: FastifyRequest): Promise<Pick<GraphQLContext, 'authUser'>> => {
      try {
        await request.jwtVerify();
      } catch {
        return toGraphQLError(new UnauthorizedError('Invalid or expired token'));
      }
      const authUser = request.user as AuthUser;
      if (!limiter.consume(authUser.tenantId)) {
        return toGraphQLError(new TooManyRequestsError());
      }
      return { authUser };
    },
    errorFormatter: (execution, ctx) => {
      const formatted = mercurius.defaultErrorFormatter(execution, ctx);
      // Surface the same HTTP status our REST errors use instead of mercurius's
      // blanket 200-with-errors-array default — statusCode was carried through
      // from AppError/UnauthorizedError/TooManyRequestsError via GraphQLError
      // extensions (resolvers.ts's toGraphQLError, and thrown directly above).
      const firstExtensions = execution.errors?.[0]?.extensions as { statusCode?: number } | undefined;
      if (firstExtensions?.statusCode) formatted.statusCode = firstExtensions.statusCode;
      return formatted;
    },
  });
}
