import type { DagStepDefinition } from '@flowforge/shared-types';
import { CONDITION_OPS } from '@flowforge/shared-types';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const CONDITION_RIGHT = ['succeeded', 'failed', 'skipped'] as const;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 'var(--space-3)' }}>
      <label style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--ink-mut)', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

/**
 * Right-side form for whichever node is selected on the canvas — one field
 * set per step type, matching the exact shape shared-types/dag.ts defines
 * (no fields this schema doesn't have, e.g. no dependsOn field here since
 * dependencies are drawn as edges on the canvas, not typed by hand).
 */
export function StepConfigPanel({
  step,
  onChange,
  onDelete,
}: {
  step: DagStepDefinition;
  onChange: (next: DagStepDefinition) => void;
  onDelete: () => void;
}) {
  return (
    <div className="card" style={{ padding: 'var(--space-4)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
        <h3 style={{ margin: 0, fontSize: 'var(--text-base)' }}>{step.type} step</h3>
        <button type="button" className="btn-ghost" onClick={onDelete} aria-label={`Delete step ${step.key}`}>
          Delete
        </button>
      </div>

      <Field label="Key">
        <input
          value={step.key}
          onChange={(e) => onChange({ ...step, key: e.target.value } as DagStepDefinition)}
          style={{ width: '100%' }}
        />
      </Field>

      {step.type === 'http' ? (
        <>
          <Field label="Method">
            <select value={step.method} onChange={(e) => onChange({ ...step, method: e.target.value as (typeof HTTP_METHODS)[number] })} style={{ width: '100%' }}>
              {HTTP_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <Field label="URL">
            <input value={step.url} onChange={(e) => onChange({ ...step, url: e.target.value })} style={{ width: '100%', fontFamily: 'var(--font-mono)' }} />
          </Field>
        </>
      ) : null}

      {step.type === 'script' ? (
        <>
          <Field label="Command">
            <input value={step.command} onChange={(e) => onChange({ ...step, command: e.target.value })} style={{ width: '100%', fontFamily: 'var(--font-mono)' }} />
          </Field>
          <Field label="Args (space-separated)">
            <input
              value={(step.args ?? []).join(' ')}
              onChange={(e) => onChange({ ...step, args: e.target.value.split(' ').filter(Boolean) })}
              style={{ width: '100%', fontFamily: 'var(--font-mono)' }}
            />
          </Field>
          <Field label="Timeout (ms)">
            <input
              type="number"
              min={1}
              max={300_000}
              value={step.timeoutMs}
              onChange={(e) => onChange({ ...step, timeoutMs: Number(e.target.value) })}
              style={{ width: '100%' }}
            />
          </Field>
        </>
      ) : null}

      {step.type === 'delay' ? (
        <Field label="Duration (ms)">
          <input
            type="number"
            min={0}
            max={300_000}
            value={step.durationMs}
            onChange={(e) => onChange({ ...step, durationMs: Number(e.target.value) })}
            style={{ width: '100%' }}
          />
        </Field>
      ) : null}

      {step.type === 'condition' ? (
        <>
          <Field label="Left ($.steps.<key>.status)">
            <input value={step.left} onChange={(e) => onChange({ ...step, left: e.target.value })} style={{ width: '100%', fontFamily: 'var(--font-mono)' }} />
          </Field>
          <Field label="Operator">
            <select value={step.op} onChange={(e) => onChange({ ...step, op: e.target.value as (typeof CONDITION_OPS)[number] })} style={{ width: '100%' }}>
              {CONDITION_OPS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Right">
            <select value={step.right} onChange={(e) => onChange({ ...step, right: e.target.value as (typeof CONDITION_RIGHT)[number] })} style={{ width: '100%' }}>
              {CONDITION_RIGHT.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
        </>
      ) : null}
    </div>
  );
}
