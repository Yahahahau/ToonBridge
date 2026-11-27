// XFL reader: ZIP entries -> IR (Doc). Preserves everything it can; reports the rest.
import type { AnimateFilter, ColorEffect } from '../effects/plan';
import type { DiagLocation, Diagnostics } from '../diagnostics';
import type { Doc, Element, EdgeRec, Frame, InstanceEl, Layer, LoopMode, Matrix, Paint, RGBA, ShapeEl, StrokeMeta, StrokeStyle, SymbolDef, Timeline, TweenInfo } from '../ir';
import { compose, IDENTITY } from '../geometry/matrix';
import { hex, sha1 } from '../util';
import { parseEdge } from './edges';
import { attrNum, child, kids, parseXml, type XNode } from './xml';

export interface XflInput { files: Map<string, Uint8Array>; }

const dec = new TextDecoder('utf-8');

function findRoot(files: Map<string, Uint8Array>): string | null {
  let best: string | null = null;
  for (const k of files.keys()) {
    if (k === 'DOMDocument.xml') return '';
    if (k.endsWith('/DOMDocument.xml')) if (best === null || k.length < best.length + 'DOMDocument.xml'.length) best = k.slice(0, -'DOMDocument.xml'.length);
  }
  return best;
}

function parseColor(hexStr: string | undefined, alpha: number): RGBA {
  const h = (hexStr ?? '#000000').replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0').slice(0, 6), 16);
  return { r: ((v >> 16) & 255) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255, a: alpha };
}

function parseMatrix(holder: XNode | undefined): Matrix | undefined {
  const m = child(holder ?? ({ children: [] } as unknown as XNode), 'Matrix');
  if (!m) return undefined;
  return { a: attrNum(m, 'a', 1), b: attrNum(m, 'b', 0), c: attrNum(m, 'c', 0), d: attrNum(m, 'd', 1), tx: attrNum(m, 'tx', 0), ty: attrNum(m, 'ty', 0) };
}

function parsePaint(n: XNode, diag: Diagnostics, loc?: DiagLocation, what = 'fill'): Paint {
  const solid = child(n, 'SolidColor');
  if (solid) return { kind: 'solid', color: parseColor(solid.attrs.color, attrNum(solid, 'alpha', 1)) };
  for (const g of ['LinearGradient', 'RadialGradient']) {
    const gr = child(n, g);
    if (gr) {
      const e = kids(gr, 'GradientEntry')[0];
      diag.approx('XFL_GRADIENT', 'Gradient is not supported yet: replaced by its first colour', 1, loc && { ...loc, source: `${what} <${g}> (${kids(gr, 'GradientEntry').length} colours)` });
      return { kind: 'unsupported', what: g, fallback: e ? parseColor(e.attrs.color, attrNum(e, 'alpha', 1)) : undefined };
    }
  }
  if (child(n, 'BitmapFill')) {
    diag.loss('XFL_BITMAP_FILL', 'Bitmap fill is not converted: the area it fills is missing', 1, loc && { ...loc, source: `${what} <BitmapFill bitmapPath="${child(n, 'BitmapFill')!.attrs.bitmapPath ?? ''}">` });
    return { kind: 'unsupported', what: 'BitmapFill' };
  }
  const other = n.children[0]?.name ?? 'unknown fill';
  diag.loss('XFL_FILL_UNKNOWN', 'Unknown fill type is not converted: the area it fills is missing', 1, loc && { ...loc, source: `${what} <${other}>` });
  return { kind: 'unsupported', what: other };
}

