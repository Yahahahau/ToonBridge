// XFL reader: ZIP entries -> IR (Doc). Preserves everything it can; reports the rest.
import type { Diagnostics } from '../diagnostics';
import type { Doc, Element, EdgeRec, Frame, InstanceEl, Layer, Matrix, Paint, RGBA, ShapeEl, StrokeStyle, SymbolDef, Timeline, TweenInfo } from '../ir';
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

function parsePaint(n: XNode, diag: Diagnostics): Paint {
  const solid = child(n, 'SolidColor');
  if (solid) return { kind: 'solid', color: parseColor(solid.attrs.color, attrNum(solid, 'alpha', 1)) };
  for (const g of ['LinearGradient', 'RadialGradient']) {
    const gr = child(n, g);
    if (gr) {
      const e = kids(gr, 'GradientEntry')[0];
      diag.approx('XFL_GRADIENT', 'Gradient fills are not supported: replaced by the first gradient colour', 1);
      return { kind: 'unsupported', what: g, fallback: e ? parseColor(e.attrs.color, attrNum(e, 'alpha', 1)) : undefined };
    }
  }
  if (child(n, 'BitmapFill')) return { kind: 'unsupported', what: 'BitmapFill' };
  return { kind: 'unsupported', what: n.children[0]?.name ?? 'unknown fill' };
}

