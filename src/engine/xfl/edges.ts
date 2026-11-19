// R1 + R2: XFL edge strings -> cubic Bézier segments in pixels.
import type { Diagnostics } from '../diagnostics';

export type Pt = [number, number];
export interface Seg { p0: Pt; c1: Pt; c2: Pt; p3: Pt; }

const TWIPS = 20;

/** R1: number syntax: decimal, or "#HEX.FF" = signed 24-bit integer + 8-bit fraction (twips). */
export function parseNum(s: string): number {
  if (s.startsWith('#')) {
    const [a, b = ''] = s.slice(1).split('.');
    let v = parseInt(a, 16);
    if (v >= 0x800000) v -= 1 << 24;
    const fr = b ? parseInt(b, 16) / 256 : 0;
    return v >= 0 ? v + fr : v - fr;
  }
  return Number(s);
}
const px = (n: number) => n / TWIPS;

const ARGC: Record<string, number> = { '!': 2, '|': 2, '[': 4, ']': 4, '/': 2, S: 1 };

/** Parse a legacy `edges` string (move/line/quad). Quad -> cubic (R2). */
export function parseEdgesAttr(e: string, diag: Diagnostics): Seg[] {
  const parts = e.match(/[!|[\]/S]|[^\s!|[\]/S]+/g) ?? [];
  const segs: Seg[] = [];
  let cur: Pt = [0, 0];
  let i = 0;
  while (i < parts.length) {
    const cmd = parts[i];
    if (!(cmd in ARGC)) { diag.warn('XFL_EDGE_TOKEN', 'Unexpected token in edges string ignored'); i++; continue; }
    const args: number[] = [];
    i++;
    while (i < parts.length && !(parts[i] in ARGC) && args.length < ARGC[cmd]) args.push(px(parseNum(parts[i++])));
    if (args.length < ARGC[cmd]) { diag.warn('XFL_EDGE_SHORT', 'Edge command with missing arguments ignored'); continue; }
    if (cmd === '!') cur = [args[0], args[1]];
    else if (cmd === '|') { const p3: Pt = [args[0], args[1]]; segs.push({ p0: cur, c1: cur, c2: p3, p3 }); cur = p3; }
    else if (cmd === '[' || cmd === ']') {
      const q: Pt = [args[0], args[1]], p3: Pt = [args[2], args[3]];
      segs.push({
        p0: cur, p3,
        c1: [cur[0] + (2 / 3) * (q[0] - cur[0]), cur[1] + (2 / 3) * (q[1] - cur[1])],
        c2: [p3[0] + (2 / 3) * (q[0] - p3[0]), p3[1] + (2 / 3) * (q[1] - p3[1])],
      });
      cur = p3;
      if (cmd === ']') diag.warn('XFL_EDGE_BRACKET', "Edge command ']' treated like '[' (not verified in sample files)");
    } else if (cmd === '/') {
      diag.loss('XFL_EDGE_SLASH', "Edge command '/' not understood; segment skipped");
    } // 'S' = style-change marker: carries no geometry
  }
  return segs;
}

/**
 * Parse the `cubics` attribute. Observed grammar (all 55,563 samples):
 *   !sx sy ( [x,y] ; c1x,c1y c2x,c2y ex,ey  (q|Q|p ... quadratic approximation)  ) [x,y] ;
 * Exactly one cubic per Edge. The q/Q/p approximation tail is a legacy fallback and is ignored.
 */
export function parseCubicsAttr(c: string, diag: Diagnostics): Seg[] {
  const m = /^!\s*(\S+)\s+(\S+?)\s*\(\s*(?:[^;]*?)\s*;\s*(\S+?),(\S+?)\s+(\S+?),(\S+?)\s+(\S+?),(\S+?)\s*(?:[qQp)])/.exec(c);
  if (!m) { diag.loss('XFL_CUBIC_PARSE', 'Unparseable cubics attribute; edge skipped'); return []; }
  const n = (k: number) => px(parseNum(m[k]));
  const p0: Pt = [n(1), n(2)];
  const seg: Seg = { p0, c1: [n(3), n(4)], c2: [n(5), n(6)], p3: [n(7), n(8)] };
  if ([...seg.p0, ...seg.c1, ...seg.c2, ...seg.p3].some((v) => !Number.isFinite(v))) {
    diag.loss('XFL_CUBIC_PARSE', 'Non-finite cubic coordinate; edge skipped'); return [];
  }
  return [seg];
}

/** R2: prefer exact cubics when present, otherwise legacy edges with quad->cubic. */
export function parseEdge(edges: string | undefined, cubics: string | undefined, diag: Diagnostics): Seg[] {
  if (cubics) return parseCubicsAttr(cubics, diag);
  if (edges) return parseEdgesAttr(edges, diag);
  return [];
}
