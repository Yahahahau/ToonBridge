// Phase B3: core timeline & layer fidelity.
// Every XFL here is a SYNTHETIC TEST FIXTURE written by hand for one behaviour. None of them is an Adobe Animate file.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { analyzeInput, convertAnalysis, type DiagItem } from '../src/engine';
import { readZipTolerant } from '../src/engine/zip/reader';
import { renderTsprojSvg } from '../scripts/render-preview';
import { nodeSql } from './helpers';

const XNS = 'xmlns="http://ns.adobe.com/xfl/2008/"';
export const box = (color: string, x = 0, size = 2000) =>
  `<DOMShape><fills><FillStyle index="1"><SolidColor color="${color}"/></FillStyle></fills><edges><Edge fillStyle1="1" edges="!${x} 0|${x + size} 0|${x + size} ${size}|${x} ${size}|${x} 0"/></edges></DOMShape>`;
export const layer = (name: string, frames: string, attrs = '') => `<DOMLayer name="${name}" ${attrs}><frames>${frames}</frames></DOMLayer>`;
export const frame = (index: number, duration: number, elements: string, attrs = '') => `<DOMFrame index="${index}" duration="${duration}" ${attrs}><elements>${elements}</elements></DOMFrame>`;
export const symbolXml = (name: string, layers: string, type = 'graphic') => `<DOMSymbolItem ${XNS} name="${name}" symbolType="${type}"><timeline><DOMTimeline name="${name}"><layers>${layers}</layers></DOMTimeline></timeline></DOMSymbolItem>`;
/** A symbol whose frame k (0-based) shows a box with colour COLORS[k]: a frame counter you can read back from the output. */
export const COLORS = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF'];
export const counter = (name: string, n = COLORS.length) => symbolXml(name, layer('art', Array.from({ length: n }, (_, i) => frame(i, 1, box(COLORS[i]))).join('')));

/** Synthetic XFL zip: one scene (`layers` = inner XML of <layers>) plus library symbols { file name -> XML }. */
export function xfl(layers: string, symbols: Record<string, string> = {}): Uint8Array {
  const inc = Object.keys(symbols).map((k) => `<Include href="${k}.xml"/>`).join('');
  const doc = `<DOMDocument ${XNS} width="200" height="200" frameRate="24"><symbols>${inc}</symbols><timelines><DOMTimeline name="Scene 1"><layers>${layers}</layers></DOMTimeline></timelines></DOMDocument>`;
  const files: Record<string, Uint8Array> = { 'DOMDocument.xml': strToU8(doc), 'p.xfl': strToU8('PROXY-CS5') };
  for (const [k, v] of Object.entries(symbols)) files[`LIBRARY/${k}.xml`] = strToU8(v);
  return zipSync(files, { level: 0 });
}

