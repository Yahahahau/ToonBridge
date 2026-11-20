import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { analyzeInput, convertAnalysis } from '../src/engine';
import { nodeSql } from './helpers';

const XNS = 'xmlns="http://ns.adobe.com/xfl/2008/"';
const sym = `<DOMSymbolItem ${XNS} name="Arm" symbolType="graphic"><timeline><DOMTimeline name="Arm"><layers><DOMLayer name="a"><frames><DOMFrame index="0" duration="1"><elements><DOMShape><fills><FillStyle index="1"><SolidColor color="#FF0000"/></FillStyle></fills><edges><Edge fillStyle1="1" edges="!0 0|2000 0|2000 2000|0 2000|0 0"/></edges></DOMShape></elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timeline></DOMSymbolItem>`;
const inst = (tx: number, tpx: number) => `<DOMSymbolInstance libraryItemName="Arm" symbolType="graphic"><matrix><Matrix tx="${tx}" ty="0"/></matrix><transformationPoint><Point x="${tpx}" y="0"/></transformationPoint></DOMSymbolInstance>`;
function xfl(f0: string, f1: string): Uint8Array {
  const doc = `<DOMDocument ${XNS} width="400" height="400" frameRate="24"><symbols><Include href="Arm.xml"/></symbols><timelines><DOMTimeline name="Scene 1"><layers><DOMLayer name="L"><frames>
    <DOMFrame index="0" duration="4" tweenType="motion" motionTweenSnap="true"><elements>${f0}</elements></DOMFrame>
    <DOMFrame index="4" duration="1"><elements>${f1}</elements></DOMFrame>
  </frames></DOMLayer></layers></DOMTimeline></timelines></DOMDocument>`;
  return zipSync({ 'DOMDocument.xml': strToU8(doc), 'LIBRARY/Arm.xml': strToU8(sym), 't.xfl': strToU8('PROXY-CS5') }, { level: 0 });
}
/** World position of the symbol's local origin in each drawing (rotation 0, scale 1 here): p − pv. */
async function origins(bytes: Uint8Array): Promise<number[]> {
  const out = convertAnalysis(analyzeInput(bytes, 't.fla'), await nodeSql());
  const scene = out.project.clips.find((c) => c.isScene)!;
  const xs: number[] = [];
  for (const d of scene.layers[0].drawings) for (let k = d.s; k <= d.e; k++) { const c = d.content[0].c; if (c.kind === 'clip') xs.push(c.ref.p[0] - c.ref.pv[0]); }
  return xs;
}

describe('motion tweens', () => {
  it('a moved transformation point does not move the art (no jump at the next keyframe)', async () => {
    // Same placement (tx = 0) at both keyframes; only the transformation point differs (0 -> 50 px).
    const xs = await origins(xfl(inst(0, 0), inst(0, 50)));
    expect(xs).toHaveLength(5);
    for (const x of xs) expect(Math.abs(x)).toBeLessThan(1e-6);
  });
  it('a real move is interpolated linearly and lands on both keyframes', async () => {
    const xs = await origins(xfl(inst(0, 0), inst(100, 50)));
    expect(xs.map((x) => Math.round(x * 1000) / 1000)).toEqual([0, 25, 50, 75, 100]);
  });
});
