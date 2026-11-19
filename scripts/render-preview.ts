// Dev tool: renders a frame of a written .tsproj to SVG by reading ONLY the output file back.
// Implements the Perspective effect as read from the app-made sample (see geometry/perspective.ts).
//   npx tsx scripts/render-preview.ts in.tsproj frame out.svg [--no-effects]
import { readFileSync, writeFileSync } from 'node:fs';
import { contoursBounds } from '../src/engine/geometry/bounds';
import type { Contour } from '../src/engine/geometry/contours';
import { readZipTolerant } from '../src/engine/zip/reader';
import { nodeSql } from '../tests/helpers';

type Pt = [number, number];
/* eslint-disable @typescript-eslint/no-explicit-any */

/** Projective map sending 4 source corners to 4 destination corners (affine when the quad is a parallelogram). */
function homography(src: Pt[], dst: Pt[]): (p: Pt) => Pt {
  const A: number[][] = [], B: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); B.push(v);
  }
  const n = 8;
  for (let i = 0; i < n; i++) {
    let piv = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
    [A[i], A[piv]] = [A[piv], A[i]]; [B[i], B[piv]] = [B[piv], B[i]];
    for (let r = i + 1; r < n; r++) { const f = A[r][i] / A[i][i]; for (let c = i; c < n; c++) A[r][c] -= f * A[i][c]; B[r] -= f * B[i]; }
  }
  const h = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = B[i]; for (let c = i + 1; c < n; c++) s -= A[i][c] * h[c]; h[i] = s / A[i][i]; }
  return ([x, y]) => { const w = h[6] * x + h[7] * y + 1; return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w]; };
}

const d2 = (n: number) => Math.round(n * 100) / 100;
const rgba = (c: any) => `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${c.a})`;

/** Resolve an effect row to {c0..c3} at 0-based frame `t` (K tracks "cx,i"/"cy,i", linear interpolation assumed). */
export function resolveEffect(e: any, t: number): any {
  const out: any = { c0: e.c0 ?? [0, 0], c1: e.c1 ?? [0, 0], c2: e.c2 ?? [0, 0], c3: e.c3 ?? [0, 0] };
  if (Array.isArray(e.K)) {
    for (let i = 0; i < e.K.length; i += 2) {
      const [kind, idx] = String(e.K[i]).split(','); const tr = e.K[i + 1];
      let v = tr.v[0];
      for (let k = 0; k < tr.f.length; k++) {
        if (t >= tr.f[k]) v = tr.v[k];
        if (k + 1 < tr.f.length && t >= tr.f[k] && t < tr.f[k + 1]) v = tr.v[k] + ((tr.v[k + 1] - tr.v[k]) * (t - tr.f[k])) / (tr.f[k + 1] - tr.f[k]);
      }
      out[`c${idx}`] = kind === 'cx' ? [v, out[`c${idx}`][1]] : [out[`c${idx}`][0], v];
    }
  }
  return out;
}

export function itemsToSvg(items: any[], effect?: any): string {
  const toContours = (it: any): Contour[] => it.p.s.map((sp: any) => ({ nodes: sp.p.map((n: any) => ({ p: n.p, i: n.i, o: n.o })), closed: sp.c !== false }));
  let warp: ((p: Pt) => Pt) | null = null;
  if (effect) {
    const b = contoursBounds(items.flatMap(toContours));
    if (b) {
      const w = b.maxX - b.minX, h = b.maxY - b.minY;
      const src: Pt[] = [[b.minX, b.minY], [b.maxX, b.minY], [b.minX, b.maxY], [b.maxX, b.maxY]];
      const dst = src.map((p, i) => [p[0] + effect[`c${i}`][0] * w, p[1] + effect[`c${i}`][1] * h] as Pt);
      warp = homography(src, dst);
    }
  }
  let out = '';
  for (const it of items) {
    const fill = it.f ? rgba(it.f.c.c ?? it.f.c) : 'none';
    const stroke = it.sC ? rgba(it.sC.c) : 'none';
    let dd = '';
    for (const sp of it.p.s) {
      const nodes = sp.p as any[];
      // absolute control points, optionally warped
      const P = nodes.map((n) => {
        const p: Pt = n.p, o: Pt = [p[0] + (n.o?.[0] ?? 0), p[1] + (n.o?.[1] ?? 0)], i: Pt = [p[0] + (n.i?.[0] ?? 0), p[1] + (n.i?.[1] ?? 0)];
        return warp ? { p: warp(p), o: warp(o), i: warp(i) } : { p, o, i };
      });
      const seg = (a: any, b: any) => `C${d2(a.o[0])} ${d2(a.o[1])} ${d2(b.i[0])} ${d2(b.i[1])} ${d2(b.p[0])} ${d2(b.p[1])}`;
      dd += `M${d2(P[0].p[0])} ${d2(P[0].p[1])}`;
      for (let k = 1; k < P.length; k++) dd += seg(P[k - 1], P[k]);
      if (sp.c !== false) dd += `${seg(P[P.length - 1], P[0])}Z`;
    }
    out += `<path d="${dd}" fill="${fill}" fill-rule="nonzero" stroke="${stroke}" stroke-width="${it.sW ?? 0}"/>`;
  }
  return out;
}

