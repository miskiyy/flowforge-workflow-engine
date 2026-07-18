import { useRef, useState } from 'react';

/**
 * Monospace JSON textarea + line-number gutter — the lazy correct answer
 * (frontend-design.md §15): the schema is the contract, the server's errors
 * are already field-pathed, and a visual DAG builder would be 2+ days that
 * competes with the AI panel for the same "authoring" story.
 *
 * Only checks JSON syntax on blur (`JSON.parse`) — never reimplements
 * `validateDag`; the server stays the trust boundary.
 */
export function DagEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [syntaxError, setSyntaxError] = useState<string | null>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const lineCount = value.split('\n').length;

  function handleBlur() {
    try {
      JSON.parse(value);
      setSyntaxError(null);
    } catch (err) {
      setSyntaxError(err instanceof Error ? err.message : 'Invalid JSON');
    }
  }

  function syncGutterScroll() {
    if (gutterRef.current && textareaRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }

  return (
    <div>
      {/* Terminal-style chrome (stitch dag-builder.html's code-container): a title bar
          above the editor, no behavior change underneath. */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--surface-sunken)' }}>
        <div
          aria-hidden="true"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            padding: 'var(--space-2) var(--space-3)',
            background: 'var(--surface-raised)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--status-failed)', opacity: 0.6 }} />
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--status-pending)', opacity: 0.6 }} />
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--status-succeeded)', opacity: 0.6 }} />
          <span
            style={{
              marginLeft: 'var(--space-2)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              color: 'var(--ink-mut)',
              letterSpacing: '0.05em',
            }}
          >
            workflow.json
          </span>
        </div>
        {/* overflow stays visible (not hidden) so a keyboard focus ring on the textarea below never gets clipped —
            each child rounds only its own outer edge instead (§12 focus-visible audit). */}
        <div style={{ display: 'flex' }}>
          <div
            ref={gutterRef}
            aria-hidden="true"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
              color: 'var(--ink-mut)',
              padding: 'var(--space-2)',
              textAlign: 'right',
              userSelect: 'none',
              overflow: 'hidden',
              background: 'var(--surface-sunken)',
              whiteSpace: 'pre',
            }}
          >
            {Array.from({ length: lineCount }, (_, index) => index + 1).join('\n')}
          </div>
          <textarea
            ref={textareaRef}
            data-testid="dag-editor-textarea"
            aria-label="Workflow DAG (JSON)"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onBlur={handleBlur}
            onScroll={syncGutterScroll}
            spellCheck={false}
            rows={20}
            style={{
              flex: 1,
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
              padding: 'var(--space-2)',
              border: 'none',
              resize: 'vertical',
              background: 'var(--surface-sunken)',
              color: 'var(--ink)',
            }}
          />
        </div>
      </div>
      {syntaxError ? (
        <p role="alert" data-testid="dag-editor-syntax-error" style={{ color: 'var(--status-failed)' }}>
          Invalid JSON: {syntaxError}
        </p>
      ) : null}
    </div>
  );
}
