import { useState } from 'react';
import { diagSummary, reportToText, type DiagItem, type DiagLocation, type Report } from '../engine';
import { Icon } from '../ui/Icon';
import { Banner, Box, Button, Label, type Tone } from '../ui/kit';

const SEV: Record<string, { label: string; tone: Tone }> = { loss: { label: 'Lost', tone: 'danger' }, unsupported: { label: 'Unsupported', tone: 'attention' }, approx: { label: 'Approximated', tone: 'attention' }, warn: { label: 'Warning', tone: 'attention' }, info: { label: 'Info', tone: 'neutral' } };
const ORDER = ['loss', 'unsupported', 'approx', 'warn', 'info'];

function where(l: DiagLocation): string {
  const owner = l.owner ? `${l.ownerKind === 'symbol' ? 'Symbol' : l.ownerKind === 'scene' ? 'Scene' : l.ownerKind === 'page' ? 'FLA page' : 'Document'} “${l.owner}”` : '';
  const layer = l.layer !== undefined ? `Layer “${l.layer}”${l.layerIndex ? ` (#${l.layerIndex})` : ''}` : '';
  return [owner, layer].filter(Boolean).join(' › ');
}
function detail(l: DiagLocation): string {
  const p: string[] = [];
  if (l.frames) p.push(l.frames[0] === l.frames[1] ? `Frame ${l.frames[0]}` : `Frames ${l.frames[0]}–${l.frames[1]}`);
  if (l.element) p.push(`Element ${l.element}`);
  if (l.source) p.push(l.source);
  return p.join(' · ');
}

function DiagRow({ d }: { d: DiagItem }) {
  const n = d.locations.length;
  return (
    <li className="row row-wrap">
      <Label tone={SEV[d.severity].tone}>{SEV[d.severity].label}</Label>
      <div className="row-stack">
        <span className="row-title"><code className="diag-code">{d.code}</code><span className="row-text">{d.message}</span></span>
        {n > 0 && (
          <details className="diag-locs">
            <summary>{d.count === 1 ? 'Where: 1 place' : `Where: ${d.count} places`}</summary>
            <ul>
              {d.locations.map((l, i) => (
                <li key={i}><span className="diag-where">{where(l) || 'Document'}</span>{detail(l) && <span className="muted"> · {detail(l)}</span>}</li>
              ))}
            </ul>
            {d.hiddenLocations > 0 && <p className="muted small">…and {d.hiddenLocations} more not listed (the count above is complete).</p>}
          </details>
        )}
      </div>
      <span className="counter" title="Affected items">×{d.count}</span>
    </li>
  );
}
const LVL: Record<string, { label: string; tone: Tone }> = { 'structure-verified': { label: 'Verified', tone: 'success' }, experimental: { label: 'Experimental', tone: 'attention' }, 'not-supported': { label: 'Not supported', tone: 'danger' } };

export function ReportView({ report }: { report: Report }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(reportToText(report)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ } };
  const diags = [...report.diagnostics].sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));
  const own = diags.filter((d) => d.origin !== 'jpexs');
  const attention = own.filter((d) => d.severity !== 'info');
  const infos = own.filter((d) => d.severity === 'info');
  const legacy = diags.filter((d) => d.origin === 'jpexs');
  const s = diagSummary(report.diagnostics);
  const tile = (label: string, k: keyof typeof s) => <div><dt>{label}</dt><dd>{s[k].items}{s[k].affected > s[k].items && <span className="muted small"> · {s[k].affected} places</span>}</dd></div>;
  return (
    <div className="stack">
      {report.validation.ok
        ? <Banner tone="success" title="Output check passed">The file was read back and every structural check passed.</Banner>
        : <Banner tone="danger" title="Output check failed">The file did not pass its own checks and can't be downloaded.</Banner>}

      <Box title="Summary" actions={<Button size="sm" icon={copied ? 'check' : 'copy'} onClick={() => void copy()}>{copied ? 'Copied' : 'Copy report'}</Button>}>
        <p className="muted small" style={{ margin: 0 }}>Each item below says where it happens in your Animate file: scene or symbol, layer, frames and element.</p>
        <dl className="facts">{tile('Lost', 'loss')}{tile('Unsupported', 'unsupported')}{tile('Approximated', 'approx')}{tile('Warnings', 'warn')}{tile('Info', 'info')}</dl>
      </Box>

      <Box flush title="Needs attention">
        {attention.length === 0 ? <p className="box-pad muted">Nothing was lost, approximated or left out.</p> : (
          <ul className="rows">{attention.map((d, i) => <DiagRow key={i} d={d} />)}</ul>
        )}
      </Box>

      {legacy.length > 0 && (
        <Box flush title="From the legacy FLA converter (JPEXS)">
          <p className="box-pad muted small">This project was exported from a binary FLA by JPEXS FLA Convert. These items come from its own report (conversion-report.txt), not from ToonBridge.</p>
          <ul className="rows">{legacy.map((d, i) => <DiagRow key={i} d={d} />)}</ul>
        </Box>
      )}

      {infos.length > 0 && (
        <Box flush title="How things were converted">
          <ul className="rows">{infos.map((d, i) => <DiagRow key={i} d={d} />)}</ul>
        </Box>
      )}

      <Box flush title="Output checks">
        <ul className="rows">
          {report.validation.checks.map((c) => (
            <li key={c.category} className="row row-wrap">
              <Icon name={c.ok ? 'check' : 'alert'} size={16} className={c.ok ? 'fg-success' : 'fg-danger'} />
              <strong className="row-name">{c.category}</strong>
              <span className="row-text muted">{c.details.slice(0, 3).join(' · ')}</span>
            </li>
          ))}
        </ul>
        <p className="box-foot muted">{(report.output.bytes / 1048576).toFixed(1)} MB · {report.output.clips} clips · sha1 {report.output.sha1}</p>
      </Box>

      <Box flush title="Feature status">
        <ul className="rows">
          {report.features.map((f) => (
            <li key={f.feature} className="row row-wrap">
              <Label tone={LVL[f.level].tone}>{LVL[f.level].label}</Label>
              <span className="row-text"><strong>{f.feature}</strong><br /><span className="muted">{f.note}</span></span>
            </li>
          ))}
        </ul>
      </Box>

      <Box title="Statistics">
        <dl className="facts">{Object.entries(report.stats).map(([k, v]) => <div key={k}><dt>{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</dt><dd>{v.toLocaleString()}</dd></div>)}</dl>
      </Box>
    </div>
  );
}
