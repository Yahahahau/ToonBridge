// R8 (skew): ToonSquid has no skew in its transform, but a Perspective effect moves the four
// corners of a layer's bounds. Observed in app-made files (Perspective_revert_engineer.tsproj):
//   effect row  = layers.type 121 {LI, Na:"Perspective", Id, V:3, LD, c0..c3:[x,y]}; owner layer has Ef:[effectId]
//   corner order c0..c3 = TL, TR, BL, BR (consistent across 4 test frames); values are displacements
//   normalised by the layer bounds (x by width, y by height).   <-- normalisation/space: experimental
import type { PerspectiveEffect } from '../resolver/model';
import type { Bounds } from './bounds';

/** Corner displacements for the local x-shear x' = x + h·y about the layer-local origin. */
export function shearEffect(b: Bounds, h: number): PerspectiveEffect | null {
  const w = b.maxX - b.minX, ht = b.maxY - b.minY;
  if (!(w > 1e-9) || !(ht > 1e-9)) return null;
  const dx = (y: number) => (h * y) / w;
  return { c: [[dx(b.minY), 0], [dx(b.minY), 0], [dx(b.maxY), 0], [dx(b.maxY), 0]] };
}

/** Inverse: which shear factor does an effect encode (only valid for pure x-shears). */
export function effectToShear(b: Bounds, e: PerspectiveEffect): number {
  const w = b.maxX - b.minX, ht = b.maxY - b.minY;
  return ((e.c[2][0] - e.c[0][0]) * w) / ht;
}
