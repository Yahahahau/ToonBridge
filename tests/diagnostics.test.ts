// Phase B1: locatable diagnostics and zero-silent-loss reporting.
// Small hand-written XFL fixtures, one property each, so a failure points at exactly one detector.
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { analyzeInput, convertAnalysis, reportToText, type DiagItem } from '../src/engine';
import { Diagnostics, LOCATION_LIMIT } from '../src/engine/diagnostics';
import { nodeSql } from './helpers';

const XNS = 'xmlns="http://ns.adobe.com/xfl/2008/"';
const box = (color = '#FF0000', stroke = '') =>
  `<DOMShape><fills><FillStyle index="1"><SolidColor color="${color}"/></FillStyle></fills>${stroke ? `<strokes><StrokeStyle index="1">${stroke}</StrokeStyle></strokes>` : ''}<edges><Edge fillStyle1="1"${stroke ? ' strokeStyle="1"' : ''} edges="!0 0|2000 0|2000 2000|0 2000|0 0"/></edges></DOMShape>`;
const inst = (lib: string, attrs = '', tx = 10, inner = '') => `<DOMSymbolInstance libraryItemName="${lib}" symbolType="graphic" ${attrs}><matrix><Matrix tx="${tx}" ty="10"/></matrix>${inner}</DOMSymbolInstance>`;
const sym = (name: string, frames: number) => `<DOMSymbolItem ${XNS} name="${name}" symbolType="graphic"><timeline><DOMTimeline name="${name}"><layers><DOMLayer name="art"><frames>${Array.from({ length: frames }, (_, i) => `<DOMFrame index="${i}"><elements>${box(['#FF0000', '#00FF00', '#0000FF', '#FFFF00'][i % 4])}</elements></DOMFrame>`).join('')}</frames></DOMLayer></layers></DOMTimeline></timeline></DOMSymbolItem>`;

/** One scene; `layers` is the inner XML of <layers>. Symbols A (3 frames) and B (2 frames) are always in the library. */
function xfl(layers: string, extraDoc = ''): Uint8Array {
  const doc = `<DOMDocument ${XNS} width="200" height="200" frameRate="24">${extraDoc}<symbols><Include href="A.xml"/><Include href="B.xml"/></symbols><timelines><DOMTimeline name="Scene 1"><layers>${layers}</layers></DOMTimeline></timelines></DOMDocument>`;
  return zipSync({ 'DOMDocument.xml': strToU8(doc), 'LIBRARY/A.xml': strToU8(sym('A', 3)), 'LIBRARY/B.xml': strToU8(sym('B', 2)), 'p.xfl': strToU8('PROXY-CS5') }, { level: 0 });
}
const layer = (name: string, frames: string, attrs = '') => `<DOMLayer name="${name}" ${attrs}><frames>${frames}</frames></DOMLayer>`;
const frame = (index: number, duration: number, elements: string, attrs = '', inner = '') => `<DOMFrame index="${index}" duration="${duration}" ${attrs}>${inner}<elements>${elements}</elements></DOMFrame>`;

async function run(bytes: Uint8Array) {
  const out = convertAnalysis(analyzeInput(bytes, 'fixture.zip'), await nodeSql());
  return out;
}
const find = (ds: DiagItem[], code: string) => ds.filter((d) => d.code === code);
const one = (ds: DiagItem[], code: string) => { const f = find(ds, code); expect(f, code).toHaveLength(1); return f[0]; };

