import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Prefix for element ids. */
  id: string;
  children: ReactNode;
  wide?: boolean;
}

/**
 * A modal dialog on the native <dialog> element: the browser handles focus, Esc,
 * and keeping the rest of the page inert. Content mounts only while open.
 */
export function Dialog({ open, onClose, title, id, children, wide = false }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`dialog${wide ? ' wide' : ''}`}
      aria-labelledby={`${id}-h`}
      onClose={onClose}
      // A click on the backdrop lands on the <dialog> itself (the content fills it).
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="dialog-inner">
          <div className="dialog-head">
            <h2 id={`${id}-h`}>{title}</h2>
            <button type="button" className="icon" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
          <div className="dialog-body">{children}</div>
        </div>
      )}
    </dialog>
  );
}
