import { useCallback, useEffect, useRef, useState } from 'react';
import { getSql } from '../sql';
import { MASCOT_SOURCE } from '../mascot/config';
import { loadAtlas } from '../mascot/useAtlas';

export interface BootTask { id: string; label: string; state: 'pending' | 'done' | 'failed'; }
export interface BootState { tasks: BootTask[]; ready: boolean; fatal: string | null; retry: () => void; }

const FONT_LOADS = ['600 1em "Fredoka Variable"', '400 1em "Nunito Variable"', '700 1em "Nunito Variable"'];
const withTimeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

/**
 * Real start-up work, no artificial delay: web fonts, the SQLite WASM the converter needs, and (if configured) the mascot atlas.
 * Fonts and the mascot are optional (a failure just falls back); the engine is required.
 */
export function useBoot(): BootState {
  const [tasks, setTasks] = useState<BootTask[]>([
    { id: 'fonts', label: 'Loading fonts', state: 'pending' },
    { id: 'engine', label: 'Starting converter engine', state: 'pending' },
  ]);
  const [fatal, setFatal] = useState<string | null>(null);
  const [run, setRun] = useState(0);
  const first = useRef(true);

  const mark = (id: string, state: BootTask['state']) => setTasks((t) => t.map((x) => (x.id === id ? { ...x, state } : x)));

  useEffect(() => {
    let live = true;
    const set = (id: string, s: BootTask['state']) => { if (live) mark(id, s); };
    if (!first.current) { setFatal(null); setTasks((t) => t.map((x) => ({ ...x, state: 'pending' }))); }
    first.current = false;
    if (MASCOT_SOURCE) setTasks((t) => (t.some((x) => x.id === 'mascot') ? t : [...t, { id: 'mascot', label: 'Loading mascot', state: 'pending' }]));

    void withTimeout(Promise.all(FONT_LOADS.map((f) => document.fonts.load(f))), 4000).catch(() => undefined).then(() => set('fonts', 'done'));
    void getSql().then(() => set('engine', 'done'), (e: Error) => { if (live) { set('engine', 'failed'); setFatal(`The converter engine could not start: ${e.message}`); } });
    if (MASCOT_SOURCE) void loadAtlas(MASCOT_SOURCE).catch(() => undefined).then(() => set('mascot', 'done'));
    return () => { live = false; };
  }, [run]);

  const retry = useCallback(() => setRun((n) => n + 1), []);
  const ready = tasks.every((t) => t.state === 'done');
  return { tasks, ready, fatal, retry };
}
