import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { Diagnostics } from '../src/engine/diagnostics';
import { analyzeInput, convertAnalysis, UnsupportedInputError } from '../src/engine';
import { parseCubicsAttr, parseEdgesAttr, parseNum } from '../src/engine/xfl/edges';
import { fillContours } from '../src/engine/geometry/contours';
import { compose, decompose } from '../src/engine/geometry/matrix';
import { easeT } from '../src/engine/resolver/resolver';
import { readZipTolerant } from '../src/engine/zip/reader';
import { writeZipStored } from '../src/engine/zip/writer';
import { uuid5 } from '../src/engine/util';
import { nodeSql } from './helpers';

describe('R1/R2 numbers and edges', () => {
  it('parses #hex.frac signed 24-bit twips', () => {
    expect(parseNum('#FFFFFF.80')).toBe(-1.5);
    expect(parseNum('#10.80')).toBe(16.5);
    expect(parseNum('2408')).toBe(2408);
  });
  it('parses the observed cubics grammar', () => {
    const d = new Diagnostics();
    const s = parseCubicsAttr('!2658 1211(;2658,1379 2692,1615 2802,1764q2658 1211Q2658 1358q2802 1764);', d)[0];
    expect(s.p0).toEqual([132.9, 60.55]);
    expect(s.c1).toEqual([132.9, 68.95]);
    expect(s.p3).toEqual([140.1, 88.2]);
  });
  it('converts quads to cubics (2/3 rule)', () => {
    const s = parseEdgesAttr('!0 0[60 0 60 60', new Diagnostics())[0];
    expect(s.c1[0]).toBeCloseTo((2 / 3) * 3, 9); // 60 twips = 3 px
    expect(s.c2[0]).toBeCloseTo(3, 9);
    expect(s.c2[1]).toBeCloseTo(3 - (2 / 3) * 3, 9);
  });
});

describe('R3 contours', () => {
  const sq = (x0: number, y0: number, x1: number, y1: number, rev = false) => {
    const pts: [number, number][] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
    const segs = [];
    for (let i = 0; i < 4; i++) segs.push({ p0: pts[i], c1: pts[i], c2: pts[i + 1], p3: pts[i + 1] });
    return { segs, ...(rev ? { fill0: 1 } : { fill1: 1 }) };
  };
  it('stitches a ring with a hole into two contours of opposite winding', () => {
    // outer: fill on right of direction (fill1); hole: fill0 edges drawn in the opposite direction
    const edges = [sq(0, 0, 10, 10), sq(3, 3, 6, 6, true)];
    const c = fillContours(edges, 1, undefined, new Diagnostics());
    expect(c).toHaveLength(2);
    const area = (n: { p: [number, number] }[]) => n.reduce((a, p, i) => { const q = n[(i + 1) % n.length]; return a + (p.p[0] * q.p[1] - q.p[0] * p.p[1]); }, 0) / 2;
    const [a1, a2] = c.map((x) => area(x.nodes));
    expect(Math.sign(a1)).toBe(-Math.sign(a2));
  });
  it('is deterministic regardless of edge order within ties', () => {
    const e = [sq(0, 0, 4, 4), sq(10, 10, 14, 14)];
    const a = JSON.stringify(fillContours(e, 1, undefined, new Diagnostics()));
    const b = JSON.stringify(fillContours([...e].reverse(), 1, undefined, new Diagnostics()));
    expect(a).toBe(b);
  });
});

describe('R5 transforms', () => {
  it('decomposes rotation/scale/flip', () => {
    const th = Math.PI / 4;
    const d = decompose({ a: 2 * Math.cos(th), b: 2 * Math.sin(th), c: -Math.sin(th), d: Math.cos(th), tx: 0, ty: 0 });
    expect(d.rot).toBeCloseTo(th, 9); expect(d.sx).toBeCloseTo(2, 9); expect(d.sy).toBeCloseTo(1, 9); expect(d.skew).toBeCloseTo(0, 9);
    expect(decompose({ a: 1, b: 0, c: 0, d: -1, tx: 0, ty: 0 }).sy).toBe(-1);
  });
  it('compose applies inner first', () => {
    const m = compose({ a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 0 }, { a: 2, b: 0, c: 0, d: 2, tx: 1, ty: 1 });
    expect(m.tx).toBe(11); expect(m.a).toBe(2);
  });
  it('ease endpoints are fixed', () => {
    for (const e of [-100, -30, 0, 50, 100]) { expect(easeT(0, e)).toBe(0); expect(easeT(1, e)).toBe(1); }
  });
});