function parseShape(n: XNode, diag: Diagnostics, loc?: DiagLocation): ShapeEl {
  const fills = new Map<number, Paint>();
  for (const fs of kids(child(n, 'fills'), 'FillStyle')) fills.set(attrNum(fs, 'index', 0), parsePaint(fs, diag, loc, `fill style ${attrNum(fs, 'index', 0)}`));
  const strokes = new Map<number, StrokeStyle>();
  for (const ss of kids(child(n, 'strokes'), 'StrokeStyle')) {
    const sk = ss.children[0];
    if (!sk) continue;
    const idx = attrNum(ss, 'index', 0);
    const sl = loc && { ...loc, source: `stroke style ${idx} <${sk.name}>` };
    if (sk.name !== 'SolidStroke') diag.approx('XFL_STROKE_STYLE', 'Stroke style (dashed, dotted, ragged, stipple, hatched) approximated as a solid stroke', 1, sl);
    const fillHolder = child(sk, 'fill');
    const paint: Paint = fillHolder ? parsePaint(fillHolder, diag, loc, `stroke style ${idx}`) : { kind: 'solid', color: parseColor('#000000', 1) };
    const meta: StrokeMeta = {};
    if (sk.attrs.caps !== undefined) meta.caps = sk.attrs.caps;
    if (sk.attrs.joints !== undefined) meta.joints = sk.attrs.joints;
    if (sk.attrs.miterLimit !== undefined) meta.miterLimit = attrNum(sk, 'miterLimit', 3);
    if (sk.attrs.scaleMode !== undefined) meta.scaleMode = sk.attrs.scaleMode;
    if (sk.attrs.solidStyle === 'hairline') meta.hairline = true;
    // Animate's defaults are round caps and round joins. Anything else is not carried over (ToonSquid stroke cap/join
    // values are not decoded; the writer uses the only values seen in app-made files).
    if ((meta.caps && meta.caps !== 'round') || (meta.joints && meta.joints !== 'round'))
      diag.approx('STROKE_CAPS_JOINS', 'Stroke cap / join style is not converted (ToonSquid default used)', 1, loc && { ...loc, source: `stroke style ${idx} caps="${meta.caps ?? 'round'}" joints="${meta.joints ?? 'round'}"` });
    if (meta.scaleMode && meta.scaleMode !== 'normal')
      diag.approx('STROKE_SCALE_MODE', 'Stroke scale mode is not converted: the stroke scales with its object', 1, loc && { ...loc, source: `stroke style ${idx} scaleMode="${meta.scaleMode}"` });
    if (meta.hairline)
      diag.approx('STROKE_HAIRLINE', 'Hairline stroke written with its nominal width (it does not stay 1 px when scaled)', 1, loc && { ...loc, source: `stroke style ${idx} solidStyle="hairline"` });
    strokes.set(idx, { paint, weight: attrNum(sk, 'weight', 1), meta: Object.keys(meta).length ? meta : undefined });
  }
  const edges: EdgeRec[] = [];
  for (const e of kids(child(n, 'edges'), 'Edge')) {
    const segs = parseEdge(e.attrs.edges, e.attrs.cubics, diag);
    if (!segs.length) continue;
    const num = (k: string) => (e.attrs[k] !== undefined ? Number(e.attrs[k]) : undefined);
    edges.push({ segs, fill0: num('fillStyle0'), fill1: num('fillStyle1'), stroke: num('strokeStyle') });
  }
  const matrix = parseMatrix(child(n, 'matrix'));
  return { type: 'shape', edges, fills, strokes, matrix };
}

function applyMatrixToShape(s: ShapeEl, m: Matrix): ShapeEl {
  return { ...s, matrix: s.matrix ? compose(m, s.matrix) : m };
}

/** Animate filters. Missing attributes take the Flash/AS3 filter-class defaults. Disabled filters (isEnabled="false") are skipped. */
function parseFilters(holder: XNode | undefined): AnimateFilter[] {
  const out: AnimateFilter[] = [];
  const b = (x: XNode, k: string) => x.attrs[k] === 'true';
  for (const f of kids(holder)) {
    if (f.attrs.isEnabled === 'false') continue;
    const q = attrNum(f, 'quality', 1);
    switch (f.name) {
      case 'BlurFilter': out.push({ kind: 'blur', blurX: attrNum(f, 'blurX', 4), blurY: attrNum(f, 'blurY', 4), quality: q }); break;
      case 'DropShadowFilter': out.push({ kind: 'dropShadow', blurX: attrNum(f, 'blurX', 4), blurY: attrNum(f, 'blurY', 4), quality: q, angle: attrNum(f, 'angle', 45), distance: attrNum(f, 'distance', 4), color: parseColor(f.attrs.color ?? '#000000', attrNum(f, 'alpha', 1)), strength: attrNum(f, 'strength', 1), knockout: b(f, 'knockout'), inner: b(f, 'inner'), hideObject: b(f, 'hideObject') }); break;
      case 'GlowFilter': out.push({ kind: 'glow', blurX: attrNum(f, 'blurX', 6), blurY: attrNum(f, 'blurY', 6), quality: q, color: parseColor(f.attrs.color ?? '#FF0000', attrNum(f, 'alpha', 1)), strength: attrNum(f, 'strength', 2), knockout: b(f, 'knockout'), inner: b(f, 'inner') }); break;
      case 'AdjustColorFilter': out.push({ kind: 'adjustColor', brightness: attrNum(f, 'brightness', 0), contrast: attrNum(f, 'contrast', 0), saturation: attrNum(f, 'saturation', 0), hue: attrNum(f, 'hue', 0) }); break;
      case 'BevelFilter': out.push({ kind: 'bevel', name: 'Bevel' }); break;
      case 'GradientGlowFilter': out.push({ kind: 'gradientGlow', name: 'Gradient Glow' }); break;
      case 'GradientBevelFilter': out.push({ kind: 'gradientBevel', name: 'Gradient Bevel' }); break;
      default: out.push({ kind: 'other', name: f.name });
    }
  }
  return out;
}

