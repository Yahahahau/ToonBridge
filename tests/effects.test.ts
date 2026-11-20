import { describe, expect, it } from 'vitest';
import { BLEND_MAP, boxBlurSigma, planColor, planFilters } from '../src/engine/effects/plan';

const black = { r: 0, g: 0, b: 0, a: 1 };
describe('Animate filters -> ToonSquid effects (plan)', () => {
  it('blur: box blur size/quality -> Gaussian sigma; anisotropic blur reported', () => {
    expect(boxBlurSigma(1, 1)).toBe(0);
    expect(boxBlurSigma(13, 3)).toBeCloseTo(Math.sqrt(3 * 168 / 12), 9);
    const p = planFilters([{ kind: 'blur', blurX: 10, blurY: 40, quality: 1 }]);
    expect(p.effects[0]).toMatchObject({ kind: 'gaussianBlur', radius: Math.round(Math.sqrt(1599 / 12) * 100) / 100 });
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
