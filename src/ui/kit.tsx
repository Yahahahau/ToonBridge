// Small, consistent component set (GitHub-style density, ToonBridge tokens).
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

type Variant = 'default' | 'primary' | 'invisible' | 'danger';
export function Button({ variant = 'default', size = 'md', icon, children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: IconName }) {
  return <button {...rest} className={`btn btn-${variant} btn-${size} ${className}`}>{icon && <Icon name={icon} size={size === 'lg' ? 18 : 16} />}{children}</button>;
}
export function LinkButton({ variant = 'default', size = 'md', icon, children, className = '', ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: IconName }) {
  return <a {...rest} className={`btn btn-${variant} btn-${size} ${className}`}>{icon && <Icon name={icon} size={size === 'lg' ? 18 : 16} />}{children}</a>;
}
/** Icon-only button with a tooltip (label is also the accessible name). */
export function IconButton({ icon, label, tipSide = 'bottom', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; tipSide?: 'bottom' | 'top' | 'left' }) {
  return <button {...rest} className={`btn btn-default btn-icon ${rest.className ?? ''}`} aria-label={label} data-tip={label} data-tip-side={tipSide}><Icon name={icon} size={16} /></button>;
}

export type Tone = 'neutral' | 'accent' | 'success' | 'attention' | 'danger' | 'info';
export function Label({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`label label-${tone}`}>{children}</span>;
}
export function Banner({ tone = 'info', icon, title, children, actions }: { tone?: Tone; icon?: IconName; title?: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  const def: Record<Tone, IconName> = { info: 'info', accent: 'info', neutral: 'info', success: 'check', attention: 'alert', danger: 'alert' };
  return (
    <div className={`banner banner-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon name={icon ?? def[tone]} size={16} className="banner-icon" />
      <div className="banner-body">{title && <strong>{title}</strong>}{children && <div>{children}</div>}</div>
      {actions && <div className="banner-actions">{actions}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: string; icon?: IconName; count?: number | string; disabled?: boolean }[]; value: T; onChange: (t: T) => void; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} disabled={t.disabled} className="tab" onClick={() => onChange(t.id)}>
          {t.icon && <Icon name={t.icon} size={16} />}<span>{t.label}</span>{t.count !== undefined && <span className="counter">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Menu button + popover. Closes on outside click / Escape; arrow keys move between items. */
export function Dropdown({ button, items, align = 'right', label }: { button: ReactNode; label: string; align?: 'left' | 'right'; items: { id: string; label: string; icon?: IconName; checked?: boolean; onSelect: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); (wrap.current?.querySelector('.dd-trigger') as HTMLElement | null)?.focus(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const els = [...(wrap.current?.querySelectorAll<HTMLElement>('[role=menuitemradio],[role=menuitem]') ?? [])];
        const i = els.indexOf(document.activeElement as HTMLElement);
        els[(i + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length]?.focus(); e.preventDefault();
      }
    };
    document.addEventListener('mousedown', off); document.addEventListener('keydown', key);
    requestAnimationFrame(() => (wrap.current?.querySelector('[role^=menuitem]') as HTMLElement | null)?.focus());
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <div className="dd" ref={wrap}>
      <button className="btn btn-default btn-md dd-trigger" aria-haspopup="menu" aria-expanded={open} aria-controls={id} aria-label={label} onClick={() => setOpen((o) => !o)}>{button}<Icon name="chevron" size={14} /></button>
      {open && (
        <div className={`dd-menu dd-${align}`} role="menu" id={id}>
          {items.map((it) => (
            <button key={it.id} role={it.checked === undefined ? 'menuitem' : 'menuitemradio'} aria-checked={it.checked} className="dd-item" onClick={() => { it.onSelect(); setOpen(false); }}>
              <span className="dd-check">{it.checked && <Icon name="check" size={14} />}</span>{it.icon && <Icon name={it.icon} size={16} />}<span>{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty"><span className="empty-icon"><Icon name={icon} size={24} /></span><h3>{title}</h3>{children && <p>{children}</p>}{action}</div>;
}
export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-hidden="true" />;
}
/** A bordered box with a header row, like a GitHub "Box". */
export function Box({ title, actions, children, className = '', flush }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={`box ${className}`}>
      {(title || actions) && <header className="box-head"><h2>{title}</h2>{actions && <div className="box-actions">{actions}</div>}</header>}
      <div className={flush ? 'box-body flush' : 'box-body'}>{children}</div>
    </section>
  );
}
