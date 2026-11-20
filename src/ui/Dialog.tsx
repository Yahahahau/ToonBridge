import { useEffect, useRef, type ReactNode } from 'react';
import { IconButton } from './kit';

/** Native <dialog> (focus trap, Escape, backdrop) styled as a GitHub-like overlay. */
export function Dialog({ title, onClose, footer, children }: { title: string; onClose: () => void; footer?: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); return () => d?.close(); }, []);
  return (
    <dialog ref={ref} className="dialog" onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }} aria-label={title}>
      <header className="dialog-head"><h2>{title}</h2><IconButton icon="x" label="Close" onClick={onClose} tipSide="left" /></header>
      <div className="dialog-body">{children}</div>
      {footer && <footer className="dialog-foot">{footer}</footer>}
    </dialog>
  );
}
