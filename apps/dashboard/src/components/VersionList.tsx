import type { WorkflowVersion } from '../api/workflows.js';

export function VersionList({
  versions,
  currentVersionId,
  selectedVersionId,
  onSelect,
}: {
  versions: WorkflowVersion[];
  currentVersionId: string | null;
  selectedVersionId: string | null;
  onSelect: (versionId: string) => void;
}) {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {versions.map((version) => {
        const isCurrent = version.id === currentVersionId;
        const isSelected = version.id === selectedVersionId;
        return (
          <li key={version.id}>
            <button
              type="button"
              data-testid="version-row"
              aria-current={isSelected ? 'true' : undefined}
              onClick={() => onSelect(version.id)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: 'var(--space-2) var(--space-3)',
                background: isSelected ? 'var(--surface)' : 'transparent',
                border: 'none',
                borderBottom: '1px solid var(--border)',
              }}
            >
              v{version.versionNumber} {isCurrent ? <strong>(current)</strong> : null}
              <br />
              <span style={{ color: 'var(--ink-mut)', fontSize: 'var(--text-xs)' }}>
                {version.createdBy} · {new Date(version.createdAt).toLocaleString()}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
