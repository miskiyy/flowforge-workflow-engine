import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { serializeRun, serializeStepRun } from '../execution/routes.js';
import { startRun } from '../execution/repository.js';
import { NotFoundError, TooManyRequestsError } from '../lib/errors.js';
import { TokenBucketLimiter } from '../lib/rate-limit.js';
import { getWorkflowByWebhookToken } from '../workflows/repository.js';

const WebhookParams = Type.Object({ token: Type.String({ format: 'uuid' }) });

/**
 * Task.md:102 — `POST /webhooks/:token`, opaque token auth, not JWT. No
 * `app.authenticate`/`app.requireWrite` here on purpose: the token itself
 * *is* the credential, and it names its own tenant (getWorkflowByWebhookToken
 * looks the row up with no tenant filter, same posture as the JWT-scoped
 * routes but inverted — here the secret picks the tenant instead of a
 * pre-authenticated caller).
 */
export function registerWebhookRoutes(app: FastifyInstance): void {
  // Keyed by token, not by IP/tenant — a leaked or brute-forced token is the
  // only thing this route can be abused through, so that's what gets throttled.
  const limiter = new TokenBucketLimiter({ capacity: 20, refillPerSecond: 5 });

  app.post('/webhooks/:token', { schema: { params: WebhookParams } }, async (request: FastifyRequest, reply) => {
    const { token } = request.params as { token: string };

    if (!limiter.consume(token)) throw new TooManyRequestsError();

    const workflow = await getWorkflowByWebhookToken(token);
    if (!workflow) throw new NotFoundError('No workflow is registered for this webhook token');

    const idempotencyKey = request.headers['idempotency-key'];
    const result = await startRun({
      tenantId: workflow.tenantId,
      workflowId: workflow.id,
      triggerType: 'webhook',
      ...(typeof idempotencyKey === 'string' ? { idempotencyKey } : {}),
    });

    return reply.status(result.deduped ? 200 : 201).send({
      run: serializeRun(result.run),
      steps: result.steps.map(serializeStepRun),
      deduped: result.deduped,
    });
  });
}
