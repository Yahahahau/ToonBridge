// Minimal, defensive reader for Microsoft Compound File Binary (MS-CFB / "OLE2"), the container of Flash 1 – CS4 .fla.
// Read-only. Every chain is bounded and loop-checked; sizes are validated against the file. Nothing is executed.
// Spec: [MS-CFB] Compound File Binary File Format (Microsoft Open Specifications).

export const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const FREESECT = 0xffffffff, ENDOFCHAIN = 0xfffffffe, NOSTREAM = 0xffffffff;

export interface CfbLimits { maxFileBytes: number; maxEntries: number; maxStreamBytes: number; }
export const DEFAULT_CFB_LIMITS: CfbLimits = { maxFileBytes: 512 * 1024 * 1024, maxEntries: 200_000, maxStreamBytes: 256 * 1024 * 1024 };

export interface CfbEntry { name: string; path: string; type: 'storage' | 'stream' | 'root'; size: number; start: number; }
export class CfbError extends Error {}

export class CfbFile {
  readonly majorVersion: number;
  readonly sectorSize: number;
  readonly entries: CfbEntry[] = [];
  private fat: Uint32Array;
  private miniFat: Uint32Array = new Uint32Array(0);
  private miniStream: Uint8Array = new Uint8Array(0);
  private miniCutoff: number;
  private dv: DataView;

  constructor(private bytes: Uint8Array, limits: CfbLimits = DEFAULT_CFB_LIMITS) {
    if (bytes.length > limits.maxFileBytes) throw new CfbError(`File is larger than the ${limits.maxFileBytes / 1048576} MB limit.`);
    if (bytes.length < 512 || !CFB_SIGNATURE.every((b, i) => bytes[i] === b)) throw new CfbError('Not an OLE2 compound file.');
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = (o: number) => this.dv.getUint16(o, true), u32 = (o: number) => this.dv.getUint32(o, true);
    if (u16(0x1c) !== 0xfffe) throw new CfbError('Corrupted OLE2 header (byte order mark).');
    this.majorVersion = u16(0x1a);
    const shift = u16(0x1e);
    if (!((this.majorVersion === 3 && shift === 9) || (this.majorVersion === 4 && shift === 12))) throw new CfbError(`Unsupported OLE2 version ${this.majorVersion} / sector shift ${shift}.`);
    if (u16(0x20) !== 6) throw new CfbError('Corrupted OLE2 header (mini sector shift).');
    this.sectorSize = 1 << shift;
    this.miniCutoff = u32(0x38);
    const nFat = u32(0x2c), firstDir = u32(0x30), firstMiniFat = u32(0x3c), nMiniFat = u32(0x40);
    let difatSector = u32(0x44); const nDifat = u32(0x48);
    const nSectors = Math.floor((bytes.length - this.sectorSize) / this.sectorSize) + 1;
    if (nFat > nSectors || nMiniFat > nSectors || nDifat > nSectors) throw new CfbError('Corrupted OLE2 header (sector counts).');

    // DIFAT: 109 entries in the header, then chained DIFAT sectors.
    const fatSectors: number[] = [];
    for (let i = 0; i < 109 && fatSectors.length < nFat; i++) { const s = u32(0x4c + i * 4); if (s !== FREESECT) fatSectors.push(s); }
    const seenDifat = new Set<number>();
    for (let k = 0; k < nDifat && fatSectors.length < nFat; k++) {
      if (difatSector >= nSectors || seenDifat.has(difatSector)) throw new CfbError('Corrupted OLE2 DIFAT chain.');
      seenDifat.add(difatSector);
      const off = this.off(difatSector), per = this.sectorSize / 4 - 1;
      for (let i = 0; i < per && fatSectors.length < nFat; i++) { const s = u32(off + i * 4); if (s !== FREESECT) fatSectors.push(s); }
      difatSector = u32(off + per * 4);
    }
    const per = this.sectorSize / 4;
    this.fat = new Uint32Array(fatSectors.length * per);
    fatSectors.forEach((s, i) => { if (s >= nSectors) throw new CfbError('FAT sector out of range.'); const o = this.off(s); for (let j = 0; j < per; j++) this.fat[i * per + j] = u32(o + j * 4); });

    // Directory
    const dir = this.readChain(firstDir, Infinity);
    const nEntries = Math.floor(dir.length / 128);
    if (nEntries > limits.maxEntries) throw new CfbError('Too many directory entries.');
    const ddv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
    type Raw = { name: string; type: number; left: number; right: number; child: number; start: number; size: number };
    const raw: Raw[] = [];
    for (let i = 0; i < nEntries; i++) {
      const o = i * 128, nameLen = ddv.getUint16(o + 64, true);
      let name = '';
      for (let k = 0; k + 2 < Math.min(nameLen, 64); k += 2) name += String.fromCharCode(ddv.getUint16(o + k, true));
      const lo = ddv.getUint32(o + 120, true), hi = this.majorVersion === 4 ? ddv.getUint32(o + 124, true) : 0;
      raw.push({ name, type: dir[o + 66], left: ddv.getUint32(o + 68, true), right: ddv.getUint32(o + 72, true), child: ddv.getUint32(o + 76, true), start: ddv.getUint32(o + 116, true), size: hi * 2 ** 32 + lo });
    }
    if (!raw.length || raw[0].type !== 5) throw new CfbError('Corrupted OLE2 directory (no root entry).');
    // Mini stream lives in the root entry's chain.
    this.miniStream = this.readChain(raw[0].start, raw[0].size);
    if (nMiniFat) { const mf = this.readChain(firstMiniFat, nMiniFat * this.sectorSize); this.miniFat = new Uint32Array(mf.length / 4); for (let i = 0; i < this.miniFat.length; i++) this.miniFat[i] = new DataView(mf.buffer, mf.byteOffset).getUint32(i * 4, true); }
    // Walk the red-black trees iteratively (no recursion), each entry at most once.
    const visited = new Set<number>();
    const stack: { id: number; parent: string }[] = [{ id: raw[0].child, parent: '' }];
    this.entries.push({ name: raw[0].name, path: '', type: 'root', size: raw[0].size, start: raw[0].start });
    while (stack.length) {
      const { id, parent } = stack.pop()!;
      if (id === NOSTREAM) continue;
      if (id >= raw.length || visited.has(id)) throw new CfbError('Corrupted OLE2 directory tree.');
      visited.add(id);
      const r = raw[id];
      stack.push({ id: r.left, parent }, { id: r.right, parent });
      const path = parent ? `${parent}/${r.name}` : r.name;
      if (r.type === 1) { this.entries.push({ name: r.name, path, type: 'storage', size: 0, start: 0 }); stack.push({ id: r.child, parent: path }); }
      else if (r.type === 2) {
        if (r.size > limits.maxStreamBytes) throw new CfbError(`Stream "${path}" exceeds the size limit.`);
        this.entries.push({ name: r.name, path, type: 'stream', size: r.size, start: r.start });
      }
    }
  }

