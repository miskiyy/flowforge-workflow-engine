import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OverviewPage } from '../src/pages/OverviewPage.js';
import { renderWithProviders, seedAuth } from './testUtils.js';

function jsonResponse(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

function statsResponse() {
  return jsonResponse({
    activeRuns: 3,
    last24h: { total: 10, succeeded: 8, failed: 2, successRate: 0.8, avgDurationMs: 1500 },
  });
}

describe('OverviewPage', () => {
  it('shows the three primary actions', async () => {
    seedAuth('editor');
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => Promise.resolve(url.includes('/stats') ? statsResponse() : jsonResponse({ items: [], nextCursor: null }))),
    );

    renderWithProviders(<OverviewPage />);

    expect(screen.getByRole('link', { name: 'Generate' })).toHaveAttribute('href', '/workflows/new?mode=ai');
    expect(screen.getByRole('link', { name: 'New' })).toHaveAttribute('href', '/workflows/new');
    expect(screen.getByRole('link', { name: 'Examples' })).toHaveAttribute('href', '/workflows');
    await waitFor(() => expect(screen.getByTestId('recent-runs-empty')).toBeInTheDocument());
  });

  it('lists recent runs with the workflow name when runs exist', async () => {
    seedAuth('editor');
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/stats')) return Promise.resolve(statsResponse());
        if (url.includes('/runs')) {
          return Promise.resolve(
            jsonResponse({
              items: [
                {
                  id: 'run-1',
                  workflowId: 'w1',
                  workflowVersionId: 'v1',
                  triggerType: 'manual',
                  triggeredBy: 'u1',
                  status: 'succeeded',
                  startedAt: null,
                  finishedAt: null,
                  createdAt: new Date().toISOString(),
                },
              ],
              nextCursor: null,
            }),
          );
        }
        return Promise.resolve(jsonResponse({ items: [{ id: 'w1', name: 'hello-http', currentVersionId: 'v1', createdAt: '' }], nextCursor: null }));
      }),
    );

    renderWithProviders(<OverviewPage />);

    await waitFor(() => expect(screen.getByTestId('recent-runs')).toBeInTheDocument());
    expect(screen.getByText('hello-http')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/runs/run-1');
  });

  it('shows fleet stats from GET /stats', async () => {
    seedAuth('editor');
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => Promise.resolve(url.includes('/stats') ? statsResponse() : jsonResponse({ items: [], nextCursor: null }))),
    );

    renderWithProviders(<OverviewPage />);

    await waitFor(() => expect(screen.getByTestId('fleet-stats')).toBeInTheDocument());
    expect(screen.getByText('Active runs').nextSibling).toHaveTextContent('3');
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('1.5s')).toBeInTheDocument();
  });
});
