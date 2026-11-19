import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

export function Dialog({ title, onClose, actions, children }: { title: string; onClose: () => void; actions?: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); return () => d?.close(); }, []);
  return (
    <dialog ref={ref} className="dlg" onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }} aria-label={title}>
      <div className="dlg-body">
        <header className="dlg-head">
          <h2>{title}</h2>
          <div className="row">
            {actions}
            <button className="btn icon" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
          </div>
        </header>
        {children}
      </div>
    </dialog>
  );
}
