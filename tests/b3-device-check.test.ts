// Phase B3.5: the device-check sample is built by the real pipeline and its written structure is what the device test
// plan expects. The XFL is a synthetic TEST FIXTURE (scripts/device/make-b3-device-check.ts), not an Animate file.
// This is AUTOMATED verification only; it says nothing about what ToonSquid shows on a device.
import { describe, expect, it } from 'vitest';
import { BLUR_END, buildB3DeviceCheck, COUNTER_COLORS, FPS, FRAMES, LAYERS } from '../scripts/device/make-b3-device-check';
import { validateTsproj } from '../src/engine/tsproj/validator';
import { readZipTolerant } from '../src/engine/zip/reader';
import { nodeSql } from './helpers';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
async function inspect(bytes: Uint8Array) {
  const SQL = await nodeSql();
  const zip = readZipTolerant(bytes);
  const dec = new TextDecoder();
  const j = (v: unknown) => JSON.parse(typeof v === 'string' ? v : dec.decode(v as Uint8Array));
  const clips = new Map<string, { c: Json; L: Map<string, { t: number; d: Json }>; D: Map<string, Json> }>();
  for (const [k, v] of zip.entries) {
    if (!k.endsWith('.tsanim')) continue;
    const db = new SQL.Database(v);
    const c = j(db.exec('select data from animationClip')[0].values[0][0]);
    const L = new Map<string, { t: number; d: Json }>();
    for (const r of db.exec('select id,type,data from layers')[0].values) L.set(r[0] as string, { t: r[1] as number, d: j(r[2]) });
    const D = new Map<string, Json>();
    for (const r of db.exec('select id,data from drawings')[0]?.values ?? []) D.set(r[0] as string, j(r[1]));
    clips.set(c.na, { c, L, D });
    db.close();
  }
  return { zip, clips };
}
const time = (d: Json) => (d.K ? d.K[1].v[0] : 1);

describe('B3 device-check sample (scripts/device/make-b3-device-check.ts)', async () => {
  const r = await buildB3DeviceCheck();
  const { zip, clips } = await inspect(r.bytes);
  const scene = clips.get('B3 device check')!;
  const tl = (scene.c.lO as string[]).map((id) => ({ id, ...scene.L.get(id)! })).filter((l) => l.t === 10);
  const byName = (n: string) => tl.find((l) => l.d.Na === n)!;
  const drawings = (n: string) => (byName(n).d.dr as string[]).map((id) => scene.D.get(id)!);
  const content = (dr: Json) => (dr.ly as string[]).map((id) => scene.L.get(id)!);

  it('passes the validator, independently re-run on the bytes', async () => {
    expect(r.report.validation.ok).toBe(true);
    expect(validateTsproj(await nodeSql(), r.bytes).ok).toBe(true);
  });

  it('is a pipeline product: deterministic, 3 clips, 12 fps, 24 frames, 1920×1080', async () => {
    expect((await buildB3DeviceCheck()).report.output.sha1).toBe(r.report.output.sha1);
    expect([...clips.keys()].sort()).toEqual(['B3 device check', 'Ball', 'Counter 1-6']);
    for (const { c } of clips.values()) expect([c.fr, c.re.w, c.re.h]).toEqual([FPS, 1920, 1080]);
    expect(Math.max(...[...scene.D.values()].map((d) => d.e))).toBe(FRAMES);
    expect([...zip.entries.keys()].filter((k) => !k.endsWith('/')).length).toBe(4);   // data + 3 .tsanim
  });

  it('layer order bottom→top and visibility: only the hidden and guide layers carry Vi:false', () => {
    expect(tl.map((l) => [l.d.Na, l.d.Vi])).toEqual([
      [LAYERS.background, undefined], [LAYERS.blur, undefined], [LAYERS.reverse, undefined], [LAYERS.forward, undefined],
      [`[Guide] ${LAYERS.guide}`, false], [LAYERS.hidden, false],
    ]);
  });

  it('hidden and guide layers keep their art (one vector drawing over frames 1–24)', () => {
    for (const n of [LAYERS.hidden, `[Guide] ${LAYERS.guide}`]) {
      const ds = drawings(n);
      expect(ds.map((d) => [d.s, d.e])).toEqual([[1, 24]]);
      expect(content(ds[0]).map((c) => c.t)).toEqual([1]);
    }
  });

  it('forward counter: one drawing 1–24 playing the full 6-frame clip from Time 1 (looping is left to ToonSquid)', () => {
    const ds = drawings(LAYERS.forward);
    expect(ds.map((d) => [d.s, d.e])).toEqual([[1, 24]]);
    const sym = content(ds[0])[0];
    expect([sym.t, sym.d.Na, time(sym.d)]).toEqual([4, 'Counter 1-6', 1]);
    const counter = clips.get('Counter 1-6')!;
    expect([...counter.D.values()].map((d) => [d.s, d.e, d.ly.length]).sort((a, b) => a[0] - b[0])).toEqual(COUNTER_COLORS.map((_, k) => [k + 1, k + 1, k + 1]));
  });

  it('reverse counter: 24 one-frame drawings with Time 6,5,4,3,2,1 repeated, all on the same full clip', () => {
    const ds = drawings(LAYERS.reverse);
    expect(ds.map((d) => [d.s, d.e])).toEqual(Array.from({ length: FRAMES }, (_, i) => [i + 1, i + 1]));
    const syms = ds.map((d) => content(d)[0]);
    expect(syms.map((s) => time(s.d))).toEqual(Array.from({ length: FRAMES }, (_, i) => 6 - (i % 6)));
    expect(new Set(syms.map((s) => s.d.cl.id)).size).toBe(1);
    expect(syms[0].d.cl.id).toBe(content(drawings(LAYERS.forward)[0])[0].d.cl.id);
  });

  it('blur tween: one Gaussian Blur row (type 100) per frame, radius strictly increasing from 0 to the end value', () => {
    const ds = drawings(LAYERS.blur);
    expect(ds.map((d) => [d.s, d.e])).toEqual(Array.from({ length: FRAMES }, (_, i) => [i + 1, i + 1]));
    const radii = ds.map((d) => {
      const sym = content(d)[0];
      expect(sym.d.Ef).toHaveLength(1);
      const fx = scene.L.get(sym.d.Ef[0])!;
      expect(fx.t).toBe(100);
      expect(fx.d.LI).toBe(sym.d.Id);
      return fx.d.r as number;
    });
    expect(radii[0]).toBe(0);
    for (let i = 1; i < radii.length; i++) expect(radii[i]).toBeGreaterThan(radii[i - 1]);
    // Animate blur 60 (quality 3) -> ToonSquid radius 2σ = 59.99 (mapping from Phase "filters", not calibrated)
    expect(radii[FRAMES - 1]).toBeCloseTo(2 * Math.sqrt((3 * (BLUR_END * BLUR_END - 1)) / 12), 2);
  });

  it('report lists every approximation used by the sample, and no loss', () => {
    const codes = r.report.diagnostics.map((d) => `${d.severity}:${d.code}`);
    for (const c of ['info:LAYER_HIDDEN', 'info:LAYER_GUIDE', 'approx:LOOP_REVERSE', 'unsupported:TS_LOOP_MODE', 'approx:TWEEN_FX_BAKED', 'approx:TWEEN_BAKED']) expect(codes).toContain(c);
    expect(codes.filter((c) => c.startsWith('loss:'))).toEqual([]);
  });
});
