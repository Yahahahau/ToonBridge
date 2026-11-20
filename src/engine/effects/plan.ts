// Animate filters / colour effects / blend modes  ->  ToonSquid effects / blend modes.
//
// Sources (see README "Filters & effects"):
//  - Adobe Animate: Graphic filters (Drop Shadow, Blur, Glow, Bevel, Gradient Glow, Gradient Bevel, Adjust Color),
//    Applying blend modes (14 modes), colour effects (brightness, tint, advanced, alpha).
//  - ToonSquid Handbook: Effects (Gaussian Blur, Adjustments, Drop Shadow, Stroke, ...), Blend Modes (27 modes).
//
// This file only decides WHAT each Animate feature becomes and with which parameter values. Whether it can be WRITTEN
// depends on whether the ToonSquid file encoding of that effect has been seen in an app-made file (see ENCODED below).
import type { RGBA } from '../ir';

/** Animate filters as stored in XFL (<filters> on an instance). Values in Animate units (px, degrees, 0..1 strength=1 is 100%). */
export type AnimateFilter =
  | { kind: 'blur'; blurX: number; blurY: number; quality: number }
  | { kind: 'dropShadow'; blurX: number; blurY: number; quality: number; angle: number; distance: number; color: RGBA; strength: number; knockout: boolean; inner: boolean; hideObject: boolean }
  | { kind: 'glow'; blurX: number; blurY: number; quality: number; color: RGBA; strength: number; knockout: boolean; inner: boolean }
  | { kind: 'adjustColor'; brightness: number; contrast: number; saturation: number; hue: number }
  | { kind: 'bevel' | 'gradientGlow' | 'gradientBevel' | 'other'; name: string };

/** Animate colour effect (<color><Color .../>). */
export interface ColorEffect {
  alphaMultiplier: number; redMultiplier: number; greenMultiplier: number; blueMultiplier: number;
  alphaOffset: number; redOffset: number; greenOffset: number; blueOffset: number;
  brightness: number; tintMultiplier: number; tintColor?: string;
}

/** A ToonSquid effect we would create. */
export type PlannedEffect =
  | { kind: 'gaussianBlur'; radius: number; note: string }
  | { kind: 'adjustments'; hue: number; saturation: number; brightness: number; contrast: number; note: string }
  | { kind: 'dropShadow'; radius: number; offsetX: number; offsetY: number; color: RGBA; inGlobalSpace: false; note: string };

export interface EffectPlan { effects: PlannedEffect[]; losses: string[]; approx: string[]; }

/**
 * ToonSquid effects whose file encoding has been observed in an app-made .tsproj. Only these are written.
 * Everything else is planned and reported, but not written (no guessing the file format).
 */
export const ENCODED = new Set<string>(['perspective']);

/**
 * Animate's blur is a box blur of `size` px applied `quality` times (1 = low, 2 = medium, 3 = high ~ Gaussian).
 * Its standard deviation is sqrt(n·(size²−1)/12). ToonSquid's Gaussian Blur takes a "radius in pixels"; how that radius
 * relates to sigma is not documented, so the plan uses sigma and says so.
 */
export function boxBlurSigma(size: number, quality: number): number {
  const n = Math.max(1, Math.round(quality || 1));
  return size <= 1 ? 0 : Math.sqrt((n * (size * size - 1)) / 12);
}
const r2 = (n: number) => Math.round(n * 100) / 100;

function blurRadius(bx: number, by: number, q: number, what: string, approx: string[]): number {
  const sx = boxBlurSigma(bx, q), sy = boxBlurSigma(by, q);
  if (Math.abs(sx - sy) > 0.5) approx.push(`${what}: Animate blurs X and Y separately (${bx}×${by}); ToonSquid has one radius, so the larger is used`);
  return r2(Math.max(sx, sy));
}

