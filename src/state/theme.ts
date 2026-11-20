import { useEffect, useState } from 'react';
import { load, save } from './storage';

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'toonbridge.theme';

/** Theme preference -> data-theme on <html>. "system" removes the attribute so CSS follows prefers-color-scheme. */
export function applyTheme(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]:not([media])')?.setAttribute('content', dark ? '#0f1514' : '#f7f9f8');
}

export function useTheme(): [ThemePref, (t: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(() => load<ThemePref>(KEY, 'system'));
  useEffect(() => { applyTheme(pref); save(KEY, pref); }, [pref]);
  return [pref, setPref];
}
