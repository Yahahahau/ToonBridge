import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { analyzeInput, convertAnalysis } from '../src/engine';
import { BLEND_MAP, BLEND_CODE, blendCode, boxBlurSigma, planColor, planFilters } from '../src/engine/effects/plan';
import { readZipTolerant } from '../src/engine/zip/reader';
import { nodeSql } from './helpers';

const black = { r: 0, g: 0, b: 0, a: 1 };
describe('Animate filters -> ToonSquid effects (plan)', () => {
  it('blur: box blur size/quality -> Gaussian sigma; anisotropic blur reported', () => {
    expect(boxBlurSigma(1, 1)).toBe(0);
    expect(boxBlurSigma(13, 3)).toBeCloseTo(Math.sqrt(3 * 168 / 12), 9);
    const p = planFilters([{ kind: 'blur', blurX: 10, blurY: 40, quality: 1 }]);
    expect(p.effects[0]).toMatchObject({ kind: 'gaussianBlur', radius: Math.round(2 * Math.sqrt(1599 / 12) * 100) / 100 });
    expect(p.approx[0]).toMatch(/X and Y separately/);
  });
  it('adjust color keeps the four values', () => {
    const p = planFilters([{ kind: 'adjustColor', brightness: 99, contrast: 56, saturation: 73, hue: -60 }]);
    expect(p.effects[0]).toMatchObject({ kind: 'adjustments', brightness: 99, contrast: 56, saturation: 73, hue: -60 });
  });
  it('drop shadow: angle/distance -> offset (screen y down), strength into alpha', () => {
    const p = planFilters([{ kind: 'dropShadow', blurX: 4, blurY: 4, quality: 1, angle: 90, distance: 10, color: black, strength: 0.5, knockout: false, inner: false, hideObject: false }]);
    expect(p.effects[0]).toMatchObject({ kind: 'dropShadow', offsetX: 0, offsetY: 10 });
    expect((p.effects[0] as { color: { a: number } }).color.a).toBe(0.5);
  });
  it('glow -> zero-offset shadow; inner glow / bevels are losses', () => {
    const g = planFilters([{ kind: 'glow', blurX: 6, blurY: 6, quality: 1, color: black, strength: 1, knockout: false, inner: false }]);
    expect(g.effects[0]).toMatchObject({ kind: 'dropShadow', offsetX: 0, offsetY: 0 });
    const l = planFilters([{ kind: 'glow', blurX: 6, blurY: 6, quality: 1, color: black, strength: 1, knockout: false, inner: true }, { kind: 'bevel', name: 'Bevel' }]);
    expect(l.effects).toHaveLength(0);
    expect(l.losses).toHaveLength(2);
  });
  it('colour effects: tint and advanced are reported, brightness planned', () => {
    const base = { alphaMultiplier: 1, redMultiplier: 1, greenMultiplier: 1, blueMultiplier: 1, alphaOffset: 0, redOffset: 0, greenOffset: 0, blueOffset: 0, brightness: 0, tintMultiplier: 0 };
    expect(planColor({ ...base, tintMultiplier: 0.5, tintColor: '#FF0000' }).losses[0]).toMatch(/Tint/);
    expect(planColor({ ...base, redMultiplier: 0.5 }).losses[0]).toMatch(/Advanced/);
    expect(planColor({ ...base, brightness: 0.3 }).effects[0]).toMatchObject({ kind: 'adjustments', brightness: 30 });
  });
  it('every Animate blend mode has a mapping entry', () => {
    for (const m of ['normal', 'layer', 'darken', 'multiply', 'lighten', 'screen', 'overlay', 'hardlight', 'difference', 'add', 'subtract', 'invert', 'alpha', 'erase']) expect(m in BLEND_MAP).toBe(true);
  });
});

describe('blend modes and effects are written like the app does', () => {
  it('bM numbers match the decoded file', () => {
    expect([BLEND_CODE.Darken, BLEND_CODE.Multiply, BLEND_CODE.Lighten, BLEND_CODE.Screen, BLEND_CODE.Add, BLEND_CODE.Overlay, BLEND_CODE['Hard Light'], BLEND_CODE.Difference, BLEND_CODE.Subtract]).toEqual([2, 3, 7, 8, 10, 12, 14, 19, 21]);
    expect(blendCode('normal')).toBeUndefined();
    expect(blendCode('invert')).toBeNull();
  });
  it('an instance with Add + Blur + Adjust Color + Drop Shadow becomes bM 10 and effect rows 100/104/101', async () => {
    const XNS = 'xmlns="http://ns.adobe.com/xfl/2008/"';
    const sym = `<DOMSymbolItem ${XNS} name="Box" symbolType="graphic"><timeline><DOMTimeline name="Box"><layers><DOMLayer name="a"><frames><DOMFrame index="0" duration="1"><elements><DOMShape><fills><FillStyle index="1"><SolidColor color="#00CC99"/></FillStyle></fills><edges><Edge fillStyle1="1" edges="!0 0|2000 0|2000 2000|0 2000|0 0"/></edges></DOMShape></elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timeline></DOMSymbolItem>`;
    const inst = `<DOMSymbolInstance libraryItemName="Box" symbolType="graphic" blendMode="add"><matrix><Matrix tx="10" ty="10"/></matrix><filters><BlurFilter blurX="10" blurY="10" quality="1"/><AdjustColorFilter brightness="20" contrast="40" saturation="-50" hue="30"/><DropShadowFilter distance="10" angle="90" color="#FF0000"/></filters></DOMSymbolInstance>`;
    const doc = `<DOMDocument ${XNS} width="200" height="200" frameRate="24"><symbols><Include href="Box.xml"/></symbols><timelines><DOMTimeline name="Scene 1"><layers><DOMLayer name="L"><frames><DOMFrame index="0" duration="1"><elements>${inst}</elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timelines></DOMDocument>`;
    const bytes = zipSync({ 'DOMDocument.xml': strToU8(doc), 'LIBRARY/Box.xml': strToU8(sym), 'x.xfl': strToU8('PROXY-CS5') }, { level: 0 });
    const SQL = await nodeSql();
    const out = convertAnalysis(analyzeInput(bytes, 'x.fla'), SQL);
    expect(out.report.ok).toBe(true);
    const scene = out.project.clips.find((c) => c.isScene)!;
    const z = readZipTolerant(out.bytes);
    const anim = [...z.entries].find(([n]) => n.endsWith(`${scene.id}.tsanim`))![1];
    const db = new SQL.Database(anim);
    const rows = db.exec('select type,data from layers')[0].values.map((r) => ({ type: r[0] as number, d: JSON.parse(new TextDecoder().decode(r[1] as Uint8Array)) }));
    const clipLayer = rows.find((r) => r.type === 4)!;
    expect(clipLayer.d.bM).toBe(10);
    expect(clipLayer.d.Ef).toHaveLength(3);
    const fx = rows.filter((r) => [100, 101, 104].includes(r.type)).sort((a, b) => a.type - b.type);
    expect(fx.map((r) => r.type)).toEqual([100, 101, 104]);
    expect(fx[0].d).toMatchObject({ Na: 'Gaussian Blur', LI: clipLayer.d.Id });
    expect(fx[1].d).toMatchObject({ Na: 'Drop Shadow', os: [0, 10], c: { r: 1, g: 0, b: 0 } });
    expect(fx[2].d).toMatchObject({ Na: 'Adjustments', h: 0.3, s: -0.5, b: 0.2, c: 0.4 });
  });
});
