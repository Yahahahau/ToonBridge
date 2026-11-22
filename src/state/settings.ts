import { useCallback, useState } from 'react';
import type { SkewMode } from '../engine';
import { load, save } from './storage';

export interface Settings { skewMode: SkewMode; seamUnderlay: boolean; keepHistory: boolean; nativeSymbols: boolean; }
export const DEFAULT_SETTINGS: Settings = { skewMode: 'bake', seamUnderlay: true, keepHistory: true, nativeSymbols: true };
const KEY = 'toonbridge.settings';

export function useSettings(): [Settings, (patch: Partial<Settings>) => void, () => void] {
  const [s, setS] = useState<Settings>(() => ({ ...DEFAULT_SETTINGS, ...load<Partial<Settings>>(KEY, {}) }));
  const update = useCallback((patch: Partial<Settings>) => setS((cur) => { const next = { ...cur, ...patch }; save(KEY, next); return next; }), []);
  const reset = useCallback(() => { save(KEY, DEFAULT_SETTINGS); setS(DEFAULT_SETTINGS); }, []);
  return [s, update, reset];
}
