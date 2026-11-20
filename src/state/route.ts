import { useEffect, useState } from 'react';

export type Route = 'convert' | 'history' | 'settings' | 'about';
const ROUTES: Route[] = ['convert', 'history', 'settings', 'about'];
const parse = (): Route => { const r = location.hash.replace(/^#\/?/, '').split(/[/?]/)[0] as Route; return ROUTES.includes(r) ? r : 'convert'; };

/** Hash routes (#/convert, #/history, ...) so it works on static hosting under any sub-path. */
export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => { const on = () => setRoute(parse()); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);
  return [route, (r) => { if (location.hash !== `#/${r}`) location.hash = `#/${r}`; else setRoute(r); }];
}
