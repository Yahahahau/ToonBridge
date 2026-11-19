// Dev/CI helper: convert a real XFL zip from the command line.
//   npx tsx scripts/convert-cli.ts in.fla out.tsproj
import { readFileSync, writeFileSync } from 'node:fs';
import { analyzeInput, convertAnalysis, reportToText } from '../src/engine';
import { nodeSql } from '../tests/helpers';

const [inp, out] = process.argv.slice(2);
const SQL = await nodeSql();
const t0 = Date.now();
const a = analyzeInput(new Uint8Array(readFileSync(inp)), inp.split('/').pop()!);
const r = convertAnalysis(a, SQL);
writeFileSync(out, r.bytes);
console.log(reportToText(r.report));
console.log(`done in ${Date.now() - t0} ms`);
