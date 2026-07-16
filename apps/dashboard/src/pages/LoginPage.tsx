import { useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { LoginError } from '../auth/AuthProvider.js';
import { useAuth } from '../auth/useAuth.js';

export function LoginPage() {
  const { token, login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const emailRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (token) {
    return <Navigate to={searchParams.get('next') ?? '/'} replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      navigate(searchParams.get('next') ?? '/', { replace: true });
    } catch (err) {
      setPassword('');
      setError(err instanceof LoginError ? err.message : 'Something went wrong. Try again.');
      emailRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={{ maxWidth: 320, margin: '10vh auto', padding: 'var(--space-4)' }}>
      <h1 tabIndex={-1} style={{ fontSize: 'var(--text-xl)', marginBottom: 'var(--space-1)' }}>
        Sign in
      </h1>
      <p style={{ color: 'var(--ink-mut)', marginTop: 0, marginBottom: 'var(--space-4)' }}>
        FlowForge — build workflows as DAGs, run them, and watch each step execute live.
      </p>
      {import.meta.env.DEV ? (
        <p
          data-testid="demo-credentials"
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--ink-mut)',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 'var(--space-2) var(--space-3)',
            marginBottom: 'var(--space-4)',
          }}
        >
          Demo login: <code>editor@acme.dev</code> / <code>password123</code>
        </p>
      ) : null}
      {error ? (
        <p role="alert" data-testid="login-error" style={{ color: 'var(--status-failed)' }}>
          {error}
        </p>
      ) : null}
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <div style={{ marginBottom: 'var(--space-3)' }}>
          <label htmlFor="login-email">Email</label>
          <br />
          <input
            id="login-email"
            ref={emailRef}
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <label htmlFor="login-password">Password</label>
          <br />
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
