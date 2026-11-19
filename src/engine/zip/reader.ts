// Tolerant ZIP reader. Walks LOCAL file headers sequentially instead of trusting the
// central directory, because Animate-produced .fla files observed in research have a
// damaged central directory. Central directory presence is only reported, never required.
import { inflateSync } from 'fflate';
import { crc32 } from '../util';

export interface ZipReadResult {
  entries: Map<string, Uint8Array>;
  /** 'central-ok' when an EOCD record was found and its entry count matches; else 'scan-only'. */
  mode: 'central-ok' | 'scan-only';
  warnings: string[];
}

const SIG_LOCAL = 0x04034b50, SIG_CEN = 0x02014b50, SIG_DESC = 0x08074b50, SIG_EOCD = 0x06054b50;

/** Preferred path: trust the central directory when it is complete and self-consistent. */
function readViaCentral(buf: Uint8Array): ZipReadResult | null {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (dv.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  if (eocd < 0) return null;
  let total = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  if (total === 0xffff || p === 0xffffffff) {
    // ZIP64: locator sits right before the EOCD
    const loc = eocd - 20;
    if (loc < 0 || dv.getUint32(loc, true) !== 0x07064b50) return null;
    const z = Number(dv.getBigUint64(loc + 8, true));
    if (z < 0 || z + 56 > buf.length || dv.getUint32(z, true) !== 0x06064b50) return null;
    total = Number(dv.getBigUint64(z + 32, true));
    p = Number(dv.getBigUint64(z + 48, true));
  }
  const entries = new Map<string, Uint8Array>();
  try {
    for (let n = 0; n < total; n++) {
      if (p + 46 > buf.length || dv.getUint32(p, true) !== SIG_CEN) return null;
      const method = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true);
      let csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
      const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      let off = dv.getUint32(p + 42, true);
      const name = new TextDecoder('utf-8').decode(buf.subarray(p + 46, p + 46 + nlen));
      // zip64 extra (id 0x0001): fields present only for the 32-bit values that are 0xFFFFFFFF, in order usize, csize, offset
      let q = p + 46 + nlen; const qEnd = q + elen;
      while (q + 4 <= qEnd) {
        const id = dv.getUint16(q, true), sz = dv.getUint16(q + 2, true);
        if (id === 1) {
          let r = q + 4;
          if (usize === 0xffffffff) { usize = Number(dv.getBigUint64(r, true)); r += 8; }
          if (csize === 0xffffffff) { csize = Number(dv.getBigUint64(r, true)); r += 8; }
          if (off === 0xffffffff) { off = Number(dv.getBigUint64(r, true)); r += 8; }
        }
        q += 4 + sz;
      }
      p += 46 + nlen + elen + clen;
      if (off + 30 > buf.length || dv.getUint32(off, true) !== SIG_LOCAL) return null;
      const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
      if (name.endsWith('/')) continue;
      const raw = buf.subarray(start, start + csize);
      const data = method === 0 ? raw.slice() : method === 8 ? inflateSync(raw) : null;
      if (!data || data.length !== usize || crc32(data) !== crc) return null;
      entries.set(name, data);
    }
  } catch { return null; }
  return { entries, mode: 'central-ok', warnings: [] };
}

