import type { Matrix } from '../ir';

export const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

/** Result applies `m` first, then `outer`: p' = outer(m(p)). */
export function compose(outer: Matrix, m: Matrix): Matrix {
  return {
    a: outer.a * m.a + outer.c * m.b,
    b: outer.b * m.a + outer.d * m.b,
    c: outer.a * m.c + outer.c * m.d,
    d: outer.b * m.c + outer.d * m.d,
    tx: outer.a * m.tx + outer.c * m.ty + outer.tx,
    ty: outer.b * m.tx + outer.d * m.ty + outer.ty,
  };
}
export const apply = (m: Matrix, p: [number, number]): [number, number] =>
  [m.a * p[0] + m.c * p[1] + m.tx, m.b * p[0] + m.d * p[1] + m.ty];

export interface Decomposed { rot: number; sx: number; sy: number; skew: number; /** shear factor: M = R·S·[[1,h],[0,1]] */ h: number; }
/** R5: rot=atan2(b,a), sx=|(a,b)|, sy=det/sx, skew = dot of basis columns (residual, not representable). */
export function decompose(m: Matrix): Decomposed {
  const sx = Math.hypot(m.a, m.b);
  if (sx < 1e-12) {
    // Degenerate x basis: fall back to y basis for rotation.
    const sy0 = Math.hypot(m.c, m.d);
    return { rot: Math.atan2(-m.c, m.d), sx: 0, sy: sy0, skew: 0, h: 0 };
  }
  const rot = Math.atan2(m.b, m.a);
  const sy = (m.a * m.d - m.b * m.c) / sx;
  const skew = (m.a * m.c + m.b * m.d) / sx; // magnitude in pixels along x-axis direction per unit
  return { rot, sx, sy, skew, h: skew / sx };
}

/** Local x-shear A = [[1,h],[0,1]] as a matrix (x' = x + h·y). */
export const shearMatrix = (h: number): Matrix => ({ a: 1, b: 0, c: h, d: 1, tx: 0, ty: 0 });
