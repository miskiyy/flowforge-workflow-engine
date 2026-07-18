import type { WorkflowDagDefinition } from '@flowforge/shared-types';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api/client.js';
import { DagCanvas, type DagBuilderTab } from '../components/dag-builder/DagCanvas.js';
import { DagEditor } from '../components/DagEditor.js';
import { PageIntro } from '../components/PageIntro.js';
import { ProposePanel } from '../components/ProposePanel.js';
import { Skeleton } from '../components/Skeleton.js';
import { StepReference } from '../components/StepReference.js';
import { useCreateWorkflow } from '../hooks/useCreateWorkflow.js';
import { useUpdateWorkflow } from '../hooks/useUpdateWorkflow.js';
import { useWorkflow } from '../hooks/useWorkflow.js';

// A one-step scaffold teaches the shape instead of an empty {"steps":[]} void.
const NEW_DAG_SCAFFOLD = JSON.stringify(
  { steps: [{ key: 'fetch', type: 'http', dependsOn: [], method: 'GET', url: 'https://example.com' }] },
  null,
  2,
);

interface StepError {
  path: string;
  message: string;
}

export function WorkflowEditorPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = id !== undefined;
  const [searchParams] = useSearchParams();
  // Arrived via "Generate with AI" — lead with the prompt, tuck JSON away.
  const aiMode = searchParams.get('mode') === 'ai' && !isEdit;
  const navigate = useNavigate();

  const { data: existing, isPending: isLoadingExisting, refetch } = useWorkflow(id);
  const createWorkflow = useCreateWorkflow();
  const updateWorkflow = useUpdateWorkflow(id ?? '');

  const [name, setName] = useState('');
  const [cronExpression, setCronExpression] = useState('');
  const [dagText, setDagText] = useState(NEW_DAG_SCAFFOLD);
  const [baseVersionId, setBaseVersionId] = useState<string | undefined>(undefined);
  const [dirty, setDirty] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [stepErrors, setStepErrors] = useState<StepError[] | null>(null);
  const [stale, setStale] = useState(false);
  // AI mode leads with the prompt; everyone else starts on the task editor.
  const [activeTab, setActiveTab] = useState<DagBuilderTab>(aiMode ? 'ai' : 'edit');
  // Bumped whenever dagText changes from outside the canvas itself (prefill,
  // AI Apply, Reload) so DagCanvas resets its nodes/edges from the new dag —
  // but NOT on the canvas's own edits, or every drag/click would reset node
  // positions. Passed as `resetToken`, not a `key` — a `key`-remount would
  // also tear down jsonPanel/aiPanel (rendered inside DagCanvas), wiping
  // ProposePanel's state out from under it right as Apply triggers this.
  const [visualSyncKey, setVisualSyncKey] = useState(0);
  // The canvas is always on screen now, so it needs *a* dag even while the
  // JSON tab holds momentarily-invalid text mid-edit — falls back to the
  // last successfully parsed shape instead of disappearing.
  const lastValidDagRef = useRef<WorkflowDagDefinition>(JSON.parse(NEW_DAG_SCAFFOLD) as WorkflowDagDefinition);

  // Prefill from the loaded version once, on arrival — not on every refetch, so it doesn't clobber in-progress edits.
  useEffect(() => {
    if (existing?.version && !dirty) {
      setName(existing.workflow.name);
      setCronExpression(existing.workflow.cronExpression ?? '');
      setDagText(JSON.stringify(existing.version.dag, null, 2));
      setBaseVersionId(existing.version.id);
      setVisualSyncKey((k) => k + 1);
    }
  }, [existing, dirty]);

  useEffect(() => {
    function warnOnUnload(event: BeforeUnloadEvent) {
      if (dirty) event.preventDefault();
    }
    window.addEventListener('beforeunload', warnOnUnload);
    return () => window.removeEventListener('beforeunload', warnOnUnload);
  }, [dirty]);

  function handleCancel() {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    navigate(-1);
  }

  /**
   * The one save path — the manual Save button and the AI panel's Apply
   * button both call this exact function, never a separate one (§8: "Saving
   * is the *same* PATCH a human uses").
   */
  async function save() {
    setSubmitError(null);
    setStepErrors(null);

    let dag: unknown;
    try {
      dag = JSON.parse(dagText);
    } catch {
      setSubmitError('Fix the JSON syntax error above before saving.');
      return;
    }

    const trimmedCron = cronExpression.trim();

    try {
      if (isEdit) {
        const result = await updateWorkflow.mutateAsync({
          name,
          dag: dag as never,
          cronExpression: trimmedCron === '' ? null : trimmedCron,
          ...(baseVersionId !== undefined ? { baseVersionId } : {}),
        });
        navigate(`/workflows/${result.workflow.id}`);
      } else {
        const result = await createWorkflow.mutateAsync({
          name,
          dag: dag as never,
          ...(trimmedCron === '' ? {} : { cronExpression: trimmedCron }),
        });
        navigate(`/workflows/${result.workflow.id}`);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 422 && Array.isArray(err.details)) {
        setStepErrors(err.details as StepError[]);
      } else if (err instanceof ApiError && err.status === 409) {
        setStale(true);
      } else if (err instanceof ApiError) {
        setSubmitError(err.message);
      } else {
        setSubmitError('Something went wrong. Try again.');
      }
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    await save();
  }

  async function handleReload() {
    const { data } = await refetch();
    if (data?.version) {
      setName(data.workflow.name);
      setCronExpression(data.workflow.cronExpression ?? '');
      setDagText(JSON.stringify(data.version.dag, null, 2));
      setBaseVersionId(data.version.id);
      setVisualSyncKey((k) => k + 1);
    }
    setDirty(false);
    setStale(false);
  }

  if (isEdit && isLoadingExisting) {
    return (
      <div>
        <h1 tabIndex={-1} style={{ fontSize: 'var(--text-xl)' }}>
          Loading workflow…
        </h1>
        <Skeleton rows={10} />
      </div>
    );
  }

  const isSaving = createWorkflow.isPending || updateWorkflow.isPending;

  let dagParseError: string | null = null;
  try {
    lastValidDagRef.current = JSON.parse(dagText) as WorkflowDagDefinition;
  } catch (err) {
    dagParseError = err instanceof Error ? err.message : 'Invalid JSON';
  }
  const canvasDag = lastValidDagRef.current;

  return (
    <div style={{ padding: '0 var(--space-4)' }}>
      {stale ? (
        <div data-testid="stale-banner" role="alert" style={{ padding: 'var(--space-3)', background: 'var(--surface)', border: '1px solid var(--border)' }}>
          This workflow changed while you were editing.{' '}
          <button type="button" onClick={() => void handleReload()}>
            Reload
          </button>
        </div>
      ) : null}

      <form onSubmit={(event) => void handleSubmit(event)}>
        {/* Custom Header Bar matching the first mockup */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 'var(--space-6)',
            borderBottom: '1px solid var(--border)',
            paddingBottom: 'var(--space-4)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <div>
              <input
                type="text"
                required
                value={name}
                placeholder="Workflow Name..."
                onChange={(event) => {
                  setName(event.target.value);
                  setDirty(true);
                }}
                style={{
                  fontSize: '24px',
                  fontWeight: 'bold',
                  background: 'transparent',
                  border: 'none',
                  color: '#fff',
                  padding: 0,
                  outline: 'none',
                  width: '320px',
                }}
              />
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-mut)', marginTop: '4px' }}>
                STATUS: <span style={{ color: 'var(--accent)', fontWeight: 'bold' }}>DRAFT</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <div style={{ position: 'relative' }}>
              <input
                id="workflow-cron"
                placeholder="Cron Expression (e.g. */5 * * * *)"
                pattern="^(\*|([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])|\*\/[0-9]+)\s+(\*|([0-9]|1[0-9]|2[0-3])|\*\/[0-9]+)\s+(\*|([1-9]|1[0-9]|2[0-9]|3[0-1])|\*\/[0-9]+)\s+(\*|([1-9]|1[0-2])|\*\/[0-9]+)\s+(\*|([0-6])|\*\/[0-9]+)$"
                title="Please enter a valid 5-field CRON expression (minute hour day-of-month month day-of-week)"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-xs)',
                  width: '240px',
                  background: 'var(--surface-sunken)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  color: '#fff',
                }}
                value={cronExpression}
                onChange={(event) => {
                  setCronExpression(event.target.value);
                  setDirty(true);
                }}
              />
            </div>
            <button
              type="submit"
              disabled={isSaving}
              style={{
                background: 'var(--accent)',
                color: 'var(--surface-sunken)',
                border: 'none',
                padding: '8px 16px',
                fontWeight: 'bold',
                borderRadius: 'var(--radius)',
                cursor: 'pointer',
              }}
            >
              💾 Save
            </button>
            <button
              type="button"
              style={{
                background: '#2563eb',
                color: 'white',
                border: 'none',
                padding: '8px 16px',
                fontWeight: 'bold',
                borderRadius: 'var(--radius)',
                cursor: 'pointer',
              }}
              onClick={() => navigate('/runs')}
            >
              ▶ Run
            </button>
          </div>
        </header>

        {dagParseError ? (
          <p role="alert" style={{ color: 'var(--status-failed)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)' }}>
            Showing the last valid graph — fix the JSON tab to continue editing visually: {dagParseError}
          </p>
        ) : null}

        <DagCanvas
          resetToken={visualSyncKey}
          dag={canvasDag}
          onChange={(dag) => {
            setDagText(JSON.stringify(dag, null, 2));
            setDirty(true);
          }}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          jsonPanel={
            <>
              <DagEditor
                value={dagText}
                onChange={(value) => {
                  setDagText(value);
                  setDirty(true);
                }}
              />
              <StepReference />
            </>
          }
          aiPanel={
            <ProposePanel
              workflowId={id ?? 'new'}
              {...(baseVersionId !== undefined ? { baseVersionId } : {})}
              onDraftReady={(nextDagText) => {
                setDagText(nextDagText);
                setDirty(true);
                setVisualSyncKey((k) => k + 1);
              }}
              onApply={() => void save()}
              onStale={() => setStale(true)}
            />
          }
        />

        {stepErrors ? (
          <ul data-testid="dag-step-errors" role="alert" style={{ marginTop: 'var(--space-4)', color: 'var(--status-failed)' }}>
            {stepErrors.map((stepError, index) => (
              <li key={index} data-testid="dag-step-error">
                <code>{stepError.path}</code>: {stepError.message}
              </li>
            ))}
          </ul>
        ) : null}

        {submitError ? (
          <p role="alert" data-testid="submit-error" style={{ color: 'var(--status-failed)', marginTop: 'var(--space-4)' }}>
            {submitError}
          </p>
        ) : null}
      </form>
    </div>
  );
}
