// Phase B2: legacy FLA timing (JPEXS zero-length frames) and import of the JPEXS conversion report.
//
// tests/fixtures/jpexs/*.fla are tiny binary FLAs written by JPEXS itself, with zero-length frames set in the model
// (see third_party/jpexs-fla-convert/test/ZeroDurationFramesTest.java). *.xfl.zip are their exports by the PATCHED
// JPEXS, including its conversion-report.txt. The Java side is tested by that Java test; here we test what ToonBridge
// reads from those exports.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { analyzeInput, convertAnalysis, reportToText } from '../src/engine';
import type { Timeline } from '../src/engine/ir';
import { detectInput } from '../src/engine/legacy/detect';
import { nodeSql } from './helpers';

const FX = join(__dirname, 'fixtures', 'jpexs');
const zipOf = (name: string) => new Uint8Array(readFileSync(join(FX, `${name}.xfl.zip`)));
const frames = (t: Timeline, layer: string) => t.layers.find((l) => l.name === layer)!.frames.map((f) => `${f.index}+${f.duration}${f.elements.length ? '' : 'e'}`).join(' ');

/** Expected timelines (same as the Java test): zero-length frames take no time; everything else is unchanged. */
const EXPECT: Record<string, Record<string, string>> = {
  'zero-length-first-frame': { 'Scene 1/L': '0+2 2+3' },
  'normal-one-frame-first-keyframe': { 'Scene 1/L': '0+1e 1+2 3+3' },
  'multiple-zero-duration-frames': { 'Scene 1/L': '0+2 2+3' },
  'empty-keyframes-kept': { 'Scene 1/L': '0+2 2+3e 5+1' },
  'held-frames': { 'Scene 1/L': '0+10' },
  'layers-with-different-starts': { 'Scene 1/A': '0+3 3+2', 'Scene 1/B': '0+3 3+2', 'Scene 1/C': '0+1e 1+4' },
  'nested-animated-symbols': { 'Inner/art': '0+2 2+2', 'Outer/holder': '0+4', 'Scene 1/S': '0+6' },
  'zero-length-frame-with-content-is-kept': { 'Scene 1/L': '0+1 1+2' },
  'only-frame-of-layer-is-zero-length': { 'Scene 1/A': '0+3', 'Scene 1/Z': '0+1e' },
};

describe('binary FLA fixtures (made by JPEXS) are real legacy FLAs', () => {
  it('each fixture .fla is detected as a binary CS4 FLA', () => {
    for (const name of Object.keys(EXPECT)) {
      const f = detectInput(new Uint8Array(readFileSync(join(FX, `${name}.fla`))));
      expect(f.kind, name).toBe('legacy-fla');
      if (f.kind === 'legacy-fla') expect(f.info.version).toBe('Flash CS4');
    }
  });
});

describe('patched JPEXS export → ToonBridge parsed timeline', () => {
  for (const [name, exp] of Object.entries(EXPECT)) {
    it(name, () => {
      const a = analyzeInput(zipOf(name), `${name}.zip`);
      for (const [key, want] of Object.entries(exp)) {
        const [tl, layer] = key.split('/');
        const t = tl === 'Scene 1' ? a.doc.scenes[0] : a.doc.symbols.get(tl)!.timeline;
        expect(frames(t, layer), key).toBe(want);
      }
    });
  }
  it('nested symbols keep their length in the final .tsproj (no extra frame)', async () => {
    const out = convertAnalysis(analyzeInput(zipOf('nested-animated-symbols'), 'n.zip'), await nodeSql());
    expect(out.report.ok).toBe(true);
    const inner = out.project.clips.find((c) => c.name === 'Inner' && c.frames > 1);
    expect(inner?.frames).toBe(4);
    expect(inner?.layers[0].drawings[0].s).toBe(1);   // art from the first frame, not from frame 2
  });
});

