import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { WebSocketServer } from 'ws';
import type { AuthUser } from '../auth/plugin.js';
import { getRun } from '../execution/repository.js';
import { AppError } from '../lib/errors.js';
import { RunPublisher } from './publisher.js';

declare module 'fastify' {
  interface FastifyInstance {
    realtimePublisher: RunPublisher;
  }
}

const RUN_STREAM_PATH = /^\/runs\/([^/]+)\/stream$/;

function rejectUpgrade(socket: Duplex, statusCode: number, message: string): void {
  socket.write(`HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

/**
 * `WS /runs/:id/stream` — hand-rolled on the raw `ws` library against
 * Fastify's underlying http.Server (Task.md's locked "native WebSocket (ws)"
 * choice), rather than a Fastify plugin, since this is the one realtime
 * route in the app. Browsers can't set custom headers on the WebSocket
 * handshake, so the JWT travels as a `?token=` query param instead of the
 * `Authorization` header the REST routes use — verified with the same
 * `app.jwt` instance `auth/plugin.ts` already registers, so there is no
 * second auth implementation. A connection is only admitted to a run's room
 * once the token's tenant is confirmed (via the existing tenant-scoped
 * `getRun`) to own that run — the same 404-not-403 cross-tenant behavior as
 * the REST history endpoints, so a WS probe can't distinguish "wrong tenant"
 * from "run doesn't exist".
 */
export function registerRealtimeGateway(app: FastifyInstance): RunPublisher {
  const publisher = new RunPublisher();
  app.decorate('realtimePublisher', publisher);

  const wss = new WebSocketServer({ noServer: true });

  app.server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    handleUpgrade(req, socket, head).catch((err: unknown) => {
      app.log.error(err);
      rejectUpgrade(socket, 500, 'Internal Server Error');
    });
  });

  async function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const url = new URL(req.url ?? '', 'http://internal');
    const match = RUN_STREAM_PATH.exec(url.pathname);
    if (!match) {
      rejectUpgrade(socket, 404, 'Not Found');
      return;
    }
    const runId = match[1] as string;

    const token = url.searchParams.get('token');
    if (!token) {
      rejectUpgrade(socket, 401, 'Unauthorized');
      return;
    }

    let authUser: AuthUser;
    try {
      authUser = app.jwt.verify<AuthUser>(token);
    } catch {
      rejectUpgrade(socket, 401, 'Unauthorized');
      return;
    }

    try {
      await getRun(authUser.tenantId, runId);
    } catch (err) {
      const statusCode = err instanceof AppError ? err.statusCode : 500;
      if (statusCode >= 500) app.log.error(err);
      rejectUpgrade(socket, statusCode, statusCode === 404 ? 'Not Found' : 'Internal Server Error');
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      publisher.join(runId, ws);
      ws.on('close', () => publisher.leave(runId, ws));
    });
  }

  return publisher;
}
