// Phase B3.5: builds the B3 device-check sample through the REAL ToonBridge pipeline
// (synthetic XFL -> analyzeInput -> convertAnalysis -> writer -> validator). The XFL is a hand-written TEST FIXTURE,
// not an Adobe Animate file; the .tsproj is never edited by hand.
//   npx tsx scripts/device/make-b3-device-check.ts [out.tsproj]   (default: B3_device_check.tsproj)
import { writeFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { analyzeInput, convertAnalysis, reportToText } from '../../src/engine';
import { nodeSql } from '../../tests/helpers';

const XNS = 'xmlns="http://ns.adobe.com/xfl/2008/"';
/** Square at (x, y) px with side s px (XFL edges are in twips: 1 px = 20). */
const box = (c: string, x: number, y: number, s: number) =>
  `<DOMShape><fills><FillStyle index="1"><SolidColor color="${c}"/></FillStyle></fills><edges><Edge fillStyle1="1" edges="!${x * 20} ${y * 20}|${(x + s) * 20} ${y * 20}|${(x + s) * 20} ${(y + s) * 20}|${x * 20} ${(y + s) * 20}|${x * 20} ${y * 20}"/></edges></DOMShape>`;

export const FPS = 12;
export const FRAMES = 24;
/** Counter frame k (0-based) shows k+1 squares in colour COUNTER_COLORS[k]: the number of squares is the frame number. */
export const COUNTER_COLORS = ['#E53935', '#FB8C00', '#FDD835', '#43A047', '#1E88E5', '#8E24AA'];
export const BLUR_START = 0;
export const BLUR_END = 60;

const counter = `<DOMSymbolItem ${XNS} name="Counter 1-6" symbolType="graphic"><timeline><DOMTimeline name="Counter 1-6"><layers><DOMLayer name="art"><frames>${COUNTER_COLORS.map((c, k) => `<DOMFrame index="${k}"><elements>${Array.from({ length: k + 1 }, (_, i) => box(c, i * 45, 0, 40)).join('')}</elements></DOMFrame>`).join('')}</frames></DOMLayer></layers></DOMTimeline></timeline></DOMSymbolItem>`;
const ball = `<DOMSymbolItem ${XNS} name="Ball" symbolType="graphic"><timeline><DOMTimeline name="Ball"><layers><DOMLayer name="art"><frames><DOMFrame index="0"><elements>${box('#1E88E5', 0, 0, 160)}</elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timeline></DOMSymbolItem>`;
const inst = (lib: string, tx: number, ty: number, attrs = '', inner = '') => `<DOMSymbolInstance libraryItemName="${lib}" symbolType="graphic" ${attrs}><matrix><Matrix tx="${tx}" ty="${ty}"/></matrix>${inner}</DOMSymbolInstance>`;
const blur = (b: number) => `<filters><BlurFilter blurX="${b}" blurY="${b}" quality="3"/></filters>`;
const L = (name: string, frames: string, attrs = '') => `<DOMLayer name="${name}" ${attrs}><frames>${frames}</frames></DOMLayer>`;
const span = (els: string) => `<DOMFrame index="0" duration="${FRAMES}"><elements>${els}</elements></DOMFrame>`;

/** Layers, top first (Animate order). */
export const LAYERS = {
  hidden: 'HIDDEN - should not show',
  guide: 'guide path',
  forward: 'forward loop 1-6',
  reverse: 'reverse loop 6-1',
  blur: 'blur tween',
  background: 'white background',
};

export function b3DeviceCheckXfl(): Uint8Array {
  const layers =
    L(LAYERS.hidden, span(box('#FF00FF', 0, 0, 1920)), 'visible="false"') +
    L(LAYERS.guide, span(box('#00BCD4', 860, 700, 200)), 'layerType="guide"') +
    L(LAYERS.forward, span(inst('Counter 1-6', 100, 100, 'loop="loop"'))) +
    L(LAYERS.reverse, span(inst('Counter 1-6', 100, 250, 'loop="loop reverse"'))) +
    L(LAYERS.blur, `<DOMFrame index="0" duration="${FRAMES - 1}" tweenType="motion"><elements>${inst('Ball', 1200, 300, '', blur(BLUR_START))}</elements></DOMFrame><DOMFrame index="${FRAMES - 1}"><elements>${inst('Ball', 1500, 300, '', blur(BLUR_END))}</elements></DOMFrame>`) +
    L(LAYERS.background, span(box('#FFFFFF', 0, 0, 1920)));
  const doc = `<DOMDocument ${XNS} width="1920" height="1080" frameRate="${FPS}"><symbols><Include href="Counter.xml"/><Include href="Ball.xml"/></symbols><timelines><DOMTimeline name="B3 device check"><layers>${layers}</layers></DOMTimeline></timelines></DOMDocument>`;
  return zipSync({ 'DOMDocument.xml': strToU8(doc), 'LIBRARY/Counter.xml': strToU8(counter), 'LIBRARY/Ball.xml': strToU8(ball), 'B3_device_check.xfl': strToU8('PROXY-CS5') }, { level: 0 });
}

export async function buildB3DeviceCheck() {
  const a = analyzeInput(b3DeviceCheckXfl(), 'B3_device_check.zip');
  return convertAnalysis(a, await nodeSql());
}

if (process.argv[1]?.endsWith('make-b3-device-check.ts')) {
  const out = process.argv[2] ?? 'B3_device_check.tsproj';
  const r = await buildB3DeviceCheck();
  writeFileSync(out, r.bytes);
  console.log(reportToText(r.report));
  console.log(`wrote ${out}`);
}
