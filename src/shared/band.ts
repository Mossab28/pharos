import { crc32 } from "./crc32";
import type { FountainHeader } from "./fountain";
import { packMeta, unpackMeta } from "./fountain";
import { bandByteCapacity, type Profile } from "./profile";

export type BandPacket = { esi: number; data: Uint8Array };

/** Slot: esi u32 | len u16 | data | crc32(body) */
export function packSlot(esi: number, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(6 + data.length);
  const v = new DataView(body.buffer);
  v.setUint32(0, esi);
  v.setUint16(4, data.length);
  body.set(data, 6);
  const out = new Uint8Array(body.length + 4);
  out.set(body);
  new DataView(out.buffer).setUint32(body.length, crc32(body));
  return out;
}

export function unpackSlot(buf: Uint8Array): BandPacket | null {
  if (buf.length < 10) return null;
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const len = v.getUint16(4);
  if (buf.length < 6 + len + 4) return null;
  const body = buf.subarray(0, 6 + len);
  if (v.getUint32(6 + len) !== crc32(body)) return null;
  return { esi: v.getUint32(0), data: buf.slice(6, 6 + len) };
}

export function packBands(
  profile: Profile,
  header: FountainHeader,
  packets: BandPacket[],
): Uint8Array[] {
  const bandCount = packets.length;
  const headerBytes = packMeta(header);
  const bands: Uint8Array[] = [];
  for (let i = 0; i < bandCount; i++) {
    const useCap = bandByteCapacity(profile, bandCount, i);
    const slot = packSlot(packets[i]!.esi, packets[i]!.data);
    const out = new Uint8Array(useCap);
    if (i === 0) {
      if (headerBytes.length + slot.length > useCap) throw new Error("band0 overflow");
      out.set(headerBytes, 0);
      out.set(slot, headerBytes.length);
    } else {
      if (slot.length > useCap) throw new Error("band overflow");
      out.set(slot, 0);
    }
    bands.push(out);
  }
  return bands;
}

export function unpackBands(bandBytes: Uint8Array[]): {
  header: FountainHeader | null;
  packets: BandPacket[];
  /** How many bands produced a valid CRC'd slot (or header+slot for band0). */
  okBands: number;
  headerOk: boolean;
} {
  const packets: BandPacket[] = [];
  let header: FountainHeader | null = null;
  let okBands = 0;
  let headerOk = false;
  for (let i = 0; i < bandBytes.length; i++) {
    const raw = bandBytes[i]!;
    if (i === 0) {
      header = unpackMeta(raw);
      headerOk = !!header;
      if (!header) continue;
      const headerLen = 28 + header.nameBytes.length;
      const slot = unpackSlot(raw.subarray(headerLen));
      if (slot) {
        packets.push(slot);
        okBands++;
      }
    } else {
      const slot = unpackSlot(raw);
      if (slot) {
        packets.push(slot);
        okBands++;
      }
    }
  }
  return { header, packets, okBands, headerOk };
}
