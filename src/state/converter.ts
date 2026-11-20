import { useCallback, useEffect, useRef, useState } from 'react';
import { analyzeInput, convertAnalysisAsync, type Analysis, type ConvertOutput, type SkewMode } from '../engine';
import { getSql } from '../sql';

export type Phase = 'idle' | 'reading' | 'ready' | 'converting' | 'done' | 'error';
export interface PickedFile { name: string; size: number; kind: string; }
export const kindOf = (name: string) => (/\.fla$/i.test(name) ? 'FLA (ZIP-based)' : 'XFL project (ZIP)');

/** Let the browser paint before a heavy synchronous step. */
const paint = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/** All conversion state + actions, wired to the real engine. Lives above the pages so switching pages keeps it. */
export function useConverter(onDone: (out: ConvertOutput, url: string, opts: { skewMode: SkewMode; seamUnderlay: boolean }) => void) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [file, setFile] = useState<PickedFile | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [out, setOut] = useState<ConvertOutput | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [stage, setStage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const done = useRef(onDone); done.current = onDone;

  const clearResult = useCallback(() => { setUrl(null); setOut(null); setStage(''); setError(null); }, []);
  const remove = useCallback(() => { clearResult(); setAnalysis(null); setFile(null); setDropError(null); setPhase('idle'); }, [clearResult]);
  useEffect(() => { if (phase === 'ready') setError(null); }, [phase]);

  const pick = useCallback(async (f: File) => {
    clearResult(); setAnalysis(null); setDropError(null);
    setFile({ name: f.name, size: f.size, kind: kindOf(f.name) });
    setPhase('reading');
    await paint();
    try { setAnalysis(analyzeInput(new Uint8Array(await f.arrayBuffer()), f.name)); setPhase('ready'); }
    catch (e) { setFile(null); setDropError((e as Error).message); setPhase('idle'); }
  }, [clearResult]);

  /** Settings changed after a result: the result no longer matches, so go back to "ready". */
  const invalidate = useCallback(() => { if (phase === 'done' || phase === 'error') { clearResult(); setPhase(analysis ? 'ready' : 'idle'); } }, [phase, analysis, clearResult]);

  const convert = useCallback(async (opts: { skewMode: SkewMode; seamUnderlay: boolean }) => {
    if (!analysis) return;
    clearResult(); setPhase('converting'); setStage('prepare');
    await paint();
    try {
      const SQL = await getSql();
      const res = await convertAnalysisAsync(analysis, SQL, setStage, paint, opts);
      setOut(res);
      if (!res.report.ok) { setError('The converted file failed its own checks, so it can\'t be downloaded. See the report for details.'); setPhase('error'); return; }
      const u = URL.createObjectURL(new Blob([res.bytes as BlobPart], { type: 'application/octet-stream' }));
      setUrl(u); setPhase('done');
      done.current(res, u, opts);
    } catch (e) { setError(`Conversion stopped: ${(e as Error).message}`); setPhase('error'); }
  }, [analysis, clearResult]);

  return { phase, file, analysis, out, url, stage, error, dropError, setDropError, pick, remove, convert, invalidate };
}
export type ConverterApi = ReturnType<typeof useConverter>;
