import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from '../atoms/Button.tsx';

export interface DialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly actions?: ReactNode;
}

export function Dialog({ open, title, onClose, children, actions }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  /**
   * Move focus in, and give it back on the way out.
   *
   * `aria-modal="true"` without this is a declaration with nothing behind it: the keyboard user who
   * opened the dialog is still focused on the button behind the overlay, so their next Tab walks the
   * page they cannot see, and Escape closes something they cannot see either. Focus returns to
   * whatever opened it, so dismissing a dialog leaves the user where they were.
   *
   * Focus goes to the panel rather than to the first control: it announces the dialog's name on open,
   * and a dialog whose first field is auto-focused makes a short confirmation feel like the app
   * filled something in without being asked.
   */
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panel?.focus();
    return () => {
      // `isConnected` guards the case where the opener unmounted while the dialog was open —
      // focusing a detached node silently does nothing in some browsers and throws in others.
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        // Focusable so it can *take* focus. `outline-none` because the panel itself is not an
        // interactive control and should not draw a ring around its whole box.
        tabIndex={-1}
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <div className="mt-3 text-sm text-slate-600">{children}</div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
          {actions}
        </div>
      </div>
    </div>
  );
}
