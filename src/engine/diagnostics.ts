// Collects everything that was not converted 1:1. Nothing is dropped silently (rule 6).
//
// Each diagnostic is grouped by (severity, code, message) and keeps the SOURCE LOCATIONS it was raised at
// (scene/symbol, layer, frame range, element). The same location is only counted once, so a problem that the
// resolver meets on every frame of a tween, or in several clip variants of one symbol, counts as ONE affected item.

/**
 * loss        = visible artwork or animation is missing or wrong in the output
 * unsupported = source information is detected and reported but not carried into the ToonSquid file
 * approx      = converted, but not exactly
 * warn        = something the user should check
 * info        = how a feature was converted (no loss)
 */
export type Severity = 'loss' | 'unsupported' | 'approx' | 'warn' | 'info';
/** Coarse level for UIs: error / warning / info. */
export type Level = 'error' | 'warning' | 'info';
export const LEVEL: Record<Severity, Level> = { loss: 'error', unsupported: 'warning', approx: 'warning', warn: 'warning', info: 'info' };

/** Where in the SOURCE (Animate) document a diagnostic applies. Frames are 1-based and inclusive, like Animate's timeline. */
export interface DiagLocation {
  /** Scene or library symbol name. */
  owner?: string;
  ownerKind?: 'scene' | 'symbol' | 'document' | 'page';   // page = a binary FLA stream (e.g. "S 75 1603754658")
  /** Layer name and its position in Animate's layer list (1 = top). */
  layer?: string;
  layerIndex?: number;
  frames?: [number, number];
  /** 1-based position of the element in its keyframe (stacking order, bottom first). */
  element?: number;
  /** Source XML element / attribute, e.g. `<DOMSymbolInstance loop="loop reverse">`. */
  source?: string;
}

/** Who raised it: ToonBridge itself, or an external converter whose report was imported (kept apart in reports). */
export type DiagOrigin = 'toonbridge' | 'jpexs';

export interface DiagItem {
  origin: DiagOrigin;
  severity: Severity;
  level: Level;
  code: string;
  message: string;
  /** True number of affected items (unique locations + unlocated occurrences). Never truncated. */
  count: number;
  /** Sorted source locations, at most LOCATION_LIMIT of them. */
  locations: DiagLocation[];
  /** Number of further locations that exist but are not listed. */
  hiddenLocations: number;
}

/** How many locations a single diagnostic lists. The count always stays exact. */
export const LOCATION_LIMIT = 25;

interface Entry { origin: DiagOrigin; severity: Severity; code: string; message: string; unlocated: number; locs: Map<string, DiagLocation>; }

const locKey = (l: DiagLocation) => JSON.stringify([l.ownerKind ?? '', l.owner ?? '', l.layerIndex ?? -1, l.layer ?? '', l.frames?.[0] ?? -1, l.frames?.[1] ?? -1, l.element ?? -1, l.source ?? '']);

function cmpLoc(a: DiagLocation, b: DiagLocation): number {
  const kind = (l: DiagLocation) => (l.ownerKind === 'document' ? 0 : l.ownerKind === 'scene' ? 1 : l.ownerKind === 'symbol' ? 2 : 3);
  return kind(a) - kind(b)
    || (a.owner ?? '').localeCompare(b.owner ?? '')
    || (a.layerIndex ?? -1) - (b.layerIndex ?? -1)
    || (a.frames?.[0] ?? -1) - (b.frames?.[0] ?? -1)
    || (a.frames?.[1] ?? -1) - (b.frames?.[1] ?? -1)
    || (a.element ?? -1) - (b.element ?? -1)
    || (a.source ?? '').localeCompare(b.source ?? '');
}

export class Diagnostics {
  private map = new Map<string, Entry>();
  add(severity: Severity, code: string, message: string, count = 1, loc?: DiagLocation, origin: DiagOrigin = 'toonbridge'): void {
    const key = `${origin}|${severity}|${code}|${message}`;
    let e = this.map.get(key);
    if (!e) { e = { origin, severity, code, message, unlocated: 0, locs: new Map() }; this.map.set(key, e); }
    if (loc) {
      const k = locKey(loc);
      if (!e.locs.has(k)) e.locs.set(k, { ...loc });
    } else e.unlocated += count;
  }
  loss(code: string, message: string, count = 1, loc?: DiagLocation) { this.add('loss', code, message, count, loc); }
  unsupported(code: string, message: string, count = 1, loc?: DiagLocation) { this.add('unsupported', code, message, count, loc); }
  approx(code: string, message: string, count = 1, loc?: DiagLocation) { this.add('approx', code, message, count, loc); }
  warn(code: string, message: string, count = 1, loc?: DiagLocation) { this.add('warn', code, message, count, loc); }
  info(code: string, message: string, count = 1, loc?: DiagLocation) { this.add('info', code, message, count, loc); }
  /** True when a diagnostic with this code was raised (any severity/message). */
  has(code: string): boolean { for (const e of this.map.values()) if (e.code === code) return true; return false; }
  items(limit = LOCATION_LIMIT): DiagItem[] {
    const order: Record<Severity, number> = { loss: 0, unsupported: 1, approx: 2, warn: 3, info: 4 };
    return [...this.map.values()]
      .map((e) => {
        const all = [...e.locs.values()].sort(cmpLoc);
        return { origin: e.origin, severity: e.severity, level: LEVEL[e.severity], code: e.code, message: e.message, count: e.unlocated + all.length, locations: all.slice(0, limit), hiddenLocations: Math.max(0, all.length - limit) };
      })
      .sort((a, b) => (a.origin === b.origin ? 0 : a.origin === 'toonbridge' ? -1 : 1) || order[a.severity] - order[b.severity] || a.code.localeCompare(b.code) || a.message.localeCompare(b.message));
  }
}

/** "Scene 1 › Layer 3 (#2) · frames 5–12 · element 1 · <source>" */
export function formatLocation(l: DiagLocation): string {
  const parts: string[] = [];
  const head = [l.owner ? `${l.ownerKind === 'symbol' ? 'Symbol' : l.ownerKind === 'scene' ? 'Scene' : l.ownerKind === 'page' ? 'FLA page' : ''} "${l.owner}"`.trim() : '', l.layer !== undefined ? `layer "${l.layer}"${l.layerIndex ? ` (#${l.layerIndex})` : ''}` : ''].filter(Boolean).join(' › ');
  if (head) parts.push(head);
  if (l.frames) parts.push(l.frames[0] === l.frames[1] ? `frame ${l.frames[0]}` : `frames ${l.frames[0]}–${l.frames[1]}`);
  if (l.element) parts.push(`element ${l.element}`);
  if (l.source) parts.push(l.source);
  return parts.join(' · ');
}
