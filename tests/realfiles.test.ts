// Real-file tests: skipped (visibly) unless A2T_FIXTURES points at the sample files.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeInput, convertAnalysis } from '../src/engine';
import { readZipTolerant } from '../src/engine/zip/reader';
import { nodeSql } from './helpers';

const dir = process.env.A2T_FIXTURES;
const fla = dir && join(dir, 'Boyfriend_But_Better.fla');
const base = dir && join(dir, '00_baseline.tsproj');
const persp = dir && join(dir, 'Perspective_revert_engineer.tsproj');
const fxProbe = dir && join(dir, 'Effect.tsproj');
const have = !!fla && existsSync(fla);
const dec = new TextDecoder();

function keySets(zipBytes: Uint8Array, SQL: Awaited<ReturnType<typeof nodeSql>>) {
  const z = readZipTolerant(zipBytes);
  const out = new Map<string, Set<string>>();
  const add = (k: string, o: unknown) => { if (o && typeof o === 'object') { const s = out.get(k) ?? new Set(); Object.keys(o).forEach((x) => s.add(x)); out.set(k, s); } };
  for (const [name, bytes] of z.entries) {
    if (!name.endsWith('.tsanim')) continue;
    const db = new SQL.Database(bytes);
    for (const [id, t, d] of db.exec('select id,type,data from layers')[0].values) { void id; add(`layer${t}`, JSON.parse(dec.decode(d as Uint8Array))); }
    for (const [, d] of db.exec('select id,data from drawings')[0]?.values ?? []) add('drawing', JSON.parse(dec.decode(d as Uint8Array)));
    for (const [, d] of db.exec('select id,data from animationClip')[0].values) add('clip', JSON.parse(dec.decode(d as Uint8Array)));
    db.close();
  }
  return out;
}

describe.skipIf(!have)('real Boyfriend_But_Better.fla (XFL, damaged central directory)', () => {
  it('converts to a valid, deterministic .tsproj', async () => {
    const SQL = await nodeSql();
    const bytes = new Uint8Array(readFileSync(fla!));
    const a1 = convertAnalysis(analyzeInput(bytes, 'bf.fla'), SQL);
    expect(a1.report.validation.ok).toBe(true);
    expect(a1.report.project.width).toBe(1920);
    expect(a1.report.stats.contours).toBeGreaterThan(1000);
    const a2 = convertAnalysis(analyzeInput(bytes, 'bf.fla'), SQL);
    expect(a2.report.output.sha1).toBe(a1.report.output.sha1);
  });
  it('output changes only where a phase deliberately changes it', async () => {
    // sha1 of the default conversion. Phases B1, B2, B3.1 and B3.2 left it unchanged (dca54e90…, commit b3157d8).
    // B3.3 changed it on purpose: the only difference is the 21 Gaussian Blur rows of "retry confirm", whose blur now
    // follows the tween (Blur 67×67 → 177×18) instead of holding the start value. Update deliberately, with a reason.
    const SQL = await nodeSql();
    const r = convertAnalysis(analyzeInput(new Uint8Array(readFileSync(fla!)), 'bf.fla'), SQL);
    expect(r.report.output.sha1).toBe('aabaeeda4955577686b653988d48101b8278343a');
    // Tween diagnostics count tweens: 15 interpolated, 6 symbol swaps, and no "unpaired" for last keyframes.
    const d = (c: string) => r.report.diagnostics.filter((x) => x.code === c).reduce((n, x) => n + x.count, 0);
    expect(d('TWEEN_BAKED')).toBe(15);
    expect(d('TWEEN_SYMBOL_SWAP')).toBe(6);
    expect(d('TWEEN_UNPAIRED')).toBe(0);
  });
  it('scan-only recovery (central directory removed) yields the identical project', async () => {
    const SQL = await nodeSql();
    const bytes = new Uint8Array(readFileSync(fla!));
    const a1 = convertAnalysis(analyzeInput(bytes, 'bf.fla'), SQL);
    const cutAt = bytes.length - 22 - 4; // chop the EOCD record -> central directory unusable
    const a2 = analyzeInput(bytes.slice(0, cutAt), 'bf-cut.fla');
    expect(a2.zipMode).toBe('scan-only');
    expect(convertAnalysis(a2, SQL).report.output.sha1).toBe(a1.report.output.sha1);
  });
  it.skipIf(!base || !existsSync(base))('writes only JSON keys that exist in app-made ToonSquid files', async () => {
    const SQL = await nodeSql();
    const ours = keySets(convertAnalysis(analyzeInput(new Uint8Array(readFileSync(fla!)), 'bf.fla'), SQL).bytes, SQL);
    const theirs = keySets(new Uint8Array(readFileSync(base!)), SQL);
    for (const extra of [persp, fxProbe]) if (extra && existsSync(extra)) for (const [k, set] of keySets(new Uint8Array(readFileSync(extra)), SQL)) { const t = theirs.get(k) ?? new Set<string>(); set.forEach((x) => t.add(x)); theirs.set(k, t); }
    const unknown: string[] = [];
    for (const [k, set] of ours) for (const key of set) if (!theirs.get(k)?.has(key)) unknown.push(`${k}.${key}`);
    // Known extrapolations (documented in README): Ef was only observed on shape (type 3) layers, bM on shape/vector layers.
    expect(unknown.filter((u) => !['layer1.Ef', 'layer4.Ef', 'layer4.bM'].includes(u))).toEqual([]);
  });
});