describe('diagnostic model', () => {
  it('counts each location once, however often it is raised', () => {
    const d = new Diagnostics();
    const loc = { owner: 'S', ownerKind: 'symbol' as const, layer: 'L', layerIndex: 1, frames: [1, 5] as [number, number] };
    for (let i = 0; i < 5; i++) d.approx('X', 'm', 1, loc);              // e.g. every frame of one tween
    d.approx('X', 'm', 1, { ...loc, frames: [6, 9] });
    expect(d.items()[0].count).toBe(2);
    expect(d.items()[0].locations).toHaveLength(2);
  });
  it('caps listed locations but keeps the true count', () => {
    const d = new Diagnostics();
    for (let i = 0; i < LOCATION_LIMIT + 7; i++) d.loss('Y', 'm', 1, { owner: 'S', frames: [i + 1, i + 1] });
    const it0 = d.items()[0];
    expect(it0.count).toBe(LOCATION_LIMIT + 7);
    expect(it0.locations).toHaveLength(LOCATION_LIMIT);
    expect(it0.hiddenLocations).toBe(7);
  });
  it('maps severities to error / warning / info levels', () => {
    const d = new Diagnostics();
    d.loss('A', 'a'); d.unsupported('B', 'b'); d.approx('C', 'c'); d.warn('D', 'd'); d.info('E', 'e');
    expect(d.items().map((x) => x.level)).toEqual(['error', 'warning', 'warning', 'warning', 'info']);
  });
});

