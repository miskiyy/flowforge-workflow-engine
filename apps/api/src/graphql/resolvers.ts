import type { WorkflowDagDefinition } from '@flowforge/shared-types';
import { GraphQLError } from 'graphql';
import type { MercuriusContext } from 'mercurius';
import type { AuthUser } from '../auth/plugin.js';
import { cancelRun, getRun, getTenantRunStats, listRuns, startRun, type RunRow } from '../execution/repository.js';
import { AppError } from '../lib/errors.js';
import { isValidCronExpression } from '../scheduling/cron.js';
import { GraphQLJSON } from './scalars.js';
import {
  createWorkflow,
  getWorkflow,
  listWorkflows,
  rollbackWorkflow,
  softDeleteWorkflow,
  updateWorkflow,
  type WorkflowDefinitionRow,
  type WorkflowSort,
} from '../workflows/repository.js';
import { validateAndGuardDag } from '../workflows/routes.js';

/** Module augmentation (same pattern as @fastify/jwt's in auth/plugin.ts) — mercurius's own context type gains the field our `context` builder (graphql/routes.ts) actually returns. */
declare module 'mercurius' {
  interface MercuriusContext {
    authUser: AuthUser;
  }
}

export type GraphQLContext = MercuriusContext;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, argName: string): void {
  if (!UUID_RE.test(value)) {
    throw new GraphQLError(`"${argName}" must be a UUID, got "${value}"`, { extensions: { code: 'BAD_USER_INPUT' } });
  }
}

/** AppError (the same class REST route handlers throw) -> GraphQLError, so one error model backs both APIs — not two divergent ones. */
export function toGraphQLError(err: unknown): never {
  if (err instanceof AppError) {
    throw new GraphQLError(err.message, { extensions: { code: err.code, statusCode: err.statusCode, details: err.details } });
  }
  throw err;
}

function requireWrite(authUser: AuthUser): void {
  if (authUser.role === 'viewer') {
    throw new GraphQLError('Viewer role cannot perform write operations', { extensions: { code: 'FORBIDDEN' } });
  }
}

function requireAdmin(authUser: AuthUser): void {
  if (authUser.role !== 'admin') {
    throw new GraphQLError('Only the admin role can perform this action', { extensions: { code: 'FORBIDDEN' } });
  }
}

function serializeWorkflow(row: WorkflowDefinitionRow) {
  return {
    id: row.id,
    name: row.name,
    currentVersionId: row.currentVersionId,
    cronExpression: row.cronExpression,
    webhookToken: row.webhookToken,
    createdAt: row.createdAt,
  };
}