export async function convert(bytes: Uint8Array) {
  const SQL = await nodeSql();
  const a = analyzeInput(bytes, 'fixture.zip');
  return { a, out: convertAnalysis(a, SQL), SQL };
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export interface ClipView { name: string; lO: string[]; layers: Map<string, { type: number; d: Json }>; drawings: Map<string, Json>; }
/** Reads the written .tsproj back (output only): clip name -> layers and drawings. */
export async function readBack(bytes: Uint8Array): Promise<Map<string, ClipView>> {
  const SQL = await nodeSql();
  const zip = readZipTolerant(bytes);
  const dec = new TextDecoder();
  const j = (v: unknown) => JSON.parse(typeof v === 'string' ? v : dec.decode(v as Uint8Array));
  const clips = new Map<string, ClipView>();
  for (const [k, v] of zip.entries) {
    if (!/\/Animations\/.+\.tsanim$/.test(k)) continue;
    const db = new SQL.Database(v);
    const c = j(db.exec('select data from animationClip')[0].values[0][0]);
    const layers = new Map<string, { type: number; d: Json }>();
    for (const r of db.exec('select id,type,data from layers')[0]?.values ?? []) layers.set(r[0] as string, { type: r[1] as number, d: j(r[2]) });
    const drawings = new Map<string, Json>();
    for (const r of db.exec('select id,data from drawings')[0]?.values ?? []) drawings.set(r[0] as string, j(r[1]));
    clips.set(c.na, { name: c.na, lO: c.lO, layers, drawings });
    db.close();
  }
  return clips;
}
/** Timeline layers of a clip, bottom first (ToonSquid lO order), without the Background. */
export const timelineLayers = (c: ClipView) => c.lO.map((id) => ({ id, ...c.layers.get(id)! })).filter((l) => l.type === 10);
/** Content layers (vector / symbol) shown by a timeline layer, with their drawing's frame range. */
export const contents = (c: ClipView, tlId: string) => (c.layers.get(tlId)!.d.dr as string[]).flatMap((did) => {
  const d = c.drawings.get(did)!;
  return (d.ly as string[]).map((ly) => ({ s: d.s as number, e: d.e as number, ...c.layers.get(ly)! }));
});
export const fillHex = (d: Json) => (d.s as Json[]).filter((it) => it.f).map((it) => {
  const h = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0').toUpperCase();
  return `#${h(it.f.c.r)}${h(it.f.c.g)}${h(it.f.c.b)}`;
});
export const find = (ds: DiagItem[], code: string) => ds.filter((d) => d.code === code);
/** Fill colours ("r,g,b") drawn by the preview renderer, which reads only the output file. */
export const fillsIn = (svg: string) => [...svg.matchAll(/fill="rgba\((\d+,\d+,\d+),/g)].map((m) => m[1]);
export async function svgAt(bytes: Uint8Array, frame: number): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'b3-'));
  const f = join(dir, 'x.tsproj');
  writeFileSync(f, bytes);
  return renderTsprojSvg(f, frame);
}