describe('ZIP + util', () => {
  it('uuid5 matches RFC 4122 test vector (python.org DNS)', () => {
    expect(uuid5('python.org', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('886313E1-3B8A-5372-9B90-0C9AEE199E5D');
  });
  it('writer output is readable and the reader recovers entries when the central directory is cut off', () => {
    const z = writeZipStored([{ name: 'a/x.txt', data: strToU8('hello') }, { name: 'a/y.bin', data: new Uint8Array([1, 2, 3]) }]);
    const ok = readZipTolerant(z);
    expect(ok.mode).toBe('central-ok');
    const cut = readZipTolerant(z.slice(0, z.length - 60));
    expect(cut.mode).toBe('scan-only');
    expect([...cut.entries.keys()]).toEqual(['a/x.txt', 'a/y.bin']);
  });
});

const XNS = 'xmlns="http://ns.adobe.com/xfl/2008/"';
function syntheticXfl(): Uint8Array {
  const sq = (id: string) => `<Edge fillStyle1="1" edges="!0 0|200 0|200 200|0 200|0 0"/>`.replace('!0', id);
  const doc = `<?xml version="1.0"?><DOMDocument ${XNS} width="200" height="100" frameRate="12"><symbols><Include href="Box.xml"/></symbols><timelines><DOMTimeline name="Scene 1"><layers><DOMLayer name="L1"><frames>
    <DOMFrame index="0" duration="4" tweenType="motion"><tweens><Ease intensity="0"/></tweens><elements><DOMSymbolInstance libraryItemName="Box" symbolType="graphic" loop="single frame"><matrix><Matrix tx="10" ty="20"/></matrix><transformationPoint><Point x="5" y="5"/></transformationPoint></DOMSymbolInstance></elements></DOMFrame>
    <DOMFrame index="4" duration="1"><elements><DOMSymbolInstance libraryItemName="Box" symbolType="graphic" loop="single frame"><matrix><Matrix a="0" b="1" c="-1" d="0" tx="50" ty="20"/></matrix><transformationPoint><Point x="5" y="5"/></transformationPoint></DOMSymbolInstance></elements></DOMFrame>
  </frames></DOMLayer></layers></DOMTimeline></timelines></DOMDocument>`;
  const sym = `<DOMSymbolItem ${XNS} name="Box" symbolType="graphic"><timeline><DOMTimeline name="Box"><layers><DOMLayer name="a"><frames><DOMFrame index="0" duration="1"><elements><DOMShape><fills><FillStyle index="1"><SolidColor color="#FF0000"/></FillStyle></fills><edges>${sq('!0')}</edges></DOMShape></elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timeline></DOMSymbolItem>`;
  return zipSync({ 'DOMDocument.xml': strToU8(doc), 'LIBRARY/Box.xml': strToU8(sym), 'Test.xfl': strToU8('PROXY-CS5') }, { level: 0 });
}

describe('end-to-end on a synthetic XFL', () => {
  it('converts, validates, bakes the tween and is deterministic', async () => {
    const SQL = await nodeSql();
    const run = () => convertAnalysis(analyzeInput(syntheticXfl(), 'syn.fla'), SQL);
    const a = run(), b = run();
    expect(a.report.validation.ok).toBe(true);
    expect(a.report.validation.checks.every((c) => c.ok)).toBe(true);
    expect(a.report.output.sha1).toBe(b.report.output.sha1); // R7 determinism
    expect(a.bytes).toEqual(b.bytes);
    const scene = a.project.clips[0];
    expect(scene.layers).toHaveLength(1);
    // frames 1..4 are tween frames (all distinct), frame 5 is the end keyframe
    const dr = scene.layers[0].drawings;
    expect(dr.map((d) => [d.s, d.e])).toEqual([[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]]);
    expect(a.project.stats.tweenFramesBaked).toBe(3);
    const mid = dr[2].content[0].c;
    if (mid.kind !== 'clip') throw new Error('expected clip content');
    // t = 2/4 with linear ease: rotation = +90°/2 (clockwise), pivot x: lerp(15, 45)=30
    expect(mid.ref.rot).toBeCloseTo(Math.PI / 4, 4);
    expect(mid.ref.p[0]).toBeCloseTo(30, 4);
    expect(a.project.clips.length).toBe(2); // scene + static symbol clip (shared by all instances)
  });
  it('rejects binary FLA with a clear message', () => {
    const cfb = new Uint8Array(512); cfb.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(() => analyzeInput(cfb, 'x.fla')).toThrow(UnsupportedInputError);
  });
});

function skewedXfl(c: number): Uint8Array {
  const base = syntheticXfl();
  void base;
  const doc = `<DOMDocument ${XNS} width="400" height="300" frameRate="24"><symbols><Include href="Box.xml"/></symbols><timelines><DOMTimeline name="Scene 1"><layers><DOMLayer name="L1"><frames>
    <DOMFrame index="0" duration="2"><elements><DOMSymbolInstance libraryItemName="Box" symbolType="graphic" loop="single frame"><matrix><Matrix c="${c}" tx="10" ty="20"/></matrix><transformationPoint><Point x="0" y="100"/></transformationPoint></DOMSymbolInstance></elements></DOMFrame>
  </frames></DOMLayer></layers></DOMTimeline></timelines></DOMDocument>`;
  const sym = `<DOMSymbolItem ${XNS} name="Box" symbolType="graphic"><timeline><DOMTimeline name="Box"><layers><DOMLayer name="a"><frames><DOMFrame index="0" duration="1"><elements><DOMShape><fills><FillStyle index="1"><SolidColor color="#00FF00"/></FillStyle></fills><edges><Edge fillStyle1="1" edges="!0 0|4000 0|4000 4000|0 4000|0 0"/></edges></DOMShape></elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timeline></DOMSymbolItem>`;
  return zipSync({ 'DOMDocument.xml': strToU8(doc), 'LIBRARY/Box.xml': strToU8(sym), 'S.xfl': strToU8('PROXY-CS5') }, { level: 0 });
}

describe('R8 skew', () => {
  const conv = async (mode: 'perspective' | 'bake' | 'off') => convertAnalysis(analyzeInput(skewedXfl(0.3), 's.fla'), await nodeSql(), undefined, { skewMode: mode });
  it('perspective: shear becomes corner offsets on a per-skew clip copy; transform keeps R·S only', async () => {
    const r = await conv('perspective');
    expect(r.report.validation.ok).toBe(true);
    const inst = r.project.clips[0].layers[0].drawings[0].content[0].c;
    if (inst.kind !== 'clip') throw new Error('clip expected');
    expect(inst.ref.rot).toBeCloseTo(0, 9);
    expect(inst.ref.sx).toBeCloseTo(1, 9); expect(inst.ref.sy).toBeCloseTo(1, 9);
    expect(inst.ref.pv).toEqual([0.3 * 100, 100]); // A·tp, tp=(0,100)
    const variant = r.project.clips.find((c) => c.id === inst.ref.clipId)!;
    const v = variant.layers[0].drawings[0].content[0].c;
    if (v.kind !== 'vector' || !v.effect) throw new Error('vector with effect expected');
    // bounds (0,0)-(200,200): x' = x + 0.3y  ->  c = h*y/w : top 0, bottom 0.3
    expect(v.effect.c.map((p) => [Math.round(p[0] * 1e6) / 1e6, p[1]])).toEqual([[0, 0], [0, 0], [0.3, 0], [0.3, 0]]);
    expect(r.report.stats.perspectiveEffects).toBe(1);
  });
  it('bake: geometry is sheared, no effect rows', async () => {
    const r = await conv('bake');
    expect(r.report.validation.ok).toBe(true);
    const inst = r.project.clips[0].layers[0].drawings[0].content[0].c;
    if (inst.kind !== 'clip') throw new Error();
    const v = r.project.clips.find((c) => c.id === inst.ref.clipId)!.layers[0].drawings[0].content[0].c;
    if (v.kind !== 'vector') throw new Error();
    expect(v.effect).toBeUndefined();
    const xs = v.items[0].kind === 'fill' ? v.items[0].contours[0].nodes.map((n) => n.p[0]) : [];
    expect(Math.max(...xs)).toBeCloseTo(200 + 0.3 * 200, 4);
  });
  it('off: skew is dropped and reported as a loss', async () => {
    const r = await conv('off');
    expect(r.report.diagnostics.some((d) => d.code === 'TRANSFORM_SKEW' && d.severity === 'loss')).toBe(true);
    expect(r.project.clips.length).toBe(2);
  });
  it('is deterministic', async () => {
    expect((await conv('perspective')).report.output.sha1).toBe((await conv('perspective')).report.output.sha1);
  });
});
