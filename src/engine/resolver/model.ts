// Writer-agnostic ToonSquid model produced by the resolver.
import type { RGBA } from '../ir';
import type { Contour } from '../geometry/contours';

export type VectorItem =
  | { kind: 'fill'; color: RGBA; contours: Contour[] }
  | { kind: 'stroke'; color: RGBA; width: number; contours: Contour[] };

/** ToonSquid effects written on a symbol layer (row types 100/101/104, fields decoded from an app-made file). */
export type TSEffect =
  | { kind: 'gaussianBlur'; r: number }
  | { kind: 'dropShadow'; r: number; os: [number, number]; c: { r: number; g: number; b: number } }
  | { kind: 'adjustments'; h: number; s: number; b: number; c: number };
export interface ClipRef { clipId: string; pv: [number, number]; p: [number, number]; rot: number; sx: number; sy: number; alpha: number; name: string; blend?: number; effects?: TSEffect[];
  /** Symbol layer "Time": 1-based clip frame at which playback starts in this drawing (K track "ti"). Default 1. */
  time?: number; }

/** ToonSquid Perspective effect: corner displacements c0..c3 = TL, TR, BL, BR (normalised by layer bounds). */
export interface PerspectiveEffect { c: [[number, number], [number, number], [number, number], [number, number]]; }

export type Content =
  | { kind: 'vector'; name: string; items: VectorItem[]; effect?: PerspectiveEffect }
  | { kind: 'clip'; ref: ClipRef };

export interface TSDrawing { id: string; s: number; e: number; content: { id: string; c: Content }[]; }
export interface TSLayer { id: string; name: string; drawings: TSDrawing[]; }
/** blendsInside: the clip holds blended content, so whoever shows it should isolate it (see resolver). */
export interface TSClip { id: string; name: string; isScene: boolean; layers: TSLayer[]; backgroundId: string; frames: number; blendsInside?: boolean; }
export interface TSProject {
  id: string; name: string; width: number; height: number; fps: number;
  clips: TSClip[]; sceneIds: string[];
  stats: Record<string, number>;
}
