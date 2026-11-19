import type { Contour } from '../src/engine/geometry/contours';
const d2 = (n: number) => Math.round(n * 100) / 100;
export function chainToContourSvg(list: Contour[]): string {
  let dd = '';
  for (const c of list) {
    const n = c.nodes; if (!n.length) continue;
    const abs = (k: number) => { const a = n[k]; return { p: a.p, o: [a.p[0] + (a.o?.[0] ?? 0), a.p[1] + (a.o?.[1] ?? 0)], i: [a.p[0] + (a.i?.[0] ?? 0), a.p[1] + (a.i?.[1] ?? 0)] }; };
    const seg = (a: ReturnType<typeof abs>, b: ReturnType<typeof abs>) => `C${d2(a.o[0])} ${d2(a.o[1])} ${d2(b.i[0])} ${d2(b.i[1])} ${d2(b.p[0])} ${d2(b.p[1])}`;
    dd += `M${d2(n[0].p[0])} ${d2(n[0].p[1])}`;
    for (let k = 1; k < n.length; k++) dd += seg(abs(k - 1), abs(k));
    if (c.closed) dd += `${seg(abs(n.length - 1), abs(0))}Z`;
  }
  return dd;
}
