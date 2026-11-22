// Compares one legacy FLA's timelines across the conversion chain, for every zero-length frame in the source:
//   source records (SourceTimelines.java JSON) -> JPEXS XFL (old) -> JPEXS XFL (patched) -> ToonBridge IR -> .tsproj clips.
// Usage: npx tsx scripts/audit/compare-timelines.ts <source.json> <old-xfl.zip> <patched-xfl.zip>
import { readFileSync } from 'node:fs';
import initSqlJs from 'sql.js';
import { analyzeInput, convertAnalysis } from '../../src/engine';
import type { Doc, Timeline } from '../../src/engine/ir';
import { timelineLength } from '../../src/engine/ir';

interface SFrame { start: number; duration: number; content: boolean; }
interface SPage { stream: string; role: string; name: string | null; layers: { name: string; frames: SFrame[] }[]; }
const [srcPath, oldZip, newZip] = process.argv.slice(2);
const source: SPage[] = JSON.parse(readFileSync(srcPath, 'utf8'));
const load = (p: string) => analyzeInput(new Uint8Array(readFileSync(p)), p);
const tl = (doc: Doc, page: SPage): Timeline | undefined => page.role === 'SCENE' ? doc.scenes.find((s) => s.name === page.name) ?? doc.scenes[0] : doc.symbols.get(page.name ?? '')?.timeline;
const firstContent = (fr: SFrame[]) => fr.find((f) => f.content)?.start;
const layerEnd = (fr: SFrame[]) => Math.max(0, ...fr.map((f) => f.start + Math.max(0, f.duration)));

const SQL = await initSqlJs();
const oldA = load(oldZip), newA = load(newZip);
const out = convertAnalysis(newA, SQL);
const rows: string[] = [];
let checked = 0, ok = 0, oldBad = 0, frameMismatch = 0;
for (const page of source) {
  if (page.role === 'UNLINKED') continue;
  const t0 = tl(oldA.doc, page), t1 = tl(newA.doc, page);
  if (!t1) continue;
  // Every keyframe that takes time must keep its start and duration (all pages, all layers, not only zero-frame ones).
  page.layers.forEach((sl, li) => {
    const expect = sl.frames.filter((f) => f.duration > 0).map((f) => `${f.start}+${f.duration}`).join(' ');
    const got = (t1.layers[li]?.frames ?? []).map((f) => `${f.index}+${f.duration}`).join(' ');
    if (expect !== got) { frameMismatch++; rows.push(`MISMATCH ${page.name} / ${sl.name}: source ${expect} | patched ${got}`); }
  });
  const srcLen = Math.max(0, ...page.layers.map((l) => layerEnd(l.frames)));
  page.layers.forEach((sl, li) => {
    const zf = sl.frames.filter((f) => f.duration <= 0);
    if (!zf.length) return;
    checked++;
    const src = firstContent(sl.frames);
    const o = t0?.layers[li]?.frames.find((f) => f.elements.length)?.index;
    const p = t1.layers[li]?.frames.find((f) => f.elements.length)?.index;
    const oEnd = t0 ? Math.max(...t0.layers[li].frames.map((f) => f.index + f.duration)) : NaN;
    const pEnd = Math.max(...t1.layers[li].frames.map((f) => f.index + f.duration));
    // Final .tsproj: the symbol's full clip (native playback) and this layer's first drawing.
    const clip = out.project.clips.find((c) => c.name === (page.name ?? '').split('/').pop() && c.frames > 1) ?? out.project.clips.find((c) => c.name === page.name);
    const cl = clip?.layers.find((l) => l.name === sl.name);
    const ts = cl?.drawings[0]?.s;
    const good = src === p && pEnd === layerEnd(sl.frames) && (ts === undefined || ts === (src ?? 0) + 1) && (!clip || clip.frames === (timelineLength(t1) || srcLen));
    if (o !== src) oldBad++;
    if (good) ok++;
    rows.push(`${good ? 'OK ' : 'BAD'} ${page.name} / ${sl.name}: zero-length frames ${zf.length} · first art at frame ${src! + 1} (source) | old JPEXS ${o! + 1} | patched ${p! + 1} | .tsproj drawing ${ts ?? '-'} · layer end source ${layerEnd(sl.frames)} | old ${oEnd} | patched ${pEnd} · clip frames ${clip?.frames ?? '-'} (source ${srcLen})`);
  });
}
console.log(rows.join('\n'));
console.log(`\nlayers with zero-length frames: ${checked}; correct after patch: ${ok}; wrong in old JPEXS output: ${oldBad}; keyframe start/duration mismatches vs source (all layers): ${frameMismatch}; tsproj valid: ${out.report.validation.ok}`);
