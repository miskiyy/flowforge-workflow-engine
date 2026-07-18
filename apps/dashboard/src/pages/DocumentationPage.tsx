import { MarketingHeader } from '../components/MarketingHeader.js';

const TOC = [
  { id: 'structure', label: 'Basic Structure' },
  { id: 'dependencies', label: 'Handling Dependencies' },
];

const PARAMS = [
  { name: 'id', type: 'String', def: 'required', desc: 'Unique identifier for the node.' },
  { name: 'retries', type: 'Integer', def: '0', desc: 'Number of retry attempts if the node fails.' },
  { name: 'timeout', type: 'Seconds', def: '3600', desc: 'Max execution time before kill.' },
];

/** Public docs page — single article, adapted from stitch/documentation.html to what the DAG engine actually supports. */
export function DocumentationPage() {
  return (
    <div style={{ minHeight: '100vh' }}>
      <MarketingHeader />
      <main
        style={{
          maxWidth: '1100px',
          margin: '0 auto',
          padding: 'var(--space-8) var(--space-6) var(--space-12)',
          display: 'grid',
          gridTemplateColumns: '1fr 220px',
          gap: 'var(--space-8)',
        }}
      >
        <article>
          <nav style={{ color: 'var(--ink-mut)', fontSize: 'var(--text-xs)', marginBottom: 'var(--space-3)' }}>
            Docs <span style={{ margin: '0 4px' }}>›</span> Workflows <span style={{ margin: '0 4px' }}>›</span>{' '}
            <span style={{ color: 'var(--accent)' }}>DAG Definitions</span>
          </nav>
          <h1 tabIndex={-1} style={{ margin: '0 0 var(--space-4)' }}>
            Defining Workflows with DAGs
          </h1>
          <p style={{ color: 'var(--ink-mut)', fontSize: 'var(--text-lg)', margin: '0 0 var(--space-8)' }}>
            A Directed Acyclic Graph (DAG) is a collection of the tasks you want to run, organized to reflect their
            relationships and dependencies. FlowForge treats DAGs as first-class citizens — define once, run
            anywhere in the cluster.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-8)' }}>
            <div className="card" style={{ padding: 'var(--space-6)' }}>
              <h3 style={{ margin: '0 0 var(--space-2)', color: 'var(--accent)' }}>Atomic Execution</h3>
              <p style={{ margin: 0, color: 'var(--ink-mut)' }}>
                Each node in your DAG runs as an isolated process. FlowForge tracks its status independently, so a
                single node failure never corrupts the state of its siblings.
              </p>
            </div>
            <div className="card" style={{ padding: 'var(--space-6)', textAlign: 'center' }}>
              <span className="icon-well icon-well-accent" style={{ margin: '0 auto var(--space-2)' }}>⚡</span>
              <strong>Real-time Status</strong>
              <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--ink-mut)' }}>Live run streaming</p>
            </div>
          </div>

          <h2 id="structure" style={{ margin: 'var(--space-8) 0 var(--space-4)' }}>
            Basic Structure
          </h2>
          <p style={{ marginBottom: 'var(--space-4)' }}>
            A workflow is defined in YAML. It must contain a <code>version</code>, a <code>name</code>, and a{' '}
            <code>nodes</code> array under <code>spec</code>.
          </p>
          <CodeBlock />

          <h2 id="dependencies" style={{ margin: 'var(--space-8) 0 var(--space-4)' }}>
            Handling Dependencies
          </h2>
          <p style={{ marginBottom: 'var(--space-6)' }}>
            The <code>dependencies</code> key defines execution order. If node B depends on node A, B only starts
            once A reports success. Watch this happen live in the run timeline.
          </p>

          <div
            className="card"
            style={{
              padding: 'var(--space-4)',
              marginBottom: 'var(--space-8)',
              borderLeft: '3px solid var(--accent)',
              background: 'var(--accent-subtle)',
            }}
          >
            <strong style={{ color: 'var(--accent)' }}>ℹ Pro Tip</strong>
            <p style={{ margin: 'var(--space-2) 0 0' }}>
              Set <code>retries</code> on nodes that call flaky external services — a failed node retries in place
              without re-running its upstream dependencies.
            </p>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--surface-raised)' }}>
                {['Parameter', 'Type', 'Default', 'Description'].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: 'left',
                      padding: 'var(--space-2) var(--space-3)',
                      fontSize: 'var(--text-xs)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      color: 'var(--ink-mut)',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PARAMS.map((p) => (
                <tr key={p.name}>
                  <td style={{ padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--border)' }}>
                    <code>{p.name}</code>
                  </td>
                  <td style={{ padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--border)', color: 'var(--ink-mut)' }}>
                    {p.type}
                  </td>
                  <td style={{ padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--border)', color: 'var(--ink-mut)' }}>
                    {p.def}
                  </td>
                  <td style={{ padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--border)', color: 'var(--ink-mut)' }}>
                    {p.desc}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>

        <aside style={{ borderLeft: '1px solid var(--border)', paddingLeft: 'var(--space-4)', height: 'fit-content', position: 'sticky', top: 'var(--space-8)' }}>
          <h5 style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink-mut)', marginBottom: 'var(--space-3)' }}>
            On this page
          </h5>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {TOC.map((t) => (
              <li key={t.id}>
                <a href={`#${t.id}`} style={{ color: 'var(--ink-mut)' }}>
                  {t.label}
                </a>
              </li>
            ))}
          </ul>
        </aside>
      </main>
    </div>
  );
}

function CodeBlock() {
  const lines = [
    'version: "2.4"',
    'name: "customer-onboarding-sync"',
    'schedule: "@hourly"',
    '',
    'spec:',
    '  nodes:',
    '    - id: fetch_source',
    '      image: python:3.9-slim',
    '      retries: 3',
    '    - id: transform',
    '      dependencies: [fetch_source]',
    '      image: spark:3.5',
  ];
  return (
    <div className="card" style={{ overflow: 'hidden', background: 'var(--surface-sunken)', marginBottom: 'var(--space-8)' }}>
      <div
        style={{
          padding: 'var(--space-2) var(--space-4)',
          borderBottom: '1px solid var(--border)',
          fontSize: 10,
          color: 'var(--ink-mut)',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          opacity: 0.6,
        }}
      >
        pipeline.yaml
      </div>
      <pre
        style={{
          margin: 0,
          padding: 'var(--space-4)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-sm)',
          lineHeight: 1.7,
          overflowX: 'auto',
        }}
      >
        {lines.join('\n')}
      </pre>
    </div>
  );
}
