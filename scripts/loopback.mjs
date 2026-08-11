import { packMeta } from "../src/shared/fountain.ts";
import { bitsPerCell, frameByteCapacity, PROFILES, resolveLayout } from "../src/shared/profile.ts";

const profile = PROFILES.fast;
const headerLen = packMeta({
  streamId: 1,
  blockCount: 1,
  blockSize: 1,
  fileSize: 1,
  fileCrc: 1,
  nameBytes: new TextEncoder().encode("x.bin"),
}).length;
const layout = resolveLayout(profile, headerLen);

console.log({
  profile: profile.id,
  grid: profile.grid,
  channelBits: profile.channelBits,
  bitsPerCell: bitsPerCell(profile),
  capacityBytes: frameByteCapacity(profile),
  ...layout,
  theoreticalMbpsAt60fps: Number(((layout.useful * 8 * 60) / 1e6).toFixed(1)),
  theoreticalMbpsAt120fps: Number(((layout.useful * 8 * 120) / 1e6).toFixed(1)),
});
