import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { analyzeInput, convertAnalysis } from '../src/engine';
import { nodeSql } from './helpers';

const XNS = 'xmlns="http://ns.adobe.com/xfl/2008/"';
const box = (color: string) => `<DOMShape><fills><FillStyle index="1"><SolidColor color="${color}"/></FillStyle></fills><edges><Edge fillStyle1="1" edges="!0 0|2000 0|2000 2000|0 2000|0 0"/></edges></DOMShape>`;
// Symbol "Blink": 12 frames, but only two different pictures (frames 1-8 red, 9-12 blue). The scene plays it once over 12 frames.
function xfl(): Uint8Array {
  const sym = `<DOMSymbolItem ${XNS} name="Blink" symbolType="graphic"><timeline><DOMTimeline name="Blink"><layers><DOMLayer name="a"><frames>
    <DOMFrame index="0" duration="8"><elements>${box('#FF0000')}</elements></DOMFrame>
    <DOMFrame index="8" duration="4"><elements>${box('#0000FF')}</elements></DOMFrame>
  </frames></DOMLayer></layers></DOMTimeline></timeline></DOMSymbolItem>`;
  const doc = `<DOMDocument ${XNS} width="200" height="200" frameRate="24"><symbols><Include href="Blink.xml"/></symbols><timelines><DOMTimeline name="Scene 1"><layers><DOMLayer name="L"><frames>
    <DOMFrame index="0" duration="12"><elements><DOMSymbolInstance libraryItemName="Blink" symbolType="graphic" loop="play once"><matrix><Matrix tx="10" ty="10"/></matrix></DOMSymbolInstance></elements></DOMFrame>
  </frames></DOMLayer></layers></DOMTimeline></timelines></DOMDocument>`;
  return zipSync({ 'DOMDocument.xml': strToU8(doc), 'LIBRARY/Blink.xml': strToU8(sym), 'h.xfl': strToU8('PROXY-CS5') }, { level: 0 });
}

/** Plays the written project back like ToonSquid (Normal loop, Time = start frame) and returns the fill colour shown. */
function shown(project: { clips: { id: string; isScene: boolean; layers: { drawings: { s: number; e: number; content: { c: any }[] }[] }[] }[] }, clipId: string, frame: number): string {
  const clip = project.clips.find((c) => c.id === clipId)!;
  const len = Math.max(...clip.layers.flatMap((l) => l.drawings.map((d) => d.e)), 1);
  for (const l of clip.layers) for (const d of l.drawings) {
    if (frame < d.s || frame > d.e) continue;
    const c = d.content[0].c;
    if (c.kind === 'vector') { const f = c.items.find((i: any) => i.kind === 'fill'); return `${Math.round(f.color.r * 255)},${Math.round(f.color.g * 255)},${Math.round(f.color.b * 255)}`; }
    const sub = project.clips.find((x) => x.id === c.ref.clipId)!;
    const sl = Math.max(...sub.layers.flatMap((ll) => ll.drawings.map((dd) => dd.e)), 1);
    return shown(project, c.ref.clipId, (((c.ref.time ?? 1) - 1 + frame - d.s) % sl) + 1);
  }
  void len; return '-';
}
const RED = '255,0,0', GREEN = '0,255,0', BLUE = '0,0,255', YELLOW = '255,255,0';

describe('animated symbols (ToonSquid symbol layers)', () => {
  it('native: one drawing plays the symbol clip, which holds all its frames', async () => {
    const out = convertAnalysis(analyzeInput(xfl(), 'h.fla'), await nodeSql());
    expect(out.report.ok).toBe(true);
    const scene = out.project.clips.find((c) => c.isScene)!;
    expect(scene.layers[0].drawings.map((d) => [d.s, d.e])).toEqual([[1, 12]]);
    const syms = out.project.clips.filter((c) => !c.isScene);
    expect(syms).toHaveLength(1);
    expect(syms[0].name).toBe('Blink');
    expect(syms[0].layers[0].drawings.map((d) => [d.s, d.e])).toEqual([[1, 8], [9, 12]]);
    const seq = Array.from({ length: 12 }, (_, k) => shown(out.project, scene.id, k + 1));
    expect(seq).toEqual([...Array(8).fill(RED), ...Array(4).fill(BLUE)]);
  });
  it('snapshot mode still gives held drawings of still clips', async () => {
    const out = convertAnalysis(analyzeInput(xfl(), 'h.fla'), await nodeSql(), undefined, { symbolPlayback: 'snapshot' });
    const scene = out.project.clips.find((c) => c.isScene)!;
    expect(scene.layers[0].drawings.map((d) => [d.s, d.e])).toEqual([[1, 8], [9, 12]]);
    expect(out.project.clips.filter((c) => !c.isScene)).toHaveLength(2);
  });
});

describe('movie clips across keyframes', () => {
  it('keep playing instead of restarting at each keyframe', async () => {
    const XNS = 'xmlns="http://ns.adobe.com/xfl/2008/"';
    const box = (c: string) => `<DOMShape><fills><FillStyle index="1"><SolidColor color="${c}"/></FillStyle></fills><edges><Edge fillStyle1="1" edges="!0 0|2000 0|2000 2000|0 2000|0 0"/></edges></DOMShape>`;
    // 4-frame movie clip with a different colour on every frame.
    const mc = `<DOMSymbolItem ${XNS} name="Loop" symbolType="movie clip"><timeline><DOMTimeline name="Loop"><layers><DOMLayer name="a"><frames>${['#FF0000', '#00FF00', '#0000FF', '#FFFF00'].map((c, i) => `<DOMFrame index="${i}" duration="1"><elements>${box(c)}</elements></DOMFrame>`).join('')}</frames></DOMLayer></layers></DOMTimeline></timeline></DOMSymbolItem>`;
    const inst = (tx: number) => `<DOMSymbolInstance libraryItemName="Loop"><matrix><Matrix tx="${tx}"/></matrix></DOMSymbolInstance>`;
    // Same movie clip on keyframes 0 and 2 (it moves), as in "retry confirm".
    const doc = `<DOMDocument ${XNS} width="200" height="200" frameRate="24"><symbols><Include href="Loop.xml"/></symbols><timelines><DOMTimeline name="Scene 1"><layers><DOMLayer name="L"><frames>
      <DOMFrame index="0" duration="2"><elements>${inst(0)}</elements></DOMFrame><DOMFrame index="2" duration="4"><elements>${inst(10)}</elements></DOMFrame>
    </frames></DOMLayer></layers></DOMTimeline></timelines></DOMDocument>`;
    const bytes = zipSync({ 'DOMDocument.xml': strToU8(doc), 'LIBRARY/Loop.xml': strToU8(mc), 'm.xfl': strToU8('PROXY-CS5') }, { level: 0 });
    const out = convertAnalysis(analyzeInput(bytes, 'm.fla'), await nodeSql());
    const scene = out.project.clips.find((c) => c.isScene)!;
    // two drawings (it moves at frame 3); the second starts the clip at its frame 3 (Time) instead of restarting
    expect(scene.layers[0].drawings.map((d) => [d.s, d.e])).toEqual([[1, 2], [3, 6]]);
    const seq = Array.from({ length: 6 }, (_, k) => shown(out.project, scene.id, k + 1));
    // frames 1..6 must show loop frames 1,2,3,4,1,2 (continuous), not 1,2,1,2,3,4
    expect(seq).toEqual([RED, GREEN, BLUE, YELLOW, RED, GREEN]);
  });
});