// ---------------------------------------------------------------------------------------------------------------
describe('B3.1 hidden layers are kept hidden (Vi:false)', () => {
  const doc = xfl(
    layer('Top visible', frame(0, 3, box('#FF0000'))) +
    layer('Middle hidden', frame(0, 3, box('#00FF00', 500)), 'visible="false"') +
    layer('Bottom visible', frame(0, 3, box('#0000FF', 1000))),
  );

  it('writes the hidden layer with its art and Vi:false; visible layers carry no Vi key', async () => {
    const { out } = await convert(doc);
    expect(out.report.validation.ok).toBe(true);
    const scene = (await readBack(out.bytes)).get('Scene 1')!;
    const tls = timelineLayers(scene);
    expect(tls.map((l) => [l.d.Na, l.d.Vi])).toEqual([['Bottom visible', undefined], ['Middle hidden', false], ['Top visible', undefined]]);
    const hiddenArt = contents(scene, tls[1].id);
    expect(hiddenArt).toHaveLength(1);
    expect(fillHex(hiddenArt[0].d)).toEqual(['#00FF00']);
    expect([hiddenArt[0].s, hiddenArt[0].e]).toEqual([1, 3]);
  });

  it('keeps the source layer order (ToonSquid lists bottom first)', async () => {
    const { out } = await convert(xfl(['A', 'B', 'C', 'D'].map((n, i) => layer(n, frame(0, 1, box(COLORS[i], i * 100)), i % 2 ? 'visible="false"' : '')).join('')));
    const tls = timelineLayers((await readBack(out.bytes)).get('Scene 1')!);
    expect(tls.map((l) => l.d.Na)).toEqual(['D', 'C', 'B', 'A']);
    expect(tls.map((l) => l.d.Vi === false)).toEqual([true, false, true, false]);
  });

  it('reports the hidden layer as kept (info), not as lost', async () => {
    const { out } = await convert(doc);
    const h = find(out.report.diagnostics, 'LAYER_HIDDEN');
    expect(h).toHaveLength(1);
    expect(h[0].severity).toBe('info');
    expect(h[0].locations[0]).toMatchObject({ owner: 'Scene 1', layer: 'Middle hidden', layerIndex: 2, source: 'visible="false"' });
    expect(out.report.diagnostics.filter((d) => d.severity === 'loss')).toEqual([]);
  });

  it('a hidden layer is not drawn: render of the output shows the visible colours only', async () => {
    const { out } = await convert(doc);
    const fills = fillsIn(await svgAt(out.bytes, 1));
    expect(fills).toContain('255,0,0');
    expect(fills).toContain('0,0,255');
    expect(fills).not.toContain('0,255,0');
  });

  it('a hidden layer above does not hide or change visible art below it (no seam bleed under hidden art)', async () => {
    const base = xfl(layer('Art', frame(0, 1, box('#0000FF'))));
    const withHidden = xfl(layer('Cover', frame(0, 1, box('#FF0000')), 'visible="false"') + layer('Art', frame(0, 1, box('#0000FF'))));
    const a = timelineLayers((await readBack((await convert(base)).out.bytes)).get('Scene 1')!);
    const bClip = (await readBack((await convert(withHidden)).out.bytes)).get('Scene 1')!;
    const b = timelineLayers(bClip);
    const aClip = (await readBack((await convert(base)).out.bytes)).get('Scene 1')!;
    expect(contents(bClip, b[0].id)[0].d.s).toEqual(contents(aClip, a[0].id)[0].d.s);
  });

  it('hidden layers inside nested symbols are kept hidden too, and their animation is kept', async () => {
    const inner = symbolXml('Inner', layer('shown', frame(0, 3, box('#0000FF'))) + layer('off', frame(0, 1, box('#FF0000')) + frame(1, 2, box('#00FF00')), 'visible="false"'));
    const { out } = await convert(xfl(layer('L', frame(0, 3, '<DOMSymbolInstance libraryItemName="Inner" symbolType="graphic" loop="loop"><matrix><Matrix/></matrix></DOMSymbolInstance>')), { Inner: inner }));
    expect(out.report.validation.ok).toBe(true);
    const clip = (await readBack(out.bytes)).get('Inner')!;
    const tls = timelineLayers(clip);
    expect(tls.map((l) => [l.d.Na, l.d.Vi])).toEqual([['off', false], ['shown', undefined]]);
    // Only the hidden layer changes, yet the symbol is still treated as animated (its hidden frames are not collapsed).
    expect(contents(clip, tls[0].id).map((c) => [c.s, c.e, fillHex(c.d)[0]])).toEqual([[1, 1, '#FF0000'], [2, 3, '#00FF00']]);
  });

  it('guide layers are kept hidden and marked "[Guide]"', async () => {
    const { out } = await convert(xfl(layer('path', frame(0, 2, box('#888888')), 'layerType="guide"') + layer('Art', frame(0, 2, box('#0000FF')))));
    const tls = timelineLayers((await readBack(out.bytes)).get('Scene 1')!);
    expect(tls.map((l) => [l.d.Na, l.d.Vi])).toEqual([['Art', undefined], ['[Guide] path', false]]);
    const g = find(out.report.diagnostics, 'LAYER_GUIDE');
    expect(g[0].severity).toBe('info');
    expect(g[0].locations[0]).toMatchObject({ layer: 'path', source: 'layerType="guide"' });
  });

  it('the validator accepts Vi:false and rejects any other Vi value', async () => {
    const { out, SQL } = await convert(doc);
    const { validateTsproj } = await import('../src/engine/tsproj/validator');
    expect(validateTsproj(SQL, out.bytes).ok).toBe(true);
    const zip = readZipTolerant(out.bytes);
    const enc = new TextEncoder();
    for (const [k, v] of zip.entries) {
      if (!k.endsWith('.tsanim')) continue;
      const db = new SQL.Database(v);
      const r = db.exec("select id,data from layers where type=10")[0];
      if (!r) { db.close(); continue; }
      for (const [id, d] of r.values) {
        const o = JSON.parse(typeof d === 'string' ? d : new TextDecoder().decode(d as Uint8Array));
        if (o.Vi === false) { o.Vi = true; db.run('update layers set data=? where id=?', [enc.encode(JSON.stringify(o)), id as string]); }
      }
      zip.entries.set(k, db.export()); db.close();
    }
    const { writeZipStored } = await import('../src/engine/zip/writer');
    const bad = writeZipStored([...zip.entries].map(([name, data]) => ({ name, data })));
    const res = validateTsproj(SQL, bad);
    expect(res.ok).toBe(false);
    expect(res.checks.find((c) => c.category === 'Layer references')!.details.join(' ')).toMatch(/Vi=true/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
const RGB = COLORS.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(','));
/** Symbol frame (0-based) visible at each scene frame, read from a render of the OUTPUT file (counter symbol colours). */
async function shownFrames(bytes: Uint8Array, n: number): Promise<number[]> {
  const out: number[] = [];
  for (let f = 1; f <= n; f++) {
    const fills = fillsIn(await svgAt(bytes, f)).map((c) => RGB.indexOf(c)).filter((i) => i >= 0);
    out.push(fills.length === 1 ? fills[0] : -1);
  }
  return out;
}
const placed = (lib: string, attrs: string, type = 'graphic') => `<DOMSymbolInstance libraryItemName="${lib}" symbolType="${type}" ${attrs}><matrix><Matrix/></matrix></DOMSymbolInstance>`;
const play = async (attrs: string, n = 8, type = 'graphic') => {
  const { out, a } = await convert(xfl(layer('L', frame(0, n, placed('C', attrs, type))), { C: counter('C') }));
  expect(out.report.validation.ok).toBe(true);
  return { frames: await shownFrames(out.bytes, n), out, a };
};

describe('B3.2 graphic loop modes, reverse playback and loop range (counter symbol C: 6 frames)', () => {
  it('forward Loop and Play Once are unchanged', async () => {
    expect((await play('loop="loop" firstFrame="2"')).frames).toEqual([2, 3, 4, 5, 0, 1, 2, 3]);
    expect((await play('loop="play once" firstFrame="2"')).frames).toEqual([2, 3, 4, 5, 5, 5, 5, 5]);
    expect((await play('loop="single frame" firstFrame="4"')).frames).toEqual([4, 4, 4, 4, 4, 4, 4, 4]);
  });

  it('Loop Reverse plays "last frame" -> "first frame" and loops (never silently forwards)', async () => {
    const r = await play('loop="loop reverse" firstFrame="2"');
    expect(r.frames).toEqual([5, 4, 3, 2, 5, 4, 3, 2]);
    expect(r.a.doc.scenes[0].layers[0].frames[0].elements[0]).toMatchObject({ loop: 'loop reverse', loopSource: 'loop reverse' });
    const d = find(r.out.report.diagnostics, 'LOOP_REVERSE');
    expect(d).toHaveLength(1);
    expect(d[0].severity).toBe('approx');
    expect(d[0].locations[0]).toMatchObject({ layer: 'L', frames: [1, 8], element: 1 });
    expect(find(r.out.report.diagnostics, 'TS_LOOP_MODE')[0].locations[0].source).toBe('loop="loop reverse"');
  });

  it('Reverse Play Once plays "last frame" -> "first frame", then holds "first frame"', async () => {
    expect((await play('loop="play once reverse" firstFrame="1"')).frames).toEqual([5, 4, 3, 2, 1, 1, 1, 1]);
  });

  it('Last frame limits the loop range in every mode', async () => {
    expect((await play('loop="loop" firstFrame="1" lastFrame="3"')).frames).toEqual([1, 2, 3, 1, 2, 3, 1, 2]);
    expect((await play('loop="play once" firstFrame="0" lastFrame="3"')).frames).toEqual([0, 1, 2, 3, 3, 3, 3, 3]);
    expect((await play('loop="loop reverse" firstFrame="1" lastFrame="3"')).frames).toEqual([3, 2, 1, 3, 2, 1, 3, 2]);
    expect((await play('loop="play once reverse" firstFrame="2" lastFrame="4"')).frames).toEqual([4, 3, 2, 2, 2, 2, 2, 2]);
    const d = find((await play('loop="loop" firstFrame="1" lastFrame="3"')).out.report.diagnostics, 'GRAPHIC_LAST_FRAME');
    expect(d[0].severity).toBe('approx');
    expect(d[0].locations[0].source).toBe('lastFrame="3" (symbol has 6 frames)');
  });

  it('reverse playback inside a nested symbol', async () => {
    const outer = symbolXml('Outer', layer('in', frame(0, 6, placed('C', 'loop="loop reverse" firstFrame="0"'))));
    const { out } = await convert(xfl(layer('L', frame(0, 8, placed('Outer', 'loop="loop"'))), { C: counter('C'), Outer: outer }));
    expect(out.report.validation.ok).toBe(true);
    expect(await shownFrames(out.bytes, 8)).toEqual([5, 4, 3, 2, 1, 0, 5, 4]);
    expect(find(out.report.diagnostics, 'LOOP_REVERSE')[0].locations[0]).toMatchObject({ owner: 'Outer', ownerKind: 'symbol', layer: 'in' });
  });

  it('a movie clip ignores the graphic loop setting (plays forwards, no reverse report)', async () => {
    const r = await play('loop="loop reverse"', 8, 'movie clip');
    expect(r.frames).toEqual([0, 1, 2, 3, 4, 5, 0, 1]);
    expect(find(r.out.report.diagnostics, 'LOOP_REVERSE')).toEqual([]);
  });

  it('reverse frames are written as one-frame drawings that each start the full clip at the right frame (Time)', async () => {
    const { out } = await play('loop="loop reverse" firstFrame="2"', 4);
    const scene = (await readBack(out.bytes)).get('Scene 1')!;
    const cs = contents(scene, timelineLayers(scene)[0].id);
    const time = (d: Record<string, unknown>) => { const K = d.K as unknown[] | undefined; return K ? (K[1] as { v: number[] }).v[0] : 1; };
    expect(cs.map((c) => [c.s, c.e, c.d.Na, time(c.d)])).toEqual([[1, 1, 'C', 6], [2, 2, 'C', 5], [3, 3, 'C', 4], [4, 4, 'C', 3]]);
    expect(new Set(cs.map((c) => (c.d.cl as { id: string }).id)).size).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
const still = symbolXml('S', layer('art', frame(0, 1, box('#808080'))));
const tweenDoc = (startInner: string, endInner: string, startAttrs = '', endAttrs = '', n = 10) => xfl(layer('Tw',
  frame(0, n, `<DOMSymbolInstance libraryItemName="S" symbolType="graphic" ${startAttrs}><matrix><Matrix tx="10" ty="10"/></matrix>${startInner}</DOMSymbolInstance>`, 'tweenType="motion"') +
  frame(n, 1, `<DOMSymbolInstance libraryItemName="S" symbolType="graphic" ${endAttrs}><matrix><Matrix tx="90" ty="10"/></matrix>${endInner}</DOMSymbolInstance>`)), { S: still });
const blurF = (x: number, y: number) => `<filters><BlurFilter blurX="${x}" blurY="${y}" quality="1"/></filters>`;
const adjF = (b: number, c: number, s: number, h: number) => `<filters><AdjustColorFilter brightness="${b}" contrast="${c}" saturation="${s}" hue="${h}"/></filters>`;
const colorFx = (attrs: string) => `<color><Color ${attrs}/></color>`;
/** Per scene frame: the symbol layer's opacity and its effect rows (type -> fields), read from the output file. */
async function effectsPerFrame(bytes: Uint8Array) {
  const scene = (await readBack(bytes)).get('Scene 1')!;
  return contents(scene, timelineLayers(scene)[0].id).map((c) => ({
    s: c.s, op: (c.d.op as number | undefined) ?? 1,
    fx: ((c.d.Ef as string[] | undefined) ?? []).map((id) => { const r = scene.layers.get(id)!; const { Id: _i, LI: _l, LD: _d, V: _v, ...rest } = r.d; void _i; void _l; void _d; void _v; return { type: r.type, ...rest } as Json; }),
  }));
}

describe('B3.3 colour effect / filter tweens', () => {
  it('a Blur change is interpolated frame by frame and lands exactly on both keyframes', async () => {
    const { out } = await convert(tweenDoc(blurF(4, 4), blurF(40, 40)));
    expect(out.report.validation.ok).toBe(true);
    const fr = await effectsPerFrame(out.bytes);
    const r = fr.map((f) => (f.fx[0] as { r: number }).r);
    expect(fr.map((f) => f.fx[0].type)).toEqual(Array(11).fill(100));
    const keyStart = (await effectsPerFrame((await convert(tweenDoc(blurF(4, 4), blurF(4, 4)))).out.bytes))[0].fx[0];
    const keyEnd = (await effectsPerFrame((await convert(xfl(layer('K', frame(0, 1, `<DOMSymbolInstance libraryItemName="S" symbolType="graphic"><matrix><Matrix/></matrix>${blurF(40, 40)}</DOMSymbolInstance>`)), { S: still }))).out.bytes))[0].fx[0];
    expect(fr[0].fx[0]).toEqual(keyStart);
    expect(fr[10].fx[0]).toEqual(keyEnd);
    for (let i = 1; i < r.length; i++) expect(r[i]).toBeGreaterThan(r[i - 1]);
    const d = find(out.report.diagnostics, 'TWEEN_FX_BAKED');
    expect(d).toHaveLength(1);
    expect(d[0].severity).toBe('approx');
    expect(d[0].locations[0]).toMatchObject({ layer: 'Tw', frames: [1, 10], element: 1, source: 'Blur 4×4 → 40×40' });
    expect(find(out.report.diagnostics, 'TWEEN_COLOR_FILTER')).toEqual([]);
  });

  it('the tween ease applies to effect values like it does to position', async () => {
    const lin = (await effectsPerFrame((await convert(tweenDoc(blurF(4, 4), blurF(40, 40)))).out.bytes)).map((f) => (f.fx[0] as { r: number }).r);
    const easedIn = (await effectsPerFrame((await convert(xfl(layer('Tw',
      frame(0, 10, `<DOMSymbolInstance libraryItemName="S" symbolType="graphic"><matrix><Matrix tx="10" ty="10"/></matrix>${blurF(4, 4)}</DOMSymbolInstance>`, 'tweenType="motion" acceleration="-100"') +
      frame(10, 1, `<DOMSymbolInstance libraryItemName="S" symbolType="graphic"><matrix><Matrix tx="90" ty="10"/></matrix>${blurF(40, 40)}</DOMSymbolInstance>`)), { S: still }))).out.bytes)).map((f) => (f.fx[0] as { r: number }).r);
    expect(easedIn[5]).toBeLessThan(lin[5]);              // ease in: slower at the start
    expect(easedIn[0]).toBe(lin[0]);
    expect(easedIn[10]).toBe(lin[10]);
  });

  it('Adjust Color values (brightness, contrast, saturation, hue) are interpolated', async () => {
    const { out } = await convert(tweenDoc(adjF(0, 0, 0, 0), adjF(50, 20, -40, 90)));
    const fr = await effectsPerFrame(out.bytes);
    expect(fr.every((f) => f.fx.length === 1 && f.fx[0].type === 104)).toBe(true);
    const h = fr.map((f) => (f.fx[0] as { h?: number }).h ?? 0);
    expect(h[0]).toBe(0);
    expect(h[10]).toBeCloseTo(0.9, 6);
    for (let i = 1; i < h.length; i++) expect(h[i]).toBeGreaterThan(h[i - 1]);
  });

  it('colour effect Brightness is interpolated (written as Adjustments brightness)', async () => {
    const { out } = await convert(tweenDoc(colorFx('brightness="0"'), colorFx('brightness="0.6"')));
    const fr = await effectsPerFrame(out.bytes);
    const b = fr.map((f) => (f.fx[0] as { b?: number } | undefined)?.b ?? 0);
    expect(b[0]).toBe(0);
    expect(b[10]).toBeCloseTo(0.6, 6);
    for (let i = 1; i < b.length; i++) expect(b[i]).toBeGreaterThan(b[i - 1]);
    expect(find(out.report.diagnostics, 'TWEEN_FX_BAKED')[0].locations[0].source).toBe('Brightness 0% → 60%');
  });

  it('an Alpha-only change is interpolated as opacity and not reported as a colour/filter tween', async () => {
    const { out } = await convert(tweenDoc('', colorFx('alphaMultiplier="0"')));
    const op = (await effectsPerFrame(out.bytes)).map((f) => f.op);
    expect(op[0]).toBe(1);
    expect(op[10]).toBe(0);
    for (let i = 1; i < op.length; i++) expect(op[i]).toBeLessThan(op[i - 1]);
    for (const c of ['TWEEN_FX_BAKED', 'TWEEN_COLOR_FILTER']) expect(find(out.report.diagnostics, c)).toEqual([]);
  });

  it('a Tint change cannot be shown at all: reported, nothing baked', async () => {
    const { out } = await convert(tweenDoc(colorFx('tintMultiplier="0.5" tintColor="#FF0000"'), colorFx('tintMultiplier="0.5" tintColor="#0000FF"')));
    const d = find(out.report.diagnostics, 'TWEEN_COLOR_FILTER');
    expect(d).toHaveLength(1);
    expect(d[0].message).toMatch(/Tint/);
    expect(d[0].locations[0].source).toBe('Tint 50% #FF0000 → 50% #0000FF');
    expect(find(out.report.diagnostics, 'FX_NO_EQUIVALENT').length).toBeGreaterThan(0);
    expect(find(out.report.diagnostics, 'TWEEN_FX_BAKED')).toEqual([]);
  });

  it('filters that differ in kind keep the start filters and say so', async () => {
    const { out } = await convert(tweenDoc(blurF(10, 10), adjF(50, 0, 0, 0)));
    const fr = await effectsPerFrame(out.bytes);
    expect(fr.slice(0, 10).every((f) => JSON.stringify(f.fx) === JSON.stringify(fr[0].fx))).toBe(true);
    const d = find(out.report.diagnostics, 'TWEEN_COLOR_FILTER');
    expect(d[0].locations[0].source).toBe('[blur] → [adjustColor]');
  });

  it('a blend mode change is held at the start keyframe and reported', async () => {
    const { out } = await convert(tweenDoc('', '', 'blendMode="multiply"', 'blendMode="screen"'));
    const d = find(out.report.diagnostics, 'TWEEN_BLEND_HELD');
    expect(d[0].locations[0].source).toBe('blendMode "multiply" → "screen"');
    const scene = (await readBack(out.bytes)).get('Scene 1')!;
    const bms = contents(scene, timelineLayers(scene)[0].id).map((c) => c.d.bM);
    expect(bms.slice(0, 10).every((b) => b === 3)).toBe(true);   // Multiply (bM 3) until the end keyframe
    expect(bms[10]).toBe(8);                                       // Screen at the end keyframe
  });
});
