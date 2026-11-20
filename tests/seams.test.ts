import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { analyzeInput, convertAnalysis } from '../src/engine';
import type { VectorItem } from '../src/engine/resolver/model';
import { nodeSql } from './helpers';

const XNS = 'xmlns="http://ns.adobe.com/xfl/2008/"';
const sq = (x0: number, y0: number, x1: number, y1: number) => `!${x0} ${y0}|${x1} ${y0}|${x1} ${y1}|${x0} ${y1}|${x0} ${y0}`;
const shape = (fills: string, edges: string) => `<DOMShape><fills>${fills}</fills><edges>${edges}</edges></DOMShape>`;
const fill = (i: number, c: string) => `<FillStyle index="${i}"><SolidColor color="${c}"/></FillStyle>`;
/** layers: TOP first, as in Animate. */
function xfl(layers: string[]): Uint8Array {
  const ls = layers.map((s, i) => `<DOMLayer name="L${i}"><frames><DOMFrame index="0" duration="1"><elements>${s}</elements></DOMFrame></frames></DOMLayer>`).join('');
  const doc = `<DOMDocument ${XNS} width="400" height="400" frameRate="24"><timelines><DOMTimeline name="Scene 1"><layers>${ls}</layers></DOMTimeline></timelines></DOMDocument>`;
  return zipSync({ 'DOMDocument.xml': strToU8(doc), 't.xfl': strToU8('PROXY-CS5') }, { level: 0 });
}
async function itemsOf(bytes: Uint8Array, seamUnderlay = true): Promise<VectorItem[][]> {
  const out = convertAnalysis(analyzeInput(bytes, 't.fla'), await nodeSql(), undefined, { seamUnderlay });
  expect(out.report.ok).toBe(true);
  const scene = out.project.clips.find((c) => c.isScene)!;
  return scene.layers.map((l) => { const c = l.drawings[0].content[0].c; return c.kind === 'vector' ? c.items : []; }); // bottom-first
}
const COLOR = shape(fill(1, '#3399FF'), `<Edge fillStyle1="1" edges="${sq(0, 0, 4000, 4000)}"/>`);
// Black ring 40px wide centred on the colour square's outline (outer square + reversed inner square = hole).
const RING = shape(fill(1, '#000000'), `<Edge fillStyle1="1" edges="${sq(-400, -400, 4400, 4400)}"/><Edge fillStyle1="1" edges="!400 400|400 3600|3600 3600|3600 400|400 400"/>`);

describe('seam hiding', () => {
  it('bleeds a lower fill under an opaque ring above it, below the fill, and leaves the top layer untouched', async () => {
    const [bottom, top] = await itemsOf(xfl([RING, COLOR]));
    expect(bottom.map((i) => i.kind)).toEqual(['stroke', 'fill']);           // underlay first = drawn below
    const s = bottom[0] as Extract<VectorItem, { kind: 'stroke' }>;
    expect(s.width).toBe(1);
    expect(s.color).toEqual((bottom[1] as Extract<VectorItem, { kind: 'fill' }>).color);
    expect(s.contours).toHaveLength(1);
    expect(s.contours[0].nodes).toHaveLength(5);                              // whole outline covered: one untrimmed chain
    expect(top.map((i) => i.kind)).toEqual(['fill']);                       // nothing above the ring: exact geometry only
  });

  it('bleeds only the covered edge, trimmed so its caps stay hidden', async () => {
    const BAR = shape(fill(1, '#000000'), `<Edge fillStyle1="1" edges="${sq(-400, -400, 400, 4400)}"/>`); // covers the left edge only
    const [bottom] = await itemsOf(xfl([BAR, COLOR]));
    const s = bottom[0] as Extract<VectorItem, { kind: 'stroke' }>;
    expect(bottom[0].kind).toBe('stroke');
    expect(s.contours).toHaveLength(1);
    const xs = s.contours[0].nodes.map((n) => n.p[0]), ys = s.contours[0].nodes.map((n) => n.p[1]);
    expect(xs.every((x) => Math.abs(x) < 1e-6)).toBe(true);                  // on the left edge only
    expect(Math.min(...ys)).toBeCloseTo(0.5, 6);                            // trimmed by width/2 at both ends
    expect(Math.max(...ys)).toBeCloseTo(199.5, 6);
  });

  it('does not bleed when nothing opaque is above', async () => {
    const SEMI = shape(`<FillStyle index="1"><SolidColor color="#000000" alpha="0.5"/></FillStyle>`, `<Edge fillStyle1="1" edges="${sq(-400, -400, 4400, 4400)}"/>`);
    const [bottom] = await itemsOf(xfl([SEMI, COLOR]));
    expect(bottom.map((i) => i.kind)).toEqual(['fill']);
  });

  it('underlays an edge shared by two fills of one shape with the darker colour', async () => {
    const SPLIT = shape(fill(1, '#FFE0C0') + fill(2, '#802040'),
      `<Edge fillStyle1="1" edges="!2000 0|0 0|0 4000|2000 4000"/><Edge fillStyle0="1" fillStyle1="2" edges="!2000 0|2000 4000"/><Edge fillStyle1="2" edges="!2000 4000|4000 4000|4000 0|2000 0"/>`);
    const [only] = await itemsOf(xfl([SPLIT]));
    expect(only.map((i) => i.kind)).toEqual(['stroke', 'fill', 'fill']);
    const s = only[0] as Extract<VectorItem, { kind: 'stroke' }>;
    expect(s.color.r).toBeCloseTo(0x80 / 255, 3);                           // darker of the two
    expect(s.contours[0].nodes.map((n) => n.p[0]).every((x) => Math.abs(x - 100) < 1e-6)).toBe(true);
  });

  it('can be switched off', async () => {
    const [bottom] = await itemsOf(xfl([RING, COLOR]), false);
    expect(bottom.map((i) => i.kind)).toEqual(['fill']);
  });
});
