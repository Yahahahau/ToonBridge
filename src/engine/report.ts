import type { DiagItem } from './diagnostics';
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
  { feature: 'Graphic symbol loop / play once / single frame', level: 'experimental', note: 'Converted to one snapshot per frame instead of relying on nested clip playback; app behaviour not confirmed.' },
  { feature: 'Skew via the Perspective effect', level: 'experimental', note: 'The effect structure (layer type 121, Ef, c0..c3) was read from an app-made sample. Corner space, normalisation and use on vector layers are not confirmed in the app. A "Bake into paths" mode is available as the more certain option.' },
  { feature: 'Layer and content stacking order (z-order)', level: 'experimental', note: 'Inferred from the Background position in lO and the order of ly.' },
  { feature: 'Strokes', level: 'experimental', note: 'jS/cS use 1/1, the only value seen in samples; their meaning is not decoded.' },
  { feature: 'Opening the file inside ToonSquid', level: 'experimental', note: 'No generated file has been opened in the app yet. Please test it on your device.' },
  { feature: 'Blend modes, masks, gradient/bitmap fills, text, filters, sound, shape tweens', level: 'not-supported', note: 'Not converted in V1. See the list of losses in this report.' },
  { feature: 'Binary FLA (OLE2)', level: 'not-supported', note: 'Detected and reported, but no reader exists yet (V1).' },
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
  L.push('Diagnostics:');
  for (const d of r.diagnostics) L.push(`  [${d.severity}] ${d.code} ×${d.count}: ${d.message}`);
  L.push('Features:');
  for (const f of r.features) L.push(`  [${f.level}] ${f.feature} — ${f.note}`);
  return L.join('\n');
}
