// Resolver: IR -> ToonSquid model. Implements R3 (via contours), R4 frame spans, R5 transforms,
// R6 graphic-symbol frame mapping (snapshot baking) and motion-tween baking.
import type { Doc, Frame, InstanceEl, Layer, Matrix, RGBA, ShapeEl, SymbolDef, Timeline } from '../ir';
import { timelineLength } from '../ir';
import { apply, compose, decompose, shearMatrix } from '../geometry/matrix';
import { contoursBounds } from '../geometry/bounds';
import { shearEffect } from '../geometry/perspective';
import type { Contour } from '../geometry/contours';
import { CoverIndex, coveredChains } from '../geometry/cover';
import { blendCode, planColor, planFilters, toTSEffects, TS_BLEND_MODES, type PlannedEffect } from '../effects/plan';
import { Diagnostics, type DiagLocation } from '../diagnostics';
import { chainToContour, fillContours, seamContours, strokeContours, usedFillIds, usedStrokeIds } from '../geometry/contours';
import { hex, rnd, sha1, uuid5 } from '../util';
import type { Content, TSClip, TSDrawing, TSEffect, TSLayer, TSProject } from './model';

interface InstState { lib: string; pv: [number, number]; p: [number, number]; rot: number; sx: number; sy: number; h: number; alpha: number; symFrame: number; blend: string; bm?: number; fx: TSEffect[]; }

/** How skew (shear) in instance matrices is handled. ToonSquid transforms have no skew. */
export type SkewMode = 'perspective' | 'bake' | 'off';
/** seamUnderlay: draw thin strokes under edges shared by two fills (default on). */
/** symbolPlayback: 'native' (default) = one clip per symbol holding all its frames, played by the symbol layer;
 *  'snapshot' = the older one-clip-per-distinct-frame output. */
export interface ResolverOptions { skewMode: SkewMode; seamUnderlay?: boolean; symbolPlayback?: 'native' | 'snapshot'; }
/** Underlay stroke width in the shape's own units (px). Wide enough to cover a 1-px anti-aliasing band at 100 % zoom. */
const SEAM_WIDTH = 1;
const SHEAR_EPS = 2e-3; // |h| below this (~0.1°) is negligible
/** base: the sig without the symbol frame (same placement/look); used to detect continuous native playback. */
interface ResolvedEl { sig: string; base: string; shape?: ShapeEl; inst?: InstState; }

const TWO_PI = Math.PI * 2;
const normPi = (a: number) => { let x = a % TWO_PI; if (x > Math.PI) x -= TWO_PI; if (x <= -Math.PI) x += TWO_PI; return x; };

/** Experimental: Animate "simple ease" modelled as quadratic: p = t + e*t*(1-t), e=intensity/100. */
/**
 * Max distance (px) between where `s` puts three local reference points and where matrix `M` puts them, using shear `h`
 * as written (the skew policy may have changed it). 0 means the state reproduces the keyframe exactly.
 */
function stateError(s: { pv: [number, number]; p: [number, number]; rot: number; sx: number; sy: number }, M: Matrix, h: number): number {
  const c = Math.cos(s.rot), sn = Math.sin(s.rot);
  const a = c * s.sx, b = sn * s.sx, cc = c * s.sx * h - sn * s.sy, d = sn * s.sx * h + c * s.sy;
  let worst = 0;
  for (const q of [s.pv, [s.pv[0] + 100, s.pv[1]], [s.pv[0], s.pv[1] + 100]] as [number, number][]) {
    const lx = q[0] - s.pv[0], ly = q[1] - s.pv[1];
    const x = s.p[0] + a * lx + cc * ly, y = s.p[1] + b * lx + d * ly;
    const m = apply(M, q);
    worst = Math.max(worst, Math.hypot(x - m[0], y - m[1]));
  }
  return worst;
}

export function easeT(t: number, intensity: number): number {
  const e = Math.max(-100, Math.min(100, intensity)) / 100;
  return t + e * t * (1 - t);
}

export class Resolver {
  private clips = new Map<string, TSClip>();
  private clipOrder: string[] = [];
  private building = new Set<string>();
  private staticMemo = new Map<string, boolean>();
  private shapeIds = new WeakMap<object, number>();
  private nextShapeId = 1;
  private shapeCache = new WeakMap<ShapeEl, Map<string, Content | null>>();
  readonly stats: Record<string, number> = {
    scenes: 0, symbolClips: 0, drawings: 0, vectorLayers: 0, clipLayers: 0, contours: 0, nodes: 0,
    tweenFramesBaked: 0, hiddenLayersKept: 0, guideLayersKept: 0, skewedInstances: 0, perspectiveEffects: 0, bakedSkewShapes: 0, seamUnderlays: 0,
  };
  private projectId: string;

  /** Source owner (scene / symbol) of every layer, for diagnostic locations. */
  private owners = new WeakMap<Layer, { owner: string; kind: 'scene' | 'symbol'; layers: Layer[] }>();

  constructor(private doc: Doc, private diag: Diagnostics, private opts: ResolverOptions = { skewMode: 'bake' }) {
    this.projectId = uuid5(`project:${doc.sourceHash}`);
    doc.scenes.forEach((sc, i) => { for (const l of sc.layers) this.owners.set(l, { owner: sc.name || `Scene ${i + 1}`, kind: 'scene', layers: sc.layers }); });
    for (const s of doc.symbols.values()) for (const l of s.timeline.layers) this.owners.set(l, { owner: s.name, kind: 'symbol', layers: s.timeline.layers });
  }

