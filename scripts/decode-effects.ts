// Decodes ToonSquid effect / blend-mode encodings from an app-made "probe" project.
// Name each layer in ToonSquid like "BM Add", "BM Hard Light", "FX Blur", "FX Adjust", "FX Shadow", ... and apply that
// blend mode / effect to it. This prints, per named layer: its type, bM value, and every effect layer it points to (Ef)
// with all fields, so the encoding can be read off directly.
//   npx tsx scripts/decode-effects.ts probe.tsproj
import { readFileSync } from 'node:fs';
import { readZipTolerant } from '../src/engine/zip/reader';
import { nodeSql } from '../tests/helpers';

const SQL = await nodeSql();
const z = readZipTolerant(new Uint8Array(readFileSync(process.argv[2])));
const dec = (b: unknown) => JSON.parse(new TextDecoder().decode(b as Uint8Array));
const strip = (o: Record<string, unknown>) => { const c = { ...o }; for (const k of ['p', 's', 'Id', 'DI', 'LD', 'MD', 'lMD']) delete c[k]; return c; };
for (const [name, data] of z.entries) {
  if (!name.endsWith('.tsanim')) continue;
  const db = new SQL.Database(data);
  const rows = (db.exec('select id,type,data from layers')[0]?.values ?? []).map((r) => ({ id: r[0] as string, type: r[1] as number, d: dec(r[2]) }));
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const r of rows) {
    if (typeof r.d.Na !== 'string' || !/^(BM|FX)\b/.test(r.d.Na)) continue;
    console.log(`\n${r.d.Na}  [layer type ${r.type}]  bM=${r.d.bM ?? '(none)'}  op=${r.d.op ?? '(none)'}`);
    console.log('  layer:', JSON.stringify(strip(r.d)));
    for (const eid of r.d.Ef ?? []) {
      const e = byId.get(eid);
      console.log(`  effect [type ${e?.type}]:`, e ? JSON.stringify(strip(e.d)) : `(missing ${eid})`);
    }
  }
  const others = rows.filter((r) => r.type !== 1 && r.type !== 3 && r.type !== 4 && r.type !== 10 && r.type !== 11 && !(r.d.Na && /^(BM|FX)\b/.test(r.d.Na)));
  for (const o of others) console.log(`\n(other row type ${o.type})`, JSON.stringify(strip(o.d)));
}
