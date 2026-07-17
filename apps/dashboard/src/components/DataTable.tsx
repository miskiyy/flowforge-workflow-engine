import type { ReactNode } from 'react';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
}

export function DataTable<T>({ columns, rows, rowKey }: { columns: DataTableColumn<T>[]; rows: T[]; rowKey: (row: T) => string }) {
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                style={{
                  textAlign: 'left',
                  padding: 'var(--space-3) var(--space-4)',
                  borderBottom: `1px solid var(--border)`,
                  background: 'var(--surface)',
                  color: 'var(--ink-mut)',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 600,
                }}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKey(row)} data-testid="data-table-row">
              {columns.map((column) => (
                <td
                  key={column.key}
                  style={{
                    padding: 'var(--space-3) var(--space-4)',
                    borderTop: index === 0 ? 'none' : '1px solid var(--border)',
                  }}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
