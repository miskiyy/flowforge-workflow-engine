import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './useAuth.js';

/** No token -> any protected route redirects to /login?next=… (frontend-design.md §5). */
export function ProtectedRoute() {
  const { token } = useAuth();
  const location = useLocation();

  if (!token) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  return <Outlet />;
}