export function readZipTolerant(buf: Uint8Array): ZipReadResult {
  const viaCentral = readViaCentral(buf);
  if (viaCentral) return viaCentral;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const entries = new Map<string, Uint8Array>();
  const warnings: string[] = [];
  const u32 = (o: number) => (o + 4 <= buf.length ? dv.getUint32(o, true) : 0);
  const findSig = (sig: number, from: number): number => {
    const b0 = sig & 0xff, b1 = (sig >> 8) & 0xff, b2 = (sig >> 16) & 0xff, b3 = (sig >>> 24) & 0xff;
    for (let i = from; i + 4 <= buf.length; i++)
      if (buf[i] === b0 && buf[i + 1] === b1 && buf[i + 2] === b2 && buf[i + 3] === b3) return i;
    return -1;
  };

  let pos = 0;
  let seen = 0;
  while (pos + 30 <= buf.length) {
    if (u32(pos) !== SIG_LOCAL) {
      if (u32(pos) === SIG_CEN || u32(pos) === SIG_EOCD) break;
      const nx = findSig(SIG_LOCAL, pos + 1);
      if (nx < 0) break;
      warnings.push(`ZIP: ${nx - pos} stray bytes skipped at offset ${pos}`);
      pos = nx;
      continue;
    }
    const flag = dv.getUint16(pos + 6, true);
    const method = dv.getUint16(pos + 8, true);
    const crc = dv.getUint32(pos + 14, true);
    let csize = dv.getUint32(pos + 18, true);
    let usize = dv.getUint32(pos + 22, true);
    const nlen = dv.getUint16(pos + 26, true);
    const elen = dv.getUint16(pos + 28, true);
    const nameBytes = buf.subarray(pos + 30, pos + 30 + nlen);
    const name = new TextDecoder('utf-8').decode(nameBytes);
    const dataStart = pos + 30 + nlen + elen;
    if (csize === 0xffffffff || usize === 0xffffffff) {
      for (let q = pos + 30 + nlen; q + 4 <= dataStart;) {
        const id = dv.getUint16(q, true), sz = dv.getUint16(q + 2, true);
        if (id === 1) { usize = Number(dv.getBigUint64(q + 4, true)); csize = Number(dv.getBigUint64(q + 12, true)); }
        q += 4 + sz;
      }
    }
    const hasDesc = (flag & 8) !== 0;
    let data: Uint8Array | null = null;
    let next = dataStart;

    if (name.endsWith('/')) {
      next = dataStart;
    } else if (!hasDesc || csize > 0) {
      const raw = buf.subarray(dataStart, dataStart + csize);
      try {
        data = method === 0 ? raw.slice() : method === 8 ? inflateSync(raw) : null;
        if (!data) warnings.push(`ZIP: unsupported compression method ${method} for "${name}"`);
      } catch (e) {
        warnings.push(`ZIP: cannot inflate "${name}": ${(e as Error).message}`);
      }
      next = dataStart + csize;
      if (hasDesc) { if (u32(next) === SIG_DESC) next += 16; else next += 12; }
    } else {
      // Sizes live in a trailing data descriptor: locate the entry end by trial inflation.
      let cand = dataStart;
      let ok = false;
      while (!ok) {
        const d = findSig(SIG_DESC, cand);
        const l = findSig(SIG_LOCAL, cand);
        const c = findSig(SIG_CEN, cand);
        const cands = [d, l, c].filter((x) => x >= 0).sort((a, b) => a - b);
        if (!cands.length) break;
        const end = cands[0];
        cand = end + 1;
        const raw = buf.subarray(dataStart, end);
        try {
          const out = method === 0 ? raw.slice() : inflateSync(raw);
          const dcrc = end === d ? u32(end + 4) : 0;
          if (end === d && dcrc !== 0 && crc32(out) !== dcrc) continue;
          data = out; csize = end - dataStart; next = end === d ? end + 16 : end; ok = true;
        } catch { /* try next candidate */ }
      }
      if (!ok) { warnings.push(`ZIP: could not recover "${name}" (data descriptor)`); break; }
    }

    if (data) {
      if (!hasDesc && method !== 8 && crc && crc32(data) !== crc) warnings.push(`ZIP: CRC mismatch for "${name}"`);
      if (!hasDesc && usize && data.length !== usize) warnings.push(`ZIP: size mismatch for "${name}"`);
      entries.set(name, data);
    }
    seen++;
    pos = next;
  }

  // Report on central directory state (informational).
  let mode: ZipReadResult['mode'] = 'scan-only';
  const eocd = (() => { for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (u32(i) === SIG_EOCD) return i; return -1; })();
  if (eocd >= 0) {
    const total = dv.getUint16(eocd + 10, true);
    const cdOff = dv.getUint32(eocd + 16, true);
    if (total !== 0xffff && total === seen && u32(cdOff) === SIG_CEN) mode = 'central-ok';
  }
  if (mode === 'scan-only') warnings.push('ZIP: central directory missing or damaged; entries recovered from local headers');
  return { entries, mode, warnings };
}
