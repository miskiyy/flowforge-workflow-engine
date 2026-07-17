import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Route-level boundary (§12) — one unhandled render error shouldn't blank
 * the whole app. Wrapped around the routed tree, keyed by pathname (App.tsx)
 * so navigating away from a crashed page remounts and recovers it.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled error rendering this route:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <main data-testid="error-boundary" role="alert" style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
          <h1 tabIndex={-1} style={{ fontSize: 'var(--text-xl)' }}>
            Something went wrong
          </h1>
          <p style={{ color: 'var(--ink-mut)' }}>{this.state.error.message}</p>
        </main>
      );
    }
    return this.props.children;
  }
}
