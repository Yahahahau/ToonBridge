import { readFileSync } from 'node:fs';
import { readZipTolerant } from './src/engine/zip/reader';
import { nodeSql } from './tests/helpers';
const SQL = await nodeSql();
for (const f of process.argv.slice(2)) {
  const z = readZipTolerant(new Uint8Array(readFileSync(f)));
  const types = new Map<number, Set<string>>();
  const samples: string[] = [];
  for (const [n, d] of z.entries) {
    if (!n.endsWith('.tsanim')) continue;
    const db = new SQL.Database(d);
    for (const r of db.exec('select type,data from layers')[0]?.values ?? []) {
      const j = JSON.parse(new TextDecoder().decode(r[1] as Uint8Array));
      const s = types.get(r[0] as number) ?? new Set(); Object.keys(j).forEach((k) => s.add(k)); types.set(r[0] as number, s);
      if ('bM' in j || 'Ef' in j || r[0] === 121) samples.push(`${r[0]} ${JSON.stringify(j).replace(/"s":\{.*?\]\}\]\}/g, '"s":…').slice(0, 300)}`);
    }
  }
  console.log('==', f.split('/').pop());
  for (const [t, s] of types) console.log(' type', t, [...s].sort().join(','));
  console.log(samples.slice(0, 12).join('\n'));
}
