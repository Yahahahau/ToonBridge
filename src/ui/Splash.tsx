import { Icon } from './Icon';
import type { BootState } from '../hooks/useBoot';

export function Splash({ boot, leaving }: { boot: BootState; leaving: boolean }) {
  const done = boot.tasks.filter((t) => t.state === 'done').length;
  const pct = Math.round((done / boot.tasks.length) * 100);
  const current = boot.tasks.find((t) => t.state === 'pending');
  return (
    <div className={`splash ${leaving ? 'leaving' : ''}`} role="status" aria-live="polite">
      <div className="splash-card">
        <img className="splash-logo" src={`${import.meta.env.BASE_URL}favicon.svg`} width="88" height="88" alt="" />
        <h1 className="splash-name">ToonBridge</h1>
        {boot.fatal ? (
          <>
            <p className="splash-err"><Icon name="alert" /> {boot.fatal}</p>
            <button className="btn btn-primary btn-md" onClick={boot.retry}><Icon name="replace" size={16} />Try again</button>
          </>
        ) : (
          <>
            <div className="bar" aria-hidden="true"><i style={{ width: `${Math.max(pct, 8)}%` }} /></div>
            <p className="splash-msg">{current ? `${current.label}…` : 'Ready'}</p>
          </>
        )}
      </div>
    </div>
  );
}
