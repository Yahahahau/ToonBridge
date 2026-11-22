// Input format detection by content signature (never by file extension).
import { CfbError, CfbFile, CFB_SIGNATURE } from './cfb';

export type InputFormat =
  | { kind: 'zip' }                                   // ZIP-based FLA (CS5+) or zipped XFL folder
  | { kind: 'xfl-entry' }                             // the small *.xfl entry file of an uncompressed XFL folder, alone
  | { kind: 'legacy-fla'; info: LegacyFlaInfo }       // OLE2 binary FLA (Flash 1 – CS4)
  | { kind: 'ole2-other'; reason: string }            // OLE2, but not a Flash document (e.g. a .doc)
  | { kind: 'corrupt'; reason: string }               // OLE2 signature but unreadable container
  | { kind: 'unknown' };

/** `Contents` stream revision -> authoring version (values from jpexs-fla-convert FLA_VERSION_DIFF.md, verified on samples there). */
const CONTENTS_VERSION: Record<number, string> = {
  0x10: 'FutureSplash / Flash 1', 0x11: 'Flash 2', 0x14: 'Flash 3', 0x1b: 'Flash 4', 0x20: 'Flash 5', 0x29: 'Flash MX',
  0x38: 'Flash MX 2004', 0x3f: 'Flash 8', 0x43: 'Flash CS3', 0x47: 'Flash CS4',
};

export interface LegacyFlaInfo {
  contentsRevision: number;
  version: string;                 // e.g. "Flash CS4", or "unknown (0x..)"
  streamNaming: 'cs3-cs4' | 'classic' | 'mixed';
  counts: { pages: number; symbols: number; media: number; other: number };
  streams: number;
  contentsBytes: number;
  totalStreamBytes: number;
}

const startsWith = (b: Uint8Array, sig: number[]) => b.length >= sig.length && sig.every((x, i) => b[i] === x);

export function detectInput(bytes: Uint8Array): InputFormat {
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) return { kind: 'zip' };
  if (startsWith(bytes, CFB_SIGNATURE)) {
    let cfb: CfbFile;
    try { cfb = new CfbFile(bytes); } catch (e) { return { kind: 'corrupt', reason: e instanceof CfbError ? e.message : 'Unreadable OLE2 container.' }; }
    const streams = cfb.streams();
    const contents = streams.find((s) => s.path === 'Contents');
    if (!contents) return { kind: 'ole2-other', reason: 'OLE2 file without a "Contents" stream: not a Flash document.' };
    let data: Uint8Array;
    try { data = cfb.read('Contents'); } catch (e) { return { kind: 'corrupt', reason: (e as Error).message }; }
    const rev = data[0];
    const counts = { pages: 0, symbols: 0, media: 0, other: 0 };
    let cs = 0, classic = 0;
    for (const s of streams) {
      if (s.path === 'Contents') continue;
      if (/^P \d+ \d+$/.test(s.path)) { counts.pages++; cs++; } else if (/^S \d+ \d+$/.test(s.path)) { counts.symbols++; cs++; } else if (/^M \d+ \d+$/.test(s.path)) { counts.media++; cs++; }
      else if (/^Page \d+$/.test(s.path)) { counts.pages++; classic++; } else if (/^Symbol \d+$/.test(s.path)) { counts.symbols++; classic++; } else if (/^Media \d+$/.test(s.path)) { counts.media++; classic++; }
      else counts.other++;
    }
    return {
      kind: 'legacy-fla',
      info: {
        contentsRevision: rev, version: CONTENTS_VERSION[rev] ?? `unknown (0x${rev.toString(16)})`,
        streamNaming: cs && classic ? 'mixed' : cs ? 'cs3-cs4' : 'classic', counts, streams: streams.length,
        contentsBytes: data.length, totalStreamBytes: streams.reduce((n, s) => n + s.size, 0)
      },
    };
  }
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 32));
  if (/^PROXY-CS5/.test(head)) return { kind: 'xfl-entry' };
  return { kind: 'unknown' };
}
