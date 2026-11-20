// ToonSquid writer: TSProject model -> .tsproj bytes (stored ZIP of SQLite files).
import type { Database, SqlJsStatic } from 'sql.js';
import type { Contour } from '../geometry/contours';
import type { RGBA } from '../ir';
import type { Content, TSClip, TSEffect, TSProject, VectorItem } from '../resolver/model';
import { FIXED_DATE, rnd, uuid5 } from '../util';
import { writeZipStored, type ZipFile } from '../zip/writer';
import { ANIM_SCHEMA, DATA_SCHEMA, LT } from './schema';

const enc = new TextEncoder();
const blob = (o: unknown) => enc.encode(JSON.stringify(o));
const col = (c: RGBA) => ({ c: { r: rnd(c.r), g: rnd(c.g), b: rnd(c.b), a: rnd(c.a) } });
const pt = (p: [number, number]): [number, number] => [rnd(p[0]), rnd(p[1])];
const r6 = (n: number) => { const r = Math.round(n * 1e6) / 1e6; return r === 0 ? 0 : r; };
const pt6 = (p: [number, number]): [number, number] => [r6(p[0]), r6(p[1])];

function pathJson(contours: Contour[]) {
  return {
    s: contours.map((c) => {
      const o: Record<string, unknown> = {
        p: c.nodes.map((n) => {
          const node: Record<string, unknown> = { p: pt(n.p) };
          if (n.i) node.i = pt(n.i);
          if (n.o) node.o = pt(n.o);
          return node;
        }),
      };
      if (!c.closed) o.c = false;
      return o;
    }),
  };
}
function itemJson(it: VectorItem) {
  if (it.kind === 'fill') return { f: col(it.color), p: pathJson(it.contours) };
  // jS/cS = 1/1 are the only values observed in app-made files (meaning not decoded: experimental)
  return { p: pathJson(it.contours), jS: 1, cS: 1, sC: col(it.color), sW: rnd(it.width) };
}

const effectId = (layerId: string) => uuid5(`${layerId}|EF-PERSPECTIVE`);
const fxId = (layerId: string, i: number, kind: string) => uuid5(`${layerId}|EF-${i}-${kind}`);
const FX_ROW: Record<TSEffect['kind'], { type: number; name: string }> = {
  gaussianBlur: { type: LT.FX_BLUR, name: 'Gaussian Blur' },
  dropShadow: { type: LT.FX_SHADOW, name: 'Drop Shadow' },
  adjustments: { type: LT.FX_ADJUST, name: 'Adjustments' },
};
/** Effect row fields exactly as an app-made file stores them (Effect.tsproj): blur {r}, shadow {r, os, c}, adjustments {h, s, b, c}. */
function fxFields(e: TSEffect): Record<string, unknown> {
  if (e.kind === 'gaussianBlur') return { r: rnd(e.r) };
  if (e.kind === 'dropShadow') return { r: rnd(e.r), os: [rnd(e.os[0]), rnd(e.os[1])], c: { r: rnd(e.c.r), g: rnd(e.c.g), b: rnd(e.c.b) } };
  const o: Record<string, unknown> = {};
  for (const k of ['h', 's', 'b', 'c'] as const) if (e[k] !== 0) o[k] = rnd(e[k]);
  return o;
}

function contentLayer(id: string, drawingId: string, c: Content): { type: number; data: Record<string, unknown> } {
  if (c.kind === 'vector') {
    const d: Record<string, unknown> = { Na: c.name, v: 3, DI: drawingId, tf: { pv: [0, 0], p: [0, 0] }, s: c.items.map(itemJson), Id: id, V: 3, LD: FIXED_DATE };
    if (c.effect) d.Ef = [effectId(id)];
    return { type: LT.VECTOR, data: d };
  }
  const r = c.ref;
  const tf: Record<string, unknown> = { pv: pt(r.pv), p: pt(r.p) };
  if (Math.abs(r.rot) > 1e-9) tf.r = rnd(r.rot);
  if (Math.abs(r.sx - 1) > 1e-9 || Math.abs(r.sy - 1) > 1e-9) tf.s = [rnd(r.sx), rnd(r.sy)];
  const d: Record<string, unknown> = { cl: { v: 1, id: r.clipId }, Id: id, V: 3, Na: r.name, DI: drawingId, LD: FIXED_DATE, tf, v: 2 };
  if (Math.abs(r.alpha - 1) > 1e-9) d.op = rnd(r.alpha);
  if (r.blend !== undefined) d.bM = r.blend;
  if (r.effects?.length) d.Ef = r.effects.map((e, i) => fxId(id, i, e.kind));
  return { type: LT.CLIP, data: d };
}

function createTables(db: Database, schema: Record<string, string>) {
  for (const sql of Object.values(schema)) db.run(sql);
}

