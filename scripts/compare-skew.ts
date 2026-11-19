// Convert with each skew mode, render a frame from the written files, compare with the reference.
//   npx tsx scripts/compare-skew.ts in.fla outDir [frame...]
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { analyzeInput, convertAnalysis } from '../src/engine';
import type { SkewMode } from '../src/engine';
import { nodeSql } from '../tests/helpers';
import { loadDoc, renderReference } from './render-reference';
import { renderTsprojSvg } from './render-preview';

const [fla, outDir, ...frames] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const SQL = await nodeSql();
const doc = loadDoc(fla);
const modes: SkewMode[] = ['off', 'perspective', 'bake'];
const files: Record<string, string> = {};
for (const m of modes) {
  const a = analyzeInput(new Uint8Array(readFileSync(fla)), 'x');
  const r = convertAnalysis(a, SQL, undefined, { skewMode: m });
  files[m] = `${outDir}/${m}.tsproj`; writeFileSync(files[m], r.bytes);
  console.log(m, 'valid=', r.report.ok, 'clips=', r.report.output.clips, 'MB=', (r.bytes.length / 1048576).toFixed(1), 'skewedInst=', r.report.stats.skewedInstances, 'effects=', r.report.stats.perspectiveEffects, 'bakedShapes=', r.report.stats.bakedSkewShapes);
}
const sceneLen = Math.max(...doc.scenes[0].layers.flatMap((l) => l.frames.map((f) => f.index + f.duration)));
const candidates = frames.length ? frames.map(Number) : Array.from({ length: sceneLen }, (_, i) => i);
for (const f of candidates) {
  const ref = renderReference(doc, 0, f);
  if (!frames.length && (ref.skewed === 0 || ref.tweenedLayers > 0)) continue;
  console.log(`frame ${f + 1}: skewed instances in reference=${ref.skewed}, tween frames=${ref.tweenedLayers}`);
  writeFileSync(`${outDir}/ref_${f + 1}.svg`, ref.svg);
  execFileSync('rsvg-convert', ['-w', '960', `${outDir}/ref_${f + 1}.svg`, '-o', `${outDir}/ref_${f + 1}.png`]);
  for (const m of modes) {
    writeFileSync(`${outDir}/${m}_${f + 1}.svg`, await renderTsprojSvg(files[m], f + 1, true));
    execFileSync('rsvg-convert', ['-w', '960', `${outDir}/${m}_${f + 1}.svg`, '-o', `${outDir}/${m}_${f + 1}.png`]);
    const r = spawnSync('compare', ['-metric', 'MAE', `${outDir}/ref_${f + 1}.png`, `${outDir}/${m}_${f + 1}.png`, 'null:'], { encoding: 'utf8' });
    console.log(`   ${m.padEnd(11)} MAE vs reference = ${(r.stderr || '').trim()}`);
  }
}
