import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';

function fakeJwt(claims: Record<string, unknown>): string {
  const payload = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `header.${payload}.sig`;
}

const CLAIMS = { tenantId: 't1', userId: 'u1', role: 'editor' };

function stubAuthAndWorkflowsFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (url.includes('/auth/login')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ accessToken: fakeJwt(CLAIMS) }) });
      }
      if (url.includes('/runs') || url.includes('/workflows')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [], nextCursor: null }) });
      }
      return Promise.reject(new Error(`Unhandled request: ${init?.method ?? 'GET'} ${url}`));
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  window.history.pushState({}, '', '/');
});

describe('App routing + auth', () => {
  it('redirects an unauthenticated visitor from a protected route to /login with a next param', async () => {
    window.history.pushState({}, '', '/runs/run-1');
    render(<App />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument());
    expect(window.location.pathname).toBe('/login');
    expect(window.location.search).toContain('next=%2Fruns%2Frun-1');
  });

  it('logs in, stores the session, and lands on the overview (default landing)', async () => {
    window.history.pushState({}, '', '/login');
    stubAuthAndWorkflowsFetch();

    render(<App />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'editor@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Build, run, and watch workflows' })).toBeInTheDocument());
    expect(screen.getByTestId('user-email')).toHaveTextContent('editor@example.com');
    expect(localStorage.getItem('flowforge_auth')).toContain('editor@example.com');
  });

  it('shows an inline error and clears the password on a failed login', async () => {
    window.history.pushState({}, '', '/login');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' } }),
      }),
    );

    render(<App />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument());

    const passwordInput = screen.getByLabelText('Password') as HTMLInputElement;
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'editor@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(screen.getByTestId('login-error')).toHaveTextContent('Invalid email or password'));
    expect(passwordInput.value).toBe('');
  });

  it('moves focus to the new page\'s <h1> on route change (SPA navigation strands screen-reader focus otherwise)', async () => {
    localStorage.setItem('flowforge_auth', JSON.stringify({ token: fakeJwt(CLAIMS), email: 'editor@example.com' }));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ items: [], nextCursor: null }) }),
    );

    render(<App />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Build, run, and watch workflows' })).toBeInTheDocument());
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Build, run, and watch workflows' }));

    fireEvent.click(screen.getByRole('link', { name: 'Runs' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Runs' })).toBeInTheDocument());
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Runs' }));
  });

  it('logs out and returns to /login', async () => {
    localStorage.setItem('flowforge_auth', JSON.stringify({ token: fakeJwt(CLAIMS), email: 'editor@example.com' }));
    window.history.pushState({}, '', '/');
    stubAuthAndWorkflowsFetch();

    render(<App />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Build, run, and watch workflows' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument());
    expect(localStorage.getItem('flowforge_auth')).toBeNull();
  });
});
