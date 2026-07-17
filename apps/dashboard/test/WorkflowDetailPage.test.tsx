import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { AuthProvider } from '../src/auth/AuthProvider.js';
import { ToastProvider } from '../src/components/Toast.js';
import { WorkflowDetailPage } from '../src/pages/WorkflowDetailPage.js';
import { renderWithProviders, seedAuth } from './testUtils.js';

const dag = { steps: [{ key: 'a', type: 'delay' as const, dependsOn: [], durationMs: 1 }] };

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body) };
}

function makeFetchMock() {
  return vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url.endsWith('/workflows/w1') && method === 'GET') {
      return Promise.resolve(
        jsonResponse({
          workflow: { id: 'w1', name: 'nightly-etl', currentVersionId: 'v1', cronExpression: null, createdAt: '2026-01-01T00:00:00Z' },
          version: { id: 'v1', workflowId: 'w1', versionNumber: 1, dag, createdBy: 'u1', createdAt: '2026-01-01T00:00:00Z' },
        }),
      );
    }
    if (url.endsWith('/workflows/w1/versions') && method === 'GET') {
      return Promise.resolve(
        jsonResponse({
          items: [
            { id: 'v1', workflowId: 'w1', versionNumber: 1, dag, createdBy: 'u1', createdAt: '2026-01-01T00:00:00Z' },
            { id: 'v2', workflowId: 'w1', versionNumber: 2, dag, createdBy: 'u1', createdAt: '2026-01-02T00:00:00Z' },
          ],
          nextCursor: null,
        }),
      );
    }
    if (url.includes('/runs?') && method === 'GET') {
      return Promise.resolve(jsonResponse({ items: [], nextCursor: null }));
    }
    if (url.includes('/rollback/') && method === 'POST') {
      return Promise.resolve(jsonResponse({ workflow: {}, version: {} }));
    }
    if (url.endsWith('/workflows/w1/trigger') && method === 'POST') {
      return Promise.resolve(jsonResponse({ run: { id: 'run-9', status: 'pending' }, steps: [] }, true, 201));
    }
    if (url.endsWith('/workflows/w1') && method === 'DELETE') {
      return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve(undefined) });
    }
    return Promise.reject(new Error(`Unhandled request: ${method} ${url}`));
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function selectSecondVersion() {
  await waitFor(() => expect(screen.getAllByTestId('version-row')).toHaveLength(2));
  fireEvent.click(screen.getAllByTestId('version-row')[1]!);
  await waitFor(() => expect(screen.getByTestId('rollback-button')).toBeInTheDocument());
}

describe('WorkflowDetailPage', () => {
  it('rolls back after confirmation, posting to the rollback endpoint', async () => {
    seedAuth('editor');
    const fetchMock = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<WorkflowDetailPage />, { route: '/workflows/w1', routePath: '/workflows/:id' });

    await selectSecondVersion();
    fireEvent.click(screen.getByTestId('rollback-button'));
    await waitFor(() => expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Roll back' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/workflows/w1/rollback/v2'),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('reverts and shows a toast when a rollback fails', async () => {
    seedAuth('editor');
    const okFetch = makeFetchMock();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url.includes('/rollback/') && method === 'POST') {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
      }
      return okFetch(url, init);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<WorkflowDetailPage />, { route: '/workflows/w1', routePath: '/workflows/:id' });

    await selectSecondVersion();
    fireEvent.click(screen.getByTestId('rollback-button'));
    await waitFor(() => expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Roll back' }));

    await waitFor(() => expect(screen.getByTestId('toast')).toBeInTheDocument());
    expect(screen.getByTestId('toast')).toHaveTextContent('Rollback failed');
  });

  it('requires confirmation before deleting', async () => {
    seedAuth('editor');
    const fetchMock = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<WorkflowDetailPage />, { route: '/workflows/w1', routePath: '/workflows/:id' });

    await waitFor(() => expect(screen.getByTestId('delete-button')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('delete-button'));
    await waitFor(() => expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument());

    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/workflows/w1'), expect.objectContaining({ method: 'DELETE' }));

    fireEvent.click(within(screen.getByTestId('confirm-dialog')).getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/workflows/w1'), expect.objectContaining({ method: 'DELETE' })),
    );
  });

  it('triggers a run and navigates to its run detail route', async () => {
    seedAuth('editor');
    const fetchMock = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function RunMarker() {
      const { id } = useParams<{ id: string }>();
      return <p data-testid="landed-on-run">{id}</p>;
    }
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthProvider>
            <MemoryRouter initialEntries={['/workflows/w1']}>
              <Routes>
                <Route path="/workflows/:id" element={<WorkflowDetailPage />} />
                <Route path="/runs/:id" element={<RunMarker />} />
              </Routes>
            </MemoryRouter>
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('trigger-button')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('trigger-button'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/workflows/w1/trigger'), expect.objectContaining({ method: 'POST' })),
    );
    await waitFor(() => expect(screen.getByTestId('landed-on-run')).toHaveTextContent('run-9'));
  });

  it('hides rollback and delete controls for a viewer', async () => {
    seedAuth('viewer');
    vi.stubGlobal('fetch', makeFetchMock());

    renderWithProviders(<WorkflowDetailPage />, { route: '/workflows/w1', routePath: '/workflows/:id' });

    await waitFor(() => expect(screen.getAllByTestId('version-row')).toHaveLength(2));
    expect(screen.queryByTestId('delete-button')).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByTestId('version-row')[1]!);
    expect(screen.queryByTestId('rollback-button')).not.toBeInTheDocument();
  });
});