/** Raw `loop` values Animate writes. "loop reverse" / "play once reverse" exist since Animate 2019. */
const KNOWN_LOOPS = new Set(['loop', 'play once', 'single frame', 'loop reverse', 'play once reverse']);
const IK_RE = /^(?:DOMIK|IK)/;

function parseInstance(n: XNode, diag: Diagnostics, loc?: DiagLocation): InstanceEl | null {
  const lib = n.attrs.libraryItemName;
  if (!lib) { diag.loss('XFL_INSTANCE_NOLIB', 'Symbol instance without libraryItemName skipped', 1, loc); return null; }
  const st = n.attrs.symbolType;
  const symbolType = st === 'graphic' ? 'graphic' : st === 'button' ? 'button' : 'movie clip';
  const loopAttr = n.attrs.loop;
  // Known modes are kept as they are (B3.2: the reverse modes too); unknown values -> "loop" (reported).
  const loop: LoopMode = loopAttr !== undefined && KNOWN_LOOPS.has(loopAttr) ? (loopAttr as LoopMode) : 'loop';
  const at = (src: string) => loc && { ...loc, source: `<DOMSymbolInstance libraryItemName="${lib}" ${src}>` };
  // Graphic loop modes only: Animate ignores `loop` on movie clips and buttons.
  if ((loopAttr === 'loop reverse' || loopAttr === 'play once reverse') && symbolType === 'graphic')
    diag.approx('LOOP_REVERSE', 'Reverse loop mode: frames are baked in reverse order ("last frame" to "first frame", as Adobe documents it; not compared with an Animate render). ToonSquid has no reverse loop mode, so each frame is its own drawing showing the right symbol frame (Time)', 1, at(`loop="${loopAttr}"`));
  else if (loopAttr !== undefined && !KNOWN_LOOPS.has(loopAttr))
    diag.warn('LOOP_UNKNOWN', 'Unknown loop mode: played as "loop"', 1, at(`loop="${loopAttr}"`));
  const tpn = child(child(n, 'transformationPoint') ?? ({ children: [] } as unknown as XNode), 'Point');
  const tp: [number, number] = tpn ? [attrNum(tpn, 'x', 0), attrNum(tpn, 'y', 0)] : [0, 0];
  let alpha = 1;
  let colorFx: ColorEffect | undefined;
  const col = child(child(n, 'color') ?? ({ children: [] } as unknown as XNode), 'Color');
  if (col) {
    alpha = attrNum(col, 'alphaMultiplier', 1);
    colorFx = {
      alphaMultiplier: alpha, redMultiplier: attrNum(col, 'redMultiplier', 1), greenMultiplier: attrNum(col, 'greenMultiplier', 1), blueMultiplier: attrNum(col, 'blueMultiplier', 1),
      alphaOffset: attrNum(col, 'alphaOffset', 0), redOffset: attrNum(col, 'redOffset', 0), greenOffset: attrNum(col, 'greenOffset', 0), blueOffset: attrNum(col, 'blueOffset', 0),
      brightness: attrNum(col, 'brightness', 0), tintMultiplier: attrNum(col, 'tintMultiplier', 0), tintColor: col.attrs.tintColor,
    };
  }
  const filters = parseFilters(child(n, 'filters'));
  if (symbolType === 'movie clip') diag.approx('XFL_MOVIECLIP', 'Movie clip instances play as looping symbols from the frame they first appear on their layer (scripts and independent timing are not modelled)', 1, loc);
  if (symbolType === 'button') diag.approx('XFL_BUTTON', 'Button instances are frozen at their Up state (frame 1)', 1, loc);

  const out: InstanceEl = {
    type: 'instance', lib, symbolType, matrix: parseMatrix(child(n, 'matrix')) ?? IDENTITY, tp, loop,
    firstFrame: attrNum(n, 'firstFrame', 0), blend: n.attrs.blendMode ?? 'normal', alpha, filters, colorFx,
  };
  // ---- source metadata, reported, not converted (Phase B1) ----
  if (loopAttr !== undefined) out.loopSource = loopAttr;
  if (n.attrs.lastFrame !== undefined) out.lastFrame = attrNum(n, 'lastFrame', 0);   // checked against the symbol length in the resolver
  if (n.attrs.isVisible === 'false') {
    out.hidden = true;
    diag.loss('INSTANCE_HIDDEN', 'Instance is hidden in Animate (Visible unchecked) but is shown in the output', 1, at('isVisible="false"'));
  }
  const m3 = child(n, 'matrix3D');
  const rot3 = ['rotationX', 'rotationY', 'z'].filter((k) => n.attrs[k] !== undefined && attrNum(n, k, 0) !== 0);
  if (m3 || rot3.length) {
    out.has3D = true;
    diag.loss('TRANSFORM_3D', '3D rotation / position is not supported: only the 2D transform is kept', 1, at(m3 ? '<matrix3D>' : rot3.map((k) => `${k}="${n.attrs[k]}"`).join(' ')));
  }
  if (child(n, 'Actionscript')) {
    out.hasScript = true;
    diag.unsupported('SCRIPT_IGNORED', 'ActionScript found and ignored (never run): playback that depends on it (stop, gotoAndPlay, button handlers) is not reproduced', 1, at('<Actionscript> on the instance'));
  }
  for (const c of n.children) if (IK_RE.test(c.name)) { diag.loss('IK_ARMATURE', 'Inverse kinematics (bones / armature) is not supported: the stored pose of each frame is kept, bones are lost', 1, at(`<${c.name}>`)); break; }
  return out;
}

