import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkflowEditorPage } from '../src/pages/WorkflowEditorPage.js';
import { renderWithProviders, seedAuth } from './testUtils.js';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('WorkflowEditorPage — create', () => {
  it('renders path-anchored errors on a 422 INVALID_DAG response', async () => {
    seedAuth('editor');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: () =>
        Promise.resolve({
          error: {
            code: 'INVALID_DAG',
            message: 'Workflow DAG failed validation',
            details: [{ path: '/steps/0/dependsOn', message: 'unknown dependency: missing' }],
          },
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<WorkflowEditorPage />, { route: '/workflows/new' });

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'nightly-etl' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByTestId('dag-step-errors')).toBeInTheDocument());
    expect(screen.getByTestId('dag-step-error')).toHaveTextContent('/steps/0/dependsOn');
    expect(screen.getByTestId('dag-step-error')).toHaveTextContent('unknown dependency: missing');
  });

  it('shows a stale banner on a 409 BASE_VERSION_STALE response', async () => {
    seedAuth('editor');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ error: { code: 'BASE_VERSION_STALE', message: 'stale' } }),
      }),
    );

    renderWithProviders(<WorkflowEditorPage />, { route: '/workflows/new' });

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'nightly-etl' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByTestId('stale-banner')).toBeInTheDocument());
  });

  it('blocks submit without a request when the DAG JSON is malformed', async () => {
    seedAuth('editor');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<WorkflowEditorPage />, { route: '/workflows/new' });

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'nightly-etl' } });
    fireEvent.change(screen.getByTestId('dag-editor-textarea'), { target: { value: '{ not valid json' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByTestId('submit-error')).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('WorkflowEditorPage — AI-first layout', () => {
  it('leads with the prompt and collapses the JSON editor when arriving in ai mode', async () => {
    seedAuth('editor');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));

    renderWithProviders(<WorkflowEditorPage />, { route: '/workflows/new?mode=ai' });

    expect(screen.getByRole('heading', { name: 'Generate a workflow' })).toBeInTheDocument();
    expect(screen.getByTestId('propose-panel')).toBeInTheDocument();
    // JSON editor is present but tucked inside a closed disclosure.
    expect(screen.getByTestId('dag-editor-textarea')).not.toBeVisible();
  });

  it('shows the JSON editor open on the plain New path', async () => {
    seedAuth('editor');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));

    renderWithProviders(<WorkflowEditorPage />, { route: '/workflows/new' });

    expect(screen.getByRole('heading', { name: 'New workflow' })).toBeInTheDocument();
    expect(screen.getByTestId('dag-editor-textarea')).toBeVisible();
    expect(screen.getByTestId('step-reference')).toBeInTheDocument();
  });
});

describe('WorkflowEditorPage — edit', () => {
  it('sends baseVersionId on the PATCH when saving an existing workflow', async () => {
    seedAuth('editor');
    const dag = { steps: [{ key: 'a', type: 'delay' as const, dependsOn: [], durationMs: 1 }] };
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url.endsWith('/workflows/w1') && method === 'GET') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              workflow: { id: 'w1', name: 'nightly-etl', currentVersionId: 'v1', cronExpression: null, createdAt: '2026-01-01T00:00:00Z' },
              version: { id: 'v1', workflowId: 'w1', versionNumber: 1, dag, createdBy: 'u1', createdAt: '2026-01-01T00:00:00Z' },
            }),
        });
      }
      if (url.endsWith('/workflows/w1') && method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              workflow: { id: 'w1', name: 'nightly-etl', currentVersionId: 'v2', cronExpression: null, createdAt: '2026-01-01T00:00:00Z' },
              version: { id: 'v2', workflowId: 'w1', versionNumber: 2, dag, createdBy: 'u1', createdAt: '2026-01-02T00:00:00Z' },
            }),
        });
      }
      return Promise.reject(new Error(`Unhandled request: ${method} ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<WorkflowEditorPage />, { route: '/workflows/w1/edit', routePath: '/workflows/:id/edit' });

    await waitFor(() => expect(screen.getByDisplayValue('nightly-etl')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/workflows/w1', expect.objectContaining({ method: 'PATCH' })),
    );
    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    const body = JSON.parse((patchCall[1] as RequestInit).body as string);
    expect(body.baseVersionId).toBe('v1');
  });

  it('Apply (from the AI panel) saves through the exact same PATCH as the manual Save button', async () => {
    seedAuth('editor');
    const dag = { steps: [{ key: 'a', type: 'delay' as const, dependsOn: [], durationMs: 1 }] };
    const proposedDag = { steps: [{ key: 'notify', type: 'delay' as const, dependsOn: [], durationMs: 1 }] };
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url.endsWith('/workflows/w1') && method === 'GET') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              workflow: { id: 'w1', name: 'nightly-etl', currentVersionId: 'v1', cronExpression: null, createdAt: '2026-01-01T00:00:00Z' },
              version: { id: 'v1', workflowId: 'w1', versionNumber: 1, dag, createdBy: 'u1', createdAt: '2026-01-01T00:00:00Z' },
            }),
        });
      }
      if (url.endsWith('/workflows/w1/propose') && method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              proposedDag,
              diff: { added: ['notify'], removed: [], modified: [], unchanged: [] },
              warnings: [],
              meta: { model: 'x', attempts: 1, cached: false, usage: { promptTokens: 1, completionTokens: 1 } },
            }),
        });
      }
      if (url.endsWith('/workflows/w1') && method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              workflow: { id: 'w1', name: 'nightly-etl', currentVersionId: 'v2', cronExpression: null, createdAt: '2026-01-01T00:00:00Z' },
              version: { id: 'v2', workflowId: 'w1', versionNumber: 2, dag: proposedDag, createdBy: 'u1', createdAt: '2026-01-02T00:00:00Z' },
            }),
        });
      }
      return Promise.reject(new Error(`Unhandled request: ${method} ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<WorkflowEditorPage />, { route: '/workflows/w1/edit', routePath: '/workflows/:id/edit' });

    await waitFor(() => expect(screen.getByDisplayValue('nightly-etl')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Describe the change you want'), { target: { value: 'Add a notify step' } });
    fireEvent.click(screen.getByTestId('propose-button'));
    await waitFor(() => expect(screen.getByTestId('propose-result')).toBeInTheDocument());

    // The draft loaded into the same editor the manual Save button reads from.
    expect(screen.getByTestId('dag-editor-textarea')).toHaveValue(JSON.stringify(proposedDag, null, 2));

    fireEvent.click(screen.getByTestId('propose-apply-button'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/workflows/w1', expect.objectContaining({ method: 'PATCH' })),
    );
    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    const body = JSON.parse((patchCall[1] as RequestInit).body as string);
    expect(body.dag).toEqual(proposedDag);
    expect(body.baseVersionId).toBe('v1');
    // Exactly one PATCH — Apply didn't open a second save path alongside the manual one.
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
  });
});
