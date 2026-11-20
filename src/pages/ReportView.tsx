import { useState } from 'react';
import { reportToText, type Report } from '../engine';
import { Icon } from '../ui/Icon';
import { Banner, Box, Button, Label, type Tone } from '../ui/kit';

const SEV: Record<string, { label: string; tone: Tone }> = { loss: { label: 'Lost', tone: 'danger' }, approx: { label: 'Approximated', tone: 'attention' }, warn: { label: 'Warning', tone: 'attention' }, info: { label: 'Info', tone: 'neutral' } };
const LVL: Record<string, { label: string; tone: Tone }> = { 'structure-verified': { label: 'Verified', tone: 'success' }, experimental: { label: 'Experimental', tone: 'attention' }, 'not-supported': { label: 'Not supported', tone: 'danger' } };

export function ReportView({ report }: { report: Report }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(reportToText(report)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ } };
  const order = ['loss', 'warn', 'approx', 'info'];
  const diags = [...report.diagnostics].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
  return (
    <div className="stack">
      {report.validation.ok
        ? <Banner tone="success" title="Output check passed">The file was read back and every structural check passed.</Banner>
        : <Banner tone="danger" title="Output check failed">The file did not pass its own checks and can't be downloaded.</Banner>}

      <Box flush title="What was lost or changed" actions={<Button size="sm" icon={copied ? 'check' : 'copy'} onClick={() => void copy()}>{copied ? 'Copied' : 'Copy report'}</Button>}>
        {diags.length === 0 ? <p className="box-pad muted">Nothing was lost or approximated.</p> : (
          <ul className="rows">
            {diags.map((d, i) => (
              <li key={i} className="row row-wrap">
                <Label tone={SEV[d.severity].tone}>{SEV[d.severity].label}</Label>
                <span className="row-text">{d.message}</span>
                {d.count > 1 && <span className="counter">×{d.count}</span>}
              </li>
            ))}
          </ul>
        )}
      </Box>

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