export function planFilters(filters: AnimateFilter[]): EffectPlan {
  const effects: PlannedEffect[] = [], losses: string[] = [], approx: string[] = [];
  for (const f of filters) {
    switch (f.kind) {
      case 'blur':
        effects.push({ kind: 'gaussianBlur', radius: blurRadius(f.blurX, f.blurY, f.quality, 'Blur', approx), note: `Animate Blur ${f.blurX}×${f.blurY} q${f.quality} -> sigma` });
        break;
      case 'adjustColor':
        // Same four controls on both sides (Animate: brightness/contrast/saturation −100..100, hue −180..180).
        effects.push({ kind: 'adjustments', hue: f.hue, saturation: f.saturation, brightness: f.brightness, contrast: f.contrast, note: 'Animate Adjust Color -> ToonSquid Adjustments (same four controls; response curves not compared)' });
        break;
      case 'dropShadow': {
        if (f.inner) { losses.push('Drop Shadow with "Inner shadow" has no ToonSquid equivalent'); break; }
        if (f.knockout || f.hideObject) approx.push('Drop Shadow "Knockout"/"Hide object" not available in ToonSquid (shadow drawn under the object instead)');
        const a = (f.angle * Math.PI) / 180;   // Animate: angle measured clockwise from +x on screen (y down)
        const color = { ...f.color, a: Math.min(1, f.color.a * Math.min(f.strength, 1)) };
        if (f.strength > 1) approx.push(`Drop Shadow strength ${Math.round(f.strength * 100)}% > 100% cannot be matched (clamped)`);
        effects.push({ kind: 'dropShadow', radius: blurRadius(f.blurX, f.blurY, f.quality, 'Drop Shadow', approx), offsetX: r2(f.distance * Math.cos(a)), offsetY: r2(f.distance * Math.sin(a)), color, inGlobalSpace: false, note: 'distance/angle -> offset X/Y' });
        break;
      }
      case 'glow': {
        if (f.inner) { losses.push('Glow with "Inner glow" has no ToonSquid equivalent'); break; }
        if (f.knockout) approx.push('Glow "Knockout" not available in ToonSquid');
        const color = { ...f.color, a: Math.min(1, f.color.a * Math.min(f.strength, 1)) };
        if (f.strength > 1) approx.push(`Glow strength ${Math.round(f.strength * 100)}% > 100% cannot be matched (clamped)`);
        // An outer glow is a shadow with no offset.
        effects.push({ kind: 'dropShadow', radius: blurRadius(f.blurX, f.blurY, f.quality, 'Glow', approx), offsetX: 0, offsetY: 0, color, inGlobalSpace: false, note: 'Glow -> Drop Shadow with zero offset' });
        break;
      }
      default:
        losses.push(`${f.kind === 'other' ? f.name : f.kind === 'bevel' ? 'Bevel' : f.kind === 'gradientGlow' ? 'Gradient Glow' : 'Gradient Bevel'} filter has no ToonSquid equivalent`);
    }
  }
  return { effects, losses, approx };
}

/** Animate colour effects. Alpha is already written as layer opacity; the rest is planned here. */
export function planColor(c: ColorEffect | undefined): EffectPlan {
  const effects: PlannedEffect[] = [], losses: string[] = [], approx: string[] = [];
  if (!c) return { effects, losses, approx };
  if (c.brightness !== 0) {
    approx.push('Colour effect "Brightness" mixes towards white/black; ToonSquid Adjustments brightness is used instead (curve differs)');
    effects.push({ kind: 'adjustments', hue: 0, saturation: 0, brightness: Math.round(c.brightness * 100), contrast: 0, note: 'Animate Brightness -> Adjustments brightness' });
  }
  if (c.tintMultiplier !== 0) losses.push('Colour effect "Tint" has no ToonSquid equivalent');
  const adv = [c.redMultiplier, c.greenMultiplier, c.blueMultiplier].some((m) => m !== 1) || [c.redOffset, c.greenOffset, c.blueOffset, c.alphaOffset].some((o) => o !== 0);
  if (adv && c.brightness === 0 && c.tintMultiplier === 0) losses.push('Colour effect "Advanced" (RGB multipliers/offsets) has no ToonSquid equivalent');
  return { effects, losses, approx };
}

/**
 * Animate blend modes (14) -> ToonSquid blend modes (27), by name. `null` = no equivalent.
 * Animate "layer" isolates the group; in ToonSquid that is a group/symbol with Normal instead of Pass Through.
 */
export const BLEND_MAP: Record<string, string | null> = {
  normal: 'Normal', layer: 'Normal', darken: 'Darken', multiply: 'Multiply', lighten: 'Lighten', screen: 'Screen',
  overlay: 'Overlay', hardlight: 'Hard Light', difference: 'Difference', add: 'Add', subtract: 'Subtract',
  invert: null, alpha: null, erase: null,
};

/** ToonSquid `bM` integers. Only Normal (field omitted) is certain; the others have not been decoded yet. */
export const BLEND_CODE: Record<string, number | undefined> = { Normal: undefined };
