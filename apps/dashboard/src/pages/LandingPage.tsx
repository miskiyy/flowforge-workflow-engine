import { Link } from 'react-router-dom';
import { MarketingHeader } from '../components/MarketingHeader.js';

/** Public marketing page — mirrors stitch/landing.html, ported off Tailwind onto the app's token/class system. */
export function LandingPage() {
  return (
    <div style={{ minHeight: '100vh' }}>
      <MarketingHeader />
      <main>
        <Hero />
        <Features />
        <Changelog />
        <BuiltForEngineers />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}

function Hero() {
  return (
    <section
      className="grid-bg"
      style={{
        padding: 'var(--space-12) var(--space-6)',
        textAlign: 'center',
      }}
    >
      <div className="chip chip-accent" style={{ marginBottom: 'var(--space-6)' }}>
        ⚡ v2.4.0 Engine Now Live
      </div>
      <h1 tabIndex={-1} style={{ fontSize: '3rem', lineHeight: 1.1, margin: '0 0 var(--space-4)', letterSpacing: '-0.02em' }}>
        Mission Control for <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Workflows</em>
      </h1>
      <p
        style={{
          color: 'var(--ink-mut)',
          maxWidth: '640px',
          margin: '0 auto var(--space-8)',
          fontSize: 'var(--text-lg)',
        }}
      >
        Deploy, orchestrate, and observe complex DAGs across distributed systems with real-time multi-tenant
        isolation and AI-assisted generation.
      </p>
      <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'center', flexWrap: 'wrap' }}>
        <Link to="/login">
          <button className="btn-primary" style={{ padding: '12px 28px', fontSize: 'var(--text-lg)' }}>
            Get Started Free →
          </button>
        </Link>
        <Link to="/docs">
          <button className="btn-ghost" style={{ padding: '12px 28px', fontSize: 'var(--text-lg)', border: '1px solid var(--border)' }}>
            ▸ View CLI Docs
          </button>
        </Link>
      </div>

      <p style={{ marginTop: 'var(--space-8)', color: 'var(--ink-mut)', fontSize: 'var(--text-xs)', letterSpacing: '0.05em', opacity: 0.6 }}>
        TRUSTED BY TEAMS AT: ☁ 🖧 ◈ ⬡
      </p>

      <DashboardPreview />
    </section>
  );
}

