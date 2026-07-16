import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HealthPage } from '../src/pages/HealthPage.js';
import { renderWithProviders, seedAuth } from './testUtils.js';

function jsonResponse(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('HealthPage', () => {
  it('renders the four stats from GET /stats', async () => {
    seedAuth('viewer');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          activeRuns: 2,
          last24h: { total: 10, succeeded: 8, failed: 2, successRate: 0.8, avgDurationMs: 1500 },
        }),
      ),
    );

    renderWithProviders(<HealthPage />);

    await waitFor(() => expect(screen.getByTestId('stats-grid')).toBeInTheDocument());
    expect(screen.getByText('Active runs').nextSibling).toHaveTextContent('2');
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('1.5s')).toBeInTheDocument();
    expect(screen.getByText('8 succeeded · 2 failed')).toBeInTheDocument();
  });

  it('shows em dashes, not 0%, when nothing has finished in the window', async () => {
    seedAuth('viewer');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          activeRuns: 0,
          last24h: { total: 0, succeeded: 0, failed: 0, successRate: null, avgDurationMs: null },
        }),
      ),
    );

    renderWithProviders(<HealthPage />);

    await waitFor(() => expect(screen.getByTestId('stats-grid')).toBeInTheDocument());
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it('shows a retryable error state when the request fails', async () => {
    seedAuth('viewer');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({ error: { code: 'X', message: 'boom' } }) }),
    );

    renderWithProviders(<HealthPage />);

    await waitFor(() => expect(screen.getByTestId('error-state')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
