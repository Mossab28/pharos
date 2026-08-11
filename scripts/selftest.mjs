import { packBands, unpackBands, packSlot, unpackSlot } from "../src/shared/band.ts";
import { crc32 } from "../src/shared/crc32.ts";
import { encodePacket, FountainDecoder, packMeta, splitBlocks } from "../src/shared/fountain.ts";
import { bytesToCells, cellsToBytes } from "../src/shared/frame.ts";
import { bitsPerCell, PROFILES, resolveLayout } from "../src/shared/profile.ts";
import { packRgb, sampleToCell, unpackRgb } from "../src/shared/colors.ts";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const payload = new TextEncoder().encode("pharos-optical-transfer-selftest-" + "x".repeat(8000));
const blocks = splitBlocks(payload, 512);
const dec = new FountainDecoder(blocks.length, 512, payload.length, crc32(payload));
let esi = 0;
while (!dec.done && esi < blocks.length * 4) {
  dec.ingest(esi, encodePacket(blocks, esi).data);
  esi++;
}
assert(dec.done, "fountain did not finish");

const slot = packSlot(9, new Uint8Array(32).map((_, i) => i));
assert(unpackSlot(slot)?.esi === 9, "slot failed");

// RGB 4-bit channel roundtrip through bit packer
const bpc = 12;
const cells = new Uint16Array(8);
for (let i = 0; i < 8; i++) cells[i] = packRgb(i, (i * 3) & 15, (i * 5) & 15, 4);
const raw = cellsToBytes(cells, bpc, 12);
const backCells = bytesToCells(raw, bpc, 8);
for (let i = 0; i < 8; i++) assert(backCells[i] === cells[i], `cell ${i}`);
const sampled = sampleToCell(255, 128, 0, 4);
const [sr, sg, sb] = unpackRgb(sampled, 4);
assert(sr === 255 && sg > 100 && sb === 0, "sample rgb");

const profile = PROFILES.fast;
assert(bitsPerCell(profile) === 12, "12 bits/cell");
const nameBytes = new TextEncoder().encode("demo.bin");
const headerLen = packMeta({
  streamId: 1,
  blockCount: 10,
  blockSize: 100,
  fileSize: 1000,
  fileCrc: 1,
  nameBytes,
}).length;
const layout = resolveLayout(profile, headerLen);
assert(layout.useful > 90000, `expected >90KB/frame, got ${layout.useful}`);

const header = {
  streamId: 7,
  blockCount: 4,
  blockSize: layout.blockSize,
  fileSize: 100,
  fileCrc: 0,
  nameBytes,
};
const packets = [];
for (let i = 0; i < layout.bandCount; i++) {
  packets.push({ esi: i, data: new Uint8Array(layout.blockSize).fill(i + 1) });
}
const bands = packBands(profile, header, packets);
const decoded = unpackBands(bands);
assert(decoded.header?.streamId === 7, "header missing");
assert(decoded.packets.length === layout.bandCount, "band packets");

const mbps60 = (layout.useful * 8 * 60) / 1e6;
const mbps120 = (layout.useful * 8 * 120) / 1e6;
assert(mbps60 > 45, `expected >45 Mbit/s @60, got ${mbps60}`);
assert(mbps120 > 90, `expected >90 Mbit/s @120, got ${mbps120}`);

console.log("selftest ok", {
  bitsPerCell: bitsPerCell(profile),
  grid: profile.grid,
  blockSize: layout.blockSize,
  bandCount: layout.bandCount,
  usefulBytesPerFrame: layout.useful,
  theoreticalMbpsAt60fps: Number(mbps60.toFixed(1)),
  theoreticalMbpsAt120fps: Number(mbps120.toFixed(1)),
});