let groupSeq = 0;
/** Source location of a keyframe on a layer (frames 1-based). */
interface FrameCtx { loc: DiagLocation; }

function parseElements(holder: XNode | undefined, diag: Diagnostics, ctx: FrameCtx, outer?: Matrix, group?: number, elemBase?: number): Element[] {
  const out: Element[] = [];
  kids(holder).forEach((e, i) => {
    const loc: DiagLocation = { ...ctx.loc, element: elemBase ?? i + 1 };
    switch (e.name) {
      case 'DOMShape': {
        const s = parseShape(e, diag, loc);
        const s2 = outer ? applyMatrixToShape(s, outer) : s;
        out.push(group !== undefined ? { ...s2, group } : s2);
        break;
      }
      case 'DOMSymbolInstance': {
        const inst = parseInstance(e, diag, loc);
        if (inst) out.push(outer ? { ...inst, matrix: compose(outer, inst.matrix) } : inst);
        break;
      }
      case 'DOMGroup': {
        const gm = parseMatrix(child(e, 'matrix')) ?? IDENTITY;
        // Visual result is exact (members keep their stacking and matrices); the group as an editable unit is lost.
        diag.approx('GROUP_FLATTENED', 'Group is flattened into its parent layer: artwork kept, the group itself is lost for editing', 1, { ...loc, source: `<DOMGroup> (${kids(child(e, 'members')).length} members)` });
        const g = group ?? ++groupSeq;
        out.push(...parseElements(child(e, 'members'), diag, ctx, outer ? compose(outer, gm) : gm, g, elemBase ?? i + 1));
        break;
      }
      case 'DOMBitmapInstance': diag.loss('XFL_BITMAP', 'Bitmap instance is not converted (raster image writing not implemented)', 1, { ...loc, source: `<DOMBitmapInstance libraryItemName="${e.attrs.libraryItemName ?? ''}">` }); break;
      case 'DOMStaticText': case 'DOMDynamicText': case 'DOMInputText': case 'DOMTLFText':
        diag.loss('XFL_TEXT', 'Text is not converted', 1, { ...loc, source: `<${e.name}>` }); break;
      case 'DOMVideoInstance': diag.loss('XFL_VIDEO', 'Video instance is not converted', 1, { ...loc, source: `<DOMVideoInstance libraryItemName="${e.attrs.libraryItemName ?? ''}">` }); break;
      case 'DOMComponentInstance': case 'DOMCompiledClipInstance': diag.loss('XFL_COMPONENT', 'Component / compiled clip instance is not converted', 1, { ...loc, source: `<${e.name}>` }); break;
      case 'DOMRectangleObject': case 'DOMOvalObject': diag.loss('XFL_PRIMITIVE', 'Primitive rectangle/oval object skipped (only its DOMShape twin is read)', 1, { ...loc, source: `<${e.name}>` }); break;
      default:
        if (IK_RE.test(e.name)) diag.loss('IK_ARMATURE', 'Inverse kinematics (bones / armature) is not supported: the stored pose of each frame is kept, bones are lost', 1, { ...loc, source: `<${e.name}>` });
        else diag.loss('XFL_UNKNOWN_ELEMENT', 'Unknown element skipped', 1, { ...loc, source: `<${e.name}>` });
    }
  });
  return out;
}

