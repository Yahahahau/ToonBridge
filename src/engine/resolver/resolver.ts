// Resolver: IR -> ToonSquid model. Implements R3 (via contours), R4 frame spans, R5 transforms,
// R6 graphic-symbol frame mapping (snapshot baking) and motion-tween baking.
import type { Doc, Frame, InstanceEl, Layer, Matrix, RGBA, ShapeEl, SymbolDef, Timeline } from '../ir';
import { timelineLength } from '../ir';
import { apply, compose, decompose, shearMatrix } from '../geometry/matrix';
import { contoursBounds } from '../geometry/bounds';
import { shearEffect } from '../geometry/perspective';
import type { Contour } from '../geometry/contours';
import { CoverIndex, coveredChains } from '../geometry/cover';
import { Diagnostics } from '../diagnostics';
import { chainToContour, fillContours, seamContours, strokeContours, usedFillIds, usedStrokeIds } from '../geometry/contours';
import { hex, rnd, sha1, uuid5 } from '../util';
import type { Content, TSClip, TSDrawing, TSLayer, TSProject } from './model';

interface InstState { lib: string; pv: [number, number]; p: [number, number]; rot: number; sx: number; sy: number; h: number; alpha: number; symFrame: number; blend: string; }

/** How skew (shear) in instance matrices is handled. ToonSquid transforms have no skew. */
export type SkewMode = 'perspective' | 'bake' | 'off';
/** seamUnderlay: draw thin strokes under edges shared by two fills (default on). */
export interface ResolverOptions { skewMode: SkewMode; seamUnderlay?: boolean; }
/** Underlay stroke width in the shape's own units (px). Wide enough to cover a 1-px anti-aliasing band at 100 % zoom. */
const SEAM_WIDTH = 1;
const SHEAR_EPS = 2e-3; // |h| below this (~0.1°) is negligible
interface ResolvedEl { sig: string; shape?: ShapeEl; inst?: InstState; }

const TWO_PI = Math.PI * 2;
const normPi = (a: number) => { let x = a % TWO_PI; if (x > Math.PI) x -= TWO_PI; if (x <= -Math.PI) x += TWO_PI; return x; };

