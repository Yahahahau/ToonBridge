import { formatLocation, type DiagItem, type Severity } from './diagnostics';
import type { ProjectInfo } from './info';
import type { ValidationResult } from './tsproj/validator';

export type FeatureLevel = 'structure-verified' | 'experimental' | 'not-supported';
export interface FeatureStatus { feature: string; level: FeatureLevel; note: string; }

/**
 * Honest capability table. "structure-verified" = the written structure/fields match app-made
 * ToonSquid files AND are re-checked by the validator. NOTHING here is claimed as "confirmed
 * working inside the ToonSquid app": no generated file has been opened in the app yet.
 */
export const FEATURES: FeatureStatus[] = [
  { feature: '.tsproj file structure (stored ZIP + SQLite)', level: 'structure-verified', note: 'Every table schema matches app-made ToonSquid files and is re-checked by the validator.' },
  { feature: 'Vector Bézier paths, contours and holes (winding)', level: 'structure-verified', note: 'Node layout (p/i/o) matches the sample files; no visual comparison against Animate for fills with holes yet.' },
  { feature: 'Frame ranges (R4) and symbols as separate clips', level: 'structure-verified', note: 'Drawing s/e values are 1-based inclusive, as in the sample files.' },
  { feature: 'Instance transform (position / rotation / scale / flip)', level: 'experimental', note: 'Rotation direction was confirmed on shape layers from a reference file; applying it to clip layers is inferred.' },
  { feature: 'Motion tweens (baked per frame)', level: 'experimental', note: 'The easing formula is a model and has not been compared with Animate renders.' },
  { feature: 'Graphic symbol loop / play once / single frame; movie clips', level: 'experimental', note: 'Default: each animated symbol becomes ONE clip holding all its frames, played inside a symbol layer (the Time track sets the start frame); playback runs span one drawing. Movie clips play continuously across keyframes of the same instance. Re-rendering matches the snapshot mode pixel-for-pixel; the Time track semantics are not yet confirmed in the app. Snapshot mode (one still clip per frame) can be chosen in the UI.' },
  { feature: 'Skew', level: 'structure-verified', note: 'Default: baked into the paths (exact Animate geometry). Optional Perspective-effect mode: The effect structure (layer type 121, Ef, c0..c3) was read from an app-made sample. Corner space, normalisation and use on vector layers are not confirmed in the app. A "Bake into paths" mode is available as the more certain option.' },
  { feature: 'Seam hiding (anti-aliasing hairlines between touching fills)', level: 'experimental', note: 'Thin underlay strokes are drawn below fills: along edges shared by two fills, and along fill edges that are hidden under opaque fills on layers above (0.5px bleed, never on a visible edge). Also closes sub-0.5px gaps that exist in the source art. Not yet checked in the ToonSquid app; can be switched off.' },
  { feature: 'Layer and content stacking order (z-order)', level: 'experimental', note: 'Inferred from the Background position in lO and the order of ly.' },
  { feature: 'Strokes', level: 'experimental', note: 'jS/cS use 1/1, the only value seen in samples; their meaning is not decoded.' },
  { feature: 'Opening the file inside ToonSquid', level: 'experimental', note: 'No generated file has been opened in the app yet. Please test it on your device.' },
  { feature: 'Filters and blend modes', level: 'experimental', note: 'Blur -> Gaussian Blur, Adjust Color -> Adjustments, Drop Shadow/Glow -> Drop Shadow, blend modes by name; row layouts and bM numbers decoded from an app-made file. Placing them on symbol layers is inferred; blur radius scale not calibrated. Inner shadows/glows, bevels, tint and Invert/Alpha/Erase are reported as lost.' },
  { feature: 'Masks, gradient/bitmap fills, text, sound, shape tweens', level: 'not-supported', note: 'Not converted in V1. See the list of losses in this report.' },
  { feature: 'Legacy binary FLA (Flash 5 – CS4, OLE2)', level: 'not-supported', note: 'Detected (version, stream counts) and safely rejected with instructions: convert to XFL with Animate or JPEXS FLA Convert first. Tested only on CS4 files; no in-browser reader yet.' },
];

export interface Report {
  source: { fileName: string; zipMode: string; zipWarnings: string[] };
  project: ProjectInfo;
  stats: Record<string, number>;
  features: FeatureStatus[];
  diagnostics: DiagItem[];
  validation: ValidationResult;
  output: { bytes: number; sha1: string; clips: number };
  ok: boolean;
}

export function reportToText(r: Report): string {
  const L: string[] = [];
  L.push(`Conversion Report — ${r.project.name}`);
  L.push(`Source: ${r.source.fileName} (ZIP: ${r.source.zipMode})`);
  L.push(`Canvas ${r.project.width}x${r.project.height} @ ${r.project.fps} fps`);
  L.push(`Output: ${r.output.bytes} bytes, sha1 ${r.output.sha1}, ${r.output.clips} clips`);
  L.push(`Validation: ${r.validation.ok ? 'PASS' : 'FAIL'}`);
  for (const c of r.validation.checks) L.push(`  [${c.ok ? 'ok' : 'FAIL'}] ${c.category}${c.details.length ? ' — ' + c.details.slice(0, 5).join('; ') : ''}`);
  L.push('Stats: ' + Object.entries(r.stats).map(([k, v]) => `${k}=${v}`).join(', '));
  const s = diagSummary(r.diagnostics);
  L.push(`Diagnostics: ${s.loss.items} lost (${s.loss.affected} places), ${s.unsupported.items} unsupported (${s.unsupported.affected}), ${s.approx.items} approximated (${s.approx.affected}), ${s.warn.items} warnings (${s.warn.affected}), ${s.info.items} info`);
  for (const d of r.diagnostics) {
    L.push(`  [${d.severity}] ${d.code} ×${d.count}: ${d.message}`);
    if (d.severity === 'info') continue;   // info lines say how something was converted; locations would only add noise
    for (const l of d.locations) L.push(`      at ${formatLocation(l)}`);
    if (d.hiddenLocations) L.push(`      … and ${d.hiddenLocations} more location(s) not listed`);
  }
  L.push('Features:');
  for (const f of r.features) L.push(`  [${f.level}] ${f.feature} — ${f.note}`);
  return L.join('\n');
}

export interface DiagTotals { items: number; affected: number; }
/** Per severity: number of distinct diagnostics and total affected items. */
export function diagSummary(diags: DiagItem[]): Record<Severity, DiagTotals> {
  const out: Record<Severity, DiagTotals> = { loss: { items: 0, affected: 0 }, unsupported: { items: 0, affected: 0 }, approx: { items: 0, affected: 0 }, warn: { items: 0, affected: 0 }, info: { items: 0, affected: 0 } };
  for (const d of diags) { out[d.severity].items++; out[d.severity].affected += d.count; }
  return out;
}
