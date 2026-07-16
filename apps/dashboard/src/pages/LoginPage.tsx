import { useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { LoginError } from '../auth/AuthProvider.js';
import { useAuth } from '../auth/useAuth.js';
import { IconWorkflow } from '../components/icons.js';

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
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-8)',
        background: 'var(--surface)',
        padding: 'var(--space-6)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <span
          aria-hidden="true"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            borderRadius: 8,
            background: 'var(--accent)',
            color: '#fff',
          }}
        >
          <IconWorkflow width={19} height={19} />
        </span>
        <strong style={{ fontSize: 'var(--text-lg)', letterSpacing: '-0.01em' }}>FlowForge</strong>
      </div>

      <div className="card" style={{ width: '100%', maxWidth: 360, padding: 'var(--space-8)' }}>
        <h1 tabIndex={-1} style={{ fontSize: 'var(--text-xl)', margin: '0 0 var(--space-1)' }}>
          Sign in
        </h1>
        <p style={{ color: 'var(--ink-mut)', margin: '0 0 var(--space-6)', lineHeight: 1.6 }}>
          Build workflows as DAGs, run them, and watch each step execute live.
        </p>
        {import.meta.env.DEV ? (
          <p
            data-testid="demo-credentials"
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--ink-mut)',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: 'var(--space-2) var(--space-3)',
              marginBottom: 'var(--space-4)',
            }}
          >
            Demo login: <code>editor@acme.dev</code> / <code>password123</code>
          </p>
        ) : null}
        {error ? (
          <p
            role="alert"
            data-testid="login-error"
            style={{
              color: 'var(--status-failed)',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 'var(--radius)',
              padding: 'var(--space-2) var(--space-3)',
              margin: '0 0 var(--space-4)',
              fontSize: 'var(--text-sm)',
            }}
          >
            {error}
          </p>
        ) : null}
        <form onSubmit={(event) => void handleSubmit(event)} noValidate>
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <label htmlFor="login-email" style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 500, marginBottom: 'var(--space-1)' }}>
              Email
            </label>
            <input
              id="login-email"
              ref={emailRef}
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ marginBottom: 'var(--space-6)' }}>
            <label
              htmlFor="login-password"
              style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 500, marginBottom: 'var(--space-1)' }}
            >
              Password
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              style={{ width: '100%' }}
            />
          </div>
          <button type="submit" className="btn-primary" disabled={submitting} style={{ width: '100%' }}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  );
}
