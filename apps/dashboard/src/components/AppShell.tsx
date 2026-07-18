import { NavLink, Outlet, Link } from 'react-router-dom';
import { useAuth } from '../auth/useAuth.js';
import { IconHome, IconLogout, IconRuns, IconWorkflow } from './icons.js';
import { TenantSwitcher } from './TenantSwitcher.js';

const NAV_ITEMS = [
  { to: '/overview', end: true, label: 'Dashboard', icon: IconHome },
  { to: '/workflows', end: false, label: 'Workflows', icon: IconWorkflow },
  { to: '/runs', end: false, label: 'History', icon: IconRuns },
];

const SIDEBAR_WIDTH = 260;

/**
 * Left sidebar shell (mission-control layout, matching the exact styling in mockup).
 */
export function AppShell() {
  const { user, logout } = useAuth();

  return (
    <div style={{ background: '#0b1326', minHeight: '100vh', color: '#dae2fd' }}>
      <aside
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          width: SIDEBAR_WIDTH,
          display: 'flex',
          flexDirection: 'column',
          padding: 'var(--space-6) var(--space-4)',
          background: '#0d1527',
          borderRight: '1px solid #1f293d',
          zIndex: 'var(--z-sticky)',
        }}
      >
        {/* Brand Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '32px', paddingLeft: '8px' }}>
          <div style={{
            background: '#2563eb',
            borderRadius: '8px',
            width: '36px',
            height: '36px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="m13 17 5-5-5-5M6 17l5-5-5-5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div>
            <div style={{ fontWeight: 'bold', fontSize: '20px', letterSpacing: '-0.02em', color: '#fff', lineHeight: 1.1 }}>FlowForge</div>
            <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 'bold', letterSpacing: '0.1em' }}>V2.4.0</div>
          </div>
        </div>

        {/* New Workflow Action Button */}
        <Link to="/workflows/new" style={{ textDecoration: 'none', marginBottom: '24px' }}>
          <button
            type="button"
            style={{
              width: '100%',
              background: '#2563eb',
              color: 'white',
              border: 'none',
              padding: '12px',
              borderRadius: '8px',
              fontWeight: 600,
              fontSize: '14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow: '0 4px 12px rgba(37, 99, 235, 0.2)',
              cursor: 'pointer',
            }}
          >
            <span>+</span> New Workflow
          </button>
        </Link>

        {/* Main Navigation */}
        <nav aria-label="Primary" style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
          {NAV_ITEMS.map(({ to, end, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px 16px',
                borderRadius: '8px',
                color: isActive ? '#fff' : '#94a3b8',
                background: isActive ? '#2563eb' : 'transparent',
                fontWeight: isActive ? 600 : 500,
                textDecoration: 'none',
                transition: 'all 0.2s',
              })}
            >
              <Icon width={20} height={20} />
              {label}
            </NavLink>
          ))}
        </nav>
        {/* Bottom Section (Settings / Log out) */}
        <div style={{ borderTop: '1px solid #1f293d', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <TenantSwitcher />
          <div style={{ padding: '0 16px', lineHeight: 1.3 }}>
            <div data-testid="user-email" style={{ fontSize: '13px', color: '#dae2fd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.email}
            </div>
            <div data-testid="user-role" style={{ color: '#64748b', fontSize: '11px' }}>
              {user?.role}
            </div>
          </div>
          <NavLink
            to="/settings"
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '12px 16px',
              borderRadius: '8px',
              color: isActive ? '#fff' : '#94a3b8',
              background: isActive ? '#2563eb' : 'transparent',
              fontWeight: isActive ? 600 : 500,
              textDecoration: 'none',
            })}
          >
            <span style={{ fontSize: '18px' }}>⚙</span>
            Settings
          </NavLink>
          <button
            type="button"
            className="btn-ghost"
            onClick={logout}
            style={{
              width: '100%',
              textAlign: 'left',
              padding: '12px 16px',
              color: '#94a3b8',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
              <IconLogout width={18} height={18} />
              Log out
            </span>
          </button>
        </div>
      </aside>
      <main style={{ marginLeft: SIDEBAR_WIDTH, minHeight: '100vh', padding: 'var(--space-8) var(--space-6) var(--space-12)', background: '#0b1326' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