function serializeRun(row: RunRow) {
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

function validateCron(cronExpression: string): void {
  if (!isValidCronExpression(cronExpression)) {
    throw new GraphQLError(`Invalid cron expression: "${cronExpression}"`, { extensions: { code: 'INVALID_CRON' } });
  }
}

export const resolvers = {
  JSON: GraphQLJSON,

  Query: {
    workflow: async (_: unknown, args: { id: string }, ctx: GraphQLContext) => {
      assertUuid(args.id, 'id');
      try {
        const { definition } = await getWorkflow(ctx.authUser.tenantId, args.id);
        return serializeWorkflow(definition);
      } catch (err) {
        if (err instanceof AppError && err.code === 'NOT_FOUND') return null;
        return toGraphQLError(err);
      }
    },

    workflows: async (_: unknown, args: { cursor?: string; limit?: number; name?: string }, ctx: GraphQLContext) => {
      const { items, nextCursor } = await listWorkflows({
        tenantId: ctx.authUser.tenantId,
        limit: args.limit ?? 20,
        sort: 'createdAt_desc' as WorkflowSort,
        ...(args.cursor !== undefined ? { cursor: args.cursor } : {}),
        ...(args.name !== undefined ? { name: args.name } : {}),
      });
      return { items: items.map(serializeWorkflow), nextCursor };
    },

    run: async (_: unknown, args: { id: string }, ctx: GraphQLContext) => {
      assertUuid(args.id, 'id');
      try {
        const { run } = await getRun(ctx.authUser.tenantId, args.id);
        return serializeRun(run);
      } catch (err) {
        if (err instanceof AppError && err.code === 'NOT_FOUND') return null;
        return toGraphQLError(err);
      }
    },

    runs: async (
      _: unknown,
      args: { cursor?: string; limit?: number; status?: RunRow['status']; workflowId?: string },
      ctx: GraphQLContext,
    ) => {
      const { items, nextCursor } = await listRuns({
        tenantId: ctx.authUser.tenantId,
        limit: args.limit ?? 20,
        ...(args.cursor !== undefined ? { cursor: args.cursor } : {}),
        ...(args.status !== undefined ? { status: args.status } : {}),
        ...(args.workflowId !== undefined ? { workflowId: args.workflowId } : {}),
      });
      return { items: items.map(serializeRun), nextCursor };
    },

    stats: async (_: unknown, __: unknown, ctx: GraphQLContext) => getTenantRunStats(ctx.authUser.tenantId),
  },

  Mutation: {
    createWorkflow: async (
      _: unknown,
      args: { name: string; dag: unknown; cronExpression?: string },
      ctx: GraphQLContext,
    ) => {
      requireWrite(ctx.authUser);
      try {
        validateAndGuardDag(args.dag);
        if (args.cronExpression !== undefined) validateCron(args.cronExpression);
        const { definition } = await createWorkflow({
          tenantId: ctx.authUser.tenantId,
          userId: ctx.authUser.userId,
          name: args.name,
          dag: args.dag as WorkflowDagDefinition,
          ...(args.cronExpression !== undefined ? { cronExpression: args.cronExpression } : {}),
        });
        return serializeWorkflow(definition);
      } catch (err) {
        return toGraphQLError(err);
      }
    },

    updateWorkflow: async (
      _: unknown,
      args: { id: string; name?: string; dag?: unknown; cronExpression?: string | null; baseVersionId?: string },
      ctx: GraphQLContext,
    ) => {
      requireWrite(ctx.authUser);
      assertUuid(args.id, 'id');
      try {
        if (args.dag !== undefined) validateAndGuardDag(args.dag);
        if (args.cronExpression !== undefined && args.cronExpression !== null) validateCron(args.cronExpression);
        const { definition } = await updateWorkflow({
          tenantId: ctx.authUser.tenantId,
          userId: ctx.authUser.userId,
          workflowId: args.id,
          ...(args.name !== undefined ? { name: args.name } : {}),
          ...(args.dag !== undefined ? { dag: args.dag as WorkflowDagDefinition } : {}),
          ...(args.cronExpression !== undefined ? { cronExpression: args.cronExpression } : {}),
          ...(args.baseVersionId !== undefined ? { baseVersionId: args.baseVersionId } : {}),
        });
        return serializeWorkflow(definition);
      } catch (err) {
        return toGraphQLError(err);
      }
    },

    deleteWorkflow: async (_: unknown, args: { id: string }, ctx: GraphQLContext) => {
      requireAdmin(ctx.authUser);
      assertUuid(args.id, 'id');
      try {
        await softDeleteWorkflow(ctx.authUser.tenantId, args.id);
        return true;
      } catch (err) {
        return toGraphQLError(err);
      }
    },

    triggerWorkflow: async (_: unknown, args: { id: string }, ctx: GraphQLContext) => {
      requireWrite(ctx.authUser);
      assertUuid(args.id, 'id');
      try {
        const { run } = await startRun({ tenantId: ctx.authUser.tenantId, userId: ctx.authUser.userId, workflowId: args.id });
        return serializeRun(run);
      } catch (err) {
        return toGraphQLError(err);
      }
    },

    cancelRun: async (_: unknown, args: { id: string }, ctx: GraphQLContext) => {
      requireWrite(ctx.authUser);
      assertUuid(args.id, 'id');
      try {
        const { run } = await cancelRun(ctx.authUser.tenantId, args.id);
        return serializeRun(run);
      } catch (err) {
        return toGraphQLError(err);
      }
    },

    rollbackWorkflow: async (_: unknown, args: { id: string; versionId: string }, ctx: GraphQLContext) => {
      requireWrite(ctx.authUser);
      assertUuid(args.id, 'id');
      assertUuid(args.versionId, 'versionId');
      try {
        const { definition } = await rollbackWorkflow({ tenantId: ctx.authUser.tenantId, workflowId: args.id, versionId: args.versionId });
        return serializeWorkflow(definition);
      } catch (err) {
        return toGraphQLError(err);
      }
    },
  },
};
