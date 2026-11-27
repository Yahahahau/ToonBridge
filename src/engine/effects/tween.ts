// B3.3: colour effect / filter values between the two keyframes of a classic tween.
//
// Each numeric value moves linearly with the same eased tween time as position, rotation and scale. Settings that are
// not amounts (filter quality, knockout / inner / hide object, which filter it is) are taken from the start keyframe.
// Interpolation is only done when both keyframes have the same filters in the same order; otherwise the caller holds
// the start values and reports it. This mirrors how the transform is tweened; it has not been compared with an Animate
// render (no Animate reference is available), so the caller reports the result as an approximation.
import type { RGBA } from '../ir';
import type { AnimateFilter, ColorEffect } from './plan';

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const lerpRGBA = (a: RGBA, b: RGBA, u: number): RGBA => ({ r: lerp(a.r, b.r, u), g: lerp(a.g, b.g, u), b: lerp(a.b, b.b, u), a: lerp(a.a, b.a, u) });

/** Colour effect "none": what a keyframe without <color> shows. */
export const NO_COLOR: ColorEffect = {
  alphaMultiplier: 1, redMultiplier: 1, greenMultiplier: 1, blueMultiplier: 1,
  alphaOffset: 0, redOffset: 0, greenOffset: 0, blueOffset: 0, brightness: 0, tintMultiplier: 0,
};

function hexToRgb(h: string | undefined): [number, number, number] | null {
  const m = h ? /^#?([0-9a-f]{6})$/i.exec(h) : null;
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
const toHex = (c: number[]) => '#' + c.map((x) => Math.round(x).toString(16).padStart(2, '0').toUpperCase()).join('');

export function lerpColor(a: ColorEffect | undefined, b: ColorEffect | undefined, u: number): ColorEffect | undefined {
  if (!a && !b) return undefined;
  const A = a ?? NO_COLOR, B = b ?? NO_COLOR;
  const out: ColorEffect = { ...A };
  for (const k of ['alphaMultiplier', 'redMultiplier', 'greenMultiplier', 'blueMultiplier', 'alphaOffset', 'redOffset', 'greenOffset', 'blueOffset', 'brightness', 'tintMultiplier'] as const) out[k] = lerp(A[k], B[k], u);
  const ta = hexToRgb(A.tintColor), tb = hexToRgb(B.tintColor);
  if (ta && tb) out.tintColor = toHex(ta.map((x, i) => lerp(x, tb[i], u)));
  else out.tintColor = A.tintColor ?? B.tintColor;
  if (out.tintColor === undefined) delete out.tintColor;
  return out;
}

/** True when the two filter lists can be interpolated value by value (same filters, same order). */
export function sameFilterShape(a: AnimateFilter[], b: AnimateFilter[]): boolean {
  return a.length === b.length && a.every((f, i) => f.kind === b[i].kind && (!('name' in f) || f.name === (b[i] as { name?: string }).name));
}

export function lerpFilters(a: AnimateFilter[], b: AnimateFilter[], u: number): AnimateFilter[] | null {
  if (!sameFilterShape(a, b)) return null;
  return a.map((f, i) => {
    const g = b[i] as typeof f;
    switch (f.kind) {
      case 'blur': { const e = g as typeof f; return { ...f, blurX: lerp(f.blurX, e.blurX, u), blurY: lerp(f.blurY, e.blurY, u) }; }
      case 'adjustColor': { const e = g as typeof f; return { ...f, brightness: lerp(f.brightness, e.brightness, u), contrast: lerp(f.contrast, e.contrast, u), saturation: lerp(f.saturation, e.saturation, u), hue: lerp(f.hue, e.hue, u) }; }
      case 'dropShadow': { const e = g as typeof f; return { ...f, blurX: lerp(f.blurX, e.blurX, u), blurY: lerp(f.blurY, e.blurY, u), angle: lerp(f.angle, e.angle, u), distance: lerp(f.distance, e.distance, u), color: lerpRGBA(f.color, e.color, u), strength: lerp(f.strength, e.strength, u) }; }
      case 'glow': { const e = g as typeof f; return { ...f, blurX: lerp(f.blurX, e.blurX, u), blurY: lerp(f.blurY, e.blurY, u), color: lerpRGBA(f.color, e.color, u), strength: lerp(f.strength, e.strength, u) }; }
      default: return f;
    }
  });
}

/** Short "what changed" text for a report location, e.g. `Blur 67×67 → 177×18`. */
export function describeChange(a: AnimateFilter[], b: AnimateFilter[], ca?: ColorEffect, cb?: ColorEffect): string {
  const parts: string[] = [];
  const n = (x: number) => String(Math.round(x * 100) / 100);
  a.forEach((f, i) => {
    const g = b[i];
    if (!g || JSON.stringify(f) === JSON.stringify(g)) return;
    if (f.kind === 'blur' && g.kind === 'blur') parts.push(`Blur ${n(f.blurX)}×${n(f.blurY)} → ${n(g.blurX)}×${n(g.blurY)}`);
    else if (f.kind === 'adjustColor' && g.kind === 'adjustColor') parts.push(`Adjust Color b${n(f.brightness)} c${n(f.contrast)} s${n(f.saturation)} h${n(f.hue)} → b${n(g.brightness)} c${n(g.contrast)} s${n(g.saturation)} h${n(g.hue)}`);
    else parts.push(`${f.kind} values`);
  });
  const A = ca ?? NO_COLOR, B = cb ?? NO_COLOR;
  if (A.brightness !== B.brightness) parts.push(`Brightness ${n(A.brightness * 100)}% → ${n(B.brightness * 100)}%`);
  if (A.tintMultiplier !== B.tintMultiplier || A.tintColor !== B.tintColor) parts.push(`Tint ${n(A.tintMultiplier * 100)}% ${A.tintColor ?? ''} → ${n(B.tintMultiplier * 100)}% ${B.tintColor ?? ''}`.replace(/\s+/g, ' ').trim());
  const adv = (c: ColorEffect) => [c.redMultiplier, c.greenMultiplier, c.blueMultiplier, c.redOffset, c.greenOffset, c.blueOffset, c.alphaOffset].join(',');
  if (adv(A) !== adv(B)) parts.push('Advanced colour (RGB multipliers / offsets)');
  return parts.join('; ');
}
