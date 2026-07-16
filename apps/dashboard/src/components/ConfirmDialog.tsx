import { useEffect, useRef } from 'react';

/**
 * Native `<dialog>` — free focus trap, top-layer stacking, Esc-to-cancel
 * (the browser fires `cancel` on Escape while modal), and focus restore to
 * whatever had focus before `showModal()` (all per the HTML living standard,
 * §12: "zero deps"). Mount-controlled by the caller (`{condition && <ConfirmDialog .../>}`)
 * rather than an `open` prop, so only one dialog ever exists in the DOM at a
 * time. `showModal` is guarded because jsdom (test environment) doesn't
 * implement it — falls back to the `open` attribute so the dialog is still
 * inspectable in tests.
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel = 'Confirm',
  onConfirm,
  onCancel,
}: {
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal?.();
    if (!dialog.open) dialog.setAttribute('open', '');
    cancelRef.current?.focus(); // focus the safe (non-destructive) action
  }, []);

  return (
    <dialog
      ref={dialogRef}
      data-testid="confirm-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 'var(--space-4)' }}
    >
      <p style={{ marginTop: 0, fontWeight: 600 }}>{title}</p>
      <p style={{ color: 'var(--ink-mut)' }}>{description}</p>
      <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
        <button type="button" ref={cancelRef} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