function writeAnim(SQL: SqlJsStatic, p: TSProject, clip: TSClip): Uint8Array {
  const db = new SQL.Database();
  createTables(db, ANIM_SCHEMA);
  db.run('INSERT INTO meta_i(key,value) VALUES (?,?)', ['v', 1]);
  const insL = db.prepare('INSERT INTO layers(id,type,data) VALUES (?,?,?)');
  const insD = db.prepare('INSERT INTO drawings(id,data) VALUES (?,?)');
  insL.run([clip.backgroundId, LT.BACKGROUND, blob({ Na: 'Background', LD: FIXED_DATE, V: 3, v: 2, if: true, Id: clip.backgroundId })]);
  for (const l of clip.layers) {
    insL.run([l.id, LT.TIMELINE, blob({ Na: l.name, LD: FIXED_DATE, V: 3, v: 3, dr: l.drawings.map((d) => d.id), Id: l.id })]);
    for (const d of l.drawings) {
      insD.run([d.id, blob({ lMD: FIXED_DATE, l: l.id, id: d.id, s: d.s, ly: d.content.map((c) => c.id), v: 3, e: d.e })]);
      for (const c of d.content) {
        const cl = contentLayer(c.id, d.id, c.c);
        insL.run([c.id, cl.type, blob(cl.data)]);
        if (c.c.kind === 'vector' && c.c.effect) {
          const e = c.c.effect.c;
          const eid = effectId(c.id);
          insL.run([eid, LT.EFFECT, blob({ LI: c.id, Na: 'Perspective', Id: eid, V: 3, LD: FIXED_DATE, c0: pt6(e[0]), c1: pt6(e[1]), c2: pt6(e[2]), c3: pt6(e[3]) })]);
        }
        if (c.c.kind === 'clip' && c.c.ref.effects?.length) {
          c.c.ref.effects.forEach((e, i) => {
            const eid = fxId(c.id, i, e.kind);
            insL.run([eid, FX_ROW[e.kind].type, blob({ LI: c.id, Na: FX_ROW[e.kind].name, Id: eid, V: 3, LD: FIXED_DATE, ...fxFields(e) })]);
          });
        }
      }
    }
  }
  insL.free(); insD.free();
  db.run('INSERT INTO animationClip(id,data) VALUES (?,?)', [clip.id, blob({
    tF: 1, ma: [], lMD: FIXED_DATE, lO: [clip.backgroundId, ...clip.layers.map((l) => l.id)], id: clip.id, cD: FIXED_DATE, cL: null,
    v: 5, re: { w: p.width, h: p.height }, fr: p.fps, na: clip.name, tH: { r: [], v: 1, c: [] },
  })]);
  const out = db.export();
  db.close();
  return out;
}

function writeData(SQL: SqlJsStatic, p: TSProject): Uint8Array {
  const db = new SQL.Database();
  createTables(db, DATA_SCHEMA);
  db.run('INSERT INTO meta_i(key,value) VALUES (?,?)', ['v', 1]);
  db.run('INSERT INTO meta_i(key,value) VALUES (?,?)', ['sv', 2]);
  const scene = p.clips.find((c) => c.id === p.sceneIds[0])!;
  const firstLayer = scene.layers.find((l) => l.drawings.length);
  const firstDrawing = firstLayer?.drawings[0];
  const pcs: unknown[] = [];
  for (const c of p.clips) {
    pcs.push(c.id, { lo: { md: 0, v: 1, e: null, s: null, en: false }, v: 2, sFW: 80, tM: 0, cTH: null, dWf: 0, nDS: 1, oSE: false, dDD: 1 });
  }
  const eS: Record<string, unknown> = {
    exS: { v: 1, iA: null, cI: p.sceneIds[0], iT: null, re: { w: p.width, h: p.height } },
    cF: 1, v: 6, sC: p.sceneIds[0], pCS: pcs,
    oS: { aC: { g: 0, b: 1, r: 0.1302042 }, a: 3, b: 2, bO: [0.34807956, 0.29022664, 0.23237312, 0.1745198, 0.11666667], m: 1, bC: { g: 0.263, b: 0.168, r: 0.897 }, v: 3, o: 0, t: 0, aO: [0.34807956, 0.29022664, 0.23237312, 0.1745198, 0.11666667] },
  };
  if (firstLayer && firstDrawing) { eS.sAL = firstLayer.id; eS.sCL = firstDrawing.content[0].id; eS.sD = firstDrawing.id; }
  const me = { tC: null, re: { w: p.width, h: p.height }, fr: p.fps, oD: FIXED_DATE, id: p.id, cD: FIXED_DATE, na: p.name, v: 1, mO: 17 };
  const oR = { v: 1, dRI: [], anD: [], auD: [], txD: [], tSD: [], viD: [] };
  db.run('INSERT INTO meta_d(key,value) VALUES (?,?)', ['me', blob(me)]);
  db.run('INSERT INTO meta_d(key,value) VALUES (?,?)', ['eS', blob(eS)]);
  db.run('INSERT INTO meta_d(key,value) VALUES (?,?)', ['oR', blob(oR)]);
  p.sceneIds.forEach((id, i) => db.run('INSERT INTO scenes(id,"index") VALUES (?,?)', [id, i]));
  for (const c of p.clips) db.run('INSERT INTO res_anim_clips(id) VALUES (?)', [c.id]);
  const out = db.export();
  db.close();
  return out;
}

export function writeTsproj(SQL: SqlJsStatic, p: TSProject): Uint8Array {
  const root = p.id;
  const files: ZipFile[] = [{ name: `${root}/Videos/`, dir: true }, { name: `${root}/data`, data: writeData(SQL, p) }];
  const clips = [...p.clips].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const c of clips) files.push({ name: `${root}/Animations/${c.id}.tsanim`, data: writeAnim(SQL, p, c) });
  return writeZipStored(files);
}