  /** Location of a layer (and optionally a frame range / element) in the SOURCE document. Frames are 0-based in, 1-based out. */
  private loc(layer: Layer, from?: number, to?: number, element?: number, source?: string): DiagLocation {
    const o = this.owners.get(layer);
    const l: DiagLocation = { owner: o?.owner, ownerKind: o?.kind, layer: layer.name, layerIndex: layer.index !== undefined ? layer.index + 1 : undefined };
    if (from !== undefined) l.frames = [from + 1, (to ?? from) + 1];
    if (element !== undefined) l.element = element + 1;
    if (source) l.source = source;
    return l;
  }
  private keyLoc(layer: Layer, f: Frame, element?: number, source?: string): DiagLocation { return this.loc(layer, f.index, f.index + f.duration - 1, element, source); }
  private isGuided(layer: Layer): boolean {
    const o = this.owners.get(layer);
    return layer.parentIndex !== undefined && o?.layers[layer.parentIndex]?.kind === 'guide';
  }

  /**
   * Layers written to the file: normal layers (visible or hidden) and guide layers. Hidden and guide layers are kept as
   * hidden ToonSquid layers (B3.1), so their art is still in the file. Mask and folder layers are not converted.
   */
  private converted(layer: Layer): boolean { return layer.kind === 'normal' || layer.kind === 'guide'; }
  /** Written but switched off (Vi:false): hidden in Animate, or a guide layer (never shown in Animate's output). */
  private writtenHidden(layer: Layer): boolean { return layer.kind === 'guide' || !layer.visible; }

  run(): TSProject {
    const sceneIds: string[] = [];
    this.doc.scenes.forEach((sc, i) => {
      const id = uuid5(`scene:${i}`, this.projectId);
      const n = Math.max(1, timelineLength(sc));
      const frames = Array.from({ length: n }, (_, k) => k);
      this.buildClip(id, sc.name || `Scene ${i + 1}`, sc, frames, true);
      sceneIds.push(id);
      this.stats.scenes++;
    });
    // Scenes first (in order), then symbol clips in creation order.
    const ordered = [...sceneIds, ...this.clipOrder.filter((id) => !sceneIds.includes(id))];
    return {
      id: this.projectId, name: this.doc.name, width: this.doc.width, height: this.doc.height, fps: this.doc.fps,
      clips: ordered.map((id) => this.clips.get(id)!), sceneIds, stats: this.stats,
    };
  }

  // ---------- symbols ----------
  private isStatic(sym: SymbolDef, stack: Set<string> = new Set()): boolean {
    const memo = this.staticMemo.get(sym.name);
    if (memo !== undefined) return memo;
    if (stack.has(sym.name)) return false;
    stack.add(sym.name);
    let ok = true;
    for (const l of sym.timeline.layers) {
      if (!this.converted(l)) continue;
      if (l.frames.length > 1 || (l.frames[0] && (l.frames[0].index !== 0 || l.frames[0].tween))) { ok = false; break; }
      for (const f of l.frames) for (const e of f.elements) {
        if (e.type !== 'instance') continue;
        const s = this.doc.symbols.get(e.lib);
        if (s && !this.isStatic(s, stack)) { ok = false; break; }
      }
      if (!ok) break;
    }
    stack.delete(sym.name);
    if (stack.size === 0) this.staticMemo.set(sym.name, ok);
    return ok;
  }

  /**
   * Symbol frame shown `offset` frames after the keyframe. Graphic loop modes per Adobe ("Elements" help page, Graphic
   * Looping): Loop / Play Once run "first frame" -> "last frame"; Loop Reverse / Reverse Play Once run "last frame" ->
   * "first frame"; play-once modes then hold their end frame. "Last frame" (XFL lastFrame, Animate 2019+) defaults to
   * the symbol's last frame. Without lastFrame, Loop keeps the classic behaviour (wraps through the whole symbol).
   */
  private symbolFrame(inst: InstanceEl, offset: number, len: number): number {
    if (len <= 0) return 0;
    if (inst.symbolType === 'button') return 0;
    const mod = (a: number, n: number) => ((a % n) + n) % n;
    if (inst.symbolType === 'movie clip') return mod(offset, len);
    const first = inst.firstFrame;
    if (inst.loop === 'single frame') return Math.min(first, len - 1);
    const ranged = inst.lastFrame !== undefined;
    const f0 = Math.min(Math.max(0, first), len - 1);
    const last = ranged ? Math.min(Math.max(inst.lastFrame!, f0), len - 1) : len - 1;
    const span = last - f0 + 1;
    switch (inst.loop) {
      case 'play once': return Math.min(first + offset, last);
      case 'play once reverse': return Math.max(last - offset, f0);
      case 'loop reverse': return last - mod(offset, span);
      default: return ranged ? f0 + mod(offset, span) : mod(first + offset, len);
    }
  }

