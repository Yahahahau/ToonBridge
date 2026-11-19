import { describe, expect, it } from 'vitest';
import { parseAtlasXml } from '../src/mascot/atlas';

const XML = `<?xml version="1.0" encoding="utf-8"?>
<TextureAtlas imagePath="m.png">
  <SubTexture name="wave0002" x="20" y="0" width="10" height="12" frameX="-1" frameY="-2" frameWidth="14" frameHeight="16"/>
  <SubTexture name="wave0001" x="10" y="0" width="10" height="12"/>
  <SubTexture name="blink0000" x="0" y="0" width="8" height="8" rotated="true"/>
</TextureAtlas>`;

describe('atlas XML (Sparrow/Starling)', () => {
  it('reads frames and groups them by name prefix in numeric order — without inventing anything', () => {
    const a = parseAtlasXml(XML);
    expect(a.imagePath).toBe('m.png');
    expect(a.frames).toHaveLength(3);
    expect([...a.animations.keys()].sort()).toEqual(['blink', 'wave']);
    expect(a.animations.get('wave')!.map((f) => f.name)).toEqual(['wave0001', 'wave0002']);
    const f = a.animations.get('wave')![1];
    expect([f.frameX, f.frameY, f.frameWidth, f.frameHeight]).toEqual([-1, -2, 14, 16]);
    expect(a.animations.get('wave')![0].frameWidth).toBe(10);    // defaults to the region size when untrimmed
    expect(a.animations.get('blink')![0].rotated).toBe(true);
  });
  it('rejects XML that is not an atlas', () => {
    expect(() => parseAtlasXml('<foo/>')).toThrow(/TextureAtlas/);
    expect(() => parseAtlasXml('<TextureAtlas imagePath="x"/>')).toThrow(/SubTexture/);
  });
  it('handles a single SubTexture', () => {
    expect(parseAtlasXml('<TextureAtlas><SubTexture name="a0" x="0" y="0" width="1" height="1"/></TextureAtlas>').frames).toHaveLength(1);
  });
});
