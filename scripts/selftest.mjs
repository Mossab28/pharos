import { packBands, unpackBands, packSlot, unpackSlot } from "../src/shared/band.ts";
import { crc32 } from "../src/shared/crc32.ts";
import { encodePacket, FountainDecoder, packMeta, splitBlocks } from "../src/shared/fountain.ts";
import { bytesToCells, cellsToBytes } from "../src/shared/frame.ts";
import { bitsPerCell, PROFILES, resolveLayout } from "../src/shared/profile.ts";
import { packRgb } from "../src/shared/colors.ts";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const payload = new TextEncoder().encode("pharos-selftest-" + "x".repeat(4000));
const blocks = splitBlocks(payload, 256);
const dec = new FountainDecoder(blocks.length, 256, payload.length, crc32(payload));
let esi = 0;
while (!dec.done && esi < blocks.length * 4) {
  dec.ingest(esi, encodePacket(blocks, esi).data);
  esi++;
}
assert(dec.done, "fountain failed");
assert(unpackSlot(packSlot(3, new Uint8Array([1, 2, 3])))?.esi === 3, "slot");

const cells = new Uint16Array([packRgb(0, 1, 2, 2), packRgb(3, 2, 1, 2)]);
const raw = cellsToBytes(cells, 6, 2);
assert(bytesToCells(raw, 6, 2)[0] === cells[0], "bit pack");

const profile = PROFILES.fast;
assert(profile.fps <= 20, "send fps must be phone-friendly");
assert(bitsPerCell(profile) === 6, "6 bits/cell");
const headerLen = packMeta({
  streamId: 1,
  blockCount: 2,
  blockSize: 100,
  fileSize: 10,
  fileCrc: 1,
  nameBytes: new TextEncoder().encode("a.bin"),
}).length;
const layout = resolveLayout(profile, headerLen);
assert(layout.bandCount === 4, "4 bands");
assert(layout.blockSize >= 64, "block size");

const header = {
  streamId: 9,
  blockCount: 2,
  blockSize: layout.blockSize,
  fileSize: 10,
  fileCrc: 0,
  nameBytes: new TextEncoder().encode("a.bin"),
};
const packets = Array.from({ length: layout.bandCount }, (_, i) => ({
  esi: i,
  data: new Uint8Array(layout.blockSize).fill(i + 1),
}));
const decoded = unpackBands(packBands(profile, header, packets));
assert(decoded.header?.streamId === 9, "header");
assert(decoded.packets.length === layout.bandCount, "packets");

console.log("selftest ok", {
  grid: profile.grid,
  fps: profile.fps,
  useful: layout.useful,
  mbpsAtSendFps: Number(((layout.useful * 8 * profile.fps) / 1e6).toFixed(2)),
});
