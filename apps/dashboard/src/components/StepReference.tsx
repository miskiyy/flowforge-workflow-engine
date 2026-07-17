import { STEP_TYPES } from '@flowforge/shared-types';

/**
 * Authoring cheat-sheet for the JSON editor. Step-type names come from the
 * shared schema (single source of truth); the minimal example per type is
 * illustrative. Server-side validateDag remains the trust boundary — this
 * only helps a human write valid JSON faster.
 */
const EXAMPLES: Record<(typeof STEP_TYPES)[number], string> = {
  http: '{ "key": "fetch", "type": "http", "dependsOn": [], "method": "GET", "url": "https://example.com" }',
  delay: '{ "key": "wait", "type": "delay", "dependsOn": ["fetch"], "durationMs": 1000 }',
  script: '{ "key": "run", "type": "script", "dependsOn": [], "command": "echo", "args": ["hi"], "timeoutMs": 5000 }',
  condition:
    '{ "key": "gate", "type": "condition", "dependsOn": ["fetch"], "left": "$.steps.fetch.status", "op": "eq", "right": "succeeded" }',
};

export function StepReference() {
  return (
    <details data-testid="step-reference" style={{ marginTop: 'var(--space-3)' }}>
      <summary style={{ cursor: 'pointer', color: 'var(--ink-mut)', fontSize: 'var(--text-sm)' }}>Step reference</summary>
      <div style={{ marginTop: 'var(--space-2)' }}>
        <p style={{ color: 'var(--ink-mut)', fontSize: 'var(--text-sm)', margin: '0 0 var(--space-2)' }}>
          A workflow is {'{ "steps": [ … ] }'}. Each step has a unique <code>key</code>, a <code>type</code>, and{' '}
          <code>dependsOn</code> (keys that must finish first). Available types: {STEP_TYPES.join(', ')}.
        </p>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--space-2)' }}>
          {STEP_TYPES.map((type) => (
            <li key={type}>
              <code style={{ fontSize: 'var(--text-xs)', display: 'block', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {EXAMPLES[type]}
              </code>
            </li>
          ))}
        </ul>
        <p style={{ color: 'var(--ink-mut)', fontSize: 'var(--text-xs)', marginTop: 'var(--space-2)' }}>
          <code>script</code> runs a stubbed sandbox (always succeeds). <code>condition</code> compares a dependency's
          outcome — <code>left</code> must be <code>$.steps.&lt;key&gt;.status</code> for a step in{' '}
          <code>dependsOn</code>; a false comparison skips this step&apos;s own dependents without failing the run.
        </p>
      </div>
    </details>
  );
}
