import { packBands, unpackBands, packSlot, unpackSlot } from "../src/shared/band.ts";
import { crc32 } from "../src/shared/crc32.ts";
import { encodePacket, FountainDecoder, packMeta, splitBlocks } from "../src/shared/fountain.ts";
import { bytesToCells, cellsToBytes } from "../src/shared/frame.ts";
import { bitsPerCell, PROFILES, resolveLayout } from "../src/shared/profile.ts";

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

const profile = PROFILES.fast;
assert(profile.mono === true, "mono default");
assert(bitsPerCell(profile) === 1, "1 bit/cell");
assert(profile.packetsPerFrame === 1, "single band");

const cells = new Uint16Array([1, 0, 1, 1, 0, 0, 1, 0]);
const raw = cellsToBytes(cells, 1, 1);
assert(bytesToCells(raw, 1, 8)[0] === 1, "mono bit");

const nameBytes = new TextEncoder().encode("a.bin");
const headerLen = packMeta({
  streamId: 1,
  blockCount: 2,
  blockSize: 100,
  fileSize: 10,
  fileCrc: 1,
  nameBytes,
}).length;
const layout = resolveLayout(profile, headerLen);
assert(layout.bandCount === 1, "1 band");
assert(layout.blockSize >= 64, "block");

const header = {
  streamId: 9,
  blockCount: 2,
  blockSize: layout.blockSize,
  fileSize: 10,
  fileCrc: 0,
  nameBytes,
};
const packets = [{ esi: 0, data: new Uint8Array(layout.blockSize).fill(7) }];
const decoded = unpackBands(packBands(profile, header, packets));
assert(decoded.headerOk && decoded.header?.streamId === 9, "header");
assert(decoded.okBands === 1 && decoded.packets.length === 1, "packet");

console.log("selftest ok", {
  grid: profile.grid,
  fps: profile.fps,
  mono: profile.mono,
  useful: layout.useful,
  mbps: Number(((layout.useful * 8 * profile.fps) / 1e6).toFixed(2)),
});