/** Experimental: Animate "simple ease" modelled as quadratic: p = t + e*t*(1-t), e=intensity/100. */
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
    tweenFramesBaked: 0, hiddenLayersSkipped: 0, skewedInstances: 0, perspectiveEffects: 0, bakedSkewShapes: 0, seamUnderlays: 0,
  };
  private projectId: string;

  constructor(private doc: Doc, private diag: Diagnostics, private opts: ResolverOptions = { skewMode: 'perspective' }) {
    this.projectId = uuid5(`project:${doc.sourceHash}`);
  }

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
      if (l.kind !== 'normal' || !l.visible) continue;
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

  private symbolFrame(inst: InstanceEl, offset: number, len: number): number {
    if (len <= 0) return 0;
    if (inst.symbolType === 'button') return 0;
    const first = inst.symbolType === 'movie clip' ? 0 : inst.firstFrame;
    if (inst.symbolType === 'graphic' && inst.loop === 'single frame') return Math.min(first, len - 1);
    if (inst.symbolType === 'graphic' && inst.loop === 'play once') return Math.min(first + offset, len - 1);
    return (((first + offset) % len) + len) % len;
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
        if (layer.kind !== 'normal' || !layer.visible) { parts.push('-'); continue; }
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
    if (this.building.has(id)) { this.diag.loss('SYMBOL_CYCLE', `Recursive symbol reference to "${sym.name}" skipped`); return null; }
    this.building.add(id);
    const name = (stat ? sym.name : `${sym.name} @${symFrame + 1}`) + (h ? ` [skew ${rnd(h)}]` : '');
    this.buildClip(id, name, sym.timeline, [stat ? 0 : symFrame], false, h);
    this.building.delete(id);
    this.stats.symbolClips++;
    return id;
  }

  // ---------- clip building ----------
  private buildClip(id: string, name: string, tl: Timeline, srcFrames: number[], isScene: boolean, preH = 0): void {
    const layers: TSLayer[] = [];
    const ordered = [...tl.layers].reverse(); // Animate lists top layer first; ToonSquid lO is bottom-first
    const conv: Layer[] = [];
    for (const layer of ordered) {
      if (layer.kind === 'folder') { this.diag.info('LAYER_FOLDER', 'Layer folders are flattened (children are converted as ordinary layers)'); continue; }
      if (layer.kind === 'guide') { this.diag.loss('LAYER_GUIDE', 'Guide layers are not converted'); continue; }
      if (layer.kind === 'mask') { this.diag.loss('LAYER_MASK', 'Mask layers are not converted; masked layers are rendered without masking'); continue; }
      if (!layer.visible) { this.diag.loss('LAYER_HIDDEN', 'Hidden layers are not converted'); this.stats.hiddenLayersSkipped++; continue; }
      conv.push(layer);
    }
    // Resolve every frame once (bottom-first), so each shape can see what is drawn above it in the same frame.
    const resolved = conv.map((layer) => srcFrames.map((j) => this.resolveFrame(layer, j, preH)));
    /** Shapes drawn above element `ci` of layer `li` at frame `k` (later elements of the same frame, then higher layers). */
    const above = (li: number, k: number, ci: number): ShapeEl[] => {
      const out: ShapeEl[] = [];
      const own = resolved[li][k];
      if (own) for (let c = ci + 1; c < own.length; c++) { const s = own[c].shape; if (s) out.push(s); }
      for (let l = li + 1; l < conv.length; l++) for (const el of resolved[l][k] ?? []) if (el.shape) out.push(el.shape);
      return out;
    };
    conv.forEach((layer, li) => {
      const lid = uuid5(`${id}|L${li}`, this.projectId);
      const drawings = this.buildLayer(id, li, layer, resolved[li], preH, (k, ci) => above(li, k, ci));
      layers.push({ id: lid, name: layer.name || `Layer ${li + 1}`, drawings });
    });
    const clip: TSClip = { id, name, isScene, layers, backgroundId: uuid5(`${id}|BG`, this.projectId), frames: srcFrames.length };
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
    if (f.tween && offset > 0) {
      if (f.tween.kind === 'motion') {
        const starts = f.elements.filter((e) => e.type === 'instance');
        const ends = nextKey && nextKey.index === f.index + f.duration ? nextKey.elements.filter((e) => e.type === 'instance') : [];
        if (starts.length === 1 && ends.length === 1 && f.elements.length === 1) tweenEnd = ends[0] as InstanceEl;
        else this.diag.approx('TWEEN_UNPAIRED', 'Motion tween without a single instance at both keyframes: held at the start keyframe', 1);
      } else if (f.tween.kind === 'shape') {
        this.diag.loss('TWEEN_SHAPE', 'Shape tweens are not supported (held at the start keyframe)', 1);
      }
    }
    for (const e of f.elements) {
      if (e.type === 'shape') { out.push({ sig: `S${this.shapeId(e)}`, shape: e }); continue; }
      const sym = this.doc.symbols.get(e.lib);
      if (!sym) { this.diag.loss('SYMBOL_UNRESOLVED', `Instance of unknown symbol "${e.lib}" skipped`); continue; }
      const len = Math.max(1, timelineLength(sym.timeline));
      const symFrame = this.symbolFrame(e, offset, len);
      const Me = eff(e.matrix);
      const dec = decompose(Me);
      const h = this.shearOf(dec.h);
      if (e.blend !== 'normal') this.diag.loss('BLEND_NOT_WRITTEN', `Blend mode "${e.blend}" on instances not written (ToonSquid blend field verified only on shape layers)`, 1);
      let st: InstState = {
        lib: e.lib, pv: [e.tp[0], e.tp[1]], p: apply(Me, e.tp), rot: dec.rot, sx: dec.sx, sy: dec.sy, h,
        alpha: e.alpha, symFrame, blend: e.blend,
      };
      if (tweenEnd && f.tween) {
        const t = easeT(offset / f.duration, f.tween.ease);
        if (f.tween.customEase) this.diag.approx('TWEEN_CUSTOM_EASE', 'Custom ease curves are not supported: standard ease used', 1);
        const Me2 = eff(tweenEnd.matrix);
        const d2 = decompose(Me2);
        const h2 = this.shearOf(d2.h, true);
        const p2 = apply(Me2, e.tp);
        let delta = d2.rot - dec.rot;
        const mode = f.tween.rotate;
        if (mode === 'clockwise') { delta = ((delta % TWO_PI) + TWO_PI) % TWO_PI + TWO_PI * f.tween.rotateTimes; }
        else if (mode === 'counter-clockwise') { delta = -((((-delta) % TWO_PI) + TWO_PI) % TWO_PI) - TWO_PI * f.tween.rotateTimes; }
        else delta = normPi(delta);
        const lerp = (a: number, b: number) => a + (b - a) * t;
        st = {
          ...st, p: [lerp(st.p[0], p2[0]), lerp(st.p[1], p2[1])], rot: dec.rot + delta * t,
          sx: lerp(dec.sx, d2.sx), sy: lerp(dec.sy, d2.sy), h: lerp(h, h2), alpha: lerp(e.alpha, tweenEnd.alpha),
        };
        this.diag.approx('TWEEN_BAKED', 'Motion tweens are baked per frame; easing model p=t+e·t(1−t) is unverified against Animate output', 1);
        this.stats.tweenFramesBaked++;
      }
      const sig = `I${e.lib}|${rnd(st.pv[0])},${rnd(st.pv[1])}|${rnd(st.p[0])},${rnd(st.p[1])}|${rnd(st.rot)}|${rnd(st.sx)},${rnd(st.sy)}|h${rnd(st.h)}|${rnd(st.alpha)}|${this.frameKey(sym, st.symFrame, st.h)}`;
      out.push({ sig, inst: st });
    }
    return out;
  }

  private buildLayer(clipId: string, li: number, layer: Layer, frames: (ResolvedEl[] | null)[], preH: number, above: (k: number, ci: number) => ShapeEl[]): TSDrawing[] {
    const drawings: TSDrawing[] = [];
    let runStart = -1;
    let runSig = '';
    let runEls: ResolvedEl[] = [];
    const flush = (endK: number) => {
      if (runStart < 0) return;
      const s = runStart + 1, e = endK + 1; // R4: 1-based inclusive
      const did = uuid5(`${clipId}|L${li}|D${s}`, this.projectId);
      const content: TSDrawing['content'] = [];
      runEls.forEach((el, ci) => {
        const cid = uuid5(`${clipId}|L${li}|D${s}|C${ci}`, this.projectId);
        if (el.shape) {
          // Distinct sets of shapes drawn above this one during the run; a bleed must be hidden in ALL of them.
          const sets = new Map<string, ShapeEl[]>();
          for (let k = runStart; k <= endK; k++) {
            const up = above(k, ci);
            sets.set(up.map((x) => this.shapeId(x)).join(','), up);
          }
          const c = this.vectorContent(el.shape, layer.name, preH, [...sets.entries()].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)));
          if (c) { content.push({ id: cid, c }); this.stats.vectorLayers++; }
        } else if (el.inst) {
          const sym = this.doc.symbols.get(el.inst.lib)!;
          const target = this.clipFor(sym, el.inst.symFrame, el.inst.h);
          if (target) {
            content.push({ id: cid, c: { kind: 'clip', ref: { clipId: target, pv: [el.inst.pv[0] + el.inst.h * el.inst.pv[1], el.inst.pv[1]], p: el.inst.p, rot: el.inst.rot, sx: el.inst.sx, sy: el.inst.sy, alpha: el.inst.alpha, name: el.inst.lib } } });
            this.stats.clipLayers++;
          }
        }
      });
      if (content.length) { drawings.push({ id: did, s, e, content }); this.stats.drawings++; }
      runStart = -1; runSig = ''; runEls = [];
    };
    for (let k = 0; k < frames.length; k++) {
      const els = frames[k];
      const sig = els && els.length ? els.map((x) => x.sig).join(';') : '';
      if (sig !== runSig) {
        flush(k - 1);
        if (sig) { runStart = k; runSig = sig; runEls = els!; }
      }
    }
    flush(frames.length - 1);
    return drawings;
  }

  /** Applies the skew policy to a raw shear factor; returns the shear that will be written (0 = none). */
  private shearOf(h: number, quiet = false): number {
    if (!(Math.abs(h) > 0)) return 0;
    if (Math.abs(h) < SHEAR_EPS) { if (!quiet) this.diag.info('SKEW_NEGLIGIBLE', 'Shear below 0.1° ignored', 1); return 0; }
    if (this.opts.skewMode === 'off') { if (!quiet) this.diag.loss('TRANSFORM_SKEW', 'Skew/shear in instance transforms dropped (skew handling disabled)', 1); return 0; }
    if (!quiet) {
      this.stats.skewedInstances++;
      if (this.opts.skewMode === 'perspective') this.diag.approx('SKEW_PERSPECTIVE', 'Skew converted to a ToonSquid Perspective effect (corner offsets). Effect layout is read from an app-made sample; space/normalisation of the corners is unverified', 1);
      else this.diag.approx('SKEW_BAKED', 'Skew baked into vector geometry of per-skew clip copies (exact, no effect used)', 1);
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

  private vectorContent(shape: ShapeEl, layerName: string, preH: number, uppers: [string, ShapeEl[]][] = []): Content | null {
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
      if (!paint) { this.diag.loss('FILL_MISSING', `Fill style ${fid} referenced by edges is not defined`); continue; }
      const color = paint.kind === 'solid' ? paint.color : paint.fallback;
      if (!color) { this.diag.loss('FILL_UNSUPPORTED', `Fill type ${paint.kind === 'unsupported' ? paint.what : ''} not converted`, 1); continue; }
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
        if (bled) this.diag.info('SEAM_BLEED', `Fill edges hidden under layers above get a ${SEAM_WIDTH / 2}px bleed, to hide anti-aliasing seams (visible edges unchanged)`, 1);
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
        if (seams.size) this.diag.info('SEAM_UNDERLAY', `Thin ${SEAM_WIDTH}px underlay strokes added beneath edges shared by two fills, to hide anti-aliasing seams`, 1);
      }
    }
    for (const f of fills) {
      items.items.push({ kind: 'fill', color: f.color, contours: f.contours });
      this.stats.contours += f.contours.length;
      for (const c of f.contours) this.stats.nodes += c.nodes.length;
    }
    for (const sid of usedStrokeIds(shape.edges)) {
      const st = shape.strokes.get(sid);
      if (!st) { this.diag.loss('STROKE_MISSING', `Stroke style ${sid} referenced by edges is not defined`); continue; }
      const color = st.paint.kind === 'solid' ? st.paint.color : st.paint.fallback;
      if (!color) { this.diag.loss('STROKE_UNSUPPORTED', 'Non-solid stroke paint not converted', 1); continue; }
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
      else this.diag.loss('SKEW_NO_BOUNDS', 'Shape with zero-width/height bounds could not receive a Perspective effect', 1);
    }
    if (bake && items.items.length) this.stats.bakedSkewShapes++;
    const res = items.items.length ? items : null;
    perH.set(cacheKey, res);
    return res;
  }
}
