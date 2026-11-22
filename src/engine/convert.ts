// Public pipeline: Reader -> IR -> Resolver -> Writer -> Validator.
import type { SqlJsStatic } from 'sql.js';
import { Diagnostics } from './diagnostics';
import type { Doc } from './ir';
import { describeDoc, type ProjectInfo } from './info';
import { FEATURES, type Report } from './report';
import { Resolver, type SkewMode } from './resolver/resolver';
import type { TSProject } from './resolver/model';
import { writeTsproj } from './tsproj/writer';
import { validateTsproj } from './tsproj/validator';
import { hex, sha1 } from './util';
import { parseXfl } from './xfl/parse';
import { readZipTolerant } from './zip/reader';

export interface Analysis { fileName: string; doc: Doc; diag: Diagnostics; info: ProjectInfo; zipMode: string; zipWarnings: string[]; }
export interface ConvertOutput { bytes: Uint8Array; fileName: string; report: Report; project: TSProject; }

import { detectInput, type LegacyFlaInfo } from './legacy/detect';

export type { SkewMode };
export class UnsupportedInputError extends Error {}
/** A legacy binary FLA was recognised. `info` describes it; it is not converted in the browser yet (see README "Legacy binary FLA"). */
export class LegacyFlaError extends UnsupportedInputError { constructor(msg: string, readonly info: LegacyFlaInfo) { super(msg); } }

/** Reader stage: bytes -> IR. Throws UnsupportedInputError / Error with a user-readable English message. */
export function analyzeInput(bytes: Uint8Array, fileName: string): Analysis {
  const fmt = detectInput(bytes);
  if (fmt.kind === 'legacy-fla') {
    const i = fmt.info;
    throw new LegacyFlaError(`This is a ${i.version} binary FLA (${i.counts.symbols} symbols, ${i.counts.pages} scene page${i.counts.pages === 1 ? '' : 's'}). Binary FLA can't be converted in the browser yet. Convert it to XFL first: open and save it in Animate, or use JPEXS FLA Convert ("convert --format CS6 --container xfl"), then zip the XFL folder and import the ZIP.`, i);
  }
  if (fmt.kind === 'corrupt') throw new UnsupportedInputError(`This looks like a binary FLA, but the file is damaged: ${fmt.reason}`);
  if (fmt.kind === 'ole2-other') throw new UnsupportedInputError(`Not a Flash file: ${fmt.reason}`);
  if (fmt.kind === 'xfl-entry') throw new UnsupportedInputError('This is only the small .xfl entry file. Zip the whole XFL folder (with DOMDocument.xml and LIBRARY) and import the ZIP.');
  if (fmt.kind !== 'zip') throw new UnsupportedInputError('Unsupported file type. Import a ZIP of an XFL project, or a ZIP-based .fla.');
  const zip = readZipTolerant(bytes);
  const diag = new Diagnostics();
  for (const w of zip.warnings) diag.warn('ZIP', w);
  const doc = parseXfl({ files: zip.entries }, diag);
  return { fileName, doc, diag, info: describeDoc(doc), zipMode: zip.mode, zipWarnings: zip.warnings };
}

export interface ConvertOptions { symbolPlayback?: 'native' | 'snapshot'; seamUnderlay?: boolean; skewMode?: SkewMode; }

/** The pipeline as a generator: yields the name of each stage before running it, so a UI can paint between stages. */
function* convertSteps(a: Analysis, SQL: SqlJsStatic, options: ConvertOptions): Generator<string, ConvertOutput, void> {
  yield 'resolve';
  const project = new Resolver(a.doc, a.diag, { skewMode: options.skewMode ?? 'bake', seamUnderlay: options.seamUnderlay ?? true, symbolPlayback: options.symbolPlayback ?? 'native' }).run();
  yield 'write';
  const bytes = writeTsproj(SQL, project);
  a.diag.info('OUTPUT_NO_THUMBNAILS', 'Library thumbnails are not written (app-made files contain them; ToonSquid may show empty previews until it redraws them)', 1, { ownerKind: 'document', owner: 'output .tsproj', source: 'Thumbnails/*.png' });
  yield 'validate';
  const validation = validateTsproj(SQL, bytes);
  const report: Report = {
    source: { fileName: a.fileName, zipMode: a.zipMode, zipWarnings: a.zipWarnings },
    project: a.info, stats: project.stats, features: FEATURES, diagnostics: a.diag.items(), validation,
    output: { bytes: bytes.length, sha1: hex(sha1(bytes)), clips: project.clips.length }, ok: validation.ok,
  };
  const base = (a.doc.name || 'project').replace(/[^\w\-. ]+/g, '_');
  return { bytes, fileName: `${base}.tsproj`, report, project };
}

export function convertAnalysis(a: Analysis, SQL: SqlJsStatic, onStage?: (s: string) => void, options: ConvertOptions = {}): ConvertOutput {
  const it = convertSteps(a, SQL, options);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
    onStage?.(r.value);
  }
}

/** Same pipeline and same output, but waits for `yieldToUi` before each stage (lets the browser paint real progress). */
export async function convertAnalysisAsync(a: Analysis, SQL: SqlJsStatic, onStage: (s: string) => void, yieldToUi: () => Promise<void>, options: ConvertOptions = {}): Promise<ConvertOutput> {
  const it = convertSteps(a, SQL, options);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
    onStage(r.value);
    await yieldToUi();
  }
}
