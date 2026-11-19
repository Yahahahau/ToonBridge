// Dev tool: "Animate truth" renderer. Draws the IR directly with the ORIGINAL Animate matrices
// (including skew) — independent of the resolver/writer — to compare against the .tsproj render.
import { readFileSync } from 'node:fs';
import { analyzeInput } from '../src/engine';
import { Diagnostics } from '../src/engine/diagnostics';
import { chainToContourSvg } from './svg-util';
import type { Doc, Frame, Layer, Timeline } from '../src/engine/ir';
import { timelineLength } from '../src/engine/ir';
import { decompose } from '../src/engine/geometry/matrix';
import { fillContours, strokeContours, usedFillIds, usedStrokeIds } from '../src/engine/geometry/contours';

const rgba = (c: { r: number; g: number; b: number; a: number }) => `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${c.a})`;

export interface RefResult { svg: string; skewed: number; tweenedLayers: number; }

export function renderReference(doc: Doc, sceneIdx: number, frame: number): RefResult {
  const diag = new Diagnostics();
  let skewed = 0, tweened = 0;
  const frameAt = (l: Layer, j: number): Frame | null => { for (const f of l.frames) if (j >= f.index && j < f.index + f.duration) return f; return null; };
  function tl(t: Timeline, j: number, depth: number): string {
    if (depth > 12) return '';
    let out = '';
    for (const l of [...t.layers].reverse()) {
      if (l.kind !== 'normal' || !l.visible) continue;
      const f = frameAt(l, j); if (!f) continue;
      if (f.tween?.kind === 'motion' && j > f.index) tweened++;
      for (const e of f.elements) {
        if (e.type === 'shape') {
          const m = e.matrix ? ` transform="matrix(${e.matrix.a} ${e.matrix.b} ${e.matrix.c} ${e.matrix.d} ${e.matrix.tx} ${e.matrix.ty})"` : '';
          let g = '';
          for (const fid of usedFillIds(e.edges)) {
            const p = e.fills.get(fid); const col = p && (p.kind === 'solid' ? p.color : p.fallback); if (!col) continue;
            g += `<path d="${chainToContourSvg(fillContours(e.edges, fid, undefined, diag))}" fill="${rgba(col)}" fill-rule="nonzero"/>`;
          }
          for (const sid of usedStrokeIds(e.edges)) {
            const s = e.strokes.get(sid); const col = s && (s.paint.kind === 'solid' ? s.paint.color : s.paint.fallback); if (!col) continue;
            g += `<path d="${chainToContourSvg(strokeContours(e.edges, sid, undefined))}" fill="none" stroke="${rgba(col)}" stroke-width="${s!.weight}"/>`;
          }
          out += `<g${m}>${g}</g>`;
        } else {
          const sym = doc.symbols.get(e.lib); if (!sym) continue;
          const len = Math.max(1, timelineLength(sym.timeline));
          const off = j - f.index;
          const first = e.symbolType === 'movie clip' ? 0 : e.firstFrame;
          let sf = (((first + off) % len) + len) % len;
          if (e.symbolType === 'button') sf = 0;
          else if (e.symbolType === 'graphic' && e.loop === 'single frame') sf = Math.min(first, len - 1);
          else if (e.symbolType === 'graphic' && e.loop === 'play once') sf = Math.min(first + off, len - 1);
          if (Math.abs(decompose(e.matrix).h) > 2e-3) skewed++;
          const m = e.matrix;
          out += `<g opacity="${e.alpha}" transform="matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.tx} ${m.ty})">${tl(sym.timeline, sf, depth + 1)}</g>`;
        }
      }
    }
    return out;
  }
  const body = tl(doc.scenes[sceneIdx], frame, 0);
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}"><rect width="100%" height="100%" fill="#999"/>${body}</svg>`, skewed, tweenedLayers: tweened };
}

export function loadDoc(file: string): Doc { return analyzeInput(new Uint8Array(readFileSync(file)), 'ref').doc; }
