// Anti-seam "trapping": which parts of a fill's outline are hidden under opaque fills drawn above it?
// Only those parts receive a bleed stroke, so no visible boundary ever moves.
import type { Contour } from './contours';
import type { Pt, Seg } from '../xfl/edges';

const STEPS = 10;           // cubic flattening for inside tests (sub-pixel accurate for art at normal scales)
const BUCKET = 16;          // y-bucket height in px for the crossing index

function bez(s: Seg, t: number): Pt {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * s.p0[0] + b * s.c1[0] + c * s.c2[0] + d * s.p3[0], a * s.p0[1] + b * s.c1[1] + c * s.c2[1] + d * s.p3[1]];
}
function tangent(s: Seg, t: number): Pt {
  const u = 1 - t;
  const x = 3 * u * u * (s.c1[0] - s.p0[0]) + 6 * u * t * (s.c2[0] - s.c1[0]) + 3 * t * t * (s.p3[0] - s.c2[0]);
  const y = 3 * u * u * (s.c1[1] - s.p0[1]) + 6 * u * t * (s.c2[1] - s.c1[1]) + 3 * t * t * (s.p3[1] - s.c2[1]);
  return [x, y];
}

/** Rebuild segments of a contour from its p/i/o nodes (closed contours wrap around). */
export function contourSegs(c: Contour): Seg[] {
  const out: Seg[] = [];
  const n = c.nodes.length;
  const last = c.closed ? n : n - 1;
  for (let k = 0; k < last; k++) {
    const a = c.nodes[k], b = c.nodes[(k + 1) % n];
    const c1: Pt = a.o ? [a.p[0] + a.o[0], a.p[1] + a.o[1]] : a.p;
    const c2: Pt = b.i ? [b.p[0] + b.i[0], b.p[1] + b.i[1]] : b.p;
    out.push({ p0: a.p, c1, c2, p3: b.p });
  }
  return out;
}

interface Line { x0: number; y0: number; x1: number; y1: number; g: number; }

/** Union of opaque fill regions; each region keeps its own non-zero winding (contours of one fill style = one group). */
export class CoverIndex {
  private buckets = new Map<number, Line[]>();
  private groups = 0;
  add(contours: Contour[]): void {
    const g = this.groups++;
    for (const c of contours) {
      for (const s of contourSegs(c)) {
        let prev = s.p0;
        for (let k = 1; k <= STEPS; k++) {
          const p = k === STEPS ? s.p3 : bez(s, k / STEPS);
          if (prev[1] !== p[1]) {
            const ln: Line = { x0: prev[0], y0: prev[1], x1: p[0], y1: p[1], g };
            const b0 = Math.floor(Math.min(prev[1], p[1]) / BUCKET), b1 = Math.floor(Math.max(prev[1], p[1]) / BUCKET);
            for (let b = b0; b <= b1; b++) { let a = this.buckets.get(b); if (!a) this.buckets.set(b, (a = [])); a.push(ln); }
          }
          prev = p;
        }
      }
    }
  }
  get empty(): boolean { return this.groups === 0; }
  /** True if p lies inside any group (non-zero rule), using a +x ray. */
  inside(p: Pt): boolean {
    const lines = this.buckets.get(Math.floor(p[1] / BUCKET));
    if (!lines) return false;
    const w = new Map<number, number>();
    for (const l of lines) {
      const up = l.y0 <= p[1] && l.y1 > p[1], down = l.y1 <= p[1] && l.y0 > p[1];
      if (!up && !down) continue;
      const x = l.x0 + ((p[1] - l.y0) / (l.y1 - l.y0)) * (l.x1 - l.x0);
      if (x > p[0]) w.set(l.g, (w.get(l.g) ?? 0) + (up ? 1 : -1));
    }
    for (const v of w.values()) if (v !== 0) return true;
    return false;
  }
}

