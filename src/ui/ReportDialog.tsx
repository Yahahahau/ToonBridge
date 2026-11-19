import { reportToText, type Report } from '../engine';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { useState } from 'react';

const SEV: Record<string, string> = { loss: 'Lost', approx: 'Approximated', warn: 'Warning', info: 'Info' };
const LVL: Record<string, string> = { 'structure-verified': 'Structure verified', experimental: 'Experimental', 'not-supported': 'Not supported' };

export function ReportDialog({ report, onClose }: { report: Report; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(reportToText(report)); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* clipboard unavailable */ }
  };
  return (
    <Dialog title="Conversion report" onClose={onClose}
      actions={<button className="btn ghost" onClick={() => void copy()}><Icon name={copied ? 'check' : 'copy'} /><span>{copied ? 'Copied' : 'Copy'}</span></button>}>
      <section>
        <h3>Output check <span className={`pill ${report.validation.ok ? 'ok' : 'bad'}`}>{report.validation.ok ? 'Passed' : 'Failed'}</span></h3>
        <ul className="checks">
          {report.validation.checks.map((c) => (
            <li key={c.category}><span className={`dot ${c.ok ? 'ok' : 'bad'}`} /> <b>{c.category}</b>
              <small>{c.details.slice(0, 4).join(' · ')}</small></li>
          ))}
        </ul>
        <p className="muted">Output {(report.output.bytes / 1048576).toFixed(1)} MB · {report.output.clips} clips · sha1 {report.output.sha1.slice(0, 12)}…</p>
      </section>

      <section>
        <h3>Lost or approximated</h3>
        {report.diagnostics.length === 0 ? <p className="muted">Nothing was lost or approximated.</p> : (
          <ul className="diag">
            {report.diagnostics.map((d, i) => (
              <li key={i}><span className={`tag ${d.severity}`}>{SEV[d.severity]}</span> {d.message}{d.count > 1 ? <em> ×{d.count}</em> : null}</li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3>Feature status</h3>
        <ul className="diag">
          {report.features.map((f) => (
            <li key={f.feature}><span className={`tag ${f.level}`}>{LVL[f.level]}</span> <b>{f.feature}</b><br /><small>{f.note}</small></li>
          ))}
        </ul>
      </section>

      <section>
        <h3>Stats</h3>
        <p className="stats">{Object.entries(report.stats).map(([k, v]) => <span key={k}>{k}: <b>{v.toLocaleString()}</b></span>)}</p>
      </section>
    </Dialog>
  );
}