describe('JPEXS report imported into the ToonBridge report', () => {
  it('skipped zero-length frame: located, marked as JPEXS, outcome stated', async () => {
    const out = convertAnalysis(analyzeInput(zipOf('zero-length-first-frame'), 'z.zip'), await nodeSql());
    const d = out.report.diagnostics.find((x) => x.code === 'JPEXS_FRAME_DURATION')!;
    expect(d.origin).toBe('jpexs');
    expect(d.severity).toBe('info');
    expect(d.message).toContain('outcome: skipped');
    expect(d.locations[0]).toMatchObject({ owner: 'Scene 1', ownerKind: 'scene', layer: 'L', frames: [1, 1] });
    expect(reportToText(out.report)).toContain('[jpexs info] JPEXS_FRAME_DURATION');
  });
  it('zero-length frame with content: warning, outcome modified', () => {
    const a = analyzeInput(zipOf('zero-length-frame-with-content-is-kept'), 'c.zip');
    const d = a.diag.items().find((x) => x.code === 'JPEXS_FRAME_DURATION')!;
    expect(d.severity).toBe('warn');
    expect(d.message).toContain('outcome: modified');
  });
  it('JPEXS diagnostics stay apart from ToonBridge parser diagnostics', () => {
    const a = analyzeInput(zipOf('nested-animated-symbols'), 'n.zip');
    for (const d of a.diag.items()) expect(d.origin === 'jpexs', d.code).toBe(d.code.startsWith('JPEXS_'));
  });

  /** A copy of a fixture with its conversion-report.txt replaced. */
  const withReport = (body: string | null) => {
    const files = unzipSync(zipOf('held-frames'));
    if (body === null) delete files['conversion-report.txt'];
    else files['conversion-report.txt'] = strToU8(body);
    return zipSync(files, { level: 0 });
  };
  const HEAD = 'Binary FLA to XFL: experimental export\nThis report covers conversion limitations, not Adobe application validation.\n\n';
  it('reports from an UNPATCHED JPEXS are flagged as a likely timing loss', () => {
    const a = analyzeInput(withReport(HEAD + 'FRAME_DURATION [S 1 1601876509:34]: Zero duration replaced with one frame.\n'), 'u.zip');
    const d = a.diag.items().find((x) => x.code === 'JPEXS_FRAME_DURATION')!;
    expect(d.severity).toBe('loss');
    expect(d.locations[0]).toMatchObject({ owner: 'S 1 1601876509', ownerKind: 'page' });
  });
  it('UNLINKED_PAGE: listed with its content summary and outcome skipped', () => {
    const a = analyzeInput(withReport(HEAD + 'UNLINKED_PAGE [S 75 1603754658:1]: Page has no scene/library descriptor and is not emitted. outcome=skipped; layers=4; keyframes=15; frames=35; objects=13\n'), 'p.zip');
    const d = a.diag.items().find((x) => x.code === 'JPEXS_UNLINKED_PAGE')!;
    expect(d.severity).toBe('unsupported');
    expect(d.message).toContain('outcome: skipped');
    expect(d.locations[0].source).toContain('4 layer(s), 15 keyframe(s), 35 frame(s), 13 object(s)');
  });
  it('other JPEXS codes are imported, never dropped', () => {
    const a = analyzeInput(withReport(HEAD + 'LAYER_COLOR [S 3 1:20]: Outline color is unavailable; black was used.\n'), 'o.zip');
    expect(a.diag.items().find((x) => x.code === 'JPEXS_LAYER_COLOR')?.locations[0].source).toContain('Outline color is unavailable');
  });
  it('a conversion-report.txt that is not from JPEXS is ignored (and said so); hostile lines do not break parsing', () => {
    const a = analyzeInput(withReport('hello <script>alert(1)</script>\nFRAME_DURATION [x:1]: y\n'), 'h.zip');
    const codes = a.diag.items().map((x) => x.code);
    expect(codes).toContain('JPEXS_REPORT_UNKNOWN');
    expect(codes).not.toContain('JPEXS_FRAME_DURATION');
    const b = analyzeInput(withReport(HEAD + 'FRAME_DURATION [' + 'x'.repeat(5000) + ':1]: y\n' + '\u0000\u0001garbage\n'), 'g.zip');
    expect(b.diag.items().filter((x) => x.origin === 'jpexs')).toHaveLength(0);
  });
  it('the report only adds diagnostics: output bytes are the same with or without it', async () => {
    const SQL = await nodeSql();
    const a = convertAnalysis(analyzeInput(withReport(null), 'a.zip'), SQL);
    const b = convertAnalysis(analyzeInput(zipOf('held-frames'), 'b.zip'), SQL);
    expect(a.report.output.sha1).toBe(b.report.output.sha1);
    expect(a.report.diagnostics.some((d) => d.origin === 'jpexs')).toBe(false);
  });
});