describe('F3: previously silent source information is reported with its location', () => {
  it('frame label, frame sound and ActionScript (detected, never run)', async () => {
    (globalThis as Record<string, unknown>).__toonbridgeScriptRan = undefined;
    const script = '<Actionscript><script><![CDATA[globalThis.__toonbridgeScriptRan = true; stop();]]></script></Actionscript>';
    const out = await run(xfl(layer('Top', frame(0, 5, box(), 'name="intro" labelType="name" soundName="beep.wav" soundSync="stream" soundLoopMode="loop"', script))));
    const ds = out.report.diagnostics;
    const label = one(ds, 'FRAME_LABEL');
    expect(label.severity).toBe('unsupported');
    expect(label.locations[0]).toMatchObject({ owner: 'Scene 1', ownerKind: 'scene', layer: 'Top', layerIndex: 1, frames: [1, 5], source: 'name "intro"' });
    const sound = one(ds, 'FRAME_SOUND');
    expect(sound.severity).toBe('loss');
    expect(sound.locations[0].source).toContain('sync="stream"');
    const sc = one(ds, 'SCRIPT_IGNORED');
    expect(sc.locations[0]).toMatchObject({ layer: 'Top', frames: [1, 5] });
    // Never executed, and the script text is not copied into the report.
    expect((globalThis as Record<string, unknown>).__toonbridgeScriptRan).toBeUndefined();
    expect(reportToText(out.report)).not.toContain('__toonbridgeScriptRan');
    expect(JSON.stringify(out.report)).not.toContain('__toonbridgeScriptRan');
  });

  it('locked / outline layers and layer hierarchy (mask, guide, folder)', async () => {
    const out = await run(xfl(
      layer('Mask', frame(0, 3, box()), 'layerType="mask" locked="true"') +
      layer('Masked', frame(0, 3, box('#00FF00')), 'parentLayerIndex="0"') +
      layer('Guide', frame(0, 3, box()), 'layerType="guide"') +
      layer('Guided', frame(0, 3, inst('A')), 'parentLayerIndex="2" outline="true"') +
      layer('Folder', '', 'layerType="folder"') +
      layer('Child', frame(0, 3, box()), 'parentLayerIndex="4"'),
    ));
    const ds = out.report.diagnostics;
    expect(one(ds, 'LAYER_LOCKED').locations[0]).toMatchObject({ layer: 'Mask', layerIndex: 1 });
    expect(one(ds, 'LAYER_OUTLINE').locations[0]).toMatchObject({ layer: 'Guided', layerIndex: 4 });
    expect(one(ds, 'LAYER_MASKED').locations[0]).toMatchObject({ layer: 'Masked', layerIndex: 2, source: 'parentLayerIndex="0" → "Mask"' });
    expect(one(ds, 'LAYER_MOTION_GUIDE').locations[0]).toMatchObject({ layer: 'Guided' });
    expect(one(ds, 'LAYER_IN_FOLDER').locations[0]).toMatchObject({ layer: 'Child' });
    expect(one(ds, 'LAYER_MASK').locations[0]).toMatchObject({ layer: 'Mask' });
    expect(one(ds, 'LAYER_GUIDE').locations[0]).toMatchObject({ layer: 'Guide' });
  });

  it('instance: reverse loop, lastFrame, hidden, 3D, instance script, loop mode not written', async () => {
    const out = await run(xfl(
      layer('Rev', frame(0, 6, inst('A', 'loop="loop reverse"'))) +
      layer('Last', frame(0, 6, inst('A', 'loop="loop" lastFrame="1"'))) +
      layer('Hid', frame(0, 6, inst('A', 'isVisible="false"'))) +
      layer('ThreeD', frame(0, 6, inst('A', 'rotationX="30"'))) +
      layer('Once', frame(0, 6, inst('A', 'loop="play once"', 10, '<Actionscript><script><![CDATA[on(release){}]]></script></Actionscript>'))),
    ));
    const ds = out.report.diagnostics;
    expect(one(ds, 'LOOP_REVERSE').locations[0]).toMatchObject({ layer: 'Rev', frames: [1, 6], element: 1, source: '<DOMSymbolInstance libraryItemName="A" loop="loop reverse">' });
    expect(one(ds, 'GRAPHIC_LAST_FRAME').locations[0]).toMatchObject({ layer: 'Last', frames: [1, 6] });
    expect(one(ds, 'INSTANCE_HIDDEN').locations[0]).toMatchObject({ layer: 'Hid' });
    expect(one(ds, 'TRANSFORM_3D').locations[0]).toMatchObject({ layer: 'ThreeD' });
    expect(one(ds, 'SCRIPT_IGNORED').locations[0]).toMatchObject({ layer: 'Once', element: 1 });
    // B3.2: reverse modes are now baked too, so they also report that no ToonSquid loop setting is written.
    expect(one(ds, 'TS_LOOP_MODE').locations.map((l) => [l.layer, l.source])).toEqual([['Rev', 'loop="loop reverse"'], ['Once', 'loop="play once"']]);
  });

  it('flattened groups, zero-duration frames, stroke caps/joins/scale mode', async () => {
    const group = `<DOMGroup><members>${box()}${box('#0000FF')}</members></DOMGroup>`;
    const stroke = '<SolidStroke weight="4" caps="square" joints="miter" scaleMode="none"><fill><SolidColor color="#000000"/></fill></SolidStroke>';
    const out = await run(xfl(
      layer('Grp', frame(0, 3, group)) +
      layer('Zero', `<DOMFrame index="0" duration="0"><elements>${box()}</elements></DOMFrame>${frame(0, 3, box('#00FF00'))}`) +
      layer('Stroke', frame(0, 3, box('#FF0000', stroke))),
    ));
    const ds = out.report.diagnostics;
    expect(one(ds, 'GROUP_FLATTENED').locations[0]).toMatchObject({ layer: 'Grp', frames: [1, 3], element: 1, source: '<DOMGroup> (2 members)' });
    expect(one(ds, 'FRAME_ZERO_DURATION').locations[0]).toMatchObject({ layer: 'Zero', frames: [1, 1], source: 'duration="0"' });
    expect(one(ds, 'STROKE_CAPS_JOINS').locations[0].source).toBe('stroke style 1 caps="square" joints="miter"');
    expect(one(ds, 'STROKE_SCALE_MODE').locations[0].source).toBe('stroke style 1 scaleMode="none"');
  });

  it('IK pose layers and IK elements', async () => {
    const out = await run(xfl(layer('Bones', frame(0, 2, inst('A')), 'animationType="IK pose"')));
    expect(one(out.report.diagnostics, 'IK_ARMATURE').locations[0]).toMatchObject({ layer: 'Bones' });
  });

  it('thumbnails are reported as not written', async () => {
    const out = await run(xfl(layer('L', frame(0, 1, box()))));
    expect(one(out.report.diagnostics, 'OUTPUT_NO_THUMBNAILS').severity).toBe('info');
  });
});

