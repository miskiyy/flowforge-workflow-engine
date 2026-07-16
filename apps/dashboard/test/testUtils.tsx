import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, type UserRole } from '../src/auth/AuthProvider.js';
import { ToastProvider } from '../src/components/Toast.js';

export function fakeJwt(claims: Record<string, unknown>): string {
  const payload = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `header.${payload}.sig`;
}

/** Must be called before rendering — AuthProvider reads localStorage synchronously on mount. */
export function seedAuth(role: UserRole = 'editor', email = 'user@example.com'): void {
  const token = fakeJwt({ tenantId: 't1', userId: 'u1', role });
  localStorage.setItem('flowforge_auth', JSON.stringify({ token, email }));
}

/** `routePath` (e.g. "/workflows/:id") registers `ui` on a real route so useParams resolves against `route`. */
export function renderWithProviders(ui: ReactElement, { route = '/', routePath }: { route?: string; routePath?: string } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={[route]}>
            {routePath ? (
              <Routes>
                <Route path={routePath} element={ui} />
              </Routes>
            ) : (
              ui
            )}
          </MemoryRouter>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}