function parseTween(f: XNode, diag: Diagnostics, loc: DiagLocation): TweenInfo | undefined {
  const tt = f.attrs.tweenType;
  const hasTweens = child(f, 'tweens');
  if (!tt && !hasTweens) return undefined;
  const kind: TweenInfo['kind'] = tt === 'motion' ? 'motion' : tt === 'shape' ? 'shape' : 'other';
  let ease = attrNum(f, 'acceleration', 0);
  let custom = false;
  for (const t of kids(hasTweens)) {
    if (t.name === 'Ease') ease = attrNum(t, 'intensity', 0);
    else if (t.name === 'CustomEase') custom = true;
  }
  const rot = f.attrs.motionTweenRotate;
  const rotate: TweenInfo['rotate'] = rot === 'clockwise' ? 'clockwise' : rot === 'counter-clockwise' ? 'counter-clockwise' : rot === 'none' ? 'none' : 'auto';
  if (kind === 'other') diag.loss('XFL_TWEEN_KIND', 'Tween type is not supported (held at the start keyframe)', 1, { ...loc, source: `tweenType="${tt}"` });
  const info: TweenInfo = { kind, ease, customEase: custom, rotate, rotateTimes: attrNum(f, 'motionTweenRotateTimes', 0) };
  if (f.attrs.motionTweenScale !== undefined) info.scale = f.attrs.motionTweenScale !== 'false';
  if (f.attrs.motionTweenOrientToPath !== undefined) info.orientToPath = f.attrs.motionTweenOrientToPath === 'true';
  if (f.attrs.motionTweenSnap !== undefined) info.snap = f.attrs.motionTweenSnap === 'true';
  return info;
}

