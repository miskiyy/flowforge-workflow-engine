import cors from '@fastify/cors';
import type { Ajv } from 'ajv';
import * as ajvFormats from 'ajv-formats';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAiRoutes } from './ai/routes.js';
import type { DagProposer } from './ai/provider.js';
import { registerAuth } from './auth/plugin.js';
import { registerAuthRoutes } from './auth/routes.js';
import { registerExecutionRoutes } from './execution/routes.js';
import { registerErrorHandler } from './lib/errors.js';
import { registerRealtimeGateway } from './realtime/gateway.js';
import { registerWebhookRoutes } from './webhooks/routes.js';
import { registerWorkflowRoutes } from './workflows/routes.js';

export interface BuildAppOptions {
  logger?: boolean;
  /** Test-only injection point — a MockProposer with scripted responses. Defaults to the config-driven provider (ai/routes.ts). */
  aiProvider?: DagProposer;
}

// ajv-formats ships a nested copy of ajv's types for its peer dependency, so
// its default export's declared type doesn't structurally match the `Ajv`
// fastify's ajv-compiler expects — cast to the plugin call signature it
// actually has (same workaround used in workflows/dag-validation.ts).
const addFormats = ajvFormats.default as unknown as (instance: Ajv) => Ajv;

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? process.env.NODE_ENV !== 'test',
    // Registers ajv-formats on Fastify's own route-schema validator so
    // `format: 'email' | 'uri'` (used by route bodies) is actually enforced,
    // not silently ignored.
    ajv: { plugins: [addFormats] },
  });

  const configuredOrigins = process.env.CORS_ORIGIN?.split(',');
  app.register(cors, {
    origin: configuredOrigins ?? (process.env.NODE_ENV === 'production' ? false : true),
  });

  registerErrorHandler(app);
  registerAuth(app);
  registerAuthRoutes(app);
  registerWorkflowRoutes(app);
  registerExecutionRoutes(app);
  registerWebhookRoutes(app);
  registerRealtimeGateway(app);
  // The one line outside ai/ that knows it exists — delete src/ai/ and everything above still works.
  registerAiRoutes(app, options.aiProvider ? { provider: options.aiProvider } : {});

  app.get('/health', async () => {
    return { status: 'ok' };
  });

  return app;
}
