import { randomUUID } from 'node:crypto';
import type { WorkflowDagDefinition } from '@flowforge/shared-types';
import { and, asc, desc, eq, gt, ilike, isNull, lt, or, sql } from 'drizzle-orm';
import { db, type Tx } from '../db/client.js';
import { workflowDefinitions, workflowVersions } from '../db/schema.js';
import { AppError, BaseVersionStaleError, NotFoundError } from '../lib/errors.js';

export type WorkflowDefinitionRow = typeof workflowDefinitions.$inferSelect;
export type WorkflowVersionRow = typeof workflowVersions.$inferSelect;

export type WorkflowSort = 'createdAt_asc' | 'createdAt_desc';

export interface CreateWorkflowInput {
  tenantId: string;
  userId: string;
  name: string;
  dag: WorkflowDagDefinition;
  cronExpression?: string;
}

export interface UpdateWorkflowInput {
  tenantId: string;
  userId: string;
  workflowId: string;
  name?: string;
  dag?: WorkflowDagDefinition;
  /** `null` clears an existing schedule; omitted leaves it untouched. */
  cronExpression?: string | null;
  /**
   * Optional optimistic-concurrency check (ai-subsystem-design.md §4.3):
   * when present, must equal the workflow's current `currentVersionId` or the
   * update is rejected with 409 instead of silently clobbering a version the
   * caller never saw. Omitted -> behavior is byte-identical to before this
   * field existed.
   */
  baseVersionId?: string;
}

export interface ListWorkflowsInput {
  tenantId: string;
  cursor?: string;
  limit: number;
  name?: string;
  sort: WorkflowSort;
}

export interface ListVersionsInput {
  tenantId: string;
  workflowId: string;
  cursor?: string;
  limit: number;
}

export interface RollbackInput {
  tenantId: string;
  workflowId: string;
  versionId: string;
}

/** Creates the definition row and its immutable v1 in one transaction, then points current_version_id at it. */
export async function createWorkflow(
  input: CreateWorkflowInput,
): Promise<{ definition: WorkflowDefinitionRow; version: WorkflowVersionRow }> {
  return db.transaction(async (tx) => {
    const [definition] = await tx
      .insert(workflowDefinitions)
      .values({
        tenantId: input.tenantId,
        name: input.name,
        ...(input.cronExpression !== undefined ? { cronExpression: input.cronExpression } : {}),
      })
      .returning();
    if (!definition) throw new Error('failed to create workflow definition');

    const [version] = await tx
      .insert(workflowVersions)
      .values({
        workflowId: definition.id,
        versionNumber: 1,
        dagDefinition: input.dag,
        createdBy: input.userId,
      })
      .returning();
    if (!version) throw new Error('failed to create workflow version');

    const [updated] = await tx
      .update(workflowDefinitions)
      .set({ currentVersionId: version.id })
      .where(eq(workflowDefinitions.id, definition.id))
      .returning();
    if (!updated) throw new Error('failed to set current version');

    return { definition: updated, version };
  });
}

async function loadTenantWorkflowForUpdate(
  tx: Tx,
  tenantId: string,
  workflowId: string,
): Promise<WorkflowDefinitionRow> {
  const [existing] = await tx
    .select()
    .from(workflowDefinitions)
    .where(
      and(
        eq(workflowDefinitions.id, workflowId),
        eq(workflowDefinitions.tenantId, tenantId),
        isNull(workflowDefinitions.deletedAt),
      ),
    )
    .for('update');
  if (!existing) throw new NotFoundError('Workflow not found');
  return existing;
}

/**
 * Updates workflow metadata and/or creates a new immutable version. Historical
 * versions are never touched — a new `dag` produces a new row and repoints
 * `current_version_id`; the row lock (`for update`) on the definition serializes
 * concurrent updates so two racing PATCHes can't compute the same next version_number.
 *
 * When `baseVersionId` is given, it's checked against the *locked* row's
 * `currentVersionId` inside this same transaction — so the check and the
 * write it guards can never race each other.
 */