const signedArea = (segs: Seg[]) => {
  let a = 0;
  for (const s of segs) for (let k = 0; k < STEPS; k++) { const p = bez(s, k / STEPS), q = bez(s, (k + 1) / STEPS); a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
};

/**
 * Segments of `fill`'s outline whose OUTSIDE (the side away from the fill), at distance `reach`, is inside EVERY cover at
 * three samples along the segment. Returned as open chains (consecutive covered segments joined), trimmed by `trim` at
 * both ends so a stroke cap cannot poke out where the coverage stops.
 */
export function coveredChains(fill: Contour[], covers: CoverIndex[], reach: number, trim: number): Seg[][] {
  if (!covers.length || covers.some((c) => c.empty)) return [];
  // All contours of one fill style share orientation (planar map), so the fill side is fixed for the whole style:
  // decide it from the contour with the largest area.
  const segsPer = fill.map(contourSegs);
  let best = 0, bestAbs = -1;
  for (const s of segsPer) { const a = signedArea(s); if (Math.abs(a) > bestAbs) { bestAbs = Math.abs(a); best = a; } }
  const outSign = best > 0 ? -1 : 1;   // interior is on the left (+90° normal) when area > 0 -> outside is the right
  const chains: Seg[][] = [];
  for (const segs of segsPer) {
    const flags = segs.map((s) => [0.2, 0.5, 0.8].every((t) => {
      const p = bez(s, t), d = tangent(s, t), len = Math.hypot(d[0], d[1]);
      if (len < 1e-9) return false;
      const nx = (-d[1] / len) * outSign, ny = (d[0] / len) * outSign;
      const q: Pt = [p[0] + nx * reach, p[1] + ny * reach];
      return covers.every((c) => c.inside(q));
    }));
    if (!flags.some(Boolean)) continue;
    const n = segs.length;
    const allCovered = flags.every(Boolean);
    // Start right after an uncovered segment so runs do not wrap around the start of the contour.
    const start = allCovered ? 0 : (flags.findIndex((f, k) => !f && flags[(k + 1) % n]) + 1) % n;
    let run: Seg[] = [];
    for (let j = 0; j < n; j++) {
      const k = (start + j) % n;
      if (flags[k]) run.push(segs[k]);
      else if (run.length) { chains.push(trimChain(run, trim)); run = []; }
    }
    if (run.length) chains.push(allCovered ? run : trimChain(run, trim));
  }
  return chains.filter((c) => c.length);
}

const ARC = 64;
/** Cumulative arc length table (ARC+1 entries) for t = k/ARC. */
function arcTable(s: Seg): number[] {
  const out = [0]; let prev = s.p0, l = 0;
  for (let k = 1; k <= ARC; k++) { const p = bez(s, k / ARC); l += Math.hypot(p[0] - prev[0], p[1] - prev[1]); out.push(l); prev = p; }
  return out;
}
const segLength = (s: Seg) => arcTable(s)[ARC];
/** Parameter t at arc length d from the start, by bisection (parameter speed may be very non-uniform). */
function tAtLength(s: Seg, d: number): number {
  const total = segLength(s);
  if (d <= 0) return 0;
  if (d >= total) return 1;
  let lo = 0, hi = 1;
  for (let it = 0; it < 40; it++) {
    const mid = (lo + hi) / 2;
    if (segLength(split(s, mid)[0]) < d) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
/** de Casteljau split at t. */
function split(s: Seg, t: number): [Seg, Seg] {
  const L = (a: Pt, b: Pt): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const p01 = L(s.p0, s.c1), p12 = L(s.c1, s.c2), p23 = L(s.c2, s.p3), p012 = L(p01, p12), p123 = L(p12, p23), m = L(p012, p123);
  return [{ p0: s.p0, c1: p01, c2: p012, p3: m }, { p0: m, c1: p123, c2: p23, p3: s.p3 }];
}
export function trimChain(chain: Seg[], d: number): Seg[] {
  if (d <= 0) return chain;
  const c = [...chain];
  // front
  let rem = d;
  while (c.length && rem > 0) {
    const l = segLength(c[0]);
    if (l <= rem) { rem -= l; c.shift(); continue; }
    c[0] = split(c[0], tAtLength(c[0], rem))[1]; rem = 0;
  }
  rem = d;
  while (c.length && rem > 0) {
    const l = segLength(c[c.length - 1]);
    if (l <= rem) { rem -= l; c.pop(); continue; }
    c[c.length - 1] = split(c[c.length - 1], tAtLength(c[c.length - 1], l - rem))[0]; rem = 0;
  }
  return c;
}