function DashboardPreview() {
  return (
    <div style={{ maxWidth: '1100px', margin: 'var(--space-8) auto 0' }}>
      <div className="card" style={{ overflow: 'hidden', boxShadow: 'var(--glow-accent), var(--shadow-md)' }}>
        <div
          style={{
            height: 32,
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            padding: '0 var(--space-4)',
            background: 'var(--surface-raised)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--status-failed)' }} />
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} />
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--status-succeeded)' }} />
          <span style={{ flex: 1, textAlign: 'center', color: 'var(--ink-mut)', fontSize: 10, opacity: 0.6 }}>
            flowforge.sh/app/orchestration/main-cluster
          </span>
        </div>
        <div style={{ display: 'flex', background: 'var(--surface-sunken)', aspectRatio: '16 / 7.5' }}>
          <div
            style={{
              width: 180,
              borderRight: '1px solid var(--border)',
              padding: 'var(--space-2)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
            }}
          >
            <div className="nav-link-active" style={{ height: 28 }} />
            <div className="nav-link" style={{ height: 28 }} />
            <div className="nav-link" style={{ height: 28 }} />
          </div>
          <div
            className="grid-bg"
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--space-6)',
              padding: 'var(--space-6)',
            }}
          >
            <div className="card" style={{ width: 160, padding: 'var(--space-3)', borderColor: 'var(--accent)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                <div style={{ height: 10, width: 60, background: 'var(--accent-subtle)', borderRadius: 4 }} />
                <span style={{ color: 'var(--status-succeeded)' }}>✓</span>
              </div>
              <div style={{ height: 6, background: 'var(--border)', borderRadius: 4, marginBottom: 4 }} />
              <div style={{ height: 6, width: '66%', background: 'var(--border)', borderRadius: 4 }} />
            </div>
            <div
              className="card action-card-featured"
              style={{ width: 176, padding: 'var(--space-3)', transform: 'scale(1.1)', boxShadow: 'var(--glow-success)' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                <div style={{ height: 10, width: 80, background: 'var(--accent-subtle-border)', borderRadius: 4 }} />
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />
              </div>
              <div style={{ height: 6, background: 'var(--border)', borderRadius: 4, marginBottom: 4 }} />
              <div style={{ height: 6, background: 'var(--border)', borderRadius: 4 }} />
            </div>
            <div className="card" style={{ width: 160, padding: 'var(--space-3)', opacity: 0.5 }}>
              <div style={{ height: 10, width: 48, background: 'var(--border)', borderRadius: 4, marginBottom: 'var(--space-2)' }} />
              <div style={{ height: 6, background: 'var(--border)', borderRadius: 4 }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const FEATURES = [
  { title: 'Real-time Monitoring', body: 'Streaming telemetry and log aggregation for every node in your workflow. Identify bottlenecks in milliseconds.', icon: '📊', span: 8 },
  { title: 'Isolation', body: 'L7 namespace isolation for diverse teams and environments.', icon: '🛡️', span: 4 },
  { title: 'AI-Gen', body: 'Generate complex YAML configurations from natural language prompts.', icon: '✨', span: 4 },
  { title: 'Enterprise Core', body: 'SSO, RBAC, and SOC2 compliant infrastructure for mission-critical loads.', icon: '🔐', span: 8 },
];

function Features() {
  return (
    <section id="features" style={{ padding: 'var(--space-12) var(--space-6)', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 'var(--space-8)' }}>
        <h2 style={{ margin: '0 0 var(--space-3)' }}>Orchestration without Compromise</h2>
        <p style={{ color: 'var(--ink-mut)', maxWidth: '560px', margin: '0 auto' }}>
          Built from the ground up for massive throughput and absolute reliability.
        </p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 'var(--space-4)' }}>
        {FEATURES.map((f) => (
          <div
            key={f.title}
            className="card"
            style={{ gridColumn: `span ${f.span}`, minHeight: 200, padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}
          >
            <span className="icon-well icon-well-accent" style={{ marginBottom: 'var(--space-4)' }}>
              {f.icon}
            </span>
            <h3 style={{ margin: '0 0 var(--space-2)' }}>{f.title}</h3>
            <p style={{ color: 'var(--ink-mut)', margin: 0, maxWidth: '520px' }}>{f.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

const RELEASES = [
  { version: 'v2.4.0', date: 'Jul 2026', note: 'AI-assisted workflow generation, gRPC API, and multi-tenant namespace isolation.' },
  { version: 'v2.3.0', date: 'Apr 2026', note: 'Real-time run streaming and DAG-level retry policies.' },
];

function Changelog() {
  return (
    <section id="changelog" style={{ padding: '0 var(--space-6) var(--space-12)', maxWidth: '720px', margin: '0 auto' }}>
      <h2 style={{ textAlign: 'center', margin: '0 0 var(--space-6)' }}>Changelog</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {RELEASES.map((r) => (
          <div key={r.version} className="card" style={{ padding: 'var(--space-4)', display: 'flex', gap: 'var(--space-4)' }}>
            <div className="chip chip-accent" style={{ flexShrink: 0, height: 'fit-content' }}>{r.version}</div>
            <div>
              <p style={{ margin: '0 0 4px', color: 'var(--ink-mut)', fontSize: 'var(--text-xs)' }}>{r.date}</p>
              <p style={{ margin: 0 }}>{r.note}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function BuiltForEngineers() {
  return (
    <section className="grid-bg" style={{ padding: 'var(--space-12) var(--space-6)', background: 'var(--surface-sunken)' }}>
      <div
        style={{
          maxWidth: '1200px',
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 'var(--space-8)',
          alignItems: 'center',
        }}
      >
        <div>
          <h2 style={{ margin: '0 0 var(--space-4)' }}>Built for Engineers</h2>
          <p style={{ color: 'var(--ink-mut)', fontSize: 'var(--text-lg)', margin: '0 0 var(--space-6)' }}>
            FlowForge is API-first and CLI-driven. We provide the primitives, you provide the logic. No proprietary
            locks, just standard protocols.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
            <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
              <span className="icon-well icon-well-accent" style={{ width: 24, height: 24, flexShrink: 0 }}>▸</span>
              <div>
                <strong>Robust CLI</strong>
                <p style={{ margin: 0, color: 'var(--ink-mut)' }}>
                  Deploy, debug, and monitor from your terminal with <code>ff-cli</code>.
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
              <span className="icon-well icon-well-accent" style={{ width: 24, height: 24, flexShrink: 0 }}>⌁</span>
              <div>
                <strong>gRPC &amp; GraphQL API</strong>
                <p style={{ margin: 0, color: 'var(--ink-mut)' }}>Integrate into your existing CI/CD pipelines with ease.</p>
              </div>
            </div>
          </div>
          <Link to="/docs" style={{ fontWeight: 600 }}>
            Explore Developer Documentation →
          </Link>
        </div>
        <CodePanel />
      </div>
    </section>
  );
}

function CodePanel() {
  const lines = [
    ['version', '"2.4"'],
    ['kind', 'Workflow'],
    ['metadata:', ''],
    ['  name', 'data-ingestion-pipeline'],
    ['spec:', ''],
    ['  nodes:', ''],
    ['  - id', 'fetch_data'],
    ['    image', 'python:3.9-slim'],
    ['  - id', 'transform'],
    ['    dependencies', '[fetch_data]'],
  ];
  return (
    <div className="card" style={{ overflow: 'hidden', background: 'var(--surface-sunken)' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: 'var(--space-2) var(--space-4)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--border)' }} />
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--border)' }} />
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--border)' }} />
        </div>
        <span style={{ fontSize: 10, color: 'var(--ink-mut)', letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.6 }}>
          forge.yaml
        </span>
      </div>
      <div style={{ padding: 'var(--space-4)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>
        {lines.map(([key, val], i) => (
          <div key={i} style={{ display: 'flex', gap: 'var(--space-3)', lineHeight: 1.7 }}>
            <span style={{ opacity: 0.25, width: 16 }}>{i + 1}</span>
            <span>
              <span style={{ color: 'var(--accent)' }}>{key}</span>
              {val && ': '}
              {val && <span style={{ color: 'var(--ink-mut)' }}>{val}</span>}
            </span>
          </div>
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: 'var(--space-3) var(--space-4)',
          borderTop: '1px solid var(--border)',
        }}
      >
        <span style={{ fontSize: 10, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} /> VALID SYNTAX
        </span>
        <button className="chip chip-accent" style={{ border: 'none', fontSize: 10 }}>
          COPY CONFIG
        </button>
      </div>
    </div>
  );
}

function FinalCta() {
  return (
    <section style={{ padding: 'var(--space-12) var(--space-6)', textAlign: 'center' }}>
      <div className="card" style={{ maxWidth: '720px', margin: '0 auto', padding: 'var(--space-12)' }}>
        <h2 style={{ margin: '0 0 var(--space-3)' }}>Ready to scale?</h2>
        <p style={{ color: 'var(--ink-mut)', fontSize: 'var(--text-lg)', margin: '0 0 var(--space-6)' }}>
          Join over 10,000+ developers orchestrating their future on FlowForge.
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link to="/login">
            <button className="btn-primary" style={{ padding: '12px 28px', fontSize: 'var(--text-lg)' }}>
              Get Started Free
            </button>
          </Link>
          <button className="btn-ghost" style={{ padding: '12px 28px', fontSize: 'var(--text-lg)', border: '1px solid var(--border)' }}>
            Contact Sales
          </button>
        </div>
      </div>
    </section>
  );
}

/** `to` omitted -> rendered as plain (non-clickable) text; no page exists to send it to yet. */
const FOOTER_COLUMNS: { title: string; links: { label: string; to?: string }[] }[] = [
  {
    title: 'Product',
    links: [{ label: 'Features', to: '/#features' }, { label: 'Changelog', to: '/#changelog' }],
  },
  {
    title: 'Resources',
    links: [{ label: 'Documentation', to: '/docs' }, { label: 'API Reference', to: '/docs' }],
  },
];

function Footer() {
  return (
    <footer style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-sunken)', padding: 'var(--space-12) var(--space-6)' }}>
      <div
        style={{
          maxWidth: '1200px',
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: '2fr repeat(3, 1fr)',
          gap: 'var(--space-8)',
          marginBottom: 'var(--space-8)',
        }}
      >
        <div>
          <span style={{ fontWeight: 800, fontSize: 'var(--text-xl)', color: 'var(--accent)', display: 'block', marginBottom: 'var(--space-3)' }}>
            FlowForge
          </span>
          <p style={{ color: 'var(--ink-mut)', maxWidth: '260px' }}>
            The orchestration layer for the modern enterprise. Scale effortlessly, observe everything.
          </p>
        </div>
        {FOOTER_COLUMNS.map((col) => (
          <div key={col.title}>
            <h5 style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 'var(--space-4)' }}>
              {col.title}
            </h5>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {col.links.map((link) =>
                link.to ? (
                  <li key={link.label}>
                    <Link to={link.to} style={{ color: 'var(--ink-mut)' }}>
                      {link.label}
                    </Link>
                  </li>
                ) : (
                  <li key={link.label} style={{ color: 'var(--ink-mut)', opacity: 0.5 }}>
                    {link.label}
                  </li>
                ),
              )}
            </ul>
          </div>
        ))}
        <div>
          <h5 style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 'var(--space-4)' }}>
            Status
          </h5>
          <div className="chip chip-accent">● ALL SYSTEMS OPERATIONAL</div>
        </div>
      </div>
      <div
        style={{
          maxWidth: '1200px',
          margin: '0 auto',
          paddingTop: 'var(--space-6)',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 'var(--space-4)',
          color: 'var(--ink-mut)',
          fontSize: 'var(--text-sm)',
        }}
      >
        <span>© 2026 FlowForge Orchestration Inc. All rights reserved.</span>
      </div>
    </footer>
  );
}
