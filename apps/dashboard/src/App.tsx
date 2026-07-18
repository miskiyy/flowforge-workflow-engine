import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { createQueryClient } from './api/client.js';
import { AppShell } from './components/AppShell.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { ToastProvider } from './components/Toast.js';
import { AuthProvider } from './auth/AuthProvider.js';
import { ProtectedRoute } from './auth/ProtectedRoute.js';
import { useAuth } from './auth/useAuth.js';
import { HealthPage } from './pages/HealthPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { OverviewPage } from './pages/OverviewPage.js';
import { RunDetailPage } from './pages/RunDetailPage.js';
import { RunsPage } from './pages/RunsPage.js';
import { WorkflowDetailPage } from './pages/WorkflowDetailPage.js';
import { WorkflowEditorPage } from './pages/WorkflowEditorPage.js';
import { WorkflowsPage } from './pages/WorkflowsPage.js';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

function RunRoute() {
  const { id } = useParams<{ id: string }>();
  const { token } = useAuth();
  if (!id || !token) return null;
  return <RunDetailPage apiUrl={API_URL} runId={id} token={token} />;
}

/** No marketing page — logged-out visitors go straight to sign-in; authenticated users land in the dashboard. */
function RootRoute() {
  const { token } = useAuth();
  return <Navigate to={token ? '/overview' : '/login'} replace />;
}

function NotFoundPage() {
  return (
    <main data-testid="not-found-page">
      <h1 tabIndex={-1}>Not found</h1>
      <p>
        <Link to="/">Back to FlowForge</Link>
      </p>
    </main>
  );
}

/**
 * Routes per frontend-design.md §3.
 *
 * Keyed by pathname so an unhandled render error on one route doesn't
 * permanently blank the app — navigating away remounts a fresh boundary
 * (§12).
 */
/** SPAs strand screen-reader focus on navigation otherwise — move it to the new page's <h1> (§12). */
function useFocusHeadingOnRouteChange(pathname: string): void {
  useEffect(() => {
    document.querySelector<HTMLElement>('h1[tabindex="-1"]')?.focus();
  }, [pathname]);
}

function AppRoutes() {
  const location = useLocation();
  useFocusHeadingOnRouteChange(location.pathname);
  return (
    <ErrorBoundary key={location.pathname}>
      <Routes>
        <Route path="/" element={<RootRoute />} />
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route path="overview" element={<OverviewPage />} />
            <Route path="workflows" element={<WorkflowsPage />} />
            <Route path="workflows/new" element={<WorkflowEditorPage />} />
            <Route path="workflows/:id" element={<WorkflowDetailPage />} />
            <Route path="workflows/:id/edit" element={<WorkflowEditorPage />} />
            <Route path="runs" element={<RunsPage />} />
            <Route path="runs/:id" element={<RunRoute />} />
            <Route path="health" element={<HealthPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}

export function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}
