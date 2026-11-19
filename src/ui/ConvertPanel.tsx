import type { ConvertOutput, SkewMode } from '../engine';
import { Icon } from './Icon';
import { MascotSlot } from '../mascot/MascotSlot';
import { formatBytes } from '../lib/format';

export type Phase = 'idle' | 'reading' | 'ready' | 'converting' | 'done' | 'error';
export const STEPS: { id: string; label: string }[] = [
  { id: 'prepare', label: 'Preparing engine' },
  { id: 'resolve', label: 'Converting timeline & vectors' },
  { id: 'write', label: 'Writing .tsproj' },
  { id: 'validate', label: 'Checking the result' },
];

const SKEW: { id: SkewMode; title: string; desc: string }[] = [
  { id: 'perspective', title: 'Perspective effect', desc: 'Keeps shapes editable. Experimental.' },
  { id: 'bake', title: 'Bake into paths', desc: 'Exact look, larger file.' },
  { id: 'off', title: 'Ignore skew', desc: 'Skewed parts are listed as lost.' },
];

interface Props {
  phase: Phase; hasFile: boolean; skew: SkewMode; onSkew: (m: SkewMode) => void;
  stage: string; out: ConvertOutput | null; url: string | null; error: string | null;
  onConvert: () => void; onReport: () => void;
}

export function ConvertPanel({ phase, hasFile, skew, onSkew, stage, out, url, error, onConvert, onReport }: Props) {
  const stepIdx = STEPS.findIndex((s) => s.id === stage);
  const pct = phase === 'done' ? 100 : phase === 'converting' ? Math.round((Math.max(stepIdx, 0) / STEPS.length) * 100) : 0;
  const counts = out ? {
    loss: out.report.diagnostics.filter((d) => d.severity === 'loss').length,
    approx: out.report.diagnostics.filter((d) => d.severity === 'approx').length,
    warn: out.report.diagnostics.filter((d) => d.severity === 'warn').length,
  } : null;

  return (
    <section className="panel convert" aria-label="Conversion">
      <h2 className="panel-title"><span>Convert</span></h2>

      {!hasFile && phase !== 'reading' && <p className="hint">Import a project to get started.</p>}
      {phase === 'reading' && <p className="hint busy-line"><span className="spinner" aria-hidden="true" /> Reading your file…</p>}

      {hasFile && phase !== 'reading' && (
        <fieldset className="skew" disabled={phase === 'converting'}>
          <legend>How should skewed parts be converted?</legend>
          <div className="seg">
            {SKEW.map((o) => (
              <label key={o.id} className={skew === o.id ? 'on' : ''}>
                <input type="radio" name="skew" value={o.id} checked={skew === o.id} onChange={() => onSkew(o.id)} />
                <b>{o.title}</b><small>{o.desc}</small>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {(phase === 'ready' || phase === 'error' || phase === 'idle') && (
        <button className="btn primary big" disabled={phase === 'idle' || !hasFile} onClick={onConvert}>
          <Icon name="bolt" /><span>{phase === 'error' ? 'Try again' : 'Convert'}</span>
        </button>
      )}

      {(phase === 'converting' || phase === 'done') && (
        <div className="progress" aria-live="polite">
          <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Conversion progress"><i style={{ width: `${pct}%` }} /></div>
          <ol className="steps-list">
            {STEPS.map((s, i) => {
              const st = phase === 'done' || i < stepIdx ? 'done' : i === stepIdx ? 'active' : 'todo';
              return <li key={s.id} className={st}><span className="tick">{st === 'done' ? <Icon name="check" size={14} /> : st === 'active' ? <span className="spinner sm" /> : null}</span>{s.label}</li>;
            })}
          </ol>
        </div>
      )}

      <MascotSlot />

      {phase === 'error' && error && (
        <div className="result bad fade" role="alert">
          <p><Icon name="alert" /> <span>{error}</span></p>
          {out && <button className="btn ghost" onClick={onReport}><Icon name="report" /><span>View report</span></button>}
        </div>
      )}

      {phase === 'done' && out && url && counts && (
        <div className="result good fade">
          <p className="result-title"><Icon name="check" /> <span>Converted and checked</span></p>
          <ul className="badges">
            <li className="ok">Structure check passed</li>
            <li className={counts.loss ? 'bad' : 'ok'}>{counts.loss} lost</li>
            <li className={counts.approx ? 'warn' : 'ok'}>{counts.approx} approximated</li>
            {counts.warn > 0 && <li className="warn">{counts.warn} warnings</li>}
          </ul>
          <div className="result-actions">
            <a className="btn primary big" href={url} download={out.fileName}><Icon name="download" /><span>Download .tsproj</span><small>{formatBytes(out.bytes.length)}</small></a>
            <button className="btn ghost" onClick={onReport}><Icon name="report" /><span>View report</span></button>
          </div>
          <p className="msg info"><Icon name="info" size={16} /> <span>Structurally validated, but not yet confirmed to open in the ToonSquid app. Check the report for anything that was approximated or left out.</span></p>
        </div>
      )}
    </section>
  );
}
