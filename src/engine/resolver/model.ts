// Writer-agnostic ToonSquid model produced by the resolver.
import type { RGBA } from '../ir';
import type { Contour } from '../geometry/contours';

export type VectorItem =
  | { kind: 'fill'; color: RGBA; contours: Contour[] }
  | { kind: 'stroke'; color: RGBA; width: number; contours: Contour[] };

export interface ClipRef { clipId: string; pv: [number, number]; p: [number, number]; rot: number; sx: number; sy: number; alpha: number; name: string; }

/** ToonSquid Perspective effect: corner displacements c0..c3 = TL, TR, BL, BR (normalised by layer bounds). */
export interface PerspectiveEffect { c: [[number, number], [number, number], [number, number], [number, number]]; }

export type Content =
  | { kind: 'vector'; name: string; items: VectorItem[]; effect?: PerspectiveEffect }
  | { kind: 'clip'; ref: ClipRef };

export interface TSDrawing { id: string; s: number; e: number; content: { id: string; c: Content }[]; }
export interface TSLayer { id: string; name: string; drawings: TSDrawing[]; }
export interface TSClip { id: string; name: string; isScene: boolean; layers: TSLayer[]; backgroundId: string; frames: number; }
export interface TSProject {
  id: string; name: string; width: number; height: number; fps: number;
  clips: TSClip[]; sceneIds: string[];
  stats: Record<string, number>;
}
