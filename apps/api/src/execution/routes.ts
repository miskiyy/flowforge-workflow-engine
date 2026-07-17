import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { RUN_STATUSES } from '../db/schema.js';
import { TooManyRequestsError } from '../lib/errors.js';
import { TokenBucketLimiter } from '../lib/rate-limit.js';
import { requestRunCancellation } from './cancellation.js';
import {
  cancelRun,
  getRun,
  getStepLogsForRun,
  getTenantRunStats,
  listRuns,
  startRun,
  type RunRow,
  type StepRunRow,
} from './repository.js';

const WorkflowIdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });
const RunIdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });
const StepLogsParams = Type.Object({ id: Type.String({ format: 'uuid' }), stepKey: Type.String({ minLength: 1 }) });

const RunStatusQuery = Type.Union(RUN_STATUSES.map((status) => Type.Literal(status)));

const ListRunsQuery = Type.Object({
  cursor: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  status: Type.Optional(RunStatusQuery),
  workflowId: Type.Optional(Type.String({ format: 'uuid' })),
});

const DEFAULT_PAGE_LIMIT = 20;

export function serializeRun(row: RunRow) {
  return {
    id: row.id,
    workflowId: row.workflowId,
    workflowVersionId: row.workflowVersionId,
    triggerType: row.triggerType,
    triggeredBy: row.triggeredBy,
    status: row.status,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
  };
}

export function serializeStepRun(row: StepRunRow) {
  return {
    id: row.id,
    stepKey: row.stepKey,
    attemptNumber: row.attemptNumber,
    status: row.status,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    error: row.error,
  };
}

/**
 * Execution lifecycle routes (Phase 3.2): starting a run and reading
 * execution history. No step dispatch, retry, scheduling, or realtime push
 * lives here — a triggered run stays 'pending' until a future executor
 * picks it up.
 */
export function registerExecutionRoutes(app: FastifyInstance): void {
  const limiter = new TokenBucketLimiter({ capacity: 50, refillPerSecond: 25 });

  const rateLimit = async (request: FastifyRequest): Promise<void> => {
    if (!limiter.consume(request.authUser.tenantId)) {
      throw new TooManyRequestsError();
    }
  };

  const readGuard = [app.authenticate, rateLimit];
  const writeGuard = [app.authenticate, rateLimit, app.requireWrite];

  app.post(
    '/workflows/:id/trigger',
    { schema: { params: WorkflowIdParams }, preHandler: writeGuard },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { run, steps } = await startRun({
        tenantId: request.authUser.tenantId,
        userId: request.authUser.userId,
        workflowId: id,
      });
      return reply.status(201).send({ run: serializeRun(run), steps: steps.map(serializeStepRun) });
    },
  );

  app.post('/runs/:id/cancel', { schema: { params: RunIdParams }, preHandler: writeGuard }, async (request) => {
    const { id } = request.params as { id: string };
    const result = await cancelRun(request.authUser.tenantId, id);
    if (!result.cancelledImmediately) requestRunCancellation(id);
    return { run: serializeRun(result.run), cancelledImmediately: result.cancelledImmediately };
  });

  app.get('/runs/:id', { schema: { params: RunIdParams }, preHandler: readGuard }, async (request) => {
    const { id } = request.params as { id: string };
    const { run, steps, dag } = await getRun(request.authUser.tenantId, id);
    return { run: serializeRun(run), steps: steps.map(serializeStepRun), dag };
  });

  app.get(
    '/runs/:id/steps/:stepKey/logs',
    { schema: { params: StepLogsParams }, preHandler: readGuard },
    async (request) => {
      const { id, stepKey } = request.params as { id: string; stepKey: string };
      const logs = await getStepLogsForRun(request.authUser.tenantId, id, stepKey);
      return { items: logs.map((log) => ({ ts: log.ts, level: log.level, message: log.message })) };
    },
  );

  app.get('/stats', { preHandler: readGuard }, async (request) => {
    return getTenantRunStats(request.authUser.tenantId);
  });

  app.get('/runs', { schema: { querystring: ListRunsQuery }, preHandler: readGuard }, async (request) => {
    const query = request.query as {
      cursor?: string;
      limit?: number;
      status?: (typeof RUN_STATUSES)[number];
      workflowId?: string;
    };
    const { items, nextCursor } = await listRuns({
      tenantId: request.authUser.tenantId,
      limit: query.limit ?? DEFAULT_PAGE_LIMIT,
      ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.workflowId !== undefined ? { workflowId: query.workflowId } : {}),
    });
    return { items: items.map(serializeRun), nextCursor };
  });
}
