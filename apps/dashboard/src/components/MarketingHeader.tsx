import { Link } from 'react-router-dom';

const NAV_LINKS = [
  { label: 'Documentation', href: '/docs' },
  { label: 'Changelog', href: '/#changelog' },
];

/** Shared header for public marketing pages (landing, docs) — same header, different body. */
export function MarketingHeader() {
  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 'var(--z-sticky)' as unknown as number,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 64,
        padding: '0 var(--space-6)',
        background: 'var(--glass-bg)',
        backdropFilter: 'blur(var(--glass-blur))',
        WebkitBackdropFilter: 'blur(var(--glass-blur))',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-8)' }}>
        <Link
          to="/"
          style={{ fontWeight: 800, fontSize: 'var(--text-xl)', color: 'var(--accent)', letterSpacing: '-0.01em' }}
        >
          FlowForge
        </Link>
        <nav style={{ display: 'flex', gap: 'var(--space-6)' }}>
          {NAV_LINKS.map(({ label, href }) => (
            <Link key={label} to={href} style={{ color: 'var(--ink-mut)', fontSize: 'var(--text-sm)', fontWeight: 500 }}>
              {label}
            </Link>
          ))}
        </nav>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <Link to="/login">
          <button className="btn-ghost">Log In</button>
        </Link>
        <Link to="/login">
          <button className="btn-primary">Get Started Free</button>
        </Link>
      </div>
    </header>
  );
}
