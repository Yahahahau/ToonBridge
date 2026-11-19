import type { Doc, Timeline } from './ir';
import { timelineLength } from './ir';

export interface TimelineInfo { name: string; frames: number; layers: { name: string; kind: string; visible: boolean; keyframes: number; tweens: number }[]; }
export interface ProjectInfo {
  name: string; width: number; height: number; fps: number; xflVersion?: string; creator?: string;
  scenes: TimelineInfo[]; symbols: { name: string; type: string; frames: number; layers: number }[];
  totals: { keyframes: number; motionTweens: number; shapes: number; instances: number };
}

function tl(t: Timeline): TimelineInfo {
  return {
    name: t.name, frames: timelineLength(t),
    layers: t.layers.map((l) => ({ name: l.name, kind: l.kind, visible: l.visible, keyframes: l.frames.length, tweens: l.frames.filter((f) => f.tween).length })),
  };
}

export function describeDoc(doc: Doc): ProjectInfo {
  let keyframes = 0, motionTweens = 0, shapes = 0, instances = 0;
  const count = (t: Timeline) => {
    for (const l of t.layers) for (const f of l.frames) {
      keyframes++;
      if (f.tween?.kind === 'motion') motionTweens++;
      for (const e of f.elements) { if (e.type === 'shape') shapes++; else instances++; }
    }
  };
  doc.scenes.forEach(count);
  for (const s of doc.symbols.values()) count(s.timeline);
  return {
    name: doc.name, width: doc.width, height: doc.height, fps: doc.fps, xflVersion: doc.xflVersion, creator: doc.creator,
    scenes: doc.scenes.map(tl),
    symbols: [...doc.symbols.values()].map((s) => ({ name: s.name, type: s.symbolType, frames: timelineLength(s.timeline), layers: s.timeline.layers.length })),
    totals: { keyframes, motionTweens, shapes, instances },
  };
}
