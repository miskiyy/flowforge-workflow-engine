import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProposePanel } from '../src/components/ProposePanel.js';
import { renderWithProviders, seedAuth } from './testUtils.js';

const dag = { steps: [{ key: 'notify', type: 'delay' as const, dependsOn: [], durationMs: 1 }] };

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body) };
}

function renderPanel(overrides: Partial<Parameters<typeof ProposePanel>[0]> = {}) {
  const onDraftReady = vi.fn();
  const onApply = vi.fn();
  const onStale = vi.fn();
  renderWithProviders(
    <ProposePanel workflowId="w1" baseVersionId="v1" onDraftReady={onDraftReady} onApply={onApply} onStale={onStale} {...overrides} />,
  );
  return { onDraftReady, onApply, onStale };
}

async function propose(prompt = 'Add a notify step') {
  fireEvent.change(screen.getByLabelText('Describe the change you want'), { target: { value: prompt } });
  fireEvent.click(screen.getByTestId('propose-button'));
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('ProposePanel', () => {
  it('shows the character counter as the prompt is typed', () => {
    seedAuth('editor');
    renderPanel();
    fireEvent.change(screen.getByLabelText('Describe the change you want'), { target: { value: 'hello' } });
    expect(screen.getByTestId('prompt-char-count')).toHaveTextContent('5 / 2000');
  });

  it('renders the diff and loads the draft into the editor on success, showing attempts and cached chips', async () => {
    seedAuth('editor');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          proposedDag: dag,
          diff: { added: ['notify'], removed: [], modified: [], unchanged: [] },
          warnings: [],
          meta: { model: 'x', attempts: 2, cached: true, usage: { promptTokens: 1, completionTokens: 1 } },
        }),
      ),
    );

    const { onDraftReady } = renderPanel();
    await propose();

    await waitFor(() => expect(screen.getByTestId('propose-result')).toBeInTheDocument());
    expect(screen.getByTestId('propose-attempts-chip')).toHaveTextContent('attempt 2');
    expect(screen.getByTestId('propose-cached-chip')).toBeInTheDocument();
    expect(screen.getAllByTestId('diff-row')).toHaveLength(1);
    expect(onDraftReady).toHaveBeenCalledWith(JSON.stringify(dag, null, 2));
  });

  it('on a 422 AI_DRAFT_INVALID: shows the errors, loads lastDraft into the editor, and keeps the prompt', async () => {
    seedAuth('editor');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: 'AI_DRAFT_INVALID',
              message: 'AI could not produce a valid workflow draft',
              details: { errors: [{ path: '/steps/0/dependsOn', message: 'unknown dependency' }], lastDraft: { steps: [] } },
            },
          },
          false,
          422,
        ),
      ),
    );

    const { onDraftReady } = renderPanel();
    await propose('Add a broken step');

    await waitFor(() => expect(screen.getByTestId('propose-error')).toBeInTheDocument());
    expect(screen.getByTestId('propose-error-list')).toHaveTextContent('/steps/0/dependsOn');
    expect(onDraftReady).toHaveBeenCalledWith(JSON.stringify({ steps: [] }, null, 2));
    expect(screen.getByLabelText('Describe the change you want')).toHaveValue('Add a broken step');
  });

  it('on a 503 AI_UNAVAILABLE: collapses to a notice, leaving the rest of the editor unaffected', async () => {
    seedAuth('editor');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'AI_UNAVAILABLE', message: 'down' } }, false, 503)),
    );

    renderPanel();
    await propose();

    await waitFor(() => expect(screen.getByTestId('propose-panel-unavailable')).toBeInTheDocument());
    expect(screen.getByTestId('propose-panel-unavailable')).toHaveTextContent('You can still edit by hand.');
    expect(screen.queryByTestId('propose-panel')).not.toBeInTheDocument();
  });

  it('on a 409 BASE_VERSION_STALE: defers to the caller-provided stale handler', async () => {
    seedAuth('editor');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'BASE_VERSION_STALE', message: 'stale' } }, false, 409)),
    );

    const { onStale } = renderPanel();
    await propose();

    await waitFor(() => expect(onStale).toHaveBeenCalled());
  });
});