  private frameKeys = new Map<string, string>();
  private keyStack = new Set<string>();
  /**
   * Content key of `sym` at `symFrame`: identical keys mean an identical picture. Frames of a symbol that look the same
   * (a held keyframe, a loop landing on an identical frame, ...) share one snapshot clip, so the parent drawing can be
   * HELD over those frames like a ToonSquid drawing (s..e), instead of becoming a new one-frame drawing every frame.
   */
  private frameKey(sym: SymbolDef, symFrame: number, h: number): string {
    if (this.isStatic(sym)) return 's';
    const memo = `${sym.name}@${symFrame}|${rnd(h)}`;
    const hit = this.frameKeys.get(memo);
    if (hit) return hit;
    if (this.keyStack.has(memo)) return `f${symFrame}`;     // cycle: fall back to the frame number
    this.keyStack.add(memo);
    const diag = this.diag;
    this.diag = this.quiet;                                  // key computation must not double-count diagnostics
    const parts: string[] = [];
    try {
      for (const layer of sym.timeline.layers) {
        if (!this.converted(layer)) { parts.push('-'); continue; }
        const els = this.resolveFrame(layer, symFrame, h);
        parts.push(els && els.length ? els.map((e) => e.sig).join(';') : '');
      }
    } finally { this.diag = diag; this.keyStack.delete(memo); }
    const key = hex(sha1(new TextEncoder().encode(parts.join('|')))).slice(0, 16);
    this.frameKeys.set(memo, key);
    return key;
  }

  /** Returns the clip id for `sym` snapshotted at `symFrame` (R6 baking); builds it on first use. Frames with the same content share it. */
  private clipFor(sym: SymbolDef, symFrame: number, h = 0): string | null {
    const stat = this.isStatic(sym);
    const key = (stat ? `sym:${sym.name}` : `sym:${sym.name}#${this.frameKey(sym, symFrame, h)}`) + (h ? `|h${rnd(h)}` : '');
    const id = uuid5(key, this.projectId);
    if (this.clips.has(id)) return id;
    if (this.building.has(id)) { this.diag.loss('SYMBOL_CYCLE', 'Symbol contains itself (recursive reference): the inner copy is skipped', 1, { owner: sym.name, ownerKind: 'symbol' }); return null; }
    this.building.add(id);
    const name = this.cleanName(sym.name);
    this.buildClip(id, name, sym.timeline, [stat ? 0 : symFrame], false, h);
    this.building.delete(id);
    this.stats.symbolClips++;
    return id;
  }

  private symLen(sym: SymbolDef): number { return Math.max(1, timelineLength(sym.timeline)); }

  /**
   * The symbol's whole timeline as ONE ToonSquid clip (all its frames), like a symbol in Animate's library. A symbol
   * layer then plays it over time; see buildLayer. Static symbols reuse their single-frame clip.
   */
  private fullClipFor(sym: SymbolDef, h = 0): string | null {
    if (this.isStatic(sym)) return this.clipFor(sym, 0, h);
    const id = uuid5(`full:${sym.name}` + (h ? `|h${rnd(h)}` : ''), this.projectId);
    if (this.clips.has(id)) return id;
    if (this.building.has(id)) { this.diag.loss('SYMBOL_CYCLE', 'Symbol contains itself (recursive reference): the inner copy is skipped', 1, { owner: sym.name, ownerKind: 'symbol' }); return null; }
    this.building.add(id);
    const len = this.symLen(sym);
    this.buildClip(id, this.cleanName(sym.name), sym.timeline, Array.from({ length: len }, (_, k) => k), false, h);
    this.building.delete(id);
    this.stats.symbolClips++;
    this.stats.animatedClips = (this.stats.animatedClips ?? 0) + 1;
    return id;
  }

  private nameCount = new Map<string, number>();
  /**
   * Library names as a person would write them: the symbol's own name (without Animate library folders), and
   * "name 2", "name 3", ... for further snapshots/skew variants of the same symbol. No "@frame" or "[skew …]" tags.
   */
  private cleanName(libName: string): string {
    const base = (libName.split('/').pop() || libName).replace(/\s+/g, ' ').trim() || 'Symbol';
    const n = (this.nameCount.get(base) ?? 0) + 1;
    this.nameCount.set(base, n);
    return n === 1 ? base : `${base} ${n}`;
  }

  // ---------- clip building ----------
  private buildClip(id: string, name: string, tl: Timeline, srcFrames: number[], isScene: boolean, preH = 0): void {
    const layers: TSLayer[] = [];
    const ordered = [...tl.layers].reverse(); // Animate lists top layer first; ToonSquid lO is bottom-first
    const conv: Layer[] = [];
    for (const layer of ordered) {
      if (layer.kind === 'folder') { this.diag.info('LAYER_FOLDER', 'Layer folder is flattened (its layers are converted as ordinary layers)', 1, this.loc(layer)); continue; }
      if (layer.kind === 'mask') { this.diag.loss('LAYER_MASK', 'Mask layer is not converted; the layers it masks are drawn without masking', 1, this.loc(layer)); continue; }
      if (layer.kind === 'guide') {
        this.diag.info('LAYER_GUIDE', 'Guide layer kept as a hidden layer named "[Guide] …" (Animate never shows guides in its output; visibility flag Vi:false as stored by the app)', 1, this.loc(layer, undefined, undefined, undefined, layer.visible ? 'layerType="guide"' : 'layerType="guide" visible="false"'));
        this.stats.guideLayersKept++;
      } else if (!layer.visible) {
        this.diag.info('LAYER_HIDDEN', 'Hidden layer kept hidden: its art is in the file with the layer switched off (visibility flag Vi:false as stored by the app)', 1, this.loc(layer, undefined, undefined, undefined, 'visible="false"'));
        this.stats.hiddenLayersKept++;
      }
      conv.push(layer);
    }
    const off = conv.map((l) => this.writtenHidden(l));
    // Resolve every frame once (bottom-first), so each shape can see what is drawn above it in the same frame.
    const resolved = conv.map((layer) => srcFrames.map((j) => this.resolveFrame(layer, j, preH)));
    /** Shapes drawn above element `ci` of layer `li` at frame `k` (later elements of the same frame, then higher layers). */
    const above = (li: number, k: number, ci: number): ShapeEl[] => {
      const out: ShapeEl[] = [];
      const own = resolved[li][k];
      if (own) for (let c = ci + 1; c < own.length; c++) { const s = own[c].shape; if (s) out.push(s); }
      // A hidden layer above draws nothing, so it must not hide (or receive the bleed of) anything below it.
      for (let l = li + 1; l < conv.length; l++) if (!off[l]) for (const el of resolved[l][k] ?? []) if (el.shape) out.push(el.shape);
      return out;
    };
    conv.forEach((layer, li) => {
      const lid = uuid5(`${id}|L${li}`, this.projectId);
      const drawings = this.buildLayer(id, li, layer, resolved[li], preH, (k, ci) => above(li, k, ci), srcFrames);
      const name = layer.name || `Layer ${li + 1}`;
      layers.push(off[li] ? { id: lid, name: layer.kind === 'guide' ? `[Guide] ${name}` : name, drawings, hidden: true } : { id: lid, name, drawings });
    });
    const blendsInside = resolved.some((fr) => fr.some((els) => (els ?? []).some((e) => e.inst?.bm !== undefined)));
    const clip: TSClip = { id, name, isScene, layers, backgroundId: uuid5(`${id}|BG`, this.projectId), frames: srcFrames.length, blendsInside };
    this.clips.set(id, clip);
    this.clipOrder.push(id);
  }

