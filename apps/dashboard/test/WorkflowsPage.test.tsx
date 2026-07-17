import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkflowsPage } from '../src/pages/WorkflowsPage.js';
import { renderWithProviders, seedAuth } from './testUtils.js';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('WorkflowsPage', () => {
  it('renders a row per workflow', async () => {
    seedAuth('editor');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [{ id: 'w1', name: 'nightly-etl', currentVersionId: 'v1', cronExpression: null, createdAt: '2026-01-01T00:00:00Z' }],
            nextCursor: null,
          }),
      }),
    );

    renderWithProviders(<WorkflowsPage />);

    await waitFor(() => expect(screen.getAllByTestId('data-table-row')).toHaveLength(1));
    expect(screen.getByText('nightly-etl')).toBeInTheDocument();
  });

  it('shows a teaching empty state when there are no workflows', async () => {
    seedAuth('editor');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ items: [], nextCursor: null }) }));

    renderWithProviders(<WorkflowsPage />);

    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());
    expect(screen.getByTestId('empty-state')).toHaveTextContent('No workflows yet');
  });

  it('shows an error state and refetches on retry', async () => {
    seedAuth('editor');
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<WorkflowsPage />);
    await waitFor(() => expect(screen.getByTestId('error-state')).toBeInTheDocument());

    fetchMock.mockClear();
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ items: [], nextCursor: null }) });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());
  });

  it('hides the New button for a viewer', async () => {
    seedAuth('viewer');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ items: [], nextCursor: null }) }));

    renderWithProviders(<WorkflowsPage />);

    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'New' })).not.toBeInTheDocument();
  });
});
