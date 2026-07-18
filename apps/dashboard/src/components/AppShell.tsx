import type { CSSProperties } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/useAuth.js';
import { IconHealth, IconHome, IconLogout, IconRuns, IconWorkflow } from './icons.js';
import { TenantSwitcher } from './TenantSwitcher.js';

const NAV_ITEMS = [
  { to: '/', end: true, label: 'Home', icon: IconHome },
  { to: '/workflows', end: false, label: 'Workflows', icon: IconWorkflow },
  { to: '/runs', end: false, label: 'Runs', icon: IconRuns },
  { to: '/health', end: false, label: 'Health', icon: IconHealth },
  { to: '/settings', end: false, label: 'Settings', icon: IconWorkflow },
];

const SIDEBAR_WIDTH = 240;

function navLinkClassName({ isActive }: { isActive: boolean }): string {
  return isActive ? 'nav-link nav-link-active' : 'nav-link';
}

const logoMarkStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 32,
  height: 32,
  borderRadius: 8,
  background: 'var(--accent-subtle)',
  border: '1px solid var(--accent-subtle-border)',
  color: 'var(--accent)',
  flexShrink: 0,
};

/**
 * Left sidebar shell (mission-control layout, stitch/ reference). Home
 * orients the user; Workflows and Runs map to the two backend resources;
 * Health is the GET /stats panel (P10).
 */
export function AppShell() {
  const { user, logout } = useAuth();

  return (
    <div>
      <aside
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          width: SIDEBAR_WIDTH,
          display: 'flex',
          flexDirection: 'column',
          padding: 'var(--space-4) var(--space-3)',
          background: 'var(--surface-raised)',
          borderRight: '1px solid var(--border)',
          zIndex: 'var(--z-sticky)',
        }}
      >
        <NavLink
          to="/overview"
          end
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            textDecoration: 'none',
            color: 'var(--ink)',
            padding: 'var(--space-2)',
            marginBottom: 'var(--space-6)',
          }}
        >
          <span aria-hidden="true" style={logoMarkStyle}>
            <svg width="17" height="17" viewBox="0 0 20 20" fill="none">
              <circle cx="4.5" cy="5" r="2" fill="currentColor" />
              <circle cx="4.5" cy="15" r="2" fill="currentColor" />
              <circle cx="15.5" cy="10" r="2" fill="currentColor" />
              <path d="M6.3 5.8 13.8 9M6.3 14.2 13.8 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </span>
          <strong style={{ fontSize: 'var(--text-lg)', letterSpacing: '-0.01em' }}>FlowForge</strong>
        </NavLink>
        <nav aria-label="Primary" style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
          {NAV_ITEMS.map(({ to, end, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={end} className={navLinkClassName}>
              <Icon width={18} height={18} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <TenantSwitcher />
          <div style={{ padding: '0 var(--space-2)', lineHeight: 1.3 }}>
            <div data-testid="user-email" style={{ fontSize: 'var(--text-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.email}
            </div>
            <div data-testid="user-role" style={{ color: 'var(--ink-mut)', fontSize: 'var(--text-xs)' }}>
              {user?.role}
            </div>
          </div>
          <button type="button" className="btn-ghost" onClick={logout} style={{ width: '100%', textAlign: 'left' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <IconLogout width={16} height={16} />
              Log out
            </span>
          </button>
        </div>
      </aside>
      <main style={{ marginLeft: SIDEBAR_WIDTH, minHeight: '100vh', padding: 'var(--space-8) var(--space-6) var(--space-12)' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
