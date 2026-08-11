import { sampleToCell, unpackRgb } from "./colors";
import { applyHomography, homographyFromPoints, type Point } from "./geometry";
import { bandRowSpan, bitsPerCell, outerSize, type Profile } from "./profile";

export function profileCode(id: string): number {
  return id === "robust" ? 1 : 0;
}

/** Cell values may need up to 12 bits → Uint16. */
export function bytesToCells(bytes: Uint8Array, bpc: number, cellCount: number): Uint16Array {
  const cells = new Uint16Array(cellCount);
  const mask = bpc >= 16 ? 0xffff : (1 << bpc) - 1;
  let bitPos = 0;
  const totalBits = bytes.length * 8;
  for (let i = 0; i < cellCount; i++) {
    if (bitPos >= totalBits) break;
    let val = 0;
    for (let b = 0; b < bpc && bitPos < totalBits; b++, bitPos++) {
      const byteIndex = bitPos >> 3;
      const bitOffset = bitPos & 7;
      if ((bytes[byteIndex]! >> bitOffset) & 1) val |= 1 << b;
    }
    cells[i] = val & mask;
  }
  return cells;
}

export function cellsToBytes(cells: Uint16Array, bpc: number, byteLength: number): Uint8Array {
  const out = new Uint8Array(byteLength);
  let bitPos = 0;
  const totalBits = byteLength * 8;
  for (let i = 0; i < cells.length && bitPos < totalBits; i++) {
    const val = cells[i]!;
    for (let b = 0; b < bpc && bitPos < totalBits; b++, bitPos++) {
      if ((val >> b) & 1) {
        const byteIndex = bitPos >> 3;
        const bitOffset = bitPos & 7;
        out[byteIndex]! |= 1 << bitOffset;
      }
    }
  }
  return out;
}

function fillRect(
  data: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  r: number,
  g: number,
  b: number,
): void {
  for (let y = y0; y < y0 + h; y++) {
    let o = (y * width + x0) * 4;
    for (let x = 0; x < w; x++) {
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
      o += 4;
    }
  }
}

/** Solid color finder with black ring + white gap (camera-friendly). */
function drawColorFinder(
  data: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  size: number,
  cell: number,
  r: number,
  g: number,
  b: number,
): void {
  fillRect(data, width, x0, y0, size, size, 0, 0, 0);
  fillRect(data, width, x0 + cell, y0 + cell, size - 2 * cell, size - 2 * cell, 255, 255, 255);
  fillRect(data, width, x0 + 2 * cell, y0 + 2 * cell, size - 4 * cell, size - 4 * cell, r, g, b);
}

export function renderBands(
  canvas: HTMLCanvasElement,
  profile: Profile,
  bands: Uint8Array[],
  pixelPerCell: number,
  frameSeq: number,
): void {
  const outer = outerSize(profile);
  const px = outer * pixelPerCell;
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d", { alpha: false })!;
  ctx.imageSmoothingEnabled = false;
  const img = ctx.createImageData(px, px);
  // Light grey surround so the white code plate pops on any desktop wallpaper.
  img.data.fill(230);

  const fs = profile.finder * pixelPerCell;
  // White plate
  fillRect(img.data, px, 0, 0, px, px, 255, 255, 255);
  // Thick black outer frame
  fillRect(img.data, px, 0, 0, px, pixelPerCell, 0, 0, 0);
  fillRect(img.data, px, 0, px - pixelPerCell, px, pixelPerCell, 0, 0, 0);
  fillRect(img.data, px, 0, 0, pixelPerCell, px, 0, 0, 0);
  fillRect(img.data, px, px - pixelPerCell, 0, pixelPerCell, px, 0, 0, 0);

  // TL red, TR green, BR blue, BL yellow
  drawColorFinder(img.data, px, 0, 0, fs, pixelPerCell, 255, 0, 0);
  drawColorFinder(img.data, px, px - fs, 0, fs, pixelPerCell, 0, 255, 0);
  drawColorFinder(img.data, px, px - fs, px - fs, fs, pixelPerCell, 0, 0, 255);
  drawColorFinder(img.data, px, 0, px - fs, fs, pixelPerCell, 255, 255, 0);

  const parity = frameSeq & 1;
  for (let i = profile.finder; i < outer - profile.finder; i++) {
    const on = ((i + parity) & 1) === 0;
    const v = on ? 0 : 255;
    fillRect(img.data, px, i * pixelPerCell, profile.quiet * pixelPerCell, pixelPerCell, pixelPerCell, v, v, v);
    fillRect(img.data, px, profile.quiet * pixelPerCell, i * pixelPerCell, pixelPerCell, pixelPerCell, v, v, v);
  }

  const origin = (profile.finder + profile.quiet) * pixelPerCell;
  const bpc = bitsPerCell(profile);
  const bandCount = bands.length;

  for (let bi = 0; bi < bandCount; bi++) {
    const { row0, rows } = bandRowSpan(profile, bandCount, bi);
    const cellCount = rows * profile.grid;
    const cells = bytesToCells(bands[bi]!, bpc, cellCount);
    let idx = 0;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < profile.grid; col++) {
        const [r, g, b] = unpackRgb(cells[idx]!, profile.channelBits);
        const x0 = origin + col * pixelPerCell;
        const y0 = origin + (row0 + row) * pixelPerCell;
        fillRect(img.data, px, x0, y0, pixelPerCell, pixelPerCell, r, g, b);
        idx++;
      }
    }
  }

  ctx.putImageData(img, 0, 0);
}

export function sampleBands(
  image: ImageData,
  profile: Profile,
  finderCenters: [Point, Point, Point, Point],
  bandCount: number,
): Uint8Array[] {
  const outer = outerSize(profile);
  const f = profile.finder;
  const u = f / (2 * outer);
  const h = homographyFromPoints(
    [
      { x: u, y: u },
      { x: 1 - u, y: u },
      { x: 1 - u, y: 1 - u },
      { x: u, y: 1 - u },
    ],
    finderCenters,
  );
  const origin = profile.finder + profile.quiet;
  const { data, width, height } = image;
  const bpc = bitsPerCell(profile);
  const out: Uint8Array[] = [];

  for (let bi = 0; bi < bandCount; bi++) {
    const { row0, rows } = bandRowSpan(profile, bandCount, bi);
    const cellCount = rows * profile.grid;
    const cells = new Uint16Array(cellCount);
    let idx = 0;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < profile.grid; col++) {
        const pu = (origin + col + 0.5) / outer;
        const pv = (origin + row0 + row + 0.5) / outer;
        const p = applyHomography(h, pu, pv);
        const x = Math.round(p.x);
        const y = Math.round(p.y);
        if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) {
          cells[idx++] = 0;
          continue;
        }
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const wgt = dx === 0 && dy === 0 ? 4 : 1;
            const o = ((y + dy) * width + (x + dx)) * 4;
            r += data[o]! * wgt;
            g += data[o + 1]! * wgt;
            b += data[o + 2]! * wgt;
            n += wgt;
          }
        }
        cells[idx++] = sampleToCell(r / n, g / n, b / n, profile.channelBits);
      }
    }
    const byteLen = Math.floor((cellCount * bpc) / 8);
    out.push(cellsToBytes(cells, bpc, byteLen));
  }
  return out;
}