export async function renderTsprojSvg(file: string, frame: number, useEffects = true): Promise<string> {
  const SQL = await nodeSql();
  const zip = readZipTolerant(new Uint8Array(readFileSync(file)));
  const dec = new TextDecoder();
  const j = (v: unknown) => JSON.parse(dec.decode(v as Uint8Array));
  const dbs = new Map<string, any>();
  let rootId = '';
  for (const [k, v] of zip.entries) { const m = /^([^/]+)\/Animations\/(.+)\.tsanim$/.exec(k); if (m) { rootId = m[1]; dbs.set(m[2], new SQL.Database(v)); } }
  const data = new SQL.Database(zip.entries.get(`${rootId}/data`)!);
  const me = j(data.exec("select value from meta_d where key='me'")[0].values[0][0]);
  const scene = data.exec('select id from scenes order by "index"')[0].values[0][0] as string;
  const q = (db: any, sql: string) => (db.exec(sql)[0]?.values ?? []) as unknown[][];

  const clipLen = (id: string): number => { const db = dbs.get(id); if (!db) return 1; return Math.max(1, ...q(db, 'select data from drawings').map((r) => j(r[0]).e as number)); };
  function clip(id: string, f: number, depth: number): string {
    const t0 = f - 1;
    if (depth > 12) return '';
    const db = dbs.get(id); if (!db) return '';
    const lO = j(q(db, 'select data from animationClip')[0][0]).lO as string[];
    let svg = '';
    for (const lid of lO) {
      const row = q(db, `select type,data from layers where id='${lid}'`)[0];
      if ((row[0] as number) !== 10) continue;
      for (const did of j(row[1]).dr) {
        const dr = j(q(db, `select data from drawings where id='${did}'`)[0][0]);
        if (f < dr.s || f > dr.e) continue;
        for (const cid of dr.ly) {
          const c = q(db, `select type,data from layers where id='${cid}'`)[0];
          const cd = j(c[1]);
          if (c[0] === 1) {
            let eff: any;
            if (useEffects && cd.Ef?.length) eff = resolveEffect(j(q(db, `select data from layers where id='${cd.Ef[0]}'`)[0][0]), t0);
            svg += itemsToSvg(cd.s, eff);
          } else if (c[0] === 3) { // shape primitive (as written by the app itself)
            let eff: any;
            if (useEffects && cd.Ef?.length) eff = resolveEffect(j(q(db, `select data from layers where id='${cd.Ef[0]}'`)[0][0]), t0);
            const tf = cd.tf, sc = tf.s ?? [1, 1];
            svg += `<g transform="translate(${tf.p[0]} ${tf.p[1]}) rotate(${((tf.r ?? 0) * 180) / Math.PI}) scale(${sc[0]} ${sc[1]}) translate(${-tf.pv[0]} ${-tf.pv[1]})">${itemsToSvg([{ f: cd.fC, p: cd.p }], eff)}</g>`;
          } else if (c[0] === 4) {
            const tf = cd.tf, sc = tf.s ?? [1, 1];
            svg += `<g opacity="${cd.op ?? 1}" transform="translate(${tf.p[0]} ${tf.p[1]}) rotate(${((tf.r ?? 0) * 180) / Math.PI}) scale(${sc[0]} ${sc[1]}) translate(${-tf.pv[0]} ${-tf.pv[1]})">${clip(cd.cl.id, ((f - dr.s) % Math.max(1, clipLen(cd.cl.id))) + 1, depth + 1)}</g>`;
          }
        }
      }
    }
    return svg;
  }
  const body = clip(scene, frame, 0);
  for (const db of dbs.values()) db.close();
  data.close();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${me.re.w}" height="${me.re.h}" viewBox="0 0 ${me.re.w} ${me.re.h}"><rect width="100%" height="100%" fill="#999"/>${body}</svg>`;
}

if (process.argv[1]?.endsWith('render-preview.ts')) {
  const [inp, frame, out] = process.argv.slice(2);
  writeFileSync(out, await renderTsprojSvg(inp, Number(frame), !process.argv.includes('--no-effects')));
}
