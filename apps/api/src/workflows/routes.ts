import type { WorkflowDagDefinition } from '@flowforge/shared-types';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError, InvalidDagError, TooManyRequestsError } from '../lib/errors.js';
import { TokenBucketLimiter } from '../lib/rate-limit.js';
import { isValidCronExpression } from '../scheduling/cron.js';
import { validateDag } from './dag-validation.js';
import { checkGuards } from './guards.js';
import {
  createWorkflow,
  getWorkflow,
  listVersions,
  listWorkflows,
  regenerateWebhookToken,
  revokeWebhookToken,
  rollbackWorkflow,
  softDeleteWorkflow,
  updateWorkflow,
  type WorkflowDefinitionRow,
  type WorkflowSort,
  type WorkflowVersionRow,
} from './repository.js';

export function validateCronExpression(cronExpression: string): void {
  if (!isValidCronExpression(cronExpression)) {
    throw new AppError(422, 'INVALID_CRON', `Invalid cron expression: "${cronExpression}"`);
  }
}

const CreateWorkflowBody = Type.Object({
  name: Type.String({ minLength: 1 }),
  dag: Type.Unknown(),
  cronExpression: Type.Optional(Type.String({ minLength: 1 })),
});

const UpdateWorkflowBody = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1 })),
  dag: Type.Optional(Type.Unknown()),
  // null clears an existing schedule; omitted leaves it untouched; a string sets/replaces it.
  cronExpression: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
  // Optional optimistic-concurrency token (ai-subsystem-design.md §4.3).
  // Omitted -> behavior is byte-identical to before this field existed.
  baseVersionId: Type.Optional(Type.String({ format: 'uuid' })),
});

const WorkflowIdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });
const RollbackParams = Type.Object({
  id: Type.String({ format: 'uuid' }),
  versionId: Type.String({ format: 'uuid' }),
});

const SortQuery = Type.Union([Type.Literal('createdAt_asc'), Type.Literal('createdAt_desc')]);

const ListWorkflowsQuery = Type.Object({
  cursor: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  name: Type.Optional(Type.String()),
  sort: Type.Optional(SortQuery),
});

const ListVersionsQuery = Type.Object({
  cursor: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
});

const DEFAULT_PAGE_LIMIT = 20;

/** Same policy as the AI proposal path (ai/propose.ts) and the GraphQL layer (graphql/resolvers.ts) — validateDag then checkGuards, one mechanism, not three (audit C1). */
export function validateAndGuardDag(dag: unknown): void {
  const validation = validateDag(dag);
  if (!validation.valid) throw new InvalidDagError(validation.errors);

  const guardErrors = checkGuards(dag as WorkflowDagDefinition);
  if (guardErrors.length > 0) throw new InvalidDagError(guardErrors);
}

function serializeDefinition(row: WorkflowDefinitionRow) {
  return {
    id: row.id,
    name: row.name,
    currentVersionId: row.currentVersionId,
    cronExpression: row.cronExpression,
    webhookToken: row.webhookToken,
    createdAt: row.createdAt,
  };
}

