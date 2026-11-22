import { useState } from 'react';
import type { SkewMode } from '../engine';
import { DropZone } from '../ui/DropZone';
import { Icon } from '../ui/Icon';
import { Banner, Box, Button, EmptyState, Label, LinkButton, Spinner, Tabs } from '../ui/kit';
import { PageHead } from '../ui/Shell';
import { MascotSlot } from '../mascot/MascotSlot';
import { formatBytes, plural } from '../lib/format';
import type { ConverterApi } from '../state/converter';
import type { Settings } from '../state/settings';
import { ReportView } from './ReportView';
import { ProjectDetails } from './ProjectDetails';

type Tab = 'overview' | 'details' | 'report';
export const STEPS = [
  { id: 'prepare', label: 'Prepare engine' },
  { id: 'resolve', label: 'Convert timeline and vectors' },
  { id: 'write', label: 'Write .tsproj' },
  { id: 'validate', label: 'Check the result' },
];
const SKEW: { id: SkewMode; title: string; desc: string }[] = [
  { id: 'bake', title: 'Bake into paths', desc: 'Exact shapes, same as Animate. Recommended.' },
  { id: 'perspective', title: 'Perspective effect', desc: 'Keeps an editable effect. Experimental.' },
  { id: 'off', title: 'Ignore skew', desc: 'Skewed parts are listed as lost.' },
];

