import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeInput, LegacyFlaError, UnsupportedInputError } from '../src/engine';
import { detectInput } from '../src/engine/legacy/detect';
import { CfbFile } from '../src/engine/legacy/cfb';

const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
describe('format detection (by signature, not extension)', () => {
  it('recognises ZIP, the .xfl entry file and unknown data', () => {
    expect(detectInput(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0])).kind).toBe('zip');
    expect(detectInput(new TextEncoder().encode('PROXY-CS5')).kind).toBe('xfl-entry');
    expect(detectInput(new TextEncoder().encode('hello')).kind).toBe('unknown');
  });
  it('reports a truncated or corrupted OLE2 file instead of crashing', () => {
    expect(detectInput(new Uint8Array([...OLE, 0, 0])).kind).toBe('corrupt');
    const bad = new Uint8Array(1024); bad.set(OLE); bad[0x1c] = 0xfe; bad[0x1d] = 0xff;
    const r = detectInput(bad); expect(r.kind).toBe('corrupt');
  });
  it('rejects a sector chain that loops', () => {
    // header: v3, 512-byte sectors, 1 FAT sector at #0, directory starting at #1; FAT makes #1 point to itself
    const b = new Uint8Array(512 * 3); b.set(OLE);
    const dv = new DataView(b.buffer);
    dv.setUint16(0x18, 0x3e, true); dv.setUint16(0x1a, 3, true); dv.setUint16(0x1c, 0xfffe, true); dv.setUint16(0x1e, 9, true); dv.setUint16(0x20, 6, true);
    dv.setUint32(0x2c, 1, true); dv.setUint32(0x30, 1, true); dv.setUint32(0x38, 4096, true); dv.setUint32(0x3c, 0xfffffffe, true); dv.setUint32(0x44, 0xfffffffe, true);
    for (let i = 0; i < 109; i++) dv.setUint32(0x4c + i * 4, 0xffffffff, true);
    dv.setUint32(0x4c, 0, true);
    for (let i = 0; i < 128; i++) dv.setUint32(512 + i * 4, 0xffffffff, true);
    dv.setUint32(512, 0xfffffffd, true); dv.setUint32(512 + 4, 1, true); // sector 1 -> 1 (loop)
    expect(() => new CfbFile(b)).toThrow(/chain/);
  });
});

const dir = process.env.A2T_FIXTURES;
const legacy = dir ? ['BoyFriend_Assets.fla', 'GF_assets.fla'].map((f) => join(dir, f)).filter(existsSync) : [];
describe.skipIf(!legacy.length)('real legacy binary FLA files', () => {
  it.each(legacy)('%s is detected as Flash CS4 with its streams, and gets a clear message', (f) => {
    const bytes = new Uint8Array(readFileSync(f));
    const r = detectInput(bytes);
    expect(r.kind).toBe('legacy-fla');
    if (r.kind !== 'legacy-fla') return;
    expect(r.info.version).toBe('Flash CS4');
    expect(r.info.streamNaming).toBe('cs3-cs4');
    expect(r.info.counts.pages).toBe(1);
    expect(r.info.counts.symbols).toBeGreaterThan(10);
    expect(() => analyzeInput(bytes, 'x.fla')).toThrow(LegacyFlaError);
    expect(() => analyzeInput(bytes, 'x.fla')).toThrow(UnsupportedInputError);
  });
});
