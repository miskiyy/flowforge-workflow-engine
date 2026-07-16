import { useState } from 'react';
import type { ProposeResult } from '../api/ai.js';
import { ApiError } from '../api/client.js';
import { usePropose } from '../hooks/usePropose.js';
import { DiffView } from './DiffView.js';

const MAX_PROMPT_LENGTH = 2000;

interface ProposeErrorState {
  kind: 'invalid' | 'rate_limited' | 'generic';
  message: string;
  errors?: { path: string; message: string }[];
}

/**
 * The AI is an untrusted contributor (§8): this panel only ever calls
 * `POST /workflows/:id/propose`, which persists nothing. It cannot write —
 * applying a draft goes through `onApply`, which the caller wires to the
 * *same* save path a human uses (never a separate mutation).
 */
export function ProposePanel({
  workflowId,
  baseVersionId,
  onDraftReady,
  onApply,
  onStale,
}: {
  workflowId: string;
  baseVersionId?: string;
  onDraftReady: (dagText: string) => void;
  onApply: () => void;
  onStale: () => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [errorState, setErrorState] = useState<ProposeErrorState | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [result, setResult] = useState<ProposeResult | null>(null);
  const propose = usePropose();

  const overLimit = prompt.length > MAX_PROMPT_LENGTH;

  async function handlePropose() {
    setErrorState(null);
    setResult(null);
    try {
      const proposed = await propose.mutateAsync({
        workflowId,
        prompt,
        ...(baseVersionId !== undefined ? { baseVersionId } : {}),
      });
      setResult(proposed);
      onDraftReady(JSON.stringify(proposed.proposedDag, null, 2));
    } catch (err) {
      if (!(err instanceof ApiError)) {
        setErrorState({ kind: 'generic', message: 'Something went wrong. Try again.' });
        return;
      }
      if (err.status === 422 && err.details && typeof err.details === 'object') {
        const details = err.details as { errors?: { path: string; message: string }[]; lastDraft?: unknown };
        setErrorState({
          kind: 'invalid',
          message: "The model couldn't produce a valid workflow after 3 attempts. Its last try is loaded below — fix it by hand or rephrase.",
          errors: details.errors ?? [],
        });
        if (details.lastDraft !== undefined) onDraftReady(JSON.stringify(details.lastDraft, null, 2));
      } else if (err.status === 503) {
        setUnavailable(true);
      } else if (err.status === 409) {
        onStale();
      } else if (err.status === 429) {
        setErrorState({ kind: 'rate_limited', message: 'Too many requests — try again in a moment.' });
        setTimeout(() => setErrorState((current) => (current?.kind === 'rate_limited' ? null : current)), 3000);
      } else {
        setErrorState({ kind: 'generic', message: err.message });
      }
    }
  }

  // 503 AI_UNAVAILABLE: panel collapses to a single notice; the editor above keeps working (§8).
  if (unavailable) {
    return (
      <div
        data-testid="propose-panel-unavailable"
        role="alert"
        style={{ marginTop: 'var(--space-4)', padding: 'var(--space-3)', border: '1px solid var(--border)', borderRadius: 8 }}
      >
        AI is unavailable right now. You can still edit by hand.
      </div>
    );
  }

  return (
    <div data-testid="propose-panel" className="card" style={{ marginTop: 'var(--space-4)', padding: 'var(--space-4)' }}>
      <h2 style={{ fontSize: 'var(--text-lg)', marginTop: 0 }}>Propose a change</h2>
      <textarea
        aria-label="Describe the change you want"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        rows={3}
        style={{ width: '100%', fontFamily: 'var(--font-sans)', padding: 'var(--space-2)' }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span
          data-testid="prompt-char-count"
          style={{ color: overLimit ? 'var(--status-failed)' : 'var(--ink-mut)', fontSize: 'var(--text-xs)' }}
        >
          {prompt.length} / {MAX_PROMPT_LENGTH}
        </span>
        <button
          type="button"
          data-testid="propose-button"
          className="btn-primary"
          onClick={() => void handlePropose()}
          disabled={propose.isPending || prompt.length === 0 || overLimit || errorState?.kind === 'rate_limited'}
        >
          {propose.isPending ? 'Proposing…' : 'Propose'}
        </button>
      </div>

      {propose.isPending ? (
        <p data-testid="propose-loading" style={{ color: 'var(--ink-mut)', fontSize: 'var(--text-sm)' }}>
          Thinking… free models can take 10s or more.
        </p>
      ) : null}

      {errorState ? (
        <div role="alert" data-testid="propose-error" style={{ marginTop: 'var(--space-3)', color: 'var(--status-failed)' }}>
          <p>{errorState.message}</p>
          {errorState.errors ? (
            <ul data-testid="propose-error-list">
              {errorState.errors.map((stepError, index) => (
                <li key={index}>
                  <code>{stepError.path}</code>: {stepError.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {result ? (
        <div data-testid="propose-result" style={{ marginTop: 'var(--space-4)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', fontSize: 'var(--text-xs)', color: 'var(--ink-mut)' }}>
            <span data-testid="propose-attempts-chip">
              {result.meta.attempts === 1 ? 'Valid on the first attempt' : `Valid on attempt ${result.meta.attempts}`}
            </span>
            {result.meta.cached ? <span data-testid="propose-cached-chip">cached</span> : null}
          </div>

          <DiffView diff={result.diff} />

          {result.warnings.length > 0 ? (
            <ul data-testid="propose-warnings">
              {result.warnings.map((warning, index) => (
                <li key={index}>
                  ⚠ <code>{warning.path}</code> — {warning.message}
                </li>
              ))}
            </ul>
          ) : null}

          <p style={{ color: 'var(--ink-mut)', fontSize: 'var(--text-sm)' }}>Review the JSON below before applying.</p>
          <button type="button" data-testid="propose-apply-button" onClick={onApply}>
            Apply
          </button>
        </div>
      ) : null}
    </div>
  );
}