function parseTimeline(tl: XNode, diag: Diagnostics, owner: string, ownerKind: 'scene' | 'symbol'): Timeline {
  const layers: Layer[] = [];
  const layerNodes = kids(child(tl, 'layers'), 'DOMLayer');
  layerNodes.forEach((ln, li) => {
    const lt = ln.attrs.layerType;
    const kind: Layer['kind'] = lt === 'guide' ? 'guide' : lt === 'mask' ? 'mask' : lt === 'folder' ? 'folder' : 'normal';
    const name = ln.attrs.name ?? '';
    const base: DiagLocation = { owner, ownerKind, layer: name, layerIndex: li + 1 };
    const frames: Frame[] = [];
    for (const fn of kids(child(ln, 'frames'), 'DOMFrame')) {
      const index = attrNum(fn, 'index', 0);
      const rawDur = attrNum(fn, 'duration', 1);
      const duration = Math.max(1, rawDur);
      const loc: DiagLocation = { ...base, frames: [index + 1, index + duration] };
      const frame: Frame = { index, duration, tween: parseTween(fn, diag, loc), elements: parseElements(child(fn, 'elements'), diag, { loc }) };
      if (fn.attrs.duration !== undefined && rawDur <= 0) {
        frame.zeroDuration = true;
        diag.warn('FRAME_ZERO_DURATION', 'Zero-length keyframe: kept as a 1-frame keyframe (a keyframe starting on the same frame replaces it)', 1, { ...loc, source: `duration="${fn.attrs.duration}"` });
      }
      if (fn.attrs.name) {
        frame.label = { name: fn.attrs.name, type: fn.attrs.labelType ?? 'name' };
        diag.unsupported('FRAME_LABEL', 'Frame label / comment / anchor is not written (ToonSquid frame markers are not decoded yet)', 1, { ...loc, source: `${frame.label.type} "${frame.label.name}"` });
      }
      if (fn.attrs.soundName) {
        frame.sound = {
          name: fn.attrs.soundName, sync: fn.attrs.soundSync ?? 'event', loopMode: fn.attrs.soundLoopMode,
          loops: fn.attrs.soundLoop !== undefined ? attrNum(fn, 'soundLoop', 1) : undefined,
          inPoint: fn.attrs.inPoint44 !== undefined ? attrNum(fn, 'inPoint44', 0) : undefined,
          outPoint: fn.attrs.outPoint44 !== undefined ? attrNum(fn, 'outPoint44', 0) : undefined,
        };
        diag.loss('FRAME_SOUND', 'Sound on the timeline is not converted (no audio in the output)', 1, { ...loc, source: `sound "${frame.sound.name}" sync="${frame.sound.sync}"${frame.sound.loopMode ? ` ${frame.sound.loopMode}` : ''}${frame.sound.loops !== undefined ? ` ×${frame.sound.loops}` : ''}` });
      }
      if (child(fn, 'Actionscript')) {
        // Presence only. The script text is never interpreted, evaluated or stored.
        frame.hasScript = true;
        diag.unsupported('SCRIPT_IGNORED', 'ActionScript found and ignored (never run): playback that depends on it (stop, gotoAndPlay, button handlers) is not reproduced', 1, { ...loc, source: '<Actionscript> on the frame' });
      }
      frames.push(frame);
    }
    frames.sort((a, b) => a.index - b.index);
    const layer: Layer = { name, kind, visible: ln.attrs.visible !== 'false', frames, index: li };
    if (ln.attrs.locked === 'true') {
      layer.locked = true;
      diag.unsupported('LAYER_LOCKED', 'Layer lock is not written (ToonSquid lock flag not decoded yet)', 1, { ...base, source: 'locked="true"' });
    }
    if (ln.attrs.outline === 'true') {
      layer.outline = true;
      diag.unsupported('LAYER_OUTLINE', 'Layer "show as outlines" is an editor setting and is not written', 1, { ...base, source: 'outline="true"' });
    }
    if (ln.attrs.animationType) {
      layer.animationType = ln.attrs.animationType;
      if (/IK/i.test(ln.attrs.animationType)) diag.loss('IK_ARMATURE', 'Inverse kinematics (bones / armature) is not supported: the stored pose of each frame is kept, bones are lost', 1, { ...base, source: `animationType="${ln.attrs.animationType}"` });
      else if (ln.attrs.animationType === 'motion object') diag.loss('XFL_MOTION_OBJECT_LAYER', 'Motion-tween (object-based) layer: its property keyframes are not converted', 1, { ...base, source: 'animationType="motion object"' });
    }
    if (ln.attrs.parentLayerIndex !== undefined) {
      const pi = attrNum(ln, 'parentLayerIndex', -1);
      layer.parentIndex = pi;
      const parent = layerNodes[pi];
      const pk = parent?.attrs.layerType;
      const src = `parentLayerIndex="${pi}" → "${parent?.attrs.name ?? '?'}"`;
      if (!parent) diag.warn('LAYER_PARENT_MISSING', 'Layer points to a parent layer that does not exist', 1, { ...base, source: src });
      else if (pk === 'mask') diag.loss('LAYER_MASKED', 'Layer is masked in Animate; masking is not converted, so the layer is drawn unmasked', 1, { ...base, source: src });
      else if (pk === 'guide') diag.loss('LAYER_MOTION_GUIDE', 'Layer follows a motion guide; the guide path is not converted (tweens move in a straight line)', 1, { ...base, source: src });
      else if (pk === 'folder') diag.info('LAYER_IN_FOLDER', 'Layer is inside a folder; folders are flattened', 1, { ...base, source: src });
    }
    layers.push(layer);
  });
  return { name: tl.attrs.name ?? '', layers };
}

