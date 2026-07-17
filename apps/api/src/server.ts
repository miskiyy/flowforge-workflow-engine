import { buildApp } from './app.js';
import { startWorkerPool } from './execution/worker.js';
import { createRealtimeExecutionLogger } from './realtime/publisher.js';
import { startCronScheduler } from './scheduling/scheduler.js';

const app = buildApp();
const port = Number(process.env.PORT ?? 3000);

// Started only from the real process entrypoint, never from app.ts (which
// tests build directly via buildApp()) — otherwise the worker pool would
// race the 170+ tests that assert a run stays 'pending' right after trigger.
// createRealtimeExecutionLogger wraps the default consoleExecutionLogger
// (not app.log directly: Fastify's pino logger takes (mergingObject, msg),
// the inverse of ExecutionLogger's (event, fields)) so a run executed by the
// worker also fans its events out to the same run_id WS rooms
// registerRealtimeGateway already set up on `app`.
const workerPool = startWorkerPool({ logger: createRealtimeExecutionLogger(app.realtimePublisher) });
const cronScheduler = startCronScheduler({ logger: createRealtimeExecutionLogger(app.realtimePublisher) });

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

async function shutdown(signal: string) {
  app.log.info({ signal }, 'shutting down');
  cronScheduler.stop();
  await workerPool.stop();
  await app.close();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
