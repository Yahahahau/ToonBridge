// Intermediate representation (format-neutral).
import type { Seg } from './xfl/edges';

export interface Matrix { a: number; b: number; c: number; d: number; tx: number; ty: number; }
export interface RGBA { r: number; g: number; b: number; a: number; } // 0..1

export type Paint = { kind: 'solid'; color: RGBA } | { kind: 'unsupported'; what: string; fallback?: RGBA };
export interface StrokeStyle { paint: Paint; weight: number; }

export interface EdgeRec { segs: Seg[]; fill0?: number; fill1?: number; stroke?: number; }
export interface ShapeEl {
  type: 'shape';
  edges: EdgeRec[];
  fills: Map<number, Paint>;
  strokes: Map<number, StrokeStyle>;
  matrix?: Matrix; // DOMShape/DOMGroup matrix (applied to coordinates)
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
}
export type Element = ShapeEl | InstanceEl;

export interface TweenInfo {
  kind: 'motion' | 'shape' | 'other';
  ease: number;            // -100..100 (Animate "Ease")
  customEase: boolean;
  rotate: 'none' | 'auto' | 'clockwise' | 'counter-clockwise';
  rotateTimes: number;
}
export interface Frame { index: number; duration: number; tween?: TweenInfo; elements: Element[]; }
export interface Layer {
  name: string;
  kind: 'normal' | 'guide' | 'mask' | 'folder';
  visible: boolean;
  frames: Frame[];
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
