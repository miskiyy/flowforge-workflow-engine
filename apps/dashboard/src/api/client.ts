import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { clearStoredAuth } from '../auth/AuthProvider.js';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

/** Extends the api.ts-era `FetchRunError` idea (frontend-design.md §1, §7): parses the frozen `{ error: { code, message, details? } }` envelope once, centrally. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }
}

async function parseErrorBody(res: Response): Promise<ApiErrorBody> {
  try {
    const json = (await res.json()) as { error?: ApiErrorBody };
    if (json.error) return json.error;
  } catch {
    // body wasn't JSON (or was empty) — fall through to a generic message
  }
  return { code: 'UNKNOWN_ERROR', message: `HTTP ${res.status}` };
}

export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  token?: string;
  body?: unknown;
  /** Overrides the env-configured origin — only `runs.ts#fetchRun` needs this, kept parameterized for `useRunStream`'s tests. */
  baseUrl?: string;
}

/** Every resource module (workflows.ts, runs.ts, ai.ts) calls through here — components never call `fetch` directly. */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { token, body, baseUrl, headers, ...init } = options;
  const res = await fetch(`${baseUrl ?? API_URL}${path}`, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) throw new ApiError(res.status, await parseErrorBody(res));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function toQueryString(query: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query as Record<string, string | number | undefined>)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** Any 401 from any query/mutation → clear auth → redirect, handled once here rather than per-screen (§5). */
function handleGlobalAuthError(error: unknown): void {
  if (error instanceof ApiError && error.status === 401) {
    clearStoredAuth();
    const next = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
    window.location.assign(`/login?next=${next}`);
  }
}

/** Never retry a 4xx (it won't fix itself); 2x exponential backoff on 5xx/network (§7). */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status < 500) return false;
  return failureCount < 2;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({ onError: handleGlobalAuthError }),
    mutationCache: new MutationCache({ onError: handleGlobalAuthError }),
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        staleTime: 30_000,
      },
    },
  });
}
