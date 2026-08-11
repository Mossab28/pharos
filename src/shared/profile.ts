export type ProfileId = "fast" | "robust";

export type Profile = {
  id: ProfileId;
  label: string;
  grid: number;
  /** Bits per RGB channel. Total bits/cell = 3 × channelBits. */
  channelBits: 2 | 3 | 4;
  /** Hint only; sender paces on vsync. */
  fps: number;
  blockSize: number;
  /** Horizontal bands = independent CRC'd packets. */
  packetsPerFrame: number;
  finder: number;
  quiet: number;
};

/** On-screen code size, Decimen-like (one square). */
export const DISPLAY_CSS_PX = 560;

export function bitsPerCell(p: Profile): number {
  return p.channelBits * 3;
}

/**
 * Same 560px square, past the old 6-bit palette ceiling.
 * fast: 280² × 12 bits (RGB 4+4+4) ≈ 118 KB / frame, 10 bands, vsync.
 */
export const PROFILES: Record<ProfileId, Profile> = {
  fast: {
    id: "fast",
    label: "Fast",
    grid: 280,
    channelBits: 4,
    fps: 120,
    blockSize: 0,
    packetsPerFrame: 10,
    finder: 4,
    quiet: 1,
  },
  robust: {
    id: "robust",
    label: "Robust",
    grid: 140,
    channelBits: 2,
    fps: 30,
    blockSize: 0,
    packetsPerFrame: 2,
    finder: 7,
    quiet: 2,
  },
};

export function frameByteCapacity(p: Profile): number {
  return Math.floor((p.grid * p.grid * bitsPerCell(p)) / 8);
}

export function outerSize(p: Profile): number {
  return p.grid + 2 * (p.finder + p.quiet);
}

export function bandRowSpan(profile: Profile, bandCount: number, bandIndex: number): { row0: number; rows: number } {
  const base = Math.floor(profile.grid / bandCount);
  const extra = profile.grid % bandCount;
  if (bandIndex < extra) {
    return { row0: bandIndex * (base + 1), rows: base + 1 };
  }
  return { row0: extra * (base + 1) + (bandIndex - extra) * base, rows: base };
}

export function bandByteCapacity(p: Profile, bandCount: number, bandIndex = 0): number {
  const { rows } = bandRowSpan(p, bandCount, bandIndex);
  return Math.floor((rows * p.grid * bitsPerCell(p)) / 8);
}

export function minBandByteCapacity(p: Profile, bandCount: number): number {
  let min = Infinity;
  for (let i = 0; i < bandCount; i++) min = Math.min(min, bandByteCapacity(p, bandCount, i));
  return min === Infinity ? 0 : min;
}

export function resolveLayout(p: Profile, headerLen: number): {
  bandCount: number;
  blockSize: number;
  useful: number;
} {
  const bandCount = Math.max(1, p.packetsPerFrame);
  const band0 = bandByteCapacity(p, bandCount, 0);
  const bandMin = minBandByteCapacity(p, bandCount);
  const from0 = band0 - headerLen - 10;
  const fromOther = bandMin - 10;
  const blockSize = Math.max(128, Math.min(from0, fromOther));
  return { bandCount, blockSize, useful: blockSize * bandCount };
}

export function resolveBlockSize(p: Profile, headerLen = 40): number {
  return resolveLayout(p, headerLen).blockSize;
}

export function resolvePacketCount(p: Profile, _headerLen = 40): number {
  return Math.max(1, p.packetsPerFrame);
}

export function usefulBytesPerFrame(p: Profile, headerLen = 40): number {
  return resolveLayout(p, headerLen).useful;
}