describe('F2: tween diagnostics count tweens, not frames', () => {
  it('a baked tween counts once; a tween on the last keyframe is not reported; scale flag and colour change are', async () => {
    const tint = (c: string) => `<color><Color tintMultiplier="0.5" tintColor="${c}"/></color>`;
    const startI = `<DOMSymbolInstance libraryItemName="A" symbolType="graphic"><matrix><Matrix tx="10" ty="10"/></matrix>${tint('#FF0000')}</DOMSymbolInstance>`;
    const endI = `<DOMSymbolInstance libraryItemName="A" symbolType="graphic"><matrix><Matrix a="2" d="2" tx="50" ty="10"/></matrix>${tint('#0000FF')}</DOMSymbolInstance>`;
    const out = await run(xfl(layer('Tw',
      frame(0, 10, startI, 'tweenType="motion" motionTweenScale="false"') +
      frame(10, 6, endI, 'tweenType="motion"'),                                   // last keyframe: Animate holds it too
    )));
    const ds = out.report.diagnostics;
    const baked = one(ds, 'TWEEN_BAKED');
    expect(baked.count).toBe(1);                                                 // 1 tween (9 baked frames)
    expect(baked.locations[0]).toMatchObject({ layer: 'Tw', frames: [1, 10], element: 1 });
    expect(find(ds, 'TWEEN_UNPAIRED')).toHaveLength(0);
    expect(find(ds, 'TWEEN_BROKEN_SOURCE')).toHaveLength(0);
    expect(one(ds, 'TWEEN_SCALE_FLAG').count).toBe(1);
    expect(one(ds, 'TWEEN_COLOR_FILTER').locations[0]).toMatchObject({ frames: [1, 10] });
  });

  it('symbol swap, group tween and broken source tweens are told apart', async () => {
    const group = `<DOMGroup><members>${box()}</members></DOMGroup>`;
    const out = await run(xfl(
      layer('Swap', frame(0, 4, inst('A'), 'tweenType="motion"') + frame(4, 1, inst('B', '', 40))) +
      layer('Grp', frame(0, 4, group, 'tweenType="motion"') + frame(4, 1, group)) +
      layer('Two', frame(0, 4, inst('A') + inst('B'), 'tweenType="motion"') + frame(4, 1, inst('A'))),
    ));
    const ds = out.report.diagnostics;
    expect(one(ds, 'TWEEN_SYMBOL_SWAP').locations[0]).toMatchObject({ layer: 'Swap', frames: [1, 4], source: '"A" → "B"' });
    expect(one(ds, 'TWEEN_UNPAIRED').locations[0]).toMatchObject({ layer: 'Grp', frames: [1, 4] });
    const broken = one(ds, 'TWEEN_BROKEN_SOURCE');
    expect(broken.severity).toBe('info');
    expect(broken.locations[0]).toMatchObject({ layer: 'Two', frames: [1, 4] });
  });

  it('held frames without tweens produce no tween diagnostics', async () => {
    const out = await run(xfl(layer('Held', frame(0, 20, inst('A', 'loop="single frame" firstFrame="1"')))));
    const codes = out.report.diagnostics.map((d) => d.code);
    for (const c of ['TWEEN_BAKED', 'TWEEN_UNPAIRED', 'TWEEN_BROKEN_SOURCE', 'TWEEN_SYMBOL_SWAP', 'TWEEN_GUARD']) expect(codes).not.toContain(c);
  });
});

describe('report integrity', () => {
  const sample = () => xfl(
    layer('Tw', frame(0, 6, inst('A'), 'tweenType="motion" name="go"') + frame(6, 3, inst('A', '', 80))) +
    layer('Grp', frame(0, 9, `<DOMGroup><members>${box()}</members></DOMGroup>`), 'locked="true"'),
  );
  it('no duplicate diagnostics and no duplicate locations', async () => {
    const out = await run(sample());
    const keys = out.report.diagnostics.map((d) => `${d.severity}|${d.code}|${d.message}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const d of out.report.diagnostics) {
      const locs = d.locations.map((l) => JSON.stringify(l));
      expect(new Set(locs).size, d.code).toBe(locs.length);
    }
  });
  it('reports and output are deterministic', async () => {
    const a = await run(sample()), b = await run(sample());
    expect(JSON.stringify(a.report.diagnostics)).toBe(JSON.stringify(b.report.diagnostics));
    expect(reportToText(a.report)).toBe(reportToText(b.report));
    expect(a.report.output.sha1).toBe(b.report.output.sha1);
  });
});
