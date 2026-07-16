import type { CSSProperties } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/useAuth.js';
import { IconHealth, IconHome, IconLogout, IconRuns, IconWorkflow } from './icons.js';

const NAV_ITEMS = [
  { to: '/', end: true, label: 'Home', icon: IconHome },
  { to: '/workflows', end: false, label: 'Workflows', icon: IconWorkflow },
  { to: '/runs', end: false, label: 'Runs', icon: IconRuns },
  { to: '/health', end: false, label: 'Health', icon: IconHealth },
];

function navLinkClassName({ isActive }: { isActive: boolean }): string {
  return isActive ? 'nav-link nav-link-active' : 'nav-link';
}

const logoMarkStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 26,
  height: 26,
  borderRadius: 7,
  background: 'var(--accent)',
  color: '#fff',
  flexShrink: 0,
};

/**
 * Flat top bar, no sidebar (frontend-design.md §4). Home orients the user;
 * Workflows and Runs map to the two backend resources; Health is the
 * GET /stats panel (P10).
 */
export function AppShell() {
  const { user, logout } = useAuth();

  return (
    <div>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-4) var(--space-6)',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg)',
          boxShadow: 'var(--shadow-sm)',
          position: 'sticky',
          top: 0,
          zIndex: 'var(--z-sticky)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-8)' }}>
          <NavLink
            to="/"
            end
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', textDecoration: 'none', color: 'var(--ink)' }}
          >
            <span aria-hidden="true" style={logoMarkStyle}>
              <svg width="15" height="15" viewBox="0 0 20 20" fill="none">
                <circle cx="4.5" cy="5" r="2" fill="currentColor" />
                <circle cx="4.5" cy="15" r="2" fill="currentColor" />
                <circle cx="15.5" cy="10" r="2" fill="currentColor" />
                <path d="M6.3 5.8 13.8 9M6.3 14.2 13.8 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </span>
            <strong style={{ fontSize: 'var(--text-lg)', letterSpacing: '-0.01em' }}>FlowForge</strong>
          </NavLink>
          <nav aria-label="Primary" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-6)' }}>
            {NAV_ITEMS.map(({ to, end, label, icon: Icon }) => (
              <NavLink key={to} to={to} end={end} className={navLinkClassName}>
                <Icon width={17} height={17} />
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.3 }}>
            <span data-testid="user-email" style={{ fontSize: 'var(--text-sm)' }}>
              {user?.email}
            </span>
            <span data-testid="user-role" style={{ color: 'var(--ink-mut)', fontSize: 'var(--text-xs)' }}>
              {user?.role}
            </span>
          </div>
          <button type="button" className="btn-ghost" onClick={logout}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <IconLogout width={16} height={16} />
              Log out
            </span>
          </button>
        </div>
      </header>
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: 'var(--space-8) var(--space-6) var(--space-12)' }}>
        <Outlet />
      </main>
    </div>
  );
}