  private off(sector: number): number {
    const o = (sector + 1) * this.sectorSize;
    if (o >= this.bytes.length) throw new CfbError('Sector beyond end of file.');
    return o;
  }

  /** Follows a FAT chain, copying at most `size` bytes. Detects loops and out-of-range sectors. */
  private readChain(start: number, size: number): Uint8Array {
    const parts: Uint8Array[] = []; let total = 0; let s = start; const seen = new Set<number>();
    while (s !== ENDOFCHAIN && total < size) {
      if (s >= this.fat.length || seen.has(s)) throw new CfbError('Corrupted OLE2 sector chain.');
      seen.add(s);
      const o = this.off(s);
      const piece = this.bytes.subarray(o, Math.min(o + this.sectorSize, this.bytes.length));
      parts.push(piece); total += piece.length;
      s = this.fat[s];
    }
    if (size !== Infinity && total < size) throw new CfbError('OLE2 stream is truncated.');
    const out = new Uint8Array(size === Infinity ? total : size);
    let p = 0; for (const x of parts) { const n = Math.min(x.length, out.length - p); out.set(x.subarray(0, n), p); p += n; if (p >= out.length) break; }
    return out;
  }

  private readMini(start: number, size: number): Uint8Array {
    const out = new Uint8Array(size); let p = 0; let s = start; const seen = new Set<number>();
    while (p < size) {
      if (s === ENDOFCHAIN || s >= this.miniFat.length || seen.has(s)) throw new CfbError('Corrupted OLE2 mini stream chain.');
      seen.add(s);
      const o = s * 64; const n = Math.min(64, size - p);
      if (o + n > this.miniStream.length) throw new CfbError('Mini sector beyond mini stream.');
      out.set(this.miniStream.subarray(o, o + n), p); p += n; s = this.miniFat[s];
    }
    return out;
  }

  streams(): CfbEntry[] { return this.entries.filter((e) => e.type === 'stream'); }
  read(path: string): Uint8Array {
    const e = this.entries.find((x) => x.type === 'stream' && x.path === path);
    if (!e) throw new CfbError(`No stream "${path}".`);
    return e.size < this.miniCutoff ? this.readMini(e.start, e.size) : this.readChain(e.start, e.size);
  }
}
