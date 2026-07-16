import type { CSSProperties } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/useAuth.js';

function navLinkStyle({ isActive }: { isActive: boolean }): CSSProperties {
  return { color: isActive ? 'var(--accent)' : 'var(--ink)', fontWeight: isActive ? 600 : 400 };
}

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
          padding: 'var(--space-3) var(--space-6)',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg)',
          boxShadow: 'var(--shadow-sm)',
          position: 'sticky',
          top: 0,
          zIndex: 'var(--z-sticky)',
        }}
      >
        <nav aria-label="Primary" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-6)' }}>
          <NavLink to="/" style={{ textDecoration: 'none', color: 'var(--ink)' }}>
            <strong>FlowForge</strong>
          </NavLink>
          <NavLink to="/" end style={navLinkStyle}>
            Home
          </NavLink>
          <NavLink to="/workflows" style={navLinkStyle}>
            Workflows
          </NavLink>
          <NavLink to="/runs" style={navLinkStyle}>
            Runs
          </NavLink>
          <NavLink to="/health" style={navLinkStyle}>
            Health
          </NavLink>
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <span data-testid="user-email">{user?.email}</span>
          <span data-testid="user-role" style={{ color: 'var(--ink-mut)', fontSize: 'var(--text-xs)' }}>
            {user?.role}
          </span>
          <button type="button" onClick={logout}>
            Log out
          </button>
        </div>
      </header>
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: 'var(--space-6) var(--space-6) var(--space-12)' }}>
        <Outlet />
      </main>
    </div>
  );
}
