import { useEffect, useMemo, useRef } from 'react';
import type { AtlasFrame } from './atlas';
import { useAtlas, type AtlasSource } from './useAtlas';

export interface MascotProps {
  /** Spritesheet image + Sparrow/Starling XML. Nothing is drawn until both load. */
  source: AtlasSource | null | undefined;
  /** Name of an animation as it appears in the XML (frame-name prefix). Nothing is drawn while undefined. */
  animation?: string;
  fps?: number;
  loop?: boolean;
  playing?: boolean;
  /** CSS height of the mascot; width follows the sprite's own aspect ratio (never stretched). */
  height?: number | string;
  className?: string;
  onEnd?: () => void;
  onError?: (message: string) => void;
}

/**
 * Reusable sprite-sheet mascot. It is deliberately "dumb": it plays whatever animation it is told to play, at the fps it is
 * given. Which animation plays when is decided by the caller (to be specified later), not here.
 */
export function Mascot({ source, animation, fps = 24, loop = true, playing = true, height = 160, className, onEnd, onError }: MascotProps) {
  const state = useAtlas(source);
  const canvas = useRef<HTMLCanvasElement>(null);
  const cb = useRef({ onEnd, onError }); cb.current = { onEnd, onError };

  const frames: AtlasFrame[] | null = useMemo(() => {
    if (state.status !== 'ready' || !animation) return null;
    return state.data.atlas.animations.get(animation) ?? null;
  }, [state, animation]);

  useEffect(() => { if (state.status === 'error') cb.current.onError?.(state.message); }, [state]);
  useEffect(() => {
    if (state.status === 'ready' && animation && !frames) cb.current.onError?.(`Mascot animation "${animation}" is not in the XML.`);
    if (frames?.some((f) => f.rotated)) cb.current.onError?.('Rotated atlas frames are not supported yet.');
  }, [state, animation, frames]);

  // Logical size = the largest untrimmed frame of this animation, so the sprite keeps its proportions across frames.
  const size = useMemo(() => {
    if (!frames) return null;
    return { w: Math.max(...frames.map((f) => f.frameWidth)), h: Math.max(...frames.map((f) => f.frameHeight)) };
  }, [frames]);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !frames || !size || state.status !== 'ready' || frames.some((f) => f.rotated)) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const img = state.data.image;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const draw = (f: AtlasFrame) => {
      ctx.clearRect(0, 0, cv.width, cv.height);
      const k = cv.width / size.w;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, f.x, f.y, f.width, f.height, -f.frameX * k, -f.frameY * k, f.width * k, f.height * k);
    };
    let i = 0;
    draw(frames[0]);
    if (!playing || reduce || frames.length < 2) return;
    let raf = 0, last = performance.now(), acc = 0;
    const step = 1000 / fps;
    const tick = (t: number) => {
      acc += t - last; last = t;
      let moved = false;
      while (acc >= step) {
        acc -= step; i++; moved = true;
        if (i >= frames.length) {
          if (loop) i = 0; else { i = frames.length - 1; cb.current.onEnd?.(); draw(frames[i]); return; }
        }
      }
      if (moved) draw(frames[i]);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [frames, size, state, fps, loop, playing]);

  if (!frames || !size) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const cssH = typeof height === 'number' ? height : 160;
  const w = Math.round(size.w * (cssH * dpr) / size.h), h = Math.round(cssH * dpr);
  return (
    <canvas ref={canvas} className={className} width={w} height={h} role="img" aria-hidden="true"
      style={{ height, aspectRatio: `${size.w} / ${size.h}`, width: 'auto', background: 'transparent' }} />
  );
}