export async function updateWorkflow(
  input: UpdateWorkflowInput,
): Promise<{ definition: WorkflowDefinitionRow; version: WorkflowVersionRow | null }> {
  return db.transaction(async (tx) => {
    const existing = await loadTenantWorkflowForUpdate(tx, input.tenantId, input.workflowId);

    if (input.baseVersionId !== undefined && existing.currentVersionId !== input.baseVersionId) {
      throw new BaseVersionStaleError();
    }

    let version: WorkflowVersionRow | null = null;
    if (input.dag !== undefined) {
      const [maxVersionRow] = await tx
        .select({ maxVersion: sql<number>`coalesce(max(${workflowVersions.versionNumber}), 0)` })
        .from(workflowVersions)
        .where(eq(workflowVersions.workflowId, existing.id));

      const [createdVersion] = await tx
        .insert(workflowVersions)
        .values({
          workflowId: existing.id,
          versionNumber: (maxVersionRow?.maxVersion ?? 0) + 1,
          dagDefinition: input.dag,
          createdBy: input.userId,
        })
        .returning();
      if (!createdVersion) throw new Error('failed to create workflow version');
      version = createdVersion;
    }

    const [updated] = await tx
      .update(workflowDefinitions)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.cronExpression !== undefined ? { cronExpression: input.cronExpression } : {}),
        ...(version !== null ? { currentVersionId: version.id } : {}),
      })
      .where(eq(workflowDefinitions.id, existing.id))
      .returning();
    if (!updated) throw new Error('failed to update workflow definition');

    return { definition: updated, version };
  });
}

/** Rollback repoints current_version_id — it never deletes or rewrites versions forward. */
export async function rollbackWorkflow(
  input: RollbackInput,
): Promise<{ definition: WorkflowDefinitionRow; version: WorkflowVersionRow }> {
  return db.transaction(async (tx) => {
    const existing = await loadTenantWorkflowForUpdate(tx, input.tenantId, input.workflowId);

    const [version] = await tx
      .select()
      .from(workflowVersions)
      .where(and(eq(workflowVersions.id, input.versionId), eq(workflowVersions.workflowId, existing.id)));
    if (!version) throw new NotFoundError('Version not found');

    const [updated] = await tx
      .update(workflowDefinitions)
      .set({ currentVersionId: version.id })
      .where(eq(workflowDefinitions.id, existing.id))
      .returning();
    if (!updated) throw new Error('failed to rollback workflow');

    return { definition: updated, version };
  });
}

/**
 * Server-generated, never client-supplied — the token is a bearer secret
 * (anyone holding it can trigger the workflow via `POST /webhooks/:token`,
 * webhooks/routes.ts), so it must not be settable through the regular
 * create/update body the way `cronExpression` is.
 */
export async function regenerateWebhookToken(tenantId: string, workflowId: string): Promise<WorkflowDefinitionRow> {
  const [updated] = await db
    .update(workflowDefinitions)
    .set({ webhookToken: randomUUID() })
    .where(
      and(
        eq(workflowDefinitions.id, workflowId),
        eq(workflowDefinitions.tenantId, tenantId),
        isNull(workflowDefinitions.deletedAt),
      ),
    )
    .returning();
  if (!updated) throw new NotFoundError('Workflow not found');
  return updated;
}

export async function revokeWebhookToken(tenantId: string, workflowId: string): Promise<WorkflowDefinitionRow> {
  const [updated] = await db
    .update(workflowDefinitions)
    .set({ webhookToken: null })
    .where(
      and(
        eq(workflowDefinitions.id, workflowId),
        eq(workflowDefinitions.tenantId, tenantId),
        isNull(workflowDefinitions.deletedAt),
      ),
    )
    .returning();
  if (!updated) throw new NotFoundError('Workflow not found');
  return updated;
}

/** Public lookup for the webhook trigger route — no tenant scoping (the token itself is the auth, and it names its own tenant). */
export async function getWorkflowByWebhookToken(token: string): Promise<WorkflowDefinitionRow | null> {
  const [row] = await db
    .select()
    .from(workflowDefinitions)
    .where(and(eq(workflowDefinitions.webhookToken, token), isNull(workflowDefinitions.deletedAt)));
  return row ?? null;
}

