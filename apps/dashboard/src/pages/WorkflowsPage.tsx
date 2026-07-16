import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../api/client.js';
import { useAuth } from '../auth/useAuth.js';
import { DataTable } from '../components/DataTable.js';
import { EmptyState } from '../components/EmptyState.js';
import { ErrorState } from '../components/ErrorState.js';
import { Skeleton } from '../components/Skeleton.js';
import { useWorkflows } from '../hooks/useWorkflows.js';

const PAGE_LIMIT = 20;

export function WorkflowsPage() {
  const { user } = useAuth();
  const canCreate = user?.role !== 'viewer';

  const [nameInput, setNameInput] = useState('');
  const [name, setName] = useState('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([]);

  // Debounced name filter (300ms) — resets pagination since a new filter invalidates the cursor.
  useEffect(() => {
    const timer = setTimeout(() => {
      setName(nameInput);
      setCursor(undefined);
      setCursorStack([]);
    }, 300);
    return () => clearTimeout(timer);
  }, [nameInput]);

  const { data, isPending, isError, error, refetch } = useWorkflows({
    limit: PAGE_LIMIT,
    ...(name ? { name } : {}),
    ...(cursor !== undefined ? { cursor } : {}),
  });

  function goNext() {
    if (!data?.nextCursor) return;
    setCursorStack((stack) => [...stack, cursor]);
    setCursor(data.nextCursor);
  }

  function goPrev() {
    setCursorStack((stack) => {
      const next = [...stack];
      setCursor(next.pop());
      return next;
    });
  }

  return (
    <div>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
        <h1 tabIndex={-1} style={{ fontSize: 'var(--text-xl)' }}>
          Workflows
        </h1>
        {canCreate ? (
          <Link to="/workflows/new">
            <button type="button">New</button>
          </Link>
        ) : null}
      </header>

      <input
        type="search"
        placeholder="Filter by name…"
        aria-label="Filter workflows by name"
        value={nameInput}
        onChange={(event) => setNameInput(event.target.value)}
        style={{ marginBottom: 'var(--space-4)', padding: 'var(--space-2)' }}
      />

      {isPending ? (
        <Skeleton rows={5} />
      ) : isError ? (
        <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load workflows.'} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState
          title="No workflows yet"
          description="Describe one in plain English and let the AI draft it, or author the DAG yourself."
          action={
            canCreate ? (
              <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'center' }}>
                <Link to="/workflows/new?mode=ai">
                  <button type="button" className="btn-primary">
                    Generate with AI
                  </button>
                </Link>
                <Link to="/workflows/new">
                  <button type="button">New workflow</button>
                </Link>
              </div>
            ) : undefined
          }
        />
      ) : (
        <>
          <DataTable
            rowKey={(row) => row.id}
            rows={data.items}
            columns={[
              { key: 'name', header: 'Name', cell: (row) => row.name },
              { key: 'version', header: 'Current version', cell: (row) => (row.currentVersionId ? 'Yes' : '—') },
              { key: 'createdAt', header: 'Created', cell: (row) => new Date(row.createdAt).toLocaleString() },
              { key: 'actions', header: 'Actions', cell: (row) => <Link to={`/workflows/${row.id}`}>Open</Link> },
            ]}
          />
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
            <button type="button" onClick={goPrev} disabled={cursorStack.length === 0}>
              Previous
            </button>
            <button type="button" onClick={goNext} disabled={!data.nextCursor}>
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
