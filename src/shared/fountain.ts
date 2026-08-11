/**
 * Luby Transform fountain code.
 * Sender emits an endless stream of encoded blocks; receiver peels when degree-1
 * equations appear. Any ~K * 1.15 distinct blocks reconstruct the file.
 */

import { crc32 } from "./crc32";

export type FountainHeader = {
  streamId: number;
  blockCount: number;
  blockSize: number;
  fileSize: number;
  fileCrc: number;
  nameBytes: Uint8Array;
};

const META_MAGIC = 0x50485253; // "PHRS"

export function splitBlocks(data: Uint8Array, blockSize: number): Uint8Array[] {
  const blocks: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += blockSize) {
    const b = new Uint8Array(blockSize);
    b.set(data.subarray(i, Math.min(i + blockSize, data.length)));
    blocks.push(b);
  }
  if (blocks.length === 0) blocks.push(new Uint8Array(blockSize));
  return blocks;
}

/** Robust soliton-ish degree sampler. */
export function pickDegree(k: number, rng: () => number): number {
  if (k <= 1) return 1;
  const r = rng();
  if (r < 0.1) return 1;
  if (r < 0.55) return 2;
  if (r < 0.8) return Math.min(k, 3);
  if (r < 0.92) return Math.min(k, 4);
  return 1 + Math.floor(rng() * Math.min(k, 8));
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function selectIndexes(k: number, degree: number, rng: () => number): number[] {
  const set = new Set<number>();
  while (set.size < degree) set.add(Math.floor(rng() * k));
  return [...set];
}

export function encodePacket(blocks: Uint8Array[], esi: number): { indexes: number[]; data: Uint8Array } {
  const k = blocks.length;
  const rng = mulberry32(esi ^ 0x9e3779b9);
  const degree = pickDegree(k, rng);
  const indexes = selectIndexes(k, degree, rng);
  const data = new Uint8Array(blocks[0]!.length);
  for (const i of indexes) {
    const src = blocks[i]!;
    for (let j = 0; j < data.length; j++) data[j]! ^= src[j]!;
  }
  return { indexes, data };
}

export class FountainDecoder {
  readonly k: number;
  readonly blockSize: number;
  readonly fileSize: number;
  readonly fileCrc: number;
  private solved: (Uint8Array | null)[];
  private equations: { indexes: number[]; data: Uint8Array }[] = [];
  solvedCount = 0;
  packetsSeen = 0;
  uniqueEsi = new Set<number>();

  constructor(k: number, blockSize: number, fileSize: number, fileCrc: number) {
    this.k = k;
    this.blockSize = blockSize;
    this.fileSize = fileSize;
    this.fileCrc = fileCrc;
    this.solved = Array.from({ length: k }, () => null);
  }

  get done(): boolean {
    return this.solvedCount >= this.k;
  }

  ingest(esi: number, payload: Uint8Array): boolean {
    this.packetsSeen++;
    this.uniqueEsi.add(esi);
    if (this.done) return true;
    if (payload.length !== this.blockSize) return false;

    const rng = mulberry32(esi ^ 0x9e3779b9);
    const degree = pickDegree(this.k, rng);
    let indexes = selectIndexes(this.k, degree, rng);
    const data = payload.slice();

    // XOR out already-solved blocks
    const remaining: number[] = [];
    for (const i of indexes) {
      const s = this.solved[i];
      if (s) {
        for (let j = 0; j < data.length; j++) data[j]! ^= s[j]!;
      } else remaining.push(i);
    }
    indexes = remaining;
    if (indexes.length === 0) return this.done;

    this.equations.push({ indexes, data });
    this.peel();
    return this.done;
  }

  private peel(): void {
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (let e = 0; e < this.equations.length; ) {
        const eq = this.equations[e]!;
        const live: number[] = [];
        for (const i of eq.indexes) {
          const s = this.solved[i];
          if (s) {
            for (let j = 0; j < eq.data.length; j++) eq.data[j]! ^= s[j]!;
          } else live.push(i);
        }
        eq.indexes = live;
        if (live.length === 0) {
          this.equations.splice(e, 1);
          continue;
        }
        if (live.length === 1) {
          const idx = live[0]!;
          if (!this.solved[idx]) {
            this.solved[idx] = eq.data.slice();
            this.solvedCount++;
            progressed = true;
          }
          this.equations.splice(e, 1);
          continue;
        }
        e++;
      }
    }
  }

  assemble(): Uint8Array | null {
    if (!this.done) return null;
    const out = new Uint8Array(this.k * this.blockSize);
    for (let i = 0; i < this.k; i++) out.set(this.solved[i]!, i * this.blockSize);
    const file = out.subarray(0, this.fileSize);
    if (crc32(file) !== this.fileCrc) return null;
    return file;
  }
}

export function packMeta(h: FountainHeader): Uint8Array {
  const buf = new Uint8Array(28 + h.nameBytes.length);
  const v = new DataView(buf.buffer);
  v.setUint32(0, META_MAGIC);
  v.setUint32(4, h.streamId);
  v.setUint32(8, h.blockCount);
  v.setUint16(12, h.blockSize);
  v.setUint32(14, h.fileSize);
  v.setUint32(18, h.fileCrc);
  v.setUint16(22, h.nameBytes.length);
  v.setUint16(24, 1); // version
  v.setUint16(26, 0); // reserved
  buf.set(h.nameBytes, 28);
  return buf;
}

export function unpackMeta(buf: Uint8Array): FountainHeader | null {
  if (buf.length < 28) return null;
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (v.getUint32(0) !== META_MAGIC) return null;
  const nameLen = v.getUint16(22);
  if (buf.length < 28 + nameLen) return null;
  return {
    streamId: v.getUint32(4),
    blockCount: v.getUint32(8),
    blockSize: v.getUint16(12),
    fileSize: v.getUint32(14),
    fileCrc: v.getUint32(18),
    nameBytes: buf.slice(28, 28 + nameLen),
  };
}
