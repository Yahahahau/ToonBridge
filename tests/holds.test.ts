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

describe('held drawings (ToonSquid exposure)', () => {
  it('frames that look the same become ONE drawing held over them, sharing one clip', async () => {
    const out = convertAnalysis(analyzeInput(xfl(), 'h.fla'), await nodeSql());
    expect(out.report.ok).toBe(true);
    const scene = out.project.clips.find((c) => c.isScene)!;
    const ranges = scene.layers[0].drawings.map((d) => [d.s, d.e]);
    expect(ranges).toEqual([[1, 8], [9, 12]]);                 // not 12 one-frame drawings
    expect(out.project.clips.filter((c) => !c.isScene)).toHaveLength(2); // one snapshot per distinct picture
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
    const colorOf = (clipId: string) => { const c = out.project.clips.find((x) => x.id === clipId)!; const v = c.layers[0].drawings[0].content[0].c; return v.kind === 'vector' && v.items[0].kind === 'fill' ? Math.round(v.items[0].color.g * 255) * 1000 + Math.round(v.items[0].color.r * 255) : -1; };
    const seq: number[] = [];
    for (const d of scene.layers[0].drawings) for (let k = d.s; k <= d.e; k++) { const c = d.content[0].c; if (c.kind === 'clip') seq.push(colorOf(c.ref.clipId)); }
    // frames 1..6 must show loop frames 1,2,3,4,1,2 (continuous), not 1,2,1,2,3,4 (restarted at frame 3)
    const f = [255, 255000, 0, 255255];
    expect(seq).toEqual([f[0], f[1], f[2], f[3], f[0], f[1]]);
  });
});
