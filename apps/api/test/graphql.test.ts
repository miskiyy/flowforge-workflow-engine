import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createTenant, createUser, validDag } from './fixtures.js';

describe('GraphQL /graphql', () => {
  let app: FastifyInstance;
  let tenantAId: string;
  let editorAToken: string;
  let adminAToken: string;
  let viewerAToken: string;
  let tenantBId: string;
  let editorBToken: string;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    const tenantA = await createTenant();
    tenantAId = tenantA.id;
    const editorA = await createUser(tenantAId, 'editor');
    const adminA = await createUser(tenantAId, 'admin');
    const viewerA = await createUser(tenantAId, 'viewer');
    editorAToken = await app.jwt.sign({ tenantId: tenantAId, userId: editorA.id, role: 'editor' });
    adminAToken = await app.jwt.sign({ tenantId: tenantAId, userId: adminA.id, role: 'admin' });
    viewerAToken = await app.jwt.sign({ tenantId: tenantAId, userId: viewerA.id, role: 'viewer' });

    const tenantB = await createTenant();
    tenantBId = tenantB.id;
    const editorB = await createUser(tenantBId, 'editor');
    editorBToken = await app.jwt.sign({ tenantId: tenantBId, userId: editorB.id, role: 'editor' });
  });

  afterAll(async () => {
    await app.close();
  });

  function graphql(token: string | null, query: string, variables?: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/graphql',
      ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
      payload: { query, ...(variables ? { variables } : {}) },
    });
  }

  it('rejects an unauthenticated request with 401, same envelope as REST', async () => {
    const response = await graphql(null, '{ __typename }');
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('creates, queries, and triggers a workflow through GraphQL', async () => {
    const created = await graphql(
      editorAToken,
      `mutation($dag: JSON!) { createWorkflow(name: "gql-flow", dag: $dag) { id name currentVersionId } }`,
      { dag: validDag() },
    );
    expect(created.statusCode).toBe(200);
    const workflowId = created.json().data.createWorkflow.id as string;
    expect(created.json().data.createWorkflow.name).toBe('gql-flow');

    const fetched = await graphql(editorAToken, `query($id: ID!) { workflow(id: $id) { id name } }`, { id: workflowId });
    expect(fetched.json().data.workflow.name).toBe('gql-flow');

    const triggered = await graphql(editorAToken, `mutation($id: ID!) { triggerWorkflow(id: $id) { id status } }`, {
      id: workflowId,
    });
    expect(triggered.json().data.triggerWorkflow.status).toBe('pending');

    const stats = await graphql(editorAToken, `{ stats { activeRuns last24h { total } } }`);
    expect(stats.json().data.stats.activeRuns).toBeGreaterThanOrEqual(1);
  });

  it('rejects an invalid DAG the same way REST does (validateAndGuardDag reused, not reimplemented)', async () => {
    const response = await graphql(
      editorAToken,
      `mutation($dag: JSON!) { createWorkflow(name: "bad-flow", dag: $dag) { id } }`,
      { dag: { steps: [{ key: 'a', type: 'delay', dependsOn: ['missing'], durationMs: 1 }] } },
    );
    expect(response.json().data).toBeNull();
    expect(response.json().errors[0].extensions.code).toBe('INVALID_DAG');
  });

  it('blocks a viewer from mutating, but allows queries', async () => {
    const write = await graphql(
      viewerAToken,
      `mutation($dag: JSON!) { createWorkflow(name: "viewer-flow", dag: $dag) { id } }`,
      { dag: validDag() },
    );
    expect(write.json().errors[0].extensions.code).toBe('FORBIDDEN');

    const read = await graphql(viewerAToken, `{ workflows(limit: 5) { items { id } } }`);
    expect(read.statusCode).toBe(200);
    expect(read.json().errors).toBeUndefined();
  });

  it('blocks an editor from deleteWorkflow, but allows admin', async () => {
    const created = await graphql(
      editorAToken,
      `mutation($dag: JSON!) { createWorkflow(name: "to-delete-gql", dag: $dag) { id } }`,
      { dag: validDag() },
    );
    const workflowId = created.json().data.createWorkflow.id as string;

    const editorDelete = await graphql(editorAToken, `mutation($id: ID!) { deleteWorkflow(id: $id) }`, { id: workflowId });
    expect(editorDelete.json().errors[0].extensions.code).toBe('FORBIDDEN');

    const adminDelete = await graphql(adminAToken, `mutation($id: ID!) { deleteWorkflow(id: $id) }`, { id: workflowId });
    expect(adminDelete.json().data.deleteWorkflow).toBe(true);
  });

  it('never returns another tenant\'s workflow, even by its real UUID', async () => {
    const created = await graphql(
      editorAToken,
      `mutation($dag: JSON!) { createWorkflow(name: "isolated-gql", dag: $dag) { id } }`,
      { dag: validDag() },
    );
    const workflowId = created.json().data.createWorkflow.id as string;

    const crossTenant = await graphql(editorBToken, `query($id: ID!) { workflow(id: $id) { id } }`, { id: workflowId });
    expect(crossTenant.json().data.workflow).toBeNull();

    const list = await graphql(editorBToken, `{ workflows { items { name } } }`);
    const names = list.json().data.workflows.items.map((w: { name: string }) => w.name);
    expect(names).not.toContain('isolated-gql');
  });
});