function serializeVersion(row: WorkflowVersionRow) {
  return {
    id: row.id,
    workflowId: row.workflowId,
    versionNumber: row.versionNumber,
    dag: row.dagDefinition,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

export function registerWorkflowRoutes(app: FastifyInstance): void {
  // One bucket per app instance (not a module-level singleton) so tenants in
  // different tests/processes never share state. Capacity is sized to cover
  // a normal burst of CRUD calls from one tenant without needing a fake
  // clock in tests — a dedicated test simply issues capacity+1 requests.
  const limiter = new TokenBucketLimiter({ capacity: 50, refillPerSecond: 25 });

  const rateLimit = async (request: FastifyRequest): Promise<void> => {
    if (!limiter.consume(request.authUser.tenantId)) {
      throw new TooManyRequestsError();
    }
  };

  const readGuard = [app.authenticate, rateLimit];
  const writeGuard = [app.authenticate, rateLimit, app.requireWrite];
  // Destructive or credential-rotating actions (delete a workflow, mint/revoke its webhook secret)
  // — editor can author and run workflows day-to-day, but not these.
  const adminGuard = [app.authenticate, rateLimit, app.requireWrite, app.requireAdmin];

  app.post(
    '/workflows',
    { schema: { body: CreateWorkflowBody }, preHandler: writeGuard },
    async (request, reply) => {
      const body = request.body as { name: string; dag: unknown; cronExpression?: string };
      validateAndGuardDag(body.dag);
      if (body.cronExpression !== undefined) validateCronExpression(body.cronExpression);

      const { definition, version } = await createWorkflow({
        tenantId: request.authUser.tenantId,
        userId: request.authUser.userId,
        name: body.name,
        dag: body.dag as WorkflowDagDefinition,
        ...(body.cronExpression !== undefined ? { cronExpression: body.cronExpression } : {}),
      });

      return reply.status(201).send({ workflow: serializeDefinition(definition), version: serializeVersion(version) });
    },
  );

  app.patch(
    '/workflows/:id',
    { schema: { params: WorkflowIdParams, body: UpdateWorkflowBody }, preHandler: writeGuard },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = request.body as { name?: string; dag?: unknown; cronExpression?: string | null; baseVersionId?: string };

      if (body.dag !== undefined) {
        validateAndGuardDag(body.dag);
      }
      if (body.cronExpression !== undefined && body.cronExpression !== null) {
        validateCronExpression(body.cronExpression);
      }

      const { definition, version } = await updateWorkflow({
        tenantId: request.authUser.tenantId,
        userId: request.authUser.userId,
        workflowId: id,
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.dag !== undefined ? { dag: body.dag as WorkflowDagDefinition } : {}),
        ...(body.cronExpression !== undefined ? { cronExpression: body.cronExpression } : {}),
        ...(body.baseVersionId !== undefined ? { baseVersionId: body.baseVersionId } : {}),
      });

      return { workflow: serializeDefinition(definition), version: version ? serializeVersion(version) : null };
    },
  );

  app.get('/workflows/:id', { schema: { params: WorkflowIdParams }, preHandler: readGuard }, async (request) => {
    const { id } = request.params as { id: string };
    const { definition, version } = await getWorkflow(request.authUser.tenantId, id);
    return { workflow: serializeDefinition(definition), version: version ? serializeVersion(version) : null };
  });

  app.get(
    '/workflows/:id/versions',
    { schema: { params: WorkflowIdParams, querystring: ListVersionsQuery }, preHandler: readGuard },
    async (request) => {
      const { id } = request.params as { id: string };
      const query = request.query as { cursor?: string; limit?: number };
      const { items, nextCursor } = await listVersions({
        tenantId: request.authUser.tenantId,
        workflowId: id,
        limit: query.limit ?? DEFAULT_PAGE_LIMIT,
        ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
      });
      return { items: items.map(serializeVersion), nextCursor };
    },
  );

  app.get('/workflows', { schema: { querystring: ListWorkflowsQuery }, preHandler: readGuard }, async (request) => {
    const query = request.query as { cursor?: string; limit?: number; name?: string; sort?: WorkflowSort };
    const { items, nextCursor } = await listWorkflows({
      tenantId: request.authUser.tenantId,
      limit: query.limit ?? DEFAULT_PAGE_LIMIT,
      sort: query.sort ?? 'createdAt_desc',
      ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
      ...(query.name !== undefined ? { name: query.name } : {}),
    });
    return { items: items.map(serializeDefinition), nextCursor };
  });

  app.post(
    '/workflows/:id/rollback/:versionId',
    { schema: { params: RollbackParams }, preHandler: writeGuard },
    async (request) => {
      const { id, versionId } = request.params as { id: string; versionId: string };
      const { definition, version } = await rollbackWorkflow({
        tenantId: request.authUser.tenantId,
        workflowId: id,
        versionId,
      });
      return { workflow: serializeDefinition(definition), version: serializeVersion(version) };
    },
  );

  app.post(
    '/workflows/:id/webhook-token',
    { schema: { params: WorkflowIdParams }, preHandler: adminGuard },
    async (request) => {
      const { id } = request.params as { id: string };
      const definition = await regenerateWebhookToken(request.authUser.tenantId, id);
      return { workflow: serializeDefinition(definition) };
    },
  );

  app.delete(
    '/workflows/:id/webhook-token',
    { schema: { params: WorkflowIdParams }, preHandler: adminGuard },
    async (request) => {
      const { id } = request.params as { id: string };
      const definition = await revokeWebhookToken(request.authUser.tenantId, id);
      return { workflow: serializeDefinition(definition) };
    },
  );

  app.delete(
    '/workflows/:id',
    { schema: { params: WorkflowIdParams }, preHandler: adminGuard },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await softDeleteWorkflow(request.authUser.tenantId, id);
      return reply.status(204).send();
    },
  );
}
