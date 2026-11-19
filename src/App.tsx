import { useCallback, useEffect, useState } from 'react';
import { analyzeInput, convertAnalysisAsync, type Analysis, type ConvertOutput, type SkewMode } from './engine';
import { getSql } from './sql';
import { AboutDialog } from './ui/AboutDialog';
import { ConvertPanel, type Phase } from './ui/ConvertPanel';
import { DropZone, kindOf, type PickedFile } from './ui/DropZone';
import { Header } from './ui/Header';
import { ProjectCard } from './ui/ProjectCard';
import { ReportDialog } from './ui/ReportDialog';
import { Icon } from './ui/Icon';
import { REPO_URL } from './links';

/** Let the browser paint before a heavy synchronous step. */
const paint = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

export function App() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [file, setFile] = useState<PickedFile | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [out, setOut] = useState<ConvertOutput | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [stage, setStage] = useState('');
  const [err, setErr] = useState<string | null>(null);      // conversion / read error
  const [dropErr, setDropErr] = useState<string | null>(null); // rejected file
  const [showReport, setShowReport] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [skew, setSkew] = useState<SkewMode>('perspective');

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const clearResult = useCallback(() => { setUrl(null); setOut(null); setStage(''); setErr(null); setShowReport(false); }, []);
  const remove = useCallback(() => { clearResult(); setAnalysis(null); setFile(null); setDropErr(null); setPhase('idle'); }, [clearResult]);

  const onFile = useCallback(async (f: File) => {
    clearResult(); setAnalysis(null); setDropErr(null);
    setFile({ name: f.name, size: f.size, kind: kindOf(f.name) });
    setPhase('reading');
    await paint();
    try {
      const a = analyzeInput(new Uint8Array(await f.arrayBuffer()), f.name);
      setAnalysis(a); setPhase('ready');
    } catch (e) {
      setFile(null); setDropErr((e as Error).message); setPhase('idle');
    }
  }, [clearResult]);

  const onReject = useCallback((msg: string) => { setDropErr(msg); }, []);

  const onSkew = useCallback((m: SkewMode) => {
    setSkew(m);
    if (phase === 'done') { clearResult(); setPhase('ready'); }   // a finished result no longer matches the chosen option
  }, [phase, clearResult]);

  const onConvert = useCallback(async () => {
    if (!analysis) return;
    clearResult(); setPhase('converting'); setStage('prepare');
    await paint();
    try {
      const SQL = await getSql();
      const res = await convertAnalysisAsync(analysis, SQL, setStage, paint, { skewMode: skew });
      if (!res.report.ok) {
        setOut(res); setErr('The converted file failed its own checks, so it can\'t be downloaded. See the report for details.');
        setPhase('error'); setShowReport(true); return;
      }
      setUrl(URL.createObjectURL(new Blob([res.bytes as BlobPart], { type: 'application/octet-stream' })));
      setOut(res); setPhase('done');
    } catch (e) {
      setErr(`Conversion stopped: ${(e as Error).message}`); setPhase('error');
    }
  }, [analysis, skew, clearResult]);

  const zipNote = analysis?.zipMode === 'scan-only' ? 'This ZIP had a damaged index. Its contents were recovered from the file headers.' : undefined;
  const busy = phase === 'reading' || phase === 'converting';

  return (
    <div className="shell app-in">
      <Header onAbout={() => setShowAbout(true)} />
      <main className="workspace">
        <div className="col-main">
          <DropZone file={file} busy={busy} error={dropErr} onFile={(f) => void onFile(f)} onReject={onReject} onRemove={remove} />
          {analysis && <ProjectCard info={analysis.info} zipNote={zipNote} />}
        </div>
        <div className="col-side">
          <ConvertPanel
            phase={phase} hasFile={!!analysis} skew={skew} onSkew={onSkew} stage={stage} out={out} url={url} error={err}
            onConvert={() => void onConvert()} onReport={() => setShowReport(true)}
          />
        </div>
      </main>
      <footer className="foot">
        <span><Icon name="lock" size={16} /> Everything runs in your browser. Files never leave your device.</span>
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer">Source on GitHub</a>
      </footer>
      {showReport && out && <ReportDialog report={out.report} onClose={() => setShowReport(false)} />}
      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
    </div>
  );
}
