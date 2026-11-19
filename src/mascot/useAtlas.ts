import { useEffect, useState } from 'react';
import { parseAtlasXml, type Atlas } from './atlas';

export interface AtlasSource { image: string; xml: string; }
export interface LoadedAtlas { atlas: Atlas; image: HTMLImageElement; }

const cache = new Map<string, Promise<LoadedAtlas>>();

/** Fetches the XML + image once per source. Rejects with a readable message if either is missing or invalid. */
export function loadAtlas(src: AtlasSource): Promise<LoadedAtlas> {
  const key = `${src.image}|${src.xml}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const res = await fetch(src.xml);
      if (!res.ok) throw new Error(`Mascot XML not found (${res.status}): ${src.xml}`);
      const atlas = parseAtlasXml(await res.text());
      const image = new Image();
      image.decoding = 'async';
      image.src = src.image;
      try { await image.decode(); } catch { throw new Error(`Mascot spritesheet could not be loaded: ${src.image}`); }
      return { atlas, image };
    })();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

export type AtlasState = { status: 'idle' } | { status: 'loading' } | { status: 'ready'; data: LoadedAtlas } | { status: 'error'; message: string };

export function useAtlas(src: AtlasSource | null | undefined): AtlasState {
  const [state, setState] = useState<AtlasState>({ status: 'idle' });
  const image = src?.image, xml = src?.xml;
  useEffect(() => {
    if (!image || !xml) { setState({ status: 'idle' }); return; }
    let live = true;
    setState({ status: 'loading' });
    loadAtlas({ image, xml }).then((data) => live && setState({ status: 'ready', data }), (e: Error) => live && setState({ status: 'error', message: e.message }));
    return () => { live = false; };
  }, [image, xml]);
  return state;
}
