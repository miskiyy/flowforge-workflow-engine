import type { WorkflowDagDefinition } from '@flowforge/shared-types';
import type { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { buildExecutionContext } from '../src/execution/context.js';
import { executeRun, type StepExecutor } from '../src/execution/executor.js';
import { startRun } from '../src/execution/repository.js';
import { createRealtimeExecutionLogger } from '../src/realtime/publisher.js';
import { createWorkflow } from '../src/workflows/repository.js';
import { createTenant, createUser, validDag } from './fixtures.js';

class WsHandshakeError extends Error {
  constructor(readonly statusCode: number) {
    super(`ws handshake rejected: ${statusCode}`);
  }
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('unexpected-response', (_req, res) => {
      reject(new WsHandshakeError(res.statusCode ?? 0));
      ws.terminate();
    });
    ws.once('error', reject);
  });
}

function nextMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
    ws.once('error', reject);
  });
}

describe('realtime gateway (WS /runs/:id/stream)', () => {
  let app: FastifyInstance;
  let baseWsUrl: string;

  let tenantAId: string;
  let editorAToken: string;
  let tenantBId: string;
  let editorBToken: string;

  beforeAll(async () => {
    app = buildApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (address === null || typeof address === 'string') throw new Error('expected a bound TCP address');
    baseWsUrl = `ws://127.0.0.1:${address.port}`;

    const tenantA = await createTenant();
    tenantAId = tenantA.id;
    const editorA = await createUser(tenantAId, 'editor');
    editorAToken = await app.jwt.sign({ tenantId: tenantAId, userId: editorA.id, role: 'editor' });

    const tenantB = await createTenant();
    tenantBId = tenantB.id;
    const editorB = await createUser(tenantBId, 'editor');
    editorBToken = await app.jwt.sign({ tenantId: tenantBId, userId: editorB.id, role: 'editor' });
  });

  afterAll(async () => {
    await app.close();
  });

  async function createRunFor(tenantId: string, userId: string) {
    const { definition, version } = await createWorkflow({
      tenantId,
      userId,
      name: `realtime-${tenantId}`,
      dag: validDag() as unknown as WorkflowDagDefinition,
    });
    const { run } = await startRun({ tenantId, userId, workflowId: definition.id });
    return { run, version, definition };
  }

  describe('connection + authentication', () => {
    it('accepts a valid token for a run the caller\'s tenant owns', async () => {
      const editor = await createUser(tenantAId, 'editor');
      const { run } = await createRunFor(tenantAId, editor.id);

      const ws = await connect(`${baseWsUrl}/runs/${run.id}/stream?token=${editorAToken}`);
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    });

    it('rejects a connection with no token', async () => {
      const editor = await createUser(tenantAId, 'editor');
      const { run } = await createRunFor(tenantAId, editor.id);

      await expect(connect(`${baseWsUrl}/runs/${run.id}/stream`)).rejects.toMatchObject({ statusCode: 401 });
    });

    it('rejects a connection with an invalid/forged token', async () => {
      const editor = await createUser(tenantAId, 'editor');
      const { run } = await createRunFor(tenantAId, editor.id);

      await expect(connect(`${baseWsUrl}/runs/${run.id}/stream?token=not-a-real-jwt`)).rejects.toMatchObject({
        statusCode: 401,
      });
    });

    it('rejects an unknown run id', async () => {
      await expect(
        connect(`${baseWsUrl}/runs/00000000-0000-0000-0000-000000000000/stream?token=${editorAToken}`),
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('tenant isolation', () => {
    it('tenant B\'s valid token cannot subscribe to tenant A\'s run, even via its real run id', async () => {
      const editorA = await createUser(tenantAId, 'editor');
      const { run } = await createRunFor(tenantAId, editorA.id);

      await expect(connect(`${baseWsUrl}/runs/${run.id}/stream?token=${editorBToken}`)).rejects.toMatchObject({
        statusCode: 404,
      });
    });
  });

  describe('room isolation', () => {
    it('a client subscribed to run A never receives events published for run B', async () => {
      const editorA = await createUser(tenantAId, 'editor');
      const { run: runA } = await createRunFor(tenantAId, editorA.id);
      const { run: runB } = await createRunFor(tenantAId, editorA.id);

      const wsA = await connect(`${baseWsUrl}/runs/${runA.id}/stream?token=${editorAToken}`);
      const wsB = await connect(`${baseWsUrl}/runs/${runB.id}/stream?token=${editorAToken}`);

      const publisher = app.realtimePublisher;
      let crossLeak = false;
      wsA.once('message', () => {
        crossLeak = true;
      });

      const bMessage = nextMessage(wsB);
      publisher.publish(runB.id, { type: 'execution.started', runId: runB.id, tenantId: tenantAId });
      await bMessage;

      expect(crossLeak).toBe(false);
      wsA.close();
      wsB.close();
    });
  });

  describe('event publishing (executor -> realtime logger -> WS room)', () => {
    it('streams the full realtime event sequence for a linear run that succeeds', async () => {
      const editorA = await createUser(tenantAId, 'editor');
      const { run, version } = await createRunFor(tenantAId, editorA.id);

      const ws = await connect(`${baseWsUrl}/runs/${run.id}/stream?token=${editorAToken}`);
      const received: { type: string; seq: number }[] = [];
      const done = new Promise<void>((resolve) => {
        ws.on('message', (data) => {
          const event = JSON.parse(data.toString()) as { type: string; seq: number };
          received.push(event);
          if (event.type === 'execution.completed') resolve();
        });
      });

      const context = buildExecutionContext({
        runId: run.id,
        tenantId: tenantAId,
        workflowVersionId: version.id,
        status: 'pending',
        dag: version.dagDefinition,
      });
      const runStep: StepExecutor = async () => ({ status: 'succeeded' });
      const logger = createRealtimeExecutionLogger(app.realtimePublisher, { info: () => {}, error: () => {} });

      await executeRun(context, runStep, { logger });
      await done;

      expect(received.map((e) => e.type)).toEqual([
        'execution.started',
        'step.queued',
        'step.running',
        'step.succeeded',
        'step.queued',
        'step.running',
        'step.succeeded',
        'execution.completed',
      ]);
      expect(received.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      ws.close();
    });
  });
});
