import { XMLParser } from 'fast-xml-parser';

/**
 * Sparrow / Starling texture-atlas XML (the format Adobe Animate's "Generate Sprite Sheet" and
 * most 2D tools export):
 *   <TextureAtlas imagePath="mascot.png">
 *     <SubTexture name="idle0000" x="0" y="0" width="120" height="140" frameX="-4" frameY="-2" frameWidth="128" frameHeight="144"/>
 *   </TextureAtlas>
 *
 * This module only READS what the file says. It never invents animation names, order or timing:
 * "animations" are simply the frame names with their trailing frame number removed, sorted by that number.
 */
export interface AtlasFrame {
  name: string;
  x: number; y: number; width: number; height: number;       // region in the sheet
  frameX: number; frameY: number; frameWidth: number; frameHeight: number; // logical (untrimmed) frame
  rotated: boolean;
}
export interface Atlas {
  imagePath?: string;
  frames: AtlasFrame[];
  /** frame-name prefix -> frames in numeric order */
  animations: Map<string, AtlasFrame[]>;
}

const num = (v: unknown, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const bool = (v: unknown) => v === true || v === 'true' || v === '1';

export function parseAtlasXml(xml: string): Atlas {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', allowBooleanAttributes: true });
  const doc = parser.parse(xml) as Record<string, any>;
  const root = doc.TextureAtlas;
  if (!root) throw new Error('Atlas XML has no <TextureAtlas> root.');
  const raw = root.SubTexture ?? [];
  const list: Record<string, string>[] = Array.isArray(raw) ? raw : [raw];
  if (!list.length) throw new Error('Atlas XML contains no <SubTexture> frames.');
  const frames: AtlasFrame[] = list.map((s) => {
    const width = num(s.width), height = num(s.height);
    return {
      name: String(s.name),
      x: num(s.x), y: num(s.y), width, height,
      frameX: num(s.frameX), frameY: num(s.frameY),
      frameWidth: num(s.frameWidth, width), frameHeight: num(s.frameHeight, height),
      rotated: bool(s.rotated),
    };
  });
  const groups = new Map<string, { n: number; f: AtlasFrame }[]>();
  for (const f of frames) {
    const m = /^(.*?)(\d+)$/.exec(f.name);
    const key = m ? m[1] : f.name;
    const arr = groups.get(key) ?? [];
    arr.push({ n: m ? parseInt(m[2], 10) : 0, f });
    groups.set(key, arr);
  }
  const animations = new Map<string, AtlasFrame[]>();
  for (const [k, v] of groups) animations.set(k, v.sort((a, b) => a.n - b.n).map((e) => e.f));
  return { imagePath: root.imagePath, frames, animations };
}
