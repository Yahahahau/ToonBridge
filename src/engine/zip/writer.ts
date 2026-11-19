// Deterministic STORED ZIP64 writer. Mirrors the container ToonSquid itself writes (observed in
// app-made .tsproj files): version 45, UTF-8 flag, zip64 extra in every local + central header,
// zip64 end-of-central-directory record + locator, stored (uncompressed) entries.
import { crc32 } from '../util';

export interface ZipFile { name: string; data?: Uint8Array; dir?: boolean; }

const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01 fixed => deterministic output

export function writeZipStored(files: ZipFile[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const FFFFFFFF = 0xffffffff;
  const z64extra = (usize: number, csize: number, off: number) => {
    const x = new Uint8Array(28);
    const v = new DataView(x.buffer);
    v.setUint16(0, 1, true); v.setUint16(2, 24, true);
    v.setBigUint64(4, BigInt(usize), true); v.setBigUint64(12, BigInt(csize), true); v.setBigUint64(20, BigInt(off), true);
    return x;
  };
  for (const f of files) {
    const name = enc.encode(f.dir && !f.name.endsWith('/') ? f.name + '/' : f.name);
    const data = f.dir ? new Uint8Array(0) : f.data ?? new Uint8Array(0);
    const crc = crc32(data);
    const extra = z64extra(data.length, data.length, offset);
    const lh = new Uint8Array(30 + name.length + extra.length);
    const v = new DataView(lh.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 45, true); v.setUint16(6, 0x0800, true); v.setUint16(8, 0, true);
    v.setUint16(10, DOS_TIME, true); v.setUint16(12, DOS_DATE, true); v.setUint32(14, crc, true);
    v.setUint32(18, FFFFFFFF, true); v.setUint32(22, FFFFFFFF, true);
    v.setUint16(26, name.length, true); v.setUint16(28, extra.length, true);
    lh.set(name, 30); lh.set(extra, 30 + name.length);
    const ch = new Uint8Array(46 + name.length + extra.length);
    const c = new DataView(ch.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 0x032d, true); c.setUint16(6, 45, true); c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true); c.setUint16(12, DOS_TIME, true); c.setUint16(14, DOS_DATE, true); c.setUint32(16, crc, true);
    c.setUint32(20, FFFFFFFF, true); c.setUint32(24, FFFFFFFF, true); c.setUint16(28, name.length, true);
    c.setUint16(30, extra.length, true); c.setUint16(32, 0, true); c.setUint16(34, 0, true); c.setUint16(36, 0, true);
    c.setUint32(38, f.dir ? 0x41ed0010 : 0x81a40000, true); c.setUint32(42, FFFFFFFF, true);
    ch.set(name, 46); ch.set(extra, 46 + name.length);
    chunks.push(lh, data);
    central.push(ch);
    offset += lh.length + data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const tail = new Uint8Array(56 + 20 + 22);
  const t = new DataView(tail.buffer);
  t.setUint32(0, 0x06064b50, true); t.setBigUint64(4, 44n, true); t.setUint16(12, 0x032d, true); t.setUint16(14, 45, true);
  t.setUint32(16, 0, true); t.setUint32(20, 0, true);
  t.setBigUint64(24, BigInt(files.length), true); t.setBigUint64(32, BigInt(files.length), true);
  t.setBigUint64(40, BigInt(cdSize), true); t.setBigUint64(48, BigInt(offset), true);
  t.setUint32(56, 0x07064b50, true); t.setUint32(60, 0, true); t.setBigUint64(64, BigInt(offset + cdSize), true); t.setUint32(72, 1, true);
  t.setUint32(76, 0x06054b50, true); t.setUint16(80, 0, true); t.setUint16(82, 0, true);
  t.setUint16(84, 0xffff, true); t.setUint16(86, 0xffff, true); t.setUint32(88, FFFFFFFF, true); t.setUint32(92, FFFFFFFF, true); t.setUint16(96, 0, true);
  const out = new Uint8Array(offset + cdSize + tail.length);
  let p = 0;
  for (const a of [...chunks, ...central, tail]) { out.set(a, p); p += a.length; }
  return out;
}
