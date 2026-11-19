import type { AtlasSource } from './useAtlas';

/**
 * Mascot asset hook-up. Intentionally empty for now — nothing is shown until you fill this in.
 *
 *   1. Put the spritesheet and its XML in  public/mascot/  (e.g. mascot.png + mascot.xml).
 *   2. Point MASCOT_SOURCE at them (paths are relative to the site root, so they work under a sub-path too).
 *   3. When the animation rules are decided, pass an `animation` name from the XML to <Mascot/> where it should appear.
 */
const base = import.meta.env.BASE_URL;
export const MASCOT_SOURCE: AtlasSource | null = null;
// export const MASCOT_SOURCE: AtlasSource | null = { image: `${base}mascot/mascot.png`, xml: `${base}mascot/mascot.xml` };
void base;
