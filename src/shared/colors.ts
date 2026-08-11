/** Per-channel quantization (replaces small palettes for high density). */

export function levelCount(channelBits: number): number {
  return 1 << channelBits;
}

export function levelValue(level: number, channelBits: number): number {
  const n = levelCount(channelBits) - 1;
  return Math.round((level / n) * 255);
}

export function quantizeChannel(value: number, channelBits: number): number {
  const n = levelCount(channelBits) - 1;
  return Math.min(n, Math.max(0, Math.round((value / 255) * n)));
}

export function packRgb(r: number, g: number, b: number, channelBits: number): number {
  const mask = (1 << channelBits) - 1;
  return ((r & mask) << (2 * channelBits)) | ((g & mask) << channelBits) | (b & mask);
}

export function unpackRgb(cell: number, channelBits: number): [number, number, number] {
  const mask = (1 << channelBits) - 1;
  const r = (cell >> (2 * channelBits)) & mask;
  const g = (cell >> channelBits) & mask;
  const b = cell & mask;
  return [levelValue(r, channelBits), levelValue(g, channelBits), levelValue(b, channelBits)];
}

export function sampleToCell(r: number, g: number, b: number, channelBits: number): number {
  return packRgb(
    quantizeChannel(r, channelBits),
    quantizeChannel(g, channelBits),
    quantizeChannel(b, channelBits),
    channelBits,
  );
}
