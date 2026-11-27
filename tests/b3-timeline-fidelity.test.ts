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
