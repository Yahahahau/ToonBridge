import { Icon } from './Icon';
import { REPO_URL } from '../links';

export function Header({ onAbout }: { onAbout: () => void }) {
  return (
    <header className="topbar">
      <a className="logo" href="./" aria-label="ToonBridge home">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} width="40" height="40" alt="" />
        <span className="logo-text"><b>ToonBridge</b><small>Animate → ToonSquid</small></span>
      </a>
      <nav className="topbar-actions" aria-label="App actions">
        <button className="btn ghost" onClick={onAbout}><Icon name="help" /><span>About</span></button>
        <a className="btn ghost" href={REPO_URL} target="_blank" rel="noopener noreferrer" aria-label="ToonBridge on GitHub"><Icon name="github" /><span>GitHub</span></a>
      </nav>
    </header>
  );
}
