import type { WorkflowDagDefinition } from '@flowforge/shared-types';
import { desc, sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

export const USER_ROLES = ['admin', 'editor', 'viewer'] as const;
export type UserRole = (typeof USER_ROLES)[number];

// Every timestamptz column below is declared with precision: 3 (milliseconds).
// Postgres' default is microsecond precision, but JS `Date` only has
// millisecond resolution — leaving the mismatch in place silently breaks
// equality comparisons that round-trip through a JS Date (e.g. the
// created_at-keyed keyset pagination cursor in workflows/repository.ts).
export const TRIGGER_TYPES = ['manual', 'cron', 'webhook'] as const;
export const RUN_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'timed_out', 'cancelled'] as const;
export const STEP_RUN_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'retrying', 'skipped'] as const;

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
});

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: USER_ROLES }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('users_tenant_id_email_unique').on(table.tenantId, table.email),
    index('users_tenant_id_idx').on(table.tenantId),
    check('users_role_check', sql`${table.role} in ('admin', 'editor', 'viewer')`),
  ],
);

// current_version_id is a forward reference to workflow_versions, which itself
// references workflow_definitions — the lazy callback breaks the circular
// import so drizzle-kit can emit the two CREATE TABLEs then a trailing
// ALTER TABLE ... ADD CONSTRAINT, matching the documented schema exactly.
export const workflowDefinitions = pgTable(
  'workflow_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    currentVersionId: uuid('current_version_id').references((): AnyPgColumn => workflowVersions.id),
    cronExpression: text('cron_expression'),
    webhookToken: uuid('webhook_token'),
    deletedAt: timestamp('deleted_at', { withTimezone: true, precision: 3 }),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (table) => [
    index('workflow_definitions_tenant_id_idx').on(table.tenantId),
    uniqueIndex('workflow_definitions_webhook_token_unique').on(table.webhookToken),
  ],
);

export const workflowVersions = pgTable(
  'workflow_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflowDefinitions.id),
    versionNumber: integer('version_number').notNull(),
    dagDefinition: jsonb('dag_definition').notNull().$type<WorkflowDagDefinition>(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('workflow_versions_workflow_id_version_number_unique').on(table.workflowId, table.versionNumber)],
);

// workflow_id is denormalized here (0004_add_workflow_id_to_runs.sql) so
// "runs for workflow X" is a direct filter instead of a join through
// workflow_versions. workflow_version_id remains the source of truth for
// which exact DAG definition a run pins (deterministic audit/replay).
export const runs = pgTable(
  'runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflowDefinitions.id),
    workflowVersionId: uuid('workflow_version_id')
      .notNull()
      .references(() => workflowVersions.id),
    triggerType: text('trigger_type', { enum: TRIGGER_TYPES }).notNull(),
    triggeredBy: uuid('triggered_by').references(() => users.id),
    status: text('status', { enum: RUN_STATUSES }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true, precision: 3 }),
    finishedAt: timestamp('finished_at', { withTimezone: true, precision: 3 }),
    // Cron/webhook triggers only (Task.md:102) — manual triggers leave this
    // null. Backs the partial unique index below, which is what actually
    // prevents a double-fire on retry/replay.
    idempotencyKey: text('idempotency_key'),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (table) => [
    index('runs_tenant_id_idx').on(table.tenantId),
    // Covers GET /runs?workflowId=X&status=failed (tenant-scoped) and also
    // satisfies the existing "newest first" ORDER BY via the trailing
    // created_at DESC — see query-optimization.md for the EXPLAIN evidence.
    index('idx_runs_tenant_workflow_status').on(table.tenantId, table.workflowId, table.status, desc(table.createdAt)),
    check('runs_trigger_type_check', sql`${table.triggerType} in ('manual', 'cron', 'webhook')`),
    check(
      'runs_status_check',
      sql`${table.status} in ('pending', 'running', 'succeeded', 'failed', 'timed_out', 'cancelled')`,
    ),
    uniqueIndex('runs_workflow_id_idempotency_key_unique')
      .on(table.workflowId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
  ],
);

// attempt_number keeps retries as history on one row rather than a row per
// attempt, so the run graph (one node per DAG step) stays legible.
export const stepRuns = pgTable(
  'step_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id),
    stepKey: text('step_key').notNull(),
    attemptNumber: integer('attempt_number').notNull().default(1),
    status: text('status', { enum: STEP_RUN_STATUSES }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true, precision: 3 }),
    finishedAt: timestamp('finished_at', { withTimezone: true, precision: 3 }),
    output: jsonb('output'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (table) => [
    index('step_runs_run_id_idx').on(table.runId),
    check(
      'step_runs_status_check',
      sql`${table.status} in ('pending', 'running', 'succeeded', 'failed', 'retrying', 'skipped')`,
    ),
  ],
);

// Plain time-indexed table, not partitioned — see Task.md's locked decision
// against "partitioning theater" for a 4-day MVP. S3/Glacier cold storage +
// retention is the documented scale path.
export const stepLogs = pgTable(
  'step_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    stepRunId: uuid('step_run_id')
      .notNull()
      .references(() => stepRuns.id),
    ts: timestamp('ts', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    level: text('level').notNull(),
    message: text('message').notNull(),
  },
  (table) => [index('step_logs_step_run_id_ts_idx').on(table.stepRunId, table.ts)],
);
