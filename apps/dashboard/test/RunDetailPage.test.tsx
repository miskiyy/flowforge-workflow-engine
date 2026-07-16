import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../src/auth/AuthProvider.js';
import { ToastProvider } from '../src/components/Toast.js';
import { RunDetailPage } from '../src/pages/RunDetailPage.js';
import { MockWebSocket } from './mockWebSocket.js';
import { seedAuth } from './testUtils.js';

const dag = { steps: [{ key: 'a', type: 'delay' as const, dependsOn: [], durationMs: 1 }] };

function renderPage(props: { apiUrl?: string; runId?: string; token?: string } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <RunDetailPage apiUrl={props.apiUrl ?? 'http://api.test'} runId={props.runId ?? 'run-1'} token={props.token ?? 'tok-123'} />
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { queryClient, ...result };
}

describe('RunDetailPage', () => {
  beforeEach(() => {
    seedAuth('editor');
    MockWebSocket.reset();
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            run: { id: 'run-1', status: 'running' },
            dag,
            steps: [{ stepKey: 'a', status: 'pending', attemptNumber: 1, error: null }],
          }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('shows a loading state, then the graph/badges/progress/timeline once the run loads', async () => {
    renderPage();

    expect(screen.getByTestId('live-run-loading')).toBeInTheDocument();

    await waitFor(() => expect(screen.getByTestId('workflow-graph')).toBeInTheDocument());
    expect(screen.getByTestId('run-status')).toHaveTextContent('running');
    expect(screen.getByTestId('progress-label')).toHaveTextContent('0 / 1 steps complete');
    expect(screen.getByTestId('timeline-empty')).toBeInTheDocument();
  });

  it('shows a "waiting for a worker" message instead of the graph while the run is pending', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ run: { id: 'run-1', status: 'pending' }, dag, steps: [] }),
      }),
    );

    renderPage();

    await waitFor(() => expect(screen.getByTestId('run-pending')).toBeInTheDocument());
    expect(screen.getByTestId('run-pending')).toHaveTextContent('Waiting for a worker to pick this up');
    expect(screen.queryByTestId('workflow-graph')).not.toBeInTheDocument();
  });

  it('updates the graph node, status badge, progress, and timeline live as WS events arrive', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('workflow-graph')).toBeInTheDocument());
    act(() => MockWebSocket.latest().simulateOpen());

    act(() => {
      MockWebSocket.latest().simulateMessage({
        type: 'step.running',
        runId: 'run-1',
        tenantId: 't1',
        seq: 1,
        ts: '2026-07-15T00:00:00.000Z',
        stepKey: 'a',
        attemptNumber: 1,
      });
    });

    await waitFor(() => {
      const node = screen.getAllByTestId('graph-node').find((n) => n.dataset.stepKey === 'a')!;
      expect(node.dataset.status).toBe('running');
    });
    expect(screen.getByTestId('status-badge')).toHaveTextContent('Running');
    expect(screen.getByTestId('progress-label')).toHaveTextContent('0 / 1 steps complete');
    expect(screen.getByTestId('timeline-entry')).toHaveTextContent('Step "a" running');

    act(() => {
      MockWebSocket.latest().simulateMessage({
        type: 'step.succeeded',
        runId: 'run-1',
        tenantId: 't1',
        seq: 2,
        ts: '2026-07-15T00:00:01.000Z',
        stepKey: 'a',
        attemptNumber: 1,
      });
    });

    await waitFor(() => {
      const node = screen.getAllByTestId('graph-node').find((n) => n.dataset.stepKey === 'a')!;
      expect(node.dataset.status).toBe('succeeded');
    });
    expect(screen.getByTestId('progress-label')).toHaveTextContent('1 / 1 steps complete');
  });

  it('shows an error state instead of the graph when the run cannot be loaded (e.g. a 404)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve({}) }));

    renderPage({ runId: 'missing-run' });

    await waitFor(() => expect(screen.getByTestId('live-run-error')).toBeInTheDocument());
    expect(screen.getByTestId('live-run-error')).toHaveTextContent('404');
    expect(screen.queryByTestId('workflow-graph')).not.toBeInTheDocument();
    expect(screen.queryByTestId('live-run-loading')).not.toBeInTheDocument();
    expect(screen.getByTestId('connection-status')).toHaveTextContent("Couldn't load this run.");
  });

  it('shows a resync hint and keeps the last-known graph mounted while reconnecting', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('workflow-graph')).toBeInTheDocument());
    act(() => MockWebSocket.latest().simulateOpen());

    act(() => MockWebSocket.latest().simulateServerClose());

    await waitFor(() => expect(screen.getByTestId('connection-status')).toHaveTextContent('Reconnecting…'));
    expect(screen.getByTestId('resync-hint')).toBeInTheDocument();
    expect(screen.getByTestId('workflow-graph')).toBeInTheDocument(); // never unmounted
  });

  it('lazily fetches and renders per-step logs when a step row is expanded', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/steps/a/logs')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              items: [{ ts: '2026-07-15T00:00:00.000Z', level: 'error', message: 'connect ETIMEDOUT' }],
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            run: { id: 'run-1', status: 'running' },
            dag,
            steps: [{ stepKey: 'a', status: 'running', attemptNumber: 2, error: null }],
          }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    await waitFor(() => expect(screen.getByTestId('workflow-graph')).toBeInTheDocument());

    // nothing fetched until the row is opened
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/logs'))).toBe(false);

    const row = screen.getByTestId('step-status-row');
    act(() => {
      (row as HTMLDetailsElement).open = true;
      row.dispatchEvent(new Event('toggle'));
    });

    await waitFor(() => expect(screen.getByTestId('step-logs')).toBeInTheDocument());
    expect(screen.getByText('connect ETIMEDOUT')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/runs/run-1/steps/a/logs'))).toBe(true);
  });

  it('shows a Cancel run button for a running run, confirms, and posts the cancel request', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && String(url).includes('/cancel')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ run: { id: 'run-1', status: 'running' }, cancelledImmediately: false }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            run: { id: 'run-1', status: 'running' },
            dag,
            steps: [{ stepKey: 'a', status: 'running', attemptNumber: 1, error: null }],
          }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel run' })).toBeInTheDocument());

    act(() => screen.getByRole('button', { name: 'Cancel run' }).click());
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();

    act(() => within(screen.getByTestId('confirm-dialog')).getByRole('button', { name: 'Cancel run' }).click());

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes('/runs/run-1/cancel') && init?.method === 'POST')).toBe(
        true,
      ),
    );
  });

  it('does not show a Cancel run button once the run is terminal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            run: { id: 'run-1', status: 'succeeded' },
            dag,
            steps: [{ stepKey: 'a', status: 'succeeded', attemptNumber: 1, error: null }],
          }),
      }),
    );

    renderPage();
    await waitFor(() => expect(screen.getByTestId('workflow-graph')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Cancel run' })).not.toBeInTheDocument();
  });

  it('invalidates the run history cache once the run reaches a terminal state', async () => {
    const { queryClient } = renderPage();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    await waitFor(() => expect(screen.getByTestId('workflow-graph')).toBeInTheDocument());
    act(() => MockWebSocket.latest().simulateOpen());

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            run: { id: 'run-1', status: 'succeeded' },
            dag,
            steps: [{ stepKey: 'a', status: 'succeeded', attemptNumber: 1, error: null }],
          }),
      }),
    );

    act(() => {
      MockWebSocket.latest().simulateMessage({
        type: 'execution.completed',
        runId: 'run-1',
        tenantId: 't1',
        seq: 1,
        ts: '2026-07-15T00:00:02.000Z',
      });
    });

    await waitFor(() => expect(screen.getByTestId('run-status')).toHaveTextContent('succeeded'));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['runs'] });
  });
});
