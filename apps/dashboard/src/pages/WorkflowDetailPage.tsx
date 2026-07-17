import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../api/client.js';
import { listRuns } from '../api/runs.js';
import { deleteWorkflow } from '../api/workflows.js';
import { useAuth } from '../auth/useAuth.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { ErrorState } from '../components/ErrorState.js';
import { PageIntro } from '../components/PageIntro.js';
import { Skeleton } from '../components/Skeleton.js';
import { useToast } from '../components/Toast.js';
import { VersionList } from '../components/VersionList.js';
import { WorkflowGraph } from '../components/WorkflowGraph.js';
import { useRollback } from '../hooks/useRollback.js';
import { useTriggerRun } from '../hooks/useTriggerRun.js';
import { useVersions } from '../hooks/useVersions.js';
import { useWorkflow } from '../hooks/useWorkflow.js';

export function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const workflowId = id!;
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canWrite = user?.role !== 'viewer';

  const { data, isPending, isError, error, refetch } = useWorkflow(workflowId);
  const versionsQuery = useVersions(workflowId);
  const runsQuery = useQuery({
    queryKey: ['runs', { workflowId }],
    queryFn: () => listRuns(token!, { workflowId, limit: 5 }),
    enabled: token !== null,
  });

  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const { showToast } = useToast();

  const rollback = useRollback(workflowId, () => showToast('Rollback failed — reverted to the previous version.'));
  const trigger = useTriggerRun();

  const deleteMutation = useMutation({
    mutationFn: () => deleteWorkflow(token!, workflowId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workflows'] });
      navigate('/workflows');
    },
  });

  if (isPending) {
    return (
      <div>
        <h1 tabIndex={-1} style={{ fontSize: 'var(--text-xl)' }}>
          Loading workflow…
        </h1>
        <Skeleton rows={6} />
      </div>
    );
  }

  if (isError) {
    if (error instanceof ApiError && error.status === 404) {
      return (
        <main data-testid="workflow-not-found">
          <h1 tabIndex={-1}>Workflow not found</h1>
          <p>It may have been deleted.</p>
          <Link to="/workflows">Back to workflows</Link>
        </main>
      );
    }
    return (
      <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load workflow.'} onRetry={() => void refetch()} />
    );
  }

  const { workflow, version } = data;
  const versions = versionsQuery.data?.items ?? [];
  const activeVersion = versions.find((v) => v.id === selectedVersionId) ?? version;
  const rollbackTargetVersion = versions.find((v) => v.id === rollbackTarget);

  return (
    <div>
      <PageIntro
        title={workflow.name}
        action={
          canWrite ? (
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button
                type="button"
                data-testid="trigger-button"
                className="btn-primary"
                disabled={!workflow.currentVersionId || trigger.isPending}
                onClick={() => {
                  trigger.mutate(workflow.id, {
                    onSuccess: (result) => navigate(`/runs/${result.run.id}`),
                    onError: () => showToast('Trigger failed — try again.'),
                  });
                }}
              >
                {trigger.isPending ? 'Triggering…' : 'Trigger'}
              </button>
              <Link to={`/workflows/${workflow.id}/edit`}>
                <button type="button">Edit</button>
              </Link>
              <button type="button" className="btn-ghost" data-testid="delete-button" onClick={() => setDeleteConfirmOpen(true)}>
                Delete
              </button>
            </div>
          ) : null
        }
      />

      <section aria-label="Workflow graph">
        {activeVersion ? <WorkflowGraph dag={activeVersion.dag} steps={{}} /> : <p>No versions yet.</p>}
      </section>

      <section aria-label="Version history" style={{ marginTop: 'var(--space-6)' }}>
        <h2 style={{ fontSize: 'var(--text-lg)' }}>Versions</h2>
        <VersionList
          versions={versions}
          currentVersionId={workflow.currentVersionId}
          selectedVersionId={selectedVersionId}
          onSelect={setSelectedVersionId}
        />
        {canWrite && selectedVersionId && selectedVersionId !== workflow.currentVersionId ? (
          <button type="button" data-testid="rollback-button" onClick={() => setRollbackTarget(selectedVersionId)}>
            Roll back to this version
          </button>
        ) : null}
      </section>

      <section aria-label="Recent runs" style={{ marginTop: 'var(--space-6)' }}>
        <h2 style={{ fontSize: 'var(--text-lg)' }}>Recent runs</h2>
        {runsQuery.data && runsQuery.data.items.length > 0 ? (
          <ul className="card" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {runsQuery.data.items.map((run, index) => (
              <li
                key={run.id}
                data-testid="recent-run-row"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                  padding: 'var(--space-3) var(--space-4)',
                  borderTop: index === 0 ? 'none' : '1px solid var(--border)',
                }}
              >
                <Link to={`/runs/${run.id}`} style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>
                  {run.id.slice(0, 8)}
                </Link>
                <span data-status={run.status} style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-mut)' }}>
                  {run.status}
                </span>
                <span style={{ color: 'var(--ink-mut)', fontSize: 'var(--text-sm)' }}>
                  {new Date(run.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ color: 'var(--ink-mut)' }}>No runs yet — press Trigger above to start one.</p>
        )}
      </section>

      {rollbackTarget !== null ? (
        <ConfirmDialog
          title={`Roll back to v${rollbackTargetVersion?.versionNumber ?? ''}?`}
          description="This creates no new version; it repoints current."
          confirmLabel="Roll back"
          onConfirm={() => {
            rollback.mutate(rollbackTarget);
            setRollbackTarget(null);
          }}
          onCancel={() => setRollbackTarget(null)}
        />
      ) : null}

      {deleteConfirmOpen ? (
        <ConfirmDialog
          title={`Delete "${workflow.name}"?`}
          description="This cannot be undone."
          confirmLabel="Delete"
          onConfirm={() => {
            deleteMutation.mutate();
            setDeleteConfirmOpen(false);
          }}
          onCancel={() => setDeleteConfirmOpen(false)}
        />
      ) : null}
    </div>
  );
}
