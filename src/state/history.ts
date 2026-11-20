import { useCallback, useState } from 'react';
import { load, save } from './storage';

/**
 * Conversion history. Only metadata is stored (in this browser); the converted files themselves are kept in memory for
 * the current session, so a download link is offered only while this tab stays open.
 */
export interface HistoryEntry {
  id: string; at: string; source: string; output: string; bytes: number; sha1: string;
  ok: boolean; lost: number; approx: number; warnings: number; skewMode: string; seams: boolean; canvas: string; fps: number;
}
const KEY = 'toonbridge.history';
const MAX = 50;
const sessionFiles = new Map<string, string>(); // id -> blob URL (this session only)

export function useHistory() {
  const [items, setItems] = useState<HistoryEntry[]>(() => load<HistoryEntry[]>(KEY, []));
  const add = useCallback((e: HistoryEntry, blobUrl: string | null, persist: boolean) => {
    if (blobUrl) sessionFiles.set(e.id, blobUrl);
    setItems((cur) => { const next = [e, ...cur].slice(0, MAX); if (persist) save(KEY, next); return next; });
  }, []);
  const remove = useCallback((id: string) => setItems((cur) => { const next = cur.filter((x) => x.id !== id); save(KEY, next); return next; }), []);
  const clear = useCallback(() => { save(KEY, []); setItems([]); }, []);
  return { items, add, remove, clear, fileUrl: (id: string) => sessionFiles.get(id) ?? null };
}
export type HistoryApi = ReturnType<typeof useHistory>;
