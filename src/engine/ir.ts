// Intermediate representation (format-neutral).
import type { Seg } from './xfl/edges';
import type { AnimateFilter, ColorEffect } from './effects/plan';

export interface Matrix { a: number; b: number; c: number; d: number; tx: number; ty: number; }
export interface RGBA { r: number; g: number; b: number; a: number; } // 0..1

export type Paint = { kind: 'solid'; color: RGBA } | { kind: 'unsupported'; what: string; fallback?: RGBA };
/** Source stroke settings kept for later phases (not converted yet; see STROKE_* diagnostics). */
export interface StrokeMeta { caps?: string; joints?: string; miterLimit?: number; scaleMode?: string; hairline?: boolean; }
export interface StrokeStyle { paint: Paint; weight: number; meta?: StrokeMeta; }

export interface EdgeRec { segs: Seg[]; fill0?: number; fill1?: number; stroke?: number; }
export interface ShapeEl {
  type: 'shape';
  edges: EdgeRec[];
  fills: Map<number, Paint>;
  strokes: Map<number, StrokeStyle>;
  matrix?: Matrix; // DOMShape/DOMGroup matrix (applied to coordinates)
  /** Set when this shape came from a flattened DOMGroup: shapes of the same group share the id (metadata only). */
  group?: number;
}
export type LoopMode = 'loop' | 'play once' | 'single frame';
export interface InstanceEl {
  type: 'instance';
  lib: string;
  symbolType: 'graphic' | 'movie clip' | 'button';
  matrix: Matrix;
  tp: [number, number];
  loop: LoopMode;
  firstFrame: number;
  blend: string;
  alpha: number;
  filters: AnimateFilter[];
  colorFx?: ColorEffect;
  /** Metadata kept from the source, not converted yet (reported as diagnostics). */
  loopSource?: string;          // raw `loop` attribute (e.g. "loop reverse")
  lastFrame?: number;           // graphic loop range end (0-based)
  hidden?: boolean;             // isVisible="false"
  has3D?: boolean;              // Matrix3D / rotationX / rotationY / z
  hasScript?: boolean;          // AS2 instance script present (never executed)
}
export type Element = ShapeEl | InstanceEl;

export interface TweenInfo {
  kind: 'motion' | 'shape' | 'other';
  ease: number;            // -100..100 (Animate "Ease")
  customEase: boolean;
  rotate: 'none' | 'auto' | 'clockwise' | 'counter-clockwise';
  rotateTimes: number;
  /** Source tween options kept as metadata (motionTweenScale / OrientToPath / Snap). */
  scale?: boolean;
  orientToPath?: boolean;
  snap?: boolean;
}
export interface FrameLabel { name: string; type: string; }
export interface FrameSound { name: string; sync: string; loopMode?: string; loops?: number; inPoint?: number; outPoint?: number; }
export interface Frame {
  index: number; duration: number; tween?: TweenInfo; elements: Element[];
  /** Metadata kept from the source, not converted yet. */
  label?: FrameLabel;
  sound?: FrameSound;
  hasScript?: boolean;          // frame ActionScript present (never executed, content not kept)
  zeroDuration?: boolean;       // duration="0" in the source
}
export interface Layer {
  name: string;
  kind: 'normal' | 'guide' | 'mask' | 'folder';
  visible: boolean;
  frames: Frame[];
  /** Position in Animate's layer list (0 = top) and source metadata. */
  index?: number;
  locked?: boolean;
  outline?: boolean;
  parentIndex?: number;         // parentLayerIndex: folder, mask or motion guide this layer belongs to
  animationType?: string;       // "motion object" / "IK pose"
}
export interface Timeline { name: string; layers: Layer[]; }
export interface SymbolDef { name: string; symbolType: string; timeline: Timeline; }

export interface Doc {
  name: string;
  width: number;
  height: number;
  fps: number;
  background: string;
  scenes: Timeline[];
  symbols: Map<string, SymbolDef>;
  sourceHash: string;
  xflVersion?: string;
  creator?: string;
}

export function timelineLength(t: Timeline): number {
  let n = 0;
  for (const l of t.layers) for (const f of l.frames) n = Math.max(n, f.index + f.duration);
  return n;
}
