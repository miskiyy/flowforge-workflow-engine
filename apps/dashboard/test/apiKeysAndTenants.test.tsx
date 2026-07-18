import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from '../src/pages/SettingsPage.js';
import { TenantSwitcher } from '../src/components/TenantSwitcher.js';
import { fakeJwt, renderWithProviders, seedAuth } from './testUtils.js';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

function stubFetch(routes: Record<string, (init?: RequestInit) => unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const match = Object.keys(routes).find((key) => url.includes(key));
      if (!match) return Promise.reject(new Error(`Unhandled: ${url}`));
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(routes[match]!(init)) });
    }),
  );
}

describe('SettingsPage — API keys', () => {
  it('gates the whole panel behind the admin role', () => {
    seedAuth('editor');
    stubFetch({ '/api-keys': () => ({ items: [] }) });
    renderWithProviders(<SettingsPage />);
    expect(screen.getByText('Admins only')).toBeInTheDocument();
  });

  it('creates a key and reveals the plaintext secret exactly once', async () => {
    seedAuth('admin');
    stubFetch({
      '/api-keys': (init) =>
        init?.method === 'POST'
          ? { apiKey: { id: 'k1', label: 'ci', prefix: 'ff_abc123', role: 'editor', createdAt: '', lastUsedAt: null }, secret: 'ff_the-real-secret' }
          : { items: [] },
    });

    renderWithProviders(<SettingsPage />);
    fireEvent.change(await screen.findByLabelText('API key label'), { target: { value: 'ci' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate key' }));

    await waitFor(() => expect(screen.getByTestId('fresh-secret')).toHaveTextContent('ff_the-real-secret'));
  });
});

describe('TenantSwitcher', () => {
  it('renders nothing when the user belongs to a single tenant', async () => {
    seedAuth('admin');
    stubFetch({ '/me/tenants': () => ({ tenants: [{ tenantId: 't1', tenantName: 'Solo', role: 'admin' }] }) });
    const { container } = renderWithProviders(<TenantSwitcher />);
    await waitFor(() => expect(container.querySelector('select')).toBeNull());
  });

  it('switches tenant, applying the new token to the session', async () => {
    seedAuth('admin');
    const newToken = fakeJwt({ tenantId: 't2', userId: 'u1', role: 'viewer' });
    stubFetch({
      '/me/tenants': () => ({
        tenants: [
          { tenantId: 't1', tenantName: 'Home', role: 'admin' },
          { tenantId: 't2', tenantName: 'Other', role: 'viewer' },
        ],
      }),
      '/auth/switch-tenant': () => ({ accessToken: newToken }),
    });

    renderWithProviders(<TenantSwitcher />);
    const select = (await screen.findByLabelText('Switch workspace')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 't2' } });

    await waitFor(() => expect(JSON.parse(localStorage.getItem('flowforge_auth')!).token).toBe(newToken));
  });
});