// Real files: XFL exported from BoyFriend_Assets.fla / GF_assets.fla by the PATCHED JPEXS, as zips in A2T_FIXTURES
// (BF-patched.xfl.zip, GF-patched.xfl.zip). The expected values come from the binary FLA records themselves.
const dir = process.env.A2T_FIXTURES;
const truth = JSON.parse(readFileSync(join(FX, 'bf-gf-zero-length-frames.json'), 'utf8')) as { locations: { file: string; timeline: string; layerIndex: number; layer: string; firstArtFrame: number; layerEnd: number; timelineLength: number; keyframes: [number, number][] }[] };
const real = (k: string) => (dir ? join(dir, `${k}-patched.xfl.zip`) : '');
describe.skipIf(!dir || !existsSync(real('BF')) || !existsSync(real('GF')))('real legacy files: all 37 zero-length-frame locations', () => {
  it('has 37 locations (33 BF, 4 GF)', () => {
    expect(truth.locations).toHaveLength(37);
    expect(truth.locations.filter((l) => l.file === 'BF')).toHaveLength(33);
  });
  for (const k of ['BF', 'GF']) {
    it(`${k}: every affected layer matches the source keyframes, and the .tsproj clip has the source length`, async () => {
      const a = analyzeInput(new Uint8Array(readFileSync(real(k))), `${k}.zip`);
      const out = convertAnalysis(a, await nodeSql());
      expect(out.report.ok).toBe(true);
      for (const loc of truth.locations.filter((l) => l.file === k)) {
        const t = a.doc.symbols.get(loc.timeline)?.timeline ?? a.doc.scenes.find((s) => s.name === loc.timeline)!;
        const layer = t.layers[loc.layerIndex];
        const where = `${loc.timeline} / ${loc.layer}`;
        expect(layer.name, where).toBe(loc.layer);
        expect(layer.frames.map((f) => [f.index, f.duration]), where).toEqual(loc.keyframes);
        expect(layer.frames.find((f) => f.elements.length)!.index + 1, where).toBe(loc.firstArtFrame);
        const clip = out.project.clips.find((c) => c.name === loc.timeline && c.frames > 1);
        if (clip) expect(clip.frames, where).toBe(loc.timelineLength);
      }
      // The imported JPEXS report names every one of them, with outcome "skipped".
      const jd = out.report.diagnostics.filter((d) => d.code === 'JPEXS_FRAME_DURATION');
      expect(jd.map((d) => d.severity)).toEqual(['info']);
      expect(jd[0].count).toBe(truth.locations.filter((l) => l.file === k).length);
    });
  }
  it('GF Dancing Beat: layers 1 and 5 and layers 2, 3, 4 all span 30 frames, as in the source', () => {
    const a = analyzeInput(new Uint8Array(readFileSync(real('GF'))), 'gf.zip');
    const t = a.doc.symbols.get('GF Dancing Beat')!.timeline;
    const end = (n: string) => Math.max(...t.layers.find((l) => l.name === n)!.frames.map((f) => f.index + f.duration));
    expect(['Layer 1', 'Layer 2', 'Layer 3', 'Layer 4', 'Layer 5'].map(end)).toEqual([30, 30, 30, 30, 30]);
    expect(frames(t, 'Layer 2').startsWith('0+2 2+2 4+2')).toBe(true);   // source: 0/2, 2/2, 4/2 …
  });
  it('the BF report lists the 6 unlinked pages', () => {
    const a = analyzeInput(new Uint8Array(readFileSync(real('BF'))), 'bf.zip');
    const d = a.diag.items().find((x) => x.code === 'JPEXS_UNLINKED_PAGE')!;
    expect(d.count).toBe(6);
  });
});
void strFromU8;
