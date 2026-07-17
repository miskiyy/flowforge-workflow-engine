import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

interface ToastMessage {
  id: number;
  message: string;
}

interface ToastContextValue {
  showToast: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextToastId = 0;

function ToastItem({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 5000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      role="status"
      data-testid="toast"
      style={{ background: 'var(--ink)', color: 'var(--bg)', padding: 'var(--space-3) var(--space-4)', borderRadius: 8 }}
    >
      {message}
      <button type="button" onClick={onDismiss} aria-label="Dismiss" style={{ marginLeft: 'var(--space-3)' }}>
        ×
      </button>
    </div>
  );
}

/**
 * A container mounted once at the app root (§12) — any component calls
 * `useToast().showToast(...)` instead of owning its own toast state, so
 * toasts stack correctly if more than one fires in quick succession.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = useCallback((message: string) => {
    setToasts((current) => [...current, { id: nextToastId++, message }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        data-testid="toast-container"
        style={{
          position: 'fixed',
          bottom: 'var(--space-4)',
          right: 'var(--space-4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
          zIndex: 'var(--z-toast)',
        }}
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} message={toast.message} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
