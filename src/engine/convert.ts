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

const isCfb = (b: Uint8Array) => [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((v, i) => b[i] === v);
const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b;

export type { SkewMode };
export class UnsupportedInputError extends Error {}

/** Reader stage: bytes -> IR. Throws UnsupportedInputError / Error with a user-readable English message. */
export function analyzeInput(bytes: Uint8Array, fileName: string): Analysis {
  if (isCfb(bytes)) {
    throw new UnsupportedInputError('This is a binary FLA (OLE2) file, which isn\'t supported yet. In Animate, choose File ▸ Save As ▸ "Animate Uncompressed Document (*.xfl)", zip the XFL folder, and import the ZIP.');
  }
  if (!isZip(bytes)) throw new UnsupportedInputError('Unsupported file type. Import a ZIP of an XFL project, or a ZIP-based .fla.');
  const zip = readZipTolerant(bytes);
  const diag = new Diagnostics();
  for (const w of zip.warnings) diag.warn('ZIP', w);
  const doc = parseXfl({ files: zip.entries }, diag);
  return { fileName, doc, diag, info: describeDoc(doc), zipMode: zip.mode, zipWarnings: zip.warnings };
}

export interface ConvertOptions { seamUnderlay?: boolean; skewMode?: SkewMode; }

/** The pipeline as a generator: yields the name of each stage before running it, so a UI can paint between stages. */
function* convertSteps(a: Analysis, SQL: SqlJsStatic, options: ConvertOptions): Generator<string, ConvertOutput, void> {
  yield 'resolve';
  const project = new Resolver(a.doc, a.diag, { skewMode: options.skewMode ?? 'perspective', seamUnderlay: options.seamUnderlay ?? true }).run();
  yield 'write';
  const bytes = writeTsproj(SQL, project);
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