export async function softDeleteWorkflow(tenantId: string, workflowId: string): Promise<WorkflowDefinitionRow> {
  const [updated] = await db
    .update(workflowDefinitions)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(workflowDefinitions.id, workflowId),
        eq(workflowDefinitions.tenantId, tenantId),
        isNull(workflowDefinitions.deletedAt),
      ),
    )
    .returning();
  if (!updated) throw new NotFoundError('Workflow not found');
  return updated;
}

export async function getWorkflow(
  tenantId: string,
  workflowId: string,
): Promise<{ definition: WorkflowDefinitionRow; version: WorkflowVersionRow | null }> {
  const [row] = await db
    .select({ definition: workflowDefinitions, version: workflowVersions })
    .from(workflowDefinitions)
    .leftJoin(workflowVersions, eq(workflowDefinitions.currentVersionId, workflowVersions.id))
    .where(
      and(
        eq(workflowDefinitions.id, workflowId),
        eq(workflowDefinitions.tenantId, tenantId),
        isNull(workflowDefinitions.deletedAt),
      ),
    );
  if (!row) throw new NotFoundError('Workflow not found');
  return row;
}

export async function listWorkflows(
  input: ListWorkflowsInput,
): Promise<{ items: WorkflowDefinitionRow[]; nextCursor: string | null }> {
  const isAsc = input.sort === 'createdAt_asc';
  const cursor = input.cursor ? decodeListCursor(input.cursor) : undefined;

  const conditions = [eq(workflowDefinitions.tenantId, input.tenantId), isNull(workflowDefinitions.deletedAt)];
  if (input.name !== undefined) conditions.push(ilike(workflowDefinitions.name, `%${input.name}%`));
  if (cursor) {
    const tieBreak = isAsc ? gt : lt;
    conditions.push(
      or(
        (isAsc ? gt : lt)(workflowDefinitions.createdAt, cursor.createdAt),
        and(eq(workflowDefinitions.createdAt, cursor.createdAt), tieBreak(workflowDefinitions.id, cursor.id)),
      )!,
    );
  }

  const orderFn = isAsc ? asc : desc;
  const rows = await db
    .select()
    .from(workflowDefinitions)
    .where(and(...conditions))
    .orderBy(orderFn(workflowDefinitions.createdAt), orderFn(workflowDefinitions.id))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const items = hasMore ? rows.slice(0, input.limit) : rows;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? encodeListCursor(last.createdAt, last.id) : null;

  return { items, nextCursor };
}

export async function listVersions(
  input: ListVersionsInput,
): Promise<{ items: WorkflowVersionRow[]; nextCursor: string | null }> {
  const [existing] = await db
    .select({ id: workflowDefinitions.id })
    .from(workflowDefinitions)
    .where(
      and(
        eq(workflowDefinitions.id, input.workflowId),
        eq(workflowDefinitions.tenantId, input.tenantId),
        isNull(workflowDefinitions.deletedAt),
      ),
    );
  if (!existing) throw new NotFoundError('Workflow not found');

  const cursorVersion = input.cursor ? decodeVersionCursor(input.cursor) : undefined;

  const rows = await db
    .select()
    .from(workflowVersions)
    .where(
      and(
        eq(workflowVersions.workflowId, input.workflowId),
        cursorVersion !== undefined ? lt(workflowVersions.versionNumber, cursorVersion) : undefined,
      ),
    )
    .orderBy(desc(workflowVersions.versionNumber))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const items = hasMore ? rows.slice(0, input.limit) : rows;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? String(last.versionNumber) : null;

  return { items, nextCursor };
}

function encodeListCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString('base64url');
}

function decodeListCursor(cursor: string): { createdAt: Date; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      createdAt: string;
      id: string;
    };
    return { createdAt: new Date(parsed.createdAt), id: parsed.id };
  } catch {
    throw new AppError(400, 'INVALID_CURSOR', 'Invalid pagination cursor');
  }
}

function decodeVersionCursor(cursor: string): number {
  const n = Number(cursor);
  if (!Number.isInteger(n) || n < 1) throw new AppError(400, 'INVALID_CURSOR', 'Invalid pagination cursor');
  return n;
}
