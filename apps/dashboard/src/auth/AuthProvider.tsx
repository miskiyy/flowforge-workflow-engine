import { createContext, useCallback, useMemo, useState, type ReactNode } from 'react';

/**
 * Mirrors apps/api/src/auth/plugin.ts's AuthUser (JWT payload shape).
 * Duplicated rather than imported — same rationale as realtime/types.ts:
 * the API and dashboard are separate deployables.
 */
export type UserRole = 'admin' | 'editor' | 'viewer';

export interface AuthClaims {
  tenantId: string;
  userId: string;
  role: UserRole;
}

export interface AuthUser extends AuthClaims {
  email: string;
}

export class LoginError extends Error {}

export interface AuthContextValue {
  token: string | null;
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = 'flowforge_auth';
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

/**
 * The JWT carries tenantId/userId/role but not email (see plugin.ts) — email
 * is captured at login time and persisted alongside the token so the user
 * menu (§4) survives a refresh.
 */
function decodeClaims(token: string): AuthClaims | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64)) as AuthClaims;
  } catch {
    return null;
  }
}

interface StoredAuth {
  token: string;
  email: string;
}

/** Used by the React Query client's global 401 handler (§5, §7) — outside React, so it can't call `logout()` from context. */
export function clearStoredAuth(): void {
  localStorage.removeItem(STORAGE_KEY);
}

function readStoredAuth(): { token: string | null; user: AuthUser | null } {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { token: null, user: null };
  try {
    const { token, email } = JSON.parse(raw) as StoredAuth;
    const claims = decodeClaims(token);
    if (!claims) return { token: null, user: null };
    return { token, user: { ...claims, email } };
  } catch {
    return { token: null, user: null };
  }
}

/**
 * Session tier (frontend-design.md §6): read by nearly every component,
 * changes ~twice per session — Context's re-render cost is irrelevant at
 * that frequency, so no separate state library is warranted.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(readStoredAuth);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const body = (await res.json().catch(() => null)) as { accessToken?: string; error?: { message: string } } | null;

    if (!res.ok) {
      throw new LoginError(body?.error?.message ?? `Login failed: HTTP ${res.status}`);
    }

    const token = body?.accessToken;
    const claims = token ? decodeClaims(token) : null;
    if (!token || !claims) {
      throw new LoginError('Login response was missing a valid token');
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, email } satisfies StoredAuth));
    setState({ token, user: { ...claims, email } });
  }, []);

  const logout = useCallback(() => {
    clearStoredAuth();
    setState({ token: null, user: null });
  }, []);

  const value = useMemo<AuthContextValue>(() => ({ token: state.token, user: state.user, login, logout }), [state, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
