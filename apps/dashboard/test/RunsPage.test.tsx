import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunsPage } from '../src/pages/RunsPage.js';
import { renderWithProviders, seedAuth } from './testUtils.js';

function jsonResponse(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) };
}

/** RunsPage renders both GET /runs and GET /stats (the merged health grid) — every stub must answer both. */
function statsResponse() {
  return jsonResponse({
    activeRuns: 0,
    last24h: { total: 0, succeeded: 0, failed: 0, successRate: null, avgDurationMs: null },
  });
}

function stubRunsAndStats(runsBody: unknown) {
  const fetchMock = vi.fn((url: string) => Promise.resolve(url.includes('/stats') ? statsResponse() : jsonResponse(runsBody)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('RunsPage', () => {
  it('renders a row per run', async () => {
    seedAuth('editor');
    stubRunsAndStats({
      items: [
        {
          id: 'run-1',
          workflowId: 'w1',
          workflowVersionId: 'v1',
          triggerType: 'manual',
          triggeredBy: 'u1',
          status: 'succeeded',
          startedAt: '2026-01-01T00:00:00.000Z',
          finishedAt: '2026-01-01T00:00:05.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    });

    renderWithProviders(<RunsPage />);

    await waitFor(() => expect(screen.getAllByTestId('data-table-row')).toHaveLength(1));
    expect(screen.getByText('5.0s')).toBeInTheDocument();
  });

  it('puts the status filter on the request query string', async () => {
    seedAuth('editor');
    const fetchMock = stubRunsAndStats({ items: [], nextCursor: null });

    renderWithProviders(<RunsPage />);
    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());

    fetchMock.mockClear();
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'failed' } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('status=failed'), expect.anything()));
  });

  it('advances the cursor on Next', async () => {
    seedAuth('editor');
    const fetchMock = stubRunsAndStats({
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
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      nextCursor: 'cursor-abc',
    });

    renderWithProviders(<RunsPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled());

    fetchMock.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('cursor=cursor-abc'), expect.anything()));
  });

  it('shows an empty state when there are no runs', async () => {
    seedAuth('editor');
    stubRunsAndStats({ items: [], nextCursor: null });

    renderWithProviders(<RunsPage />);

    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());
  });
});