  private frameAt(layer: Layer, j: number): { f: Frame; idx: number } | null {
    const fr = layer.frames;
    let lo = 0, hi = fr.length - 1, found = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (fr[mid].index <= j) { found = mid; lo = mid + 1; } else hi = mid - 1; }
    if (found < 0) return null;
    const f = fr[found];
    return j < f.index + f.duration ? { f, idx: found } : null;
  }

  private shapeId(o: object): number {
    let v = this.shapeIds.get(o);
    if (!v) { v = this.nextShapeId++; this.shapeIds.set(o, v); }
    return v;
  }

  /**
   * First frame of the uninterrupted run of keyframes in which this movie clip (same symbol, same position among that
   * symbol's instances in the keyframe) is on the layer. Its playhead counts from there.
   */
  private movieClipRunStart(layer: Layer, idx: number, e: InstanceEl): number {
    const ord = (fr: Frame, el: InstanceEl) => fr.elements.filter((x) => x.type === 'instance' && x.lib === el.lib && x.symbolType === 'movie clip').indexOf(el);
    const k = ord(layer.frames[idx], e);
    let i = idx;
    while (i > 0) {
      const prev = layer.frames[i - 1], cur = layer.frames[i];
      if (prev.index + prev.duration !== cur.index) break;
      const same = prev.elements.filter((x) => x.type === 'instance' && x.lib === e.lib && x.symbolType === 'movie clip');
      if (same.length <= k) break;
      i--;
    }
    return layer.frames[i].index;
  }

  private resolveFrame(layer: Layer, j: number, preH: number): ResolvedEl[] | null {
    const A: Matrix | null = preH ? shearMatrix(preH) : null;
    const eff = (m: Matrix): Matrix => (A ? compose(A, m) : m);
    const hit = this.frameAt(layer, j);
    if (!hit) return null;
    const { f, idx } = hit;
    const out: ResolvedEl[] = [];
    const nextKey = layer.frames[idx + 1];
    const offset = j - f.index;
    let tweenEnd: InstanceEl | null = null;
    if (f.tween && offset > 0 && (f.tween.kind === 'motion' || f.tween.kind === 'shape')) {
      const tl = this.keyLoc(layer, f);
      const hasNext = !!nextKey && nextKey.index === f.index + f.duration;
      // A tween on a layer's LAST keyframe (no end keyframe) is held by Animate as well: not a conversion loss, not reported.
      if (hasNext && f.tween.kind === 'motion') {
        const starts = f.elements.filter((e) => e.type === 'instance');
        const ends = nextKey.elements.filter((e) => e.type === 'instance');
        if (starts.length === 1 && ends.length === 1 && f.elements.length === 1) {
          const s0 = starts[0] as InstanceEl, e1 = ends[0] as InstanceEl;
          // Interpolating between DIFFERENT symbols mixes two unrelated registration points and throws the art off
          // (the frame-2 jump in BF NOTE LEFT/UP/DOWN). Hold the start keyframe instead, like the reference render.
          if (s0.lib === e1.lib) tweenEnd = e1;
          else this.diag.approx('TWEEN_SYMBOL_SWAP', 'Classic tween between two different symbols: held at the start keyframe (no interpolation)', 1, { ...tl, element: 1, source: `"${s0.lib}" → "${e1.lib}"` });
        } else {
          // Animate tweens a single group too; our parser flattens groups, so that case is a real loss.
          const oneGroup = (els: typeof f.elements) => els.length > 0 && els.every((x) => x.type === 'shape' && x.group !== undefined && x.group === (els[0] as ShapeEl).group);
          if (oneGroup(f.elements) && oneGroup(nextKey.elements))
            this.diag.approx('TWEEN_UNPAIRED', 'Classic tween of a group: not interpolated (held at the start keyframe)', 1, { ...tl, source: 'tweened <DOMGroup>' });
          else
            this.diag.info('TWEEN_BROKEN_SOURCE', 'Classic tween whose keyframes do not each hold exactly one symbol instance: Animate does not interpolate this either (broken tween); held at the start keyframe', 1, { ...tl, source: `start keyframe: ${f.elements.length} element(s), end keyframe: ${nextKey.elements.length}` });
        }
      } else if (hasNext && f.tween.kind === 'shape') {
        this.diag.loss('TWEEN_SHAPE', 'Shape tween is not supported: held at the start keyframe, then jumps to the end keyframe', 1, tl);
      }
    }
    f.elements.forEach((e, ei) => {
      if (e.type === 'shape') { const sig = `S${this.shapeId(e)}`; out.push({ sig, base: sig, shape: e }); return; }
      const el = this.keyLoc(layer, f, ei);
      const sym = this.doc.symbols.get(e.lib);
      if (!sym) { this.diag.loss('SYMBOL_UNRESOLVED', 'Instance of a symbol that is not in the library: skipped', 1, { ...el, source: `libraryItemName="${e.lib}"` }); return; }
      const len = Math.max(1, timelineLength(sym.timeline));
      if (e.symbolType === 'graphic' && e.lastFrame !== undefined && e.lastFrame < len - 1 && e.loop !== 'single frame')
        this.diag.approx('GRAPHIC_LAST_FRAME', 'Graphic loop range (First/Last frame) applied: frames baked within the range, as Adobe documents it (not compared with an Animate render)', 1, { ...el, source: `lastFrame="${e.lastFrame}" (symbol has ${len} frames)` });
      if (e.symbolType === 'graphic' && e.loop !== 'loop')
        this.diag.unsupported('TS_LOOP_MODE', 'Loop mode is not written as a ToonSquid loop setting; the correct frames are baked into the drawings instead', 1, { ...el, source: `loop="${e.loopSource ?? e.loop}"` });
      // Movie clips keep playing across consecutive keyframes (same symbol, same layer = the same instance in Animate);
      // restarting them at every keyframe made loops like "retry brain loop movie" jump back and stutter.
      const mcStart = e.symbolType === 'movie clip' ? this.movieClipRunStart(layer, idx, e) : f.index;
      if (mcStart !== f.index) this.diag.info('MOVIECLIP_CONTINUOUS', 'Movie clip spanning several keyframes keeps playing continuously (not restarted at each keyframe)', 1, el);
      const symFrame = this.symbolFrame(e, j - mcStart, len);
      const Me = eff(e.matrix);
      const dec = decompose(Me);
      const h = this.shearOf(dec.h, false, el);
      const fxw = this.instanceEffects(e, el);
      let st: InstState = {
        lib: e.lib, pv: [e.tp[0], e.tp[1]], p: apply(Me, e.tp), rot: dec.rot, sx: dec.sx, sy: dec.sy, h,
        alpha: e.alpha, symFrame, blend: e.blend, bm: fxw.bm, fx: fxw.fx,
      };
      if (tweenEnd && f.tween) {
        const t = easeT(offset / f.duration, f.tween.ease);
        if (f.tween.customEase) this.diag.approx('TWEEN_CUSTOM_EASE', 'Custom ease curve is not supported: standard ease used', 1, el);
        const Me2 = eff(tweenEnd.matrix);
        const d2 = decompose(Me2);
        const h2 = this.shearOf(d2.h, true);
        // Reported, not converted yet (Phase B1): tween options and non-alpha colour/filter changes.
        if (f.tween.scale === false && (Math.abs(d2.sx - dec.sx) > 1e-6 || Math.abs(d2.sy - dec.sy) > 1e-6))
          this.diag.approx('TWEEN_SCALE_FLAG', 'Tween option "Scale" is off in Animate, but the scale is still interpolated', 1, { ...el, source: 'motionTweenScale="false"' });
        if (f.tween.orientToPath && !this.isGuided(layer))
          this.diag.info('TWEEN_ORIENT_NO_GUIDE', 'Tween option "Orient to path" has no effect without a motion guide (same as in Animate)', 1, { ...el, source: 'motionTweenOrientToPath="true"' });
        const colourKey = (x: InstanceEl) => JSON.stringify({ c: x.colorFx ? { ...x.colorFx, alphaMultiplier: 1 } : null, f: x.filters, b: x.blend });
        if (colourKey(e) !== colourKey(tweenEnd))
          this.diag.approx('TWEEN_COLOR_FILTER', 'Colour effect / filter change in a tween is not interpolated: start values are used until the end keyframe (alpha is interpolated)', 1, el);
        // Rotation/scale are interpolated about the START keyframe's transformation point; its end position is where the
        // end matrix puts that same local point, so both keyframes are reproduced exactly.
        const p2 = apply(Me2, e.tp);
        let delta = d2.rot - dec.rot;
        const mode = f.tween.rotate;
        if (mode === 'clockwise') { delta = ((delta % TWO_PI) + TWO_PI) % TWO_PI + TWO_PI * f.tween.rotateTimes; }
        else if (mode === 'counter-clockwise') { delta = -((((-delta) % TWO_PI) + TWO_PI) % TWO_PI) - TWO_PI * f.tween.rotateTimes; }
        else delta = normPi(delta);
        const end = tweenEnd;
        const at = (u: number): InstState => ({
          ...st, p: [st.p[0] + (p2[0] - st.p[0]) * u, st.p[1] + (p2[1] - st.p[1]) * u], rot: dec.rot + delta * u,
          sx: dec.sx + (d2.sx - dec.sx) * u, sy: dec.sy + (d2.sy - dec.sy) * u, h: h + (h2 - h) * u, alpha: e.alpha + (end.alpha - e.alpha) * u,
        });
        // Guard: the interpolation must land exactly on both keyframes. If it does not (a matrix the model cannot
        // represent), hold the start keyframe and say so, instead of producing a jumping in-between.
        const err = Math.max(stateError(at(0), Me, dec.h), stateError(at(1), Me2, d2.h));
        if (err > 0.05) {
          this.diag.warn('TWEEN_GUARD', 'Classic tween could not be interpolated exactly: held at the start keyframe', 1, { ...el, source: `"${e.lib}", keyframe mismatch ${rnd(err)} px` });
        } else {
          st = at(t);
          this.diag.approx('TWEEN_BAKED', 'Classic tween baked frame by frame; the easing model p=t+e·t(1−t) is not yet compared with Animate', 1, el);
          this.stats.tweenFramesBaked++;
        }
      }
      const base = `I${e.lib}|${rnd(st.pv[0])},${rnd(st.pv[1])}|${rnd(st.p[0])},${rnd(st.p[1])}|${rnd(st.rot)}|${rnd(st.sx)},${rnd(st.sy)}|h${rnd(st.h)}|${rnd(st.alpha)}|b${st.bm ?? ''}|${JSON.stringify(st.fx)}`;
      out.push({ sig: `${base}|${this.frameKey(sym, st.symFrame, st.h)}`, base, inst: st });
    });
    return out;
  }

  private buildLayer(clipId: string, li: number, layer: Layer, frames: (ResolvedEl[] | null)[], preH: number, above: (k: number, ci: number) => ShapeEl[], srcFrames: number[]): TSDrawing[] {
    const drawings: TSDrawing[] = [];
    let runStart = -1;
    let runSig = ""; void runSig;
    let runEls: ResolvedEl[] = [];
    let runModes: ('same' | 'play')[] = [];
    const flush = (endK: number) => {
      if (runStart < 0) return;
      const s = runStart + 1, e = endK + 1; // R4: 1-based inclusive
      const did = uuid5(`${clipId}|L${li}|D${s}`, this.projectId);
      const content: TSDrawing['content'] = [];
      runEls.forEach((el, ci) => {
        const dl = this.loc(layer, srcFrames[runStart], srcFrames[endK], ci);
        const cid = uuid5(`${clipId}|L${li}|D${s}|C${ci}`, this.projectId);
        if (el.shape) {
          // Distinct sets of shapes drawn above this one during the run; a bleed must be hidden in ALL of them.
          const sets = new Map<string, ShapeEl[]>();
          for (let k = runStart; k <= endK; k++) {
            const up = above(k, ci);
            sets.set(up.map((x) => this.shapeId(x)).join(','), up);
          }
          const c = this.vectorContent(el.shape, layer.name, preH, dl, [...sets.entries()].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)));
          if (c) { content.push({ id: cid, c }); this.stats.vectorLayers++; }
        } else if (el.inst) {
          const sym = this.doc.symbols.get(el.inst.lib)!;
          // Native playback: the full symbol clip, started at the right frame (Time). Used when the drawing plays the
          // symbol continuously, and for one-frame drawings (no extra still clip needed). A symbol HELD on one frame
          // for several frames (single frame / end of play once) still gets a still clip of that frame.
          const animated = !this.isStatic(sym);
          const oneFrame = endK === runStart;
          const useFull = this.opts.symbolPlayback !== 'snapshot' && animated && (runModes[ci] === 'play' || (oneFrame && el.inst.h === 0));
          const target = useFull ? this.fullClipFor(sym, el.inst.h) : this.clipFor(sym, el.inst.symFrame, el.inst.h);
          const time = useFull ? el.inst.symFrame + 1 : undefined;
          if (useFull && runModes[ci] === 'play') this.diag.info('SYMBOL_NATIVE', 'Animated symbol written as a clip with all its frames, playing inside a symbol layer (start frame set with Time)', 1, dl);
          if (target) {
            // Blend isolation: a symbol whose own content uses blend modes is shown as an isolated group (ToonSquid Normal,
            // bM 0) instead of the default Pass Through. Otherwise its blended layers mix with whatever lies outside it
            // (the white Background), e.g. BF's miss poses turning washed-out lavender. Its own blend mode wins if set.
            const isolate = el.inst.bm === undefined && this.clips.get(target)?.blendsInside === true;
            if (isolate) this.diag.info('BLEND_ISOLATED', 'Symbol that contains blend modes written as an isolated group (Normal instead of Pass Through) so its blends stay inside it', 1, dl);
            content.push({ id: cid, c: { kind: 'clip', ref: { clipId: target, pv: [el.inst.pv[0] + el.inst.h * el.inst.pv[1], el.inst.pv[1]], p: el.inst.p, rot: el.inst.rot, sx: el.inst.sx, sy: el.inst.sy, alpha: el.inst.alpha, name: el.inst.lib, blend: isolate ? 0 : el.inst.bm, effects: el.inst.fx.length ? el.inst.fx : undefined, time } } });
            this.stats.clipLayers++;
          }
        }
      });
      if (content.length) { drawings.push({ id: did, s, e, content }); this.stats.drawings++; }
      runStart = -1; runSig = ''; runEls = []; runModes = [];
    };
    const native = this.opts.symbolPlayback !== 'snapshot';
    /** b is a's next frame of continuous playback: same placement and the symbol advanced by exactly one frame (wrapping like a loop). */
    const plays = (a: ResolvedEl, b: ResolvedEl): boolean => {
      if (!a.inst || !b.inst || a.base !== b.base) return false;
      const sym = this.doc.symbols.get(a.inst.lib);
      if (!sym || this.isStatic(sym)) return false;
      return b.inst.symFrame === (a.inst.symFrame + 1) % this.symLen(sym);
    };
    let modes: ('same' | 'play')[] = [];
    let prev: ResolvedEl[] | null = null;
    for (let k = 0; k < frames.length; k++) {
      const els = frames[k];
      const sig = els && els.length ? els.map((x) => x.sig).join(';') : '';
      let cont = false;
      if (runStart >= 0 && els && prev && els.length === prev.length) {
        if (k === runStart + 1 && native) modes = els.map((el, i) => (plays(prev![i], el) ? 'play' : 'same'));
        cont = els.every((el, i) => (modes[i] === 'play' ? plays(prev![i], el) : el.sig === prev![i].sig));
      }
      if (!cont) {
        flush(k - 1);
        modes = els ? els.map(() => 'same') : [];
        if (sig) { runStart = k; runSig = sig; runEls = els!; runModes = modes; }
      } else runModes = modes;
      prev = els;
    }
    flush(frames.length - 1);
    return drawings;
  }

  /**
   * Filters, colour effects and blend mode of an instance (see effects/plan.ts), turned into the effect rows and bM value
   * ToonSquid stores (decoded from an app-made file). Anything without an equivalent is reported, never dropped silently.
   */
  private instanceEffects(e: InstanceEl, loc?: DiagLocation): { fx: TSEffect[]; bm?: number } {
    const planned: PlannedEffect[] = [];
    for (const plan of [planFilters(e.filters), planColor(e.colorFx)]) {
      planned.push(...plan.effects);
      for (const l of plan.losses) this.diag.loss('FX_NO_EQUIVALENT', l, 1, loc);
      for (const a of plan.approx) this.diag.approx('FX_APPROX', a, 1, loc);
    }
    const fx = toTSEffects(planned);
    if (fx.length) this.diag.info('FX_WRITTEN', `Animate filters written as ToonSquid effects on the symbol layer (${[...new Set(planned.map((p) => p.kind))].join(', ')}). Effect on symbol layers is inferred from effects on shape layers`, 1, loc);
    let bm: number | undefined;
    if (e.blend !== 'normal') {
      const code = blendCode(e.blend);
      if (code === null) this.diag.loss('BLEND_NO_EQUIVALENT', `Blend mode "${e.blend}" has no ToonSquid equivalent`, 1, loc);
      else if (code === undefined) this.diag.approx('BLEND_LAYER', `Blend mode "${e.blend}" -> ToonSquid Normal`, 1, loc);
      else { bm = code; this.diag.info('BLEND_WRITTEN', `Blend mode "${e.blend}" written as ToonSquid "${TS_BLEND_MODES[code]}" (bM ${code})`, 1, loc); }
    }
    return { fx, bm };
  }

  /** Applies the skew policy to a raw shear factor; returns the shear that will be written (0 = none). */
  private shearOf(h: number, quiet = false, loc?: DiagLocation): number {
    if (!(Math.abs(h) > 0)) return 0;
    if (Math.abs(h) < SHEAR_EPS) { if (!quiet) this.diag.info('SKEW_NEGLIGIBLE', 'Shear below 0.1° ignored', 1, loc); return 0; }
    if (this.opts.skewMode === 'off') { if (!quiet) this.diag.loss('TRANSFORM_SKEW', 'Skew/shear in instance transforms dropped (skew handling disabled)', 1, loc); return 0; }
    if (!quiet) {
      this.stats.skewedInstances++;
      if (this.opts.skewMode === 'perspective') this.diag.approx('SKEW_PERSPECTIVE', 'Skew converted to a ToonSquid Perspective effect (corner offsets). Effect layout is read from an app-made sample; space/normalisation of the corners is unverified', 1, loc);
      else this.diag.approx('SKEW_BAKED', 'Skew baked into vector geometry of per-skew clip copies (exact, no effect used)', 1, loc);
    }
    return Math.round(h * 10000) / 10000;
  }

  private covers = new Map<string, CoverIndex>();
  private quiet = new Diagnostics();
  /** Opaque fill regions of `shapes` (same local space as the shape being converted), cached per set. */
  private coverIndex(sig: string, shapes: ShapeEl[], preH: number): CoverIndex {
    const key = `${preH}|${sig}`;
    let idx = this.covers.get(key);
    if (idx) return idx;
    idx = new CoverIndex();
    for (const s of shapes) {
      const m = this.shapeMatrix(s, preH);
      for (const fid of usedFillIds(s.edges)) {
        const p = s.fills.get(fid);
        const c = p ? (p.kind === 'solid' ? p.color : p.fallback) : undefined;
        if (!c || c.a < 0.999) continue;          // only opaque fills can hide a bleed
        idx.add(fillContours(s.edges, fid, m, this.quiet));
      }
    }
    this.covers.set(key, idx);
    return idx;
  }
  private shapeMatrix(shape: ShapeEl, preH: number): Matrix | undefined {
    return preH !== 0 && this.opts.skewMode === 'bake' ? compose(shearMatrix(preH), shape.matrix ?? { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }) : shape.matrix;
  }

  private vectorContent(shape: ShapeEl, layerName: string, preH: number, loc: DiagLocation, uppers: [string, ShapeEl[]][] = []): Content | null {
    let perH = this.shapeCache.get(shape);
    if (!perH) { perH = new Map(); this.shapeCache.set(shape, perH); }
    const cacheKey = `${preH}|${uppers.map((u) => u[0]).join('/')}`;
    const cached = perH.get(cacheKey);
    if (cached !== undefined) return cached;
    const bake = preH !== 0 && this.opts.skewMode === 'bake';
    const m: Matrix | undefined = bake ? compose(shearMatrix(preH), shape.matrix ?? { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }) : shape.matrix;
    const items: Content & { kind: 'vector' } = { kind: 'vector', name: layerName, items: [] };
    const solidOf = (f: number): RGBA | null => {
      const p = shape.fills.get(f);
      const c = p ? (p.kind === 'solid' ? p.color : p.fallback) : undefined;
      return c && c.a >= 0.999 ? c : null;   // translucent fills would let an underlay show through: never underlay them
    };
    const fills: { fid: number; color: RGBA; contours: Contour[] }[] = [];
    for (const fid of usedFillIds(shape.edges)) {
      const paint = shape.fills.get(fid);
      if (!paint) { this.diag.loss('FILL_MISSING', 'Fill style referenced by edges is not defined: that area is missing', 1, { ...loc, source: `fillStyle ${fid}` }); continue; }
      const color = paint.kind === 'solid' ? paint.color : paint.fallback;
      if (!color) continue;   // already reported by the parser (XFL_BITMAP_FILL / XFL_FILL_UNKNOWN) at this element
      const contours = fillContours(shape.edges, fid, m, this.diag);
      if (contours.length) fills.push({ fid, color, contours });
    }
    // Anti-seam underlays, drawn BELOW the fills (see geometry/contours.ts):
    //  - covered shapes (something is drawn above them): each fill's own outline, in its own colour -> the fill bleeds
    //    SEAM_WIDTH/2 under whatever covers its edge. The visible boundary is still drawn by the layer above.
    //  - topmost shapes: only edges shared by two fills, so the visible geometry is not changed at all.
    if (this.opts.seamUnderlay !== false && fills.length) {
      const covers = uppers.filter((u) => u[1].length).map((u) => this.coverIndex(u[0], u[1], preH));
      const anyBleed = covers.length === uppers.length && covers.length > 0;   // every frame of the run has something above
      if (anyBleed) {
        let bled = 0;
        for (const f of fills) {
          if (!solidOf(f.fid)) continue;
          // Bleed only the outline parts that are hidden under opaque fills above, in every frame of the run.
          const contours = coveredChains(f.contours, covers, SEAM_WIDTH * 0.45, SEAM_WIDTH / 2).map((c) => chainToContour(c, false));
          if (!contours.length) continue;
          items.items.push({ kind: 'stroke', color: f.color, width: SEAM_WIDTH, contours });
          this.stats.seamUnderlays++; bled++;
        }
        if (bled) this.diag.info('SEAM_BLEED', `Fill edges hidden under layers above get a ${SEAM_WIDTH / 2}px bleed, to hide anti-aliasing seams (visible edges unchanged)`, 1, loc);
      }
      {
        const lum = (c: RGBA) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
        // Darker of the two colours: where a seam meets a dark outline it disappears into it.
        const pick = (f0: number, f1: number) => {
          const a = solidOf(f0), b = solidOf(f1);
          if (!a || !b) return null;
          const la = lum(a), lb = lum(b);
          return la < lb || (la === lb && f0 < f1) ? f0 : f1;
        };
        const seams = seamContours(shape.edges, m, pick, SEAM_WIDTH / 2);
        for (const [fid, contours] of seams) {
          items.items.push({ kind: 'stroke', color: solidOf(fid)!, width: SEAM_WIDTH, contours });
          this.stats.seamUnderlays++;
        }
        if (seams.size) this.diag.info('SEAM_UNDERLAY', `Thin ${SEAM_WIDTH}px underlay strokes added beneath edges shared by two fills, to hide anti-aliasing seams`, 1, loc);
      }
    }
    for (const f of fills) {
      items.items.push({ kind: 'fill', color: f.color, contours: f.contours });
      this.stats.contours += f.contours.length;
      for (const c of f.contours) this.stats.nodes += c.nodes.length;
    }
    for (const sid of usedStrokeIds(shape.edges)) {
      const st = shape.strokes.get(sid);
      if (!st) { this.diag.loss('STROKE_MISSING', 'Stroke style referenced by edges is not defined: that stroke is missing', 1, { ...loc, source: `strokeStyle ${sid}` }); continue; }
      const color = st.paint.kind === 'solid' ? st.paint.color : st.paint.fallback;
      if (!color) continue;   // already reported by the parser at this element
      const contours = strokeContours(shape.edges, sid, m);
      if (!contours.length) continue;
      items.items.push({ kind: 'stroke', color, width: st.weight, contours });
      this.stats.contours += contours.length;
      for (const c of contours) this.stats.nodes += c.nodes.length;
    }
    if (preH !== 0 && !bake && items.items.length) {
      const b = contoursBounds(items.items.flatMap((i) => i.contours));
      const eff = b ? shearEffect(b, preH) : null;
      if (eff) { items.effect = eff; this.stats.perspectiveEffects++; }
      else this.diag.loss('SKEW_NO_BOUNDS', 'Shape with zero-width/height bounds could not receive a Perspective effect', 1, loc);
    }
    if (bake && items.items.length) this.stats.bakedSkewShapes++;
    const res = items.items.length ? items : null;
    perH.set(cacheKey, res);
    return res;
  }
}
