import type { Contour } from './contours';

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number; }

function cubicExtrema(p0: number, p1: number, p2: number, p3: number): number[] {
  // derivative of cubic Bézier: a t² + b t + c
  const a = -p0 + 3 * p1 - 3 * p2 + p3, b = 2 * (p0 - 2 * p1 + p2), c = p1 - p0;
  const ts: number[] = [];
  if (Math.abs(a) < 1e-12) { if (Math.abs(b) > 1e-12) ts.push(-c / b); }
  else { const d = b * b - 4 * a * c; if (d >= 0) { const r = Math.sqrt(d); ts.push((-b + r) / (2 * a), (-b - r) / (2 * a)); } }
  return ts.filter((t) => t > 0 && t < 1);
}
const at = (t: number, p0: number, p1: number, p2: number, p3: number) => { const u = 1 - t; return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3; };

/** Tight bounds of the Bézier outline (extrema included). */
export function contoursBounds(list: Contour[]): Bounds | null {
  let b: Bounds | null = null;
  const add = (x: number, y: number) => { if (!b) b = { minX: x, minY: y, maxX: x, maxY: y }; else { b.minX = Math.min(b.minX, x); b.minY = Math.min(b.minY, y); b.maxX = Math.max(b.maxX, x); b.maxY = Math.max(b.maxY, y); } };
  for (const c of list) {
    const n = c.nodes.length;
    for (const nd of c.nodes) add(nd.p[0], nd.p[1]);
    const last = c.closed ? n : n - 1;
    for (let k = 0; k < last; k++) {
      const a = c.nodes[k], z = c.nodes[(k + 1) % n];
      const p1: [number, number] = [a.p[0] + (a.o?.[0] ?? 0), a.p[1] + (a.o?.[1] ?? 0)];
      const p2: [number, number] = [z.p[0] + (z.i?.[0] ?? 0), z.p[1] + (z.i?.[1] ?? 0)];
      for (const t of cubicExtrema(a.p[0], p1[0], p2[0], z.p[0])) add(at(t, a.p[0], p1[0], p2[0], z.p[0]), at(t, a.p[1], p1[1], p2[1], z.p[1]));
      for (const t of cubicExtrema(a.p[1], p1[1], p2[1], z.p[1])) add(at(t, a.p[0], p1[0], p2[0], z.p[0]), at(t, a.p[1], p1[1], p2[1], z.p[1]));
    }
  }
  return b;
}
