// R3: stitch directed cubic segments into closed contours per fill style.
import type { EdgeRec, Matrix } from '../ir';
import type { Pt, Seg } from '../xfl/edges';
import { apply } from './matrix';
import { trimChain } from './cover';
import type { Diagnostics } from '../diagnostics';

export interface PathNode { p: Pt; i?: Pt; o?: Pt; }
export interface Contour { nodes: PathNode[]; closed: boolean; }

const key = (p: Pt) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;
const reverseSeg = (s: Seg): Seg => ({ p0: s.p3, c1: s.c2, c2: s.c1, p3: s.p0 });
function xf(s: Seg, m?: Matrix): Seg {
  if (!m) return s;
  return { p0: apply(m, s.p0), c1: apply(m, s.c1), c2: apply(m, s.c2), p3: apply(m, s.p3) };
}

/** Deterministic stitching: start order by (y, x, index); next segment = lowest index with exact start match. */
export function stitch(segs: Seg[]): { chains: Seg[][]; closed: boolean[] } {
  const startMap = new Map<string, number[]>();
  segs.forEach((s, i) => { const k = key(s.p0); const a = startMap.get(k); if (a) a.push(i); else startMap.set(k, [i]); });
  const order = segs.map((_, i) => i).sort((x, y) => segs[x].p0[1] - segs[y].p0[1] || segs[x].p0[0] - segs[y].p0[0] || x - y);
  const used = new Uint8Array(segs.length);
  const chains: Seg[][] = [];
  const closed: boolean[] = [];
  for (const st of order) {
    if (used[st]) continue;
    used[st] = 1;
    const chain = [segs[st]];
    const startKey = key(segs[st].p0);
    let isClosed = false;
    for (;;) {
      const endKey = key(chain[chain.length - 1].p3);
      if (endKey === startKey) { isClosed = true; break; }
      const cands = startMap.get(endKey);
      const nx = cands?.find((c) => !used[c]);
      if (nx === undefined) break;
      used[nx] = 1;
      chain.push(segs[nx]);
    }
    chains.push(chain);
    closed.push(isClosed);
  }
  return { chains, closed };
}

export function chainToContour(chain: Seg[], closed: boolean): Contour {
  const nodes: PathNode[] = [];
  const n = chain.length;
  const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
  const nz = (v: Pt) => (Math.abs(v[0]) > 1e-9 || Math.abs(v[1]) > 1e-9 ? v : undefined);
  for (let k = 0; k < n; k++) {
    const s = chain[k];
    const node: PathNode = { p: s.p0 };
    const o = nz(sub(s.c1, s.p0)); if (o) node.o = o;
    const prev = k > 0 ? chain[k - 1] : closed ? chain[n - 1] : undefined;
    if (prev) { const i = nz(sub(prev.c2, prev.p3)); if (i) node.i = i; }
    nodes.push(node);
  }
  if (!closed) {
    const last = chain[n - 1];
    const node: PathNode = { p: last.p3 };
    const i = nz(sub(last.c2, last.p3)); if (i) node.i = i;
    nodes.push(node);
  }
  return { nodes, closed };
}

/** Fill contours for one fill style. fillStyle1 edges keep direction, fillStyle0 edges are reversed. */
export function fillContours(edges: EdgeRec[], fillId: number, m: Matrix | undefined, diag: Diagnostics): Contour[] {
  const segs: Seg[] = [];
  for (const e of edges) {
    if (e.fill1 === fillId) for (const s of e.segs) segs.push(xf(s, m));
    if (e.fill0 === fillId) for (let k = e.segs.length - 1; k >= 0; k--) segs.push(reverseSeg(xf(e.segs[k], m)));
  }
  const { chains, closed } = stitch(segs);
  const out: Contour[] = [];
  chains.forEach((c, i) => {
    if (!closed[i]) diag.warn('CONTOUR_OPEN', 'A fill contour did not close exactly; ToonSquid closes it with a straight segment');
    out.push(chainToContour(c, true));
  });
  return out;
}

export function strokeContours(edges: EdgeRec[], strokeId: number, m: Matrix | undefined): Contour[] {
  const segs: Seg[] = [];
  for (const e of edges) if (e.stroke === strokeId) for (const s of e.segs) segs.push(xf(s, m));
  const { chains, closed } = stitch(segs);
  return chains.map((c, i) => chainToContour(c, closed[i]));
}

export function usedFillIds(edges: EdgeRec[]): number[] {
  const s = new Set<number>();
  for (const e of edges) { if (e.fill0) s.add(e.fill0); if (e.fill1) s.add(e.fill1); }
  return [...s].sort((a, b) => a - b);
}
export function usedStrokeIds(edges: EdgeRec[]): number[] {
  const s = new Set<number>();
  for (const e of edges) if (e.stroke) s.add(e.stroke);
  return [...s].sort((a, b) => a - b);
}

/**
 * Seam underlay (anti-conflation). Animate rasterises a shape as one planar map, so two fills that share an edge meet
 * without a gap. ToonSquid (like any vector renderer that draws each fill separately) anti-aliases both fills
 * independently along the shared edge, which lets the background show through as a hairline. The fix: draw a thin
 * stroke along every edge that has a fill on BOTH sides, *underneath* the fills. The fills still define the exact
 * boundary; the underlay only shows through the partially covered anti-aliased pixels.
 * Returns stroke contours grouped by the fill id whose colour the underlay uses (`pick` chooses it per edge).
 */
export function seamContours(edges: EdgeRec[], m: Matrix | undefined, pick: (f0: number, f1: number) => number | null, trim = 0): Map<number, Contour[]> {
  const byFill = new Map<number, Seg[]>();
  for (const e of edges) {
    if (!e.fill0 || !e.fill1 || e.fill0 === e.fill1) continue;
    const f = pick(e.fill0, e.fill1);
    if (f === null) continue;
    let a = byFill.get(f); if (!a) byFill.set(f, (a = []));
    for (const s of e.segs) a.push(xf(s, m));
  }
  const out = new Map<number, Contour[]>();
  for (const f of [...byFill.keys()].sort((x, y) => x - y)) {
    const { chains, closed } = stitch(byFill.get(f)!);
    // Open chains are trimmed so a stroke cap cannot poke out past the shape where the shared edge ends.
    const cs: Contour[] = [];
    chains.forEach((c, i) => {
      if (closed[i]) { cs.push(chainToContour(c, true)); return; }
      const tc = trimChain(c, trim);
      if (tc.length) cs.push(chainToContour(tc, false));
    });
    out.set(f, cs);
  }
  return out;
}