export function parseXfl(input: XflInput, diag: Diagnostics): Doc {
  groupSeq = 0;
  const root = findRoot(input.files);
  if (root === null) throw new Error('DOMDocument.xml not found. This is not an XFL project (or it is a binary FLA).');
  const docBytes = input.files.get(root + 'DOMDocument.xml')!;
  const docXml = parseXml(dec.decode(docBytes));
  if (docXml.name !== 'DOMDocument') throw new Error('DOMDocument.xml is invalid.');
  const docLoc: DiagLocation = { ownerKind: 'document', owner: 'DOMDocument.xml' };

  const width = attrNum(docXml, 'width', 550), height = attrNum(docXml, 'height', 400);
  let fps = 24;
  if (docXml.attrs.frameRate !== undefined) fps = attrNum(docXml, 'frameRate', 24);
  else diag.info('XFL_FPS_DEFAULT', 'DOMDocument has no frameRate attribute: XFL default 24 fps assumed', 1, docLoc);
  if (!Number.isFinite(fps) || fps <= 0) throw new Error('The project frame rate is invalid.');

  const symbols = new Map<string, SymbolDef>();
  for (const inc of kids(child(docXml, 'symbols'), 'Include')) {
    const href = inc.attrs.href;
    let bytes = input.files.get(`${root}LIBRARY/${href}`);
    if (!bytes) { try { bytes = input.files.get(`${root}LIBRARY/${decodeURIComponent(href)}`); } catch { /* ignore */ } }
    const incLoc: DiagLocation = { ...docLoc, source: `<Include href="${href}">` };
    if (!bytes) { diag.loss('XFL_SYMBOL_MISSING', 'Library file missing for a symbol', 1, incLoc); continue; }
    const sx = parseXml(dec.decode(bytes));
    if (sx.name !== 'DOMSymbolItem') { diag.loss('XFL_SYMBOL_BAD', 'Library file is not a DOMSymbolItem', 1, incLoc); continue; }
    const tl = child(child(sx, 'timeline') ?? ({ children: [] } as unknown as XNode), 'DOMTimeline');
    const name = sx.attrs.name ?? href.replace(/\.xml$/, '');
    if (!tl) { diag.loss('XFL_SYMBOL_NOTIMELINE', 'Symbol has no timeline', 1, { ownerKind: 'symbol', owner: name }); continue; }
    symbols.set(name, { name, symbolType: sx.attrs.symbolType ?? 'movie clip', timeline: parseTimeline(tl, diag, name, 'symbol') });
  }
  // Each media item is listed by name: whether it is used on a timeline shows up as its own diagnostic (bitmap/sound/video).
  for (const m of kids(child(docXml, 'media')))
    diag.loss('XFL_MEDIA', 'Media library item (bitmap / sound / video) is not converted', 1, { ...docLoc, source: `<${m.name} name="${m.attrs.name ?? ''}">` });

  const scenes = kids(child(docXml, 'timelines'), 'DOMTimeline').map((t, i) => parseTimeline(t, diag, t.attrs.name ?? `Scene ${i + 1}`, 'scene'));
  if (!scenes.length) throw new Error('No timeline found in DOMDocument.xml.');

  let name = 'Untitled';
  for (const k of input.files.keys()) { const m = /^(?:.*\/)?([^/]+)\.xfl$/.exec(k); if (m) { name = m[1]; break; } }
  return {
    name, width, height, fps, background: docXml.attrs.backgroundColor ?? '#FFFFFF', scenes, symbols,
    sourceHash: hex(sha1(docBytes)), xflVersion: docXml.attrs.xflVersion, creator: docXml.attrs.creatorInfo,
  };
}
