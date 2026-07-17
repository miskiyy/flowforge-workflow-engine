import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api/client.js';
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
  const [dagText, setDagText] = useState(NEW_DAG_SCAFFOLD);
  const [baseVersionId, setBaseVersionId] = useState<string | undefined>(undefined);
  const [dirty, setDirty] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [stepErrors, setStepErrors] = useState<StepError[] | null>(null);
  const [stale, setStale] = useState(false);

  // Prefill from the loaded version once, on arrival — not on every refetch, so it doesn't clobber in-progress edits.
  useEffect(() => {
    if (existing?.version && !dirty) {
      setName(existing.workflow.name);
      setDagText(JSON.stringify(existing.version.dag, null, 2));
      setBaseVersionId(existing.version.id);
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

    try {
      if (isEdit) {
        const result = await updateWorkflow.mutateAsync({
          name,
          dag: dag as never,
          ...(baseVersionId !== undefined ? { baseVersionId } : {}),
        });
        navigate(`/workflows/${result.workflow.id}`);
      } else {
        const result = await createWorkflow.mutateAsync({ name, dag: dag as never });
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
      setDagText(JSON.stringify(data.version.dag, null, 2));
      setBaseVersionId(data.version.id);
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

  return (
    <div>
      <PageIntro
        title={isEdit ? `Edit ${existing?.workflow.name ?? ''}` : aiMode ? 'Generate a workflow' : 'New workflow'}
        {...(aiMode
          ? { description: 'Describe what you want below. Review and edit the draft before saving — nothing is saved until you click Save.' }
          : {})}
      />

      {stale ? (
        <div data-testid="stale-banner" role="alert" style={{ padding: 'var(--space-3)', background: 'var(--surface)', border: '1px solid var(--border)' }}>
          This workflow changed while you were editing.{' '}
          <button type="button" onClick={() => void handleReload()}>
            Reload
          </button>
        </div>
      ) : null}

      <form onSubmit={(event) => void handleSubmit(event)}>
        <div style={{ marginBottom: 'var(--space-3)' }}>
          <label htmlFor="workflow-name">Name</label>
          <br />
          <input
            id="workflow-name"
            required
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setDirty(true);
            }}
          />
        </div>

        {/* AI-first: the prompt leads; raw JSON is the escape hatch below (frontend-ux-revision.md R3/R5). */}
        <ProposePanel
          workflowId={id ?? 'new'}
          {...(baseVersionId !== undefined ? { baseVersionId } : {})}
          onDraftReady={(nextDagText) => {
            setDagText(nextDagText);
            setDirty(true);
          }}
          onApply={() => void save()}
          onStale={() => setStale(true)}
        />

        <details open={!aiMode} style={{ marginTop: 'var(--space-4)' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
            {aiMode ? 'Advanced — edit JSON directly' : 'Workflow definition (JSON)'}
          </summary>
          <div style={{ marginTop: 'var(--space-3)' }}>
            <DagEditor
              value={dagText}
              onChange={(value) => {
                setDagText(value);
                setDirty(true);
              }}
            />
            <StepReference />
          </div>
        </details>

        {stepErrors ? (
          <ul data-testid="dag-step-errors" role="alert">
            {stepErrors.map((stepError, index) => (
              <li key={index} data-testid="dag-step-error">
                <code>{stepError.path}</code>: {stepError.message}
              </li>
            ))}
          </ul>
        ) : null}

        {submitError ? (
          <p role="alert" data-testid="submit-error" style={{ color: 'var(--status-failed)' }}>
            {submitError}
          </p>
        ) : null}

        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
          <button type="submit" className="btn-primary" disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={handleCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
