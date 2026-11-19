import type { ProjectInfo } from '../engine';
import { plural } from '../lib/format';

export function ProjectCard({ info, zipNote }: { info: ProjectInfo; zipNote?: string }) {
  const layerCount = info.scenes.reduce((n, s) => n + s.layers.length, 0);
  const stats: [string, string][] = [
    ['Canvas', `${info.width} × ${info.height}`],
    ['Frame rate', `${info.fps} fps`],
    ['Scenes', info.scenes.length.toLocaleString()],
    ['Symbols', info.symbols.length.toLocaleString()],
    ['Keyframes', info.totals.keyframes.toLocaleString()],
    ['Motion tweens', info.totals.motionTweens.toLocaleString()],
  ];
  return (
    <section className="panel fade" aria-label="Project information">
      <h2 className="panel-title"><span>Project</span><b title={info.name}>{info.name}</b></h2>
      <dl className="stats-grid">
        {stats.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      <details>
        <summary>{plural(layerCount, 'layer')} · {plural(info.symbols.length, 'symbol')}</summary>
        {info.scenes.map((s, i) => (
          <div key={i} className="list">
            <h4>{s.name || `Scene ${i + 1}`} <small>{plural(s.frames, 'frame')}</small></h4>
            <ul>{s.layers.map((l, j) => (
              <li key={j}>{l.name || '(unnamed)'} <small>{l.kind !== 'normal' ? `${l.kind} · ` : ''}{l.visible ? '' : 'hidden · '}{plural(l.keyframes, 'keyframe')}{l.tweens ? ` · ${plural(l.tweens, 'tween')}` : ''}</small></li>
            ))}</ul>
          </div>
        ))}
        {info.symbols.length > 0 && (
          <div className="list"><h4>Symbols</h4>
            <ul>{info.symbols.map((s) => <li key={s.name}>{s.name} <small>{s.type} · {plural(s.frames, 'frame')} · {plural(s.layers, 'layer')}</small></li>)}</ul>
          </div>
        )}
      </details>
      {zipNote && <p className="msg info"><span aria-hidden="true">ⓘ</span> {zipNote}</p>}
    </section>
  );
}
