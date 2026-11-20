import { useEffect, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { Dropdown, IconButton } from './kit';
import type { Route } from '../state/route';
import type { ThemePref } from '../state/theme';
import { REPO_URL } from '../links';

const NAV: { id: Route; label: string; icon: IconName }[] = [
  { id: 'convert', label: 'Convert', icon: 'bolt' },
  { id: 'history', label: 'Conversion history', icon: 'history' },
  { id: 'settings', label: 'Settings', icon: 'gear' },
  { id: 'about', label: 'About ToonBridge', icon: 'info' },
];
const THEME_ICON: Record<ThemePref, IconName> = { system: 'monitor', light: 'sun', dark: 'moon' };

interface Props {
  route: Route; go: (r: Route) => void; theme: ThemePref; setTheme: (t: ThemePref) => void;
  navOpen: boolean; setNavOpen: (o: boolean) => void; historyCount: number; busy: boolean; children: ReactNode;
}

export function Shell({ route, go, theme, setTheme, navOpen, setNavOpen, historyCount, busy, children }: Props) {
  useEffect(() => {
    if (!navOpen) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setNavOpen(false); };
    document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k);
  }, [navOpen, setNavOpen]);
  const nav = (r: Route) => { go(r); setNavOpen(false); };

  return (
    <div className="shell">
      <a className="skip" href="#main">Skip to content</a>
      <header className="header">
        <IconButton icon="menu" label="Open navigation" className="only-narrow" onClick={() => setNavOpen(!navOpen)} aria-expanded={navOpen} aria-controls="sidenav" />
        <a className="brand" href="#/convert" onClick={() => setNavOpen(false)}>
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} width="32" height="32" alt="" />
          <span>ToonBridge</span>
        </a>
        <span className="header-crumb hide-sm" aria-hidden="true">/</span>
        <span className="header-context hide-sm">Animate → ToonSquid</span>
        <nav className="header-nav hide-md" aria-label="Resources">
          <a href={`${REPO_URL}#readme`} target="_blank" rel="noopener noreferrer">Docs</a>
          <a href={`${REPO_URL}/issues`} target="_blank" rel="noopener noreferrer">Feedback</a>
        </nav>
        <div className="header-actions">
          {busy && <span className="header-busy" role="status"><span className="spinner" aria-hidden="true" /> <span className="hide-sm">Converting…</span></span>}
          <Dropdown label={`Theme: ${theme}`} button={<Icon name={THEME_ICON[theme]} size={16} />} items={(['system', 'light', 'dark'] as ThemePref[]).map((t) => ({ id: t, label: t === 'system' ? 'Match system' : t === 'light' ? 'Light' : 'Dark', icon: THEME_ICON[t], checked: theme === t, onSelect: () => setTheme(t) }))} />
          <IconButton icon="gear" label="Settings" onClick={() => nav('settings')} />
          <a className="btn btn-default btn-icon" href={REPO_URL} target="_blank" rel="noopener noreferrer" aria-label="Source code on GitHub" data-tip="Source code" data-tip-side="bottom"><Icon name="github" size={16} /></a>
        </div>
      </header>

      <div className="layout">
        <div className={`scrim ${navOpen ? 'show' : ''}`} onClick={() => setNavOpen(false)} aria-hidden="true" />
        <aside id="sidenav" className={`sidenav ${navOpen ? 'open' : ''}`} aria-label="Workspace">
          <p className="sidenav-title">Workspace</p>
          <ul>
            {NAV.map((n) => (
              <li key={n.id}>
                <a href={`#/${n.id}`} aria-current={route === n.id ? 'page' : undefined} onClick={() => setNavOpen(false)}>
                  <Icon name={n.icon} size={16} /><span>{n.label}</span>
                  {n.id === 'history' && historyCount > 0 && <span className="counter">{historyCount}</span>}
                </a>
              </li>
            ))}
          </ul>
          <div className="sidenav-foot">
            <p><Icon name="lock" size={14} /> Runs in your browser. Files never leave your device.</p>
          </div>
        </aside>
        <main id="main" className="main" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}

export function PageHead({ crumbs, title, description, actions }: { crumbs: { label: string; href?: string }[]; title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="pagehead">
      <nav aria-label="Breadcrumb" className="crumbs">
        <ol>{crumbs.map((c, i) => <li key={i}>{c.href && i < crumbs.length - 1 ? <a href={c.href}>{c.label}</a> : <span aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{c.label}</span>}</li>)}</ol>
      </nav>
      <div className="pagehead-row">
        <div><h1>{title}</h1>{description && <p className="pagehead-desc">{description}</p>}</div>
        {actions && <div className="pagehead-actions">{actions}</div>}
      </div>
    </div>
  );
}