function parseShape(n: XNode, diag: Diagnostics): ShapeEl {
  const fills = new Map<number, Paint>();
  for (const fs of kids(child(n, 'fills'), 'FillStyle')) fills.set(attrNum(fs, 'index', 0), parsePaint(fs, diag));
  const strokes = new Map<number, StrokeStyle>();
  for (const ss of kids(child(n, 'strokes'), 'StrokeStyle')) {
    const sk = ss.children[0];
    if (!sk) continue;
    if (sk.name !== 'SolidStroke') diag.approx('XFL_STROKE_STYLE', `Stroke style ${sk.name} approximated as a solid stroke`, 1);
    const fillHolder = child(sk, 'fill');
    const paint: Paint = fillHolder ? parsePaint(fillHolder, diag) : { kind: 'solid', color: parseColor('#000000', 1) };
    strokes.set(attrNum(ss, 'index', 0), { paint, weight: attrNum(sk, 'weight', 1) });
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

function parseInstance(n: XNode, diag: Diagnostics): InstanceEl | null {
  const lib = n.attrs.libraryItemName;
  if (!lib) { diag.loss('XFL_INSTANCE_NOLIB', 'Symbol instance without libraryItemName skipped'); return null; }
  const st = n.attrs.symbolType;
  const symbolType = st === 'graphic' ? 'graphic' : st === 'button' ? 'button' : 'movie clip';
  const loopAttr = n.attrs.loop;
  const loop = loopAttr === 'play once' ? 'play once' : loopAttr === 'single frame' ? 'single frame' : 'loop';
  const tpn = child(child(n, 'transformationPoint') ?? ({ children: [] } as unknown as XNode), 'Point');
  const tp: [number, number] = tpn ? [attrNum(tpn, 'x', 0), attrNum(tpn, 'y', 0)] : [0, 0];
  let alpha = 1;
  const col = child(child(n, 'color') ?? ({ children: [] } as unknown as XNode), 'Color');
  if (col) {
    alpha = attrNum(col, 'alphaMultiplier', 1);
    const defaults: Record<string, number> = { alphaMultiplier: 1, redMultiplier: 1, greenMultiplier: 1, blueMultiplier: 1, alphaOffset: 0, redOffset: 0, greenOffset: 0, blueOffset: 0, brightness: 0, tintMultiplier: 0 };
    for (const [k, v] of Object.entries(col.attrs)) {
      if (k === 'alphaMultiplier') continue;
      if (k === 'tintColor') { if (col.attrs.tintMultiplier && Number(col.attrs.tintMultiplier) !== 0) diag.loss('XFL_COLOR_EFFECT', 'Tint colour effect on instances is not converted'); continue; }
      if (k in defaults && Number(v) !== defaults[k]) diag.loss('XFL_COLOR_EFFECT', `Colour effect "${k}" on instances is not converted`);
    }
  }
  if (child(n, 'filters')) diag.loss('XFL_FILTERS', 'Instance filters (blur/glow/...) are not converted');
  if (symbolType === 'movie clip') diag.approx('XFL_MOVIECLIP', 'Movie clip instances are treated like looping graphics from frame 1 (independent playback is not modelled)');
  if (symbolType === 'button') diag.approx('XFL_BUTTON', 'Button instances are frozen at their Up state (frame 1)');
  return {
    type: 'instance', lib, symbolType, matrix: parseMatrix(child(n, 'matrix')) ?? IDENTITY, tp, loop,
    firstFrame: attrNum(n, 'firstFrame', 0), blend: n.attrs.blendMode ?? 'normal', alpha,
  };
}

function parseElements(holder: XNode | undefined, diag: Diagnostics, outer?: Matrix): Element[] {
  const out: Element[] = [];
  for (const e of kids(holder)) {
    switch (e.name) {
      case 'DOMShape': { const s = parseShape(e, diag); out.push(outer ? applyMatrixToShape(s, outer) : s); break; }
      case 'DOMSymbolInstance': {
        const i = parseInstance(e, diag);
        if (i) out.push(outer ? { ...i, matrix: compose(outer, i.matrix) } : i);
        break;
      }
      case 'DOMGroup': {
        const gm = parseMatrix(child(e, 'matrix')) ?? IDENTITY;
        out.push(...parseElements(child(e, 'members'), diag, outer ? compose(outer, gm) : gm));
        break;
      }
      case 'DOMBitmapInstance': diag.loss('XFL_BITMAP', 'Bitmap instances are not converted (raster texture writing not implemented in V1)'); break;
      case 'DOMStaticText': case 'DOMDynamicText': case 'DOMInputText': case 'DOMTLFText':
        diag.loss('XFL_TEXT', 'Text elements are not converted'); break;
      case 'DOMVideoInstance': diag.loss('XFL_VIDEO', 'Video instances are not converted'); break;
      case 'DOMComponentInstance': case 'DOMCompiledClipInstance': diag.loss('XFL_COMPONENT', 'Component / compiled clip instances are not converted'); break;
      case 'DOMRectangleObject': case 'DOMOvalObject': diag.loss('XFL_PRIMITIVE', `${e.name} primitive object skipped (only its DOMShape twin is read)`); break;
      default: diag.loss('XFL_UNKNOWN_ELEMENT', `Unknown element <${e.name}> skipped`);
    }
  }
  return out;
}

function parseTween(f: XNode, diag: Diagnostics): TweenInfo | undefined {
  const tt = f.attrs.tweenType;
  const hasTweens = child(f, 'tweens');
  if (!tt && !hasTweens) {
    if (f.attrs.motionTweenSnap !== undefined || f.attrs.acceleration !== undefined) { /* legacy attrs without tweenType */ }
    return undefined;
  }
  const kind: TweenInfo['kind'] = tt === 'motion' ? 'motion' : tt === 'shape' ? 'shape' : 'other';
  let ease = attrNum(f, 'acceleration', 0);
  let custom = false;
  for (const t of kids(hasTweens)) {
    if (t.name === 'Ease') ease = attrNum(t, 'intensity', 0);
    else if (t.name === 'CustomEase') custom = true;
  }
  const rot = f.attrs.motionTweenRotate;
  const rotate: TweenInfo['rotate'] = rot === 'clockwise' ? 'clockwise' : rot === 'counter-clockwise' ? 'counter-clockwise' : rot === 'none' ? 'none' : 'auto';
  if (kind === 'other') diag.loss('XFL_TWEEN_KIND', `Tween type "${tt}" is not supported (held at start keyframe)`);
  return { kind, ease, customEase: custom, rotate, rotateTimes: attrNum(f, 'motionTweenRotateTimes', 0) };
}

function parseTimeline(tl: XNode, diag: Diagnostics): Timeline {
  const layers: Layer[] = [];
  for (const ln of kids(child(tl, 'layers'), 'DOMLayer')) {
    const lt = ln.attrs.layerType;
    const kind: Layer['kind'] = lt === 'guide' ? 'guide' : lt === 'mask' ? 'mask' : lt === 'folder' ? 'folder' : 'normal';
    const frames: Frame[] = [];
    for (const fn of kids(child(ln, 'frames'), 'DOMFrame')) {
      frames.push({
        index: attrNum(fn, 'index', 0),
        duration: Math.max(1, attrNum(fn, 'duration', 1)),
        tween: parseTween(fn, diag),
        elements: parseElements(child(fn, 'elements'), diag),
      });
    }
    frames.sort((a, b) => a.index - b.index);
    layers.push({ name: ln.attrs.name ?? '', kind, visible: ln.attrs.visible !== 'false', frames });
  }
  return { name: tl.attrs.name ?? '', layers };
}

export function parseXfl(input: XflInput, diag: Diagnostics): Doc {
  const root = findRoot(input.files);
  if (root === null) throw new Error('DOMDocument.xml not found. This is not an XFL project (or it is a binary FLA).');
  const docBytes = input.files.get(root + 'DOMDocument.xml')!;
  const docXml = parseXml(dec.decode(docBytes));
  if (docXml.name !== 'DOMDocument') throw new Error('DOMDocument.xml is invalid.');

  const width = attrNum(docXml, 'width', 550), height = attrNum(docXml, 'height', 400);
  let fps = 24;
  if (docXml.attrs.frameRate !== undefined) fps = attrNum(docXml, 'frameRate', 24);
  else diag.info('XFL_FPS_DEFAULT', 'DOMDocument has no frameRate attribute: XFL default 24 fps assumed');
  if (!Number.isFinite(fps) || fps <= 0) throw new Error('The project frame rate is invalid.');

  const symbols = new Map<string, SymbolDef>();
  for (const inc of kids(child(docXml, 'symbols'), 'Include')) {
    const href = inc.attrs.href;
    let bytes = input.files.get(`${root}LIBRARY/${href}`);
    if (!bytes) { try { bytes = input.files.get(`${root}LIBRARY/${decodeURIComponent(href)}`); } catch { /* ignore */ } }
    if (!bytes) { diag.loss('XFL_SYMBOL_MISSING', `Library file missing for symbol "${href}"`); continue; }
    const sx = parseXml(dec.decode(bytes));
    if (sx.name !== 'DOMSymbolItem') { diag.loss('XFL_SYMBOL_BAD', `Library file "${href}" is not a DOMSymbolItem`); continue; }
    const tl = child(child(sx, 'timeline') ?? ({ children: [] } as unknown as XNode), 'DOMTimeline');
    if (!tl) { diag.loss('XFL_SYMBOL_NOTIMELINE', `Symbol "${sx.attrs.name}" has no timeline`); continue; }
    const name = sx.attrs.name ?? href.replace(/\.xml$/, '');
    symbols.set(name, { name, symbolType: sx.attrs.symbolType ?? 'movie clip', timeline: parseTimeline(tl, diag) });
  }
  const media = kids(child(docXml, 'media'));
  if (media.length) diag.loss('XFL_MEDIA', `${media.length} media library item(s) (bitmaps/sounds/video) are not converted`, media.length);

  const scenes = kids(child(docXml, 'timelines'), 'DOMTimeline').map((t) => parseTimeline(t, diag));
  if (!scenes.length) throw new Error('No timeline found in DOMDocument.xml.');

  let name = 'Untitled';
  for (const k of input.files.keys()) { const m = /^(?:.*\/)?([^/]+)\.xfl$/.exec(k); if (m) { name = m[1]; break; } }
  return {
    name, width, height, fps, background: docXml.attrs.backgroundColor ?? '#FFFFFF', scenes, symbols,
    sourceHash: hex(sha1(docBytes)), xflVersion: docXml.attrs.xflVersion, creator: docXml.attrs.creatorInfo,
  };
}
