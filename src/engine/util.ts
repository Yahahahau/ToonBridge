// Deterministic helpers: SHA-1, UUIDv5, CRC-32, rounding, fixed timestamp.

export const FIXED_DATE = '2026-01-01T00:00:00Z';
/** Fixed namespace for all UUIDv5 values produced by this converter. */
export const NAMESPACE = '6f1b6a0e-3c1d-5d6f-9a53-61ae0c2f7e01';

export function sha1(data: Uint8Array): Uint8Array {
  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const len = data.length;
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor((len * 8) / 0x100000000));
  dv.setUint32(padded.length - 4, (len * 8) >>> 0);
  const w = new Uint32Array(80);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (x << 1) | (x >>> 31);
    }
    let [a, b, c, d, e] = h;
    for (let i = 0; i < 80; i++) {
      let f: number, k: number;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
      e = d; d = c; c = ((b << 30) | (b >>> 2)) >>> 0; b = a; a = t;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0; h[4] = (h[4] + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const odv = new DataView(out.buffer);
  h.forEach((v, i) => odv.setUint32(i * 4, v));
  return out;
}

export function hex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

function uuidBytes(u: string): Uint8Array {
  const h = u.replace(/-/g, '');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

/** RFC 4122 UUIDv5, returned UPPERCASE (as ToonSquid writes its ids). */
export function uuid5(name: string, ns: string = NAMESPACE): string {
  const nb = uuidBytes(ns);
  const enc = new TextEncoder().encode(name);
  const buf = new Uint8Array(nb.length + enc.length);
  buf.set(nb); buf.set(enc, nb.length);
  const d = sha1(buf).slice(0, 16);
  d[6] = (d[6] & 0x0f) | 0x50;
  d[8] = (d[8] & 0x3f) | 0x80;
  const h = hex(d);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`.toUpperCase();
}

let crcTable: Uint32Array | null = null;
export function crc32(buf: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Fixed-precision rounding (R7): 4 decimals, never -0. */
export function rnd(n: number): number {
  const r = Math.round(n * 10000) / 10000;
  return r === 0 ? 0 : r;
}
