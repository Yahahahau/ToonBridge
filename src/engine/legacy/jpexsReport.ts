// Imports the `conversion-report.txt` that JPEXS FLA Convert writes next to an XFL it exported from a binary FLA,
// so the legacy converter's own losses show up in the ToonBridge report. The file is untrusted text: it is only
// matched line by line with fixed patterns, sizes are capped, and nothing in it is executed.
//
// Line format (JPEXS XflExportIssue.toString):  CODE [stream:offset]: message
// The ToonBridge-patched JPEXS (third_party/jpexs-fla-convert) appends `outcome=…; timeline="…"; layer="…"; frame=N`.
import type { Diagnostics, DiagLocation, Severity } from '../diagnostics';

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_LINES = 50_000;
const LINE = /^([A-Z][A-Z0-9_]{1,63}) \[([^\]]{0,200}):(\d{1,12})\]: (.{0,4000})$/;
const HEADER = 'Binary FLA to XFL';

/** key="value" or key=value fields that the patched JPEXS appends after the sentence. */
function fields(msg: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of msg.matchAll(/(\w{1,32})=(?:"((?:[^"\\]|\\.){0,400})"|([^;\s]{1,64}))/g)) out[m[1]] = (m[2] ?? m[3] ?? '').replace(/\\(.)/g, '$1');
  return out;
}
const sentence = (msg: string) => msg.replace(/\s*outcome=.*$/, '').trim();

export interface JpexsImport { found: boolean; lines: number; imported: number; }

/**
 * Finds `conversion-report.txt` in the same folder as DOMDocument.xml and adds its items to `diag` with origin "jpexs".
 * `isScene(name)` tells whether a timeline name is a scene (otherwise a symbol).
 */
export function importJpexsReport(files: Map<string, Uint8Array>, diag: Diagnostics, isScene: (name: string) => boolean): JpexsImport {
  let root: string | null = null;
  for (const k of files.keys()) if (k === 'DOMDocument.xml' || k.endsWith('/DOMDocument.xml')) { const r = k.slice(0, -'DOMDocument.xml'.length); if (root === null || r.length < root.length) root = r; }
  const bytes = root === null ? undefined : files.get(`${root}conversion-report.txt`);
  if (!bytes) return { found: false, lines: 0, imported: 0 };
  const docLoc: DiagLocation = { ownerKind: 'document', owner: 'conversion-report.txt' };
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, MAX_BYTES));
  const lines = text.split(/\r?\n/);
  if (!lines[0]?.startsWith(HEADER)) {
    diag.add('info', 'JPEXS_REPORT_UNKNOWN', 'A conversion-report.txt was found but it is not a JPEXS FLA Convert report: ignored', 1, docLoc, 'jpexs');
    return { found: true, lines: 0, imported: 0 };
  }
  let imported = 0;
  if (bytes.length > MAX_BYTES || lines.length > MAX_LINES) diag.add('warn', 'JPEXS_REPORT_TRUNCATED', 'The legacy converter report is very large: only its first part was imported', 1, docLoc, 'jpexs');
  for (const raw of lines.slice(1, MAX_LINES)) {
    const m = LINE.exec(raw.trim());
    if (!m) continue;
    const [, code, stream, offset, msg] = m;
    const f = fields(msg);
    const at: DiagLocation = { ownerKind: stream === 'Contents' ? 'document' : 'page', owner: stream, source: `JPEXS ${code} [${stream}:${offset}]` };
    if (f.timeline) { at.owner = f.timeline; at.ownerKind = isScene(f.timeline) ? 'scene' : 'symbol'; }
    if (f.layer) at.layer = f.layer;
    if (f.frame && /^\d+$/.test(f.frame)) at.frames = [Number(f.frame), Number(f.frame)];
    const add = (sev: Severity, c: string, message: string, loc: DiagLocation = at) => { diag.add(sev, c, message, 1, loc, 'jpexs'); imported++; };
    switch (code) {
      case 'FRAME_DURATION':
        if (f.outcome === 'skipped') add('info', 'JPEXS_FRAME_DURATION', 'Empty zero-length keyframe omitted by the legacy converter; later keyframes keep their original timing (outcome: skipped, nothing visible removed)');
        else if (f.outcome === 'modified') add('warn', 'JPEXS_FRAME_DURATION', 'Zero-length keyframe with content kept as one frame by the legacy converter; later keyframes on this layer start one frame later than in the source (outcome: modified)');
        else add('loss', 'JPEXS_FRAME_DURATION', 'Unpatched JPEXS widened a zero-length frame to one frame: later keyframes on this layer are probably one frame late (outcome: modified). Re-export with the patched JPEXS from third_party/jpexs-fla-convert', at);
        break;
      case 'UNLINKED_PAGE':
        add('unsupported', 'JPEXS_UNLINKED_PAGE', 'Library page not linked to any symbol or scene was skipped by the legacy converter (outcome: skipped; most likely a deleted symbol)', { ...at, source: `${at.source}${f.layers ? ` · ${f.layers} layer(s), ${f.keyframes} keyframe(s), ${f.frames} frame(s), ${f.objects} object(s)` : ''}` });
        break;
      case 'EXPORT_SCOPE': case 'PUBLISH_PROPERTY':
        add('info', `JPEXS_${code}`, code === 'EXPORT_SCOPE' ? 'The legacy converter marks its binary FLA → XFL export as experimental' : 'Publish setting not mapped by the legacy converter (publish settings are not used by ToonBridge)', { ...at, source: `${at.source} · ${sentence(msg)}` });
        break;
      default:
        add('warn', `JPEXS_${code}`, 'Reported by the legacy converter (JPEXS); its text is in the location (outcome: see text)', { ...at, source: `${at.source} · ${sentence(msg)}` });
    }
  }
  return { found: true, lines: lines.length, imported };
}