export function ConvertPage({ c, opts, setOpts }: { c: ConverterApi; opts: Settings; setOpts: (p: Partial<Settings>) => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  const busy = c.phase === 'reading' || c.phase === 'converting';
  const info = c.analysis?.info;
  const layerCount = info ? info.scenes.reduce((n, s) => n + s.layers.length, 0) : 0;
  const diag = c.out?.report.diagnostics ?? [];
  const counts = { loss: diag.filter((d) => d.severity === 'loss').length, approx: diag.filter((d) => d.severity === 'approx').length, warn: diag.filter((d) => d.severity === 'warn').length };
  const change = (p: Partial<Settings>) => { setOpts(p); c.invalidate(); };

  const crumbs = [{ label: 'Workspace', href: '#/convert' }, { label: 'Convert', href: '#/convert' }, ...(c.file ? [{ label: c.file.name }] : [])];
  return (
    <>
      <PageHead crumbs={crumbs} title="Convert a project"
        description="Turn an Adobe Animate project into a ToonSquid .tsproj file. Everything happens on this device."
        actions={c.file && <Button icon="x" onClick={c.remove} disabled={busy}>Start over</Button>} />

      <Tabs label="Conversion sections" value={tab} onChange={setTab} tabs={[
        { id: 'overview', label: 'Overview', icon: 'bolt' },
        { id: 'details', label: 'Project details', icon: 'layers', count: info ? layerCount : undefined, disabled: !info },
        { id: 'report', label: 'Report', icon: 'report', count: c.out ? counts.loss + counts.approx : undefined, disabled: !c.out },
      ]} />

      {tab === 'details' && info && <ProjectDetails info={info} />}
      {tab === 'report' && c.out && <ReportView report={c.out.report} />}

      {tab === 'overview' && (
        <div className="workspace">
          <div className="ws-main">
            <Box title="Project">
              <DropZone file={c.file} busy={busy} error={c.dropError} onFile={(f) => void c.pick(f)} onReject={c.setDropError} onRemove={c.remove} />
              {c.dropError && <Banner tone="danger" title="That file can't be imported">{c.dropError}</Banner>}
              {c.phase === 'reading' && <p className="status-line"><Spinner /> Reading your file…</p>}
              {info && (
                <dl className="facts">
                  <div><dt>Name</dt><dd>{info.name}</dd></div>
                  <div><dt>Canvas</dt><dd>{info.width} × {info.height}</dd></div>
                  <div><dt>Frame rate</dt><dd>{info.fps} fps</dd></div>
                  <div><dt>Scenes</dt><dd>{info.scenes.length}</dd></div>
                  <div><dt>Layers</dt><dd>{layerCount}</dd></div>
                  <div><dt>Symbols</dt><dd>{info.symbols.length}</dd></div>
                  <div><dt>Keyframes</dt><dd>{info.totals.keyframes.toLocaleString()}</dd></div>
                  <div><dt>Motion tweens</dt><dd>{info.totals.motionTweens.toLocaleString()}</dd></div>
                </dl>
              )}
              {c.analysis?.zipMode === 'scan-only' && <Banner tone="attention">This ZIP had a damaged index. Its contents were recovered from the file headers.</Banner>}
            </Box>

            <Box title="Conversion settings" actions={<a className="link-sm" href="#/settings">Defaults</a>}>
              <fieldset className="field" disabled={busy || !c.analysis}>
                <legend>Skewed artwork</legend>
                <div className="radio-list">
                  {SKEW.map((o) => (
                    <label key={o.id} className={`radio-row ${opts.skewMode === o.id ? 'on' : ''}`}>
                      <input type="radio" name="skew" checked={opts.skewMode === o.id} onChange={() => change({ skewMode: o.id })} />
                      <span><strong>{o.title}</strong><span className="muted">{o.desc}</span></span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className={`check-row ${busy || !c.analysis ? 'disabled' : ''}`}>
                <input type="checkbox" checked={opts.nativeSymbols} disabled={busy || !c.analysis} onChange={(e) => change({ nativeSymbols: e.target.checked })} />
                <span><strong>Animated symbols as clips</strong><span className="muted">Each symbol becomes one clip with all its frames, played in a symbol layer, like the Animate library. Off: one still clip per frame.</span></span>
              </label>
              <label className={`check-row ${busy || !c.analysis ? 'disabled' : ''}`}>
                <input type="checkbox" checked={opts.seamUnderlay} disabled={busy || !c.analysis} onChange={(e) => change({ seamUnderlay: e.target.checked })} />
                <span><strong>Hide hairline seams</strong><span className="muted">Fills tuck slightly under the lines above them, so no thin gaps show when zooming in. Visible edges don't move.</span></span>
              </label>
            </Box>
          </div>

          <aside className={`ws-side ${c.analysis ? "" : "is-empty"}`}>
            <Box title="Convert" className="sticky">
              {!c.analysis && c.phase !== 'reading' && <EmptyState icon="upload" title="No project yet">Import a project to see its details and convert it.</EmptyState>}
              {c.analysis && (c.phase === 'ready' || c.phase === 'error') && (
                <Button variant="primary" size="lg" icon="bolt" className="block" onClick={() => void c.convert({ skewMode: opts.skewMode, seamUnderlay: opts.seamUnderlay, nativeSymbols: opts.nativeSymbols })}>
                  {c.phase === 'error' ? 'Try again' : 'Convert to .tsproj'}
                </Button>
              )}
              {(c.phase === 'converting' || c.phase === 'done') && <Progress stage={c.stage} done={c.phase === 'done'} />}
              <MascotSlot />
              {c.phase === 'error' && c.error && (
                <Banner tone="danger" title="Conversion failed" actions={c.out && <Button size="sm" onClick={() => setTab('report')}>View report</Button>}>{c.error}</Banner>
              )}
              {c.phase === 'done' && c.out && c.url && (
                <div className="result">
                  <Banner tone="success" title="Converted and checked">Structure check passed. Not yet confirmed to open in the ToonSquid app.</Banner>
                  <div className="result-labels">
                    <Label tone={counts.loss ? 'danger' : 'success'}>{plural(counts.loss, 'item')} lost</Label>
                    <Label tone={counts.approx ? 'attention' : 'success'}>{counts.approx} approximated</Label>
                    {counts.warn > 0 && <Label tone="attention">{plural(counts.warn, 'warning')}</Label>}
                  </div>
                  <LinkButton variant="primary" size="lg" icon="download" className="block" href={c.url} download={c.out.fileName}>Download .tsproj <span className="btn-meta">{formatBytes(c.out.bytes.length)}</span></LinkButton>
                  <Button icon="report" className="block" onClick={() => setTab('report')}>Open conversion report</Button>
                  <p className="muted small"><Icon name="info" size={14} /> {c.out.fileName} · {c.out.report.output.clips} clips · sha1 {c.out.report.output.sha1.slice(0, 10)}</p>
                </div>
              )}
            </Box>
          </aside>
        </div>
      )}
    </>
  );
}

function Progress({ stage, done }: { stage: string; done: boolean }) {
  const idx = STEPS.findIndex((s) => s.id === stage);
  const pct = done ? 100 : Math.round((Math.max(idx, 0) / STEPS.length) * 100);
  return (
    <div className="progress" aria-live="polite">
      <div className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Conversion progress"><span style={{ width: `${pct}%` }} /></div>
      <ol className="steps">
        {STEPS.map((s, i) => {
          const st = done || i < idx ? 'done' : i === idx ? 'active' : 'todo';
          return <li key={s.id} className={st}><span className="step-dot">{st === 'done' ? <Icon name="check" size={12} /> : st === 'active' ? <Spinner size={10} /> : null}</span>{s.label}</li>;
        })}
      </ol>
    </div>
  );
}
