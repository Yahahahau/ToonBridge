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
