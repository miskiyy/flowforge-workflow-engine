import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { env, type AiProvider } from '../config.js';
import { AppError, TooManyRequestsError } from '../lib/errors.js';
import { TokenBucketLimiter } from '../lib/rate-limit.js';
import { OpenRouterProposer } from './openrouter.js';
import { MockProposer, type DagProposer } from './provider.js';
import { proposeDag, ProposalCache } from './propose.js';

const ProposeParams = Type.Object({ id: Type.Union([Type.Literal('new'), Type.String({ format: 'uuid' })]) });
const ProposeBody = Type.Object({
  prompt: Type.String({ minLength: 1, maxLength: 2000 }),
  baseVersionId: Type.Optional(Type.String({ format: 'uuid' })),
});

export interface RegisterAiRoutesOptions {
  /** Injected in tests (MockProposer with scripted responses); defaults to a config-driven provider otherwise. */
  provider?: DagProposer;
}

export type ProviderResolution = { ok: true; provider: DagProposer } | { ok: false; reason: string };

/**
 * Pure — no Fastify, no module-level `env` read — so the "openrouter with no
 * key" failure mode is directly unit-testable. `AI_PROVIDER=openrouter` with
 * no key fails *here*, at route registration — not at config load (config.ts
 * keeps the key optional) — and does not crash the app: the caller
 * (registerAiRoutes) skips registering the AI routes and lets the rest of
 * the API boot normally (ai-subsystem-design.md §15's "AI routes absent;
 * API boots" blast radius).
 */
export function resolveProvider(config: { aiProvider: AiProvider; openrouterApiKey?: string; aiModel: string }): ProviderResolution {
  if (config.aiProvider === 'mock') return { ok: true, provider: new MockProposer() };

  if (!config.openrouterApiKey) {
    return {
      ok: false,
      reason: 'AI_PROVIDER=openrouter but OPENROUTER_API_KEY is not set — AI routes will not be registered',
    };
  }
  return { ok: true, provider: new OpenRouterProposer({ apiKey: config.openrouterApiKey, model: config.aiModel }) };
}

export function registerAiRoutes(app: FastifyInstance, options: RegisterAiRoutesOptions = {}): void {
  let provider = options.provider;
  if (!provider) {
    const resolution = resolveProvider({
      aiProvider: env.aiProvider,
      ...(env.openrouterApiKey !== undefined ? { openrouterApiKey: env.openrouterApiKey } : {}),
      aiModel: env.aiModel,
    });
    if (!resolution.ok) {
      app.log.error(resolution.reason);
      return;
    }
    provider = resolution.provider;
  }

  const cache = new ProposalCache();
  // A separate, far tighter bucket than CRUD's {50, 25} — this resource costs
  // money/time and free-tier traffic will hit its cap. Per-app instance, not
  // module-level, matching workflows/routes.ts's convention so tests never
  // share state (ai-subsystem-design.md §11).
  const limiter = new TokenBucketLimiter({ capacity: 5, refillPerSecond: 0.05 });

  const rateLimit = async (request: FastifyRequest): Promise<void> => {
    if (!limiter.consume(request.authUser.tenantId)) {
      throw new TooManyRequestsError();
    }
  };

  // authenticate -> requireWrite -> rate limit, in that order (not CRUD's
  // auth -> rateLimit -> requireWrite): a viewer must never consume AI
  // budget just by being rejected — reject the role before touching the
  // bucket (ai-subsystem-design.md §1, §2).
  const proposeGuard = [app.authenticate, app.requireWrite, rateLimit];

  app.post(
    '/workflows/:id/propose',
    { schema: { params: ProposeParams, body: ProposeBody }, preHandler: proposeGuard },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = request.body as { prompt: string; baseVersionId?: string };

      if (id === 'new' && body.baseVersionId !== undefined) {
        throw new AppError(400, 'VALIDATION_ERROR', 'baseVersionId must be omitted when proposing a new workflow');
      }
      if (id !== 'new' && body.baseVersionId === undefined) {
        throw new AppError(400, 'VALIDATION_ERROR', 'baseVersionId is required unless proposing a new workflow');
      }

      return proposeDag(
        {
          tenantId: request.authUser.tenantId,
          workflowId: id,
          ...(body.baseVersionId !== undefined ? { baseVersionId: body.baseVersionId } : {}),
          prompt: body.prompt,
        },
        { provider, cache, model: env.aiModel },
      );
    },
  );
}
