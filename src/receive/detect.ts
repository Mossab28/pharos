import type { Point } from "../shared/geometry";

/** Corner marker colors (must match render). Order: TL, TR, BR, BL. */
const CORNERS = [
  { r: 255, g: 0, b: 0 },
  { r: 0, g: 255, b: 0 },
  { r: 0, g: 0, b: 255 },
  { r: 255, g: 255, b: 0 },
];

/**
 * Detect the four colored finder centers.
 * Each marker is hunted in its image quadrant so data cells can't steal the lock.
 */
export function detectFinders(image: ImageData): [Point, Point, Point, Point] | null {
  const { width, height, data } = image;
  const step = Math.max(2, Math.floor(Math.min(width, height) / 160));
  const midX = width / 2;
  const midY = height / 2;

  const zones = [
    { x0: 0, y0: 0, x1: midX, y1: midY },
    { x0: midX, y0: 0, x1: width, y1: midY },
    { x0: midX, y0: midY, x1: width, y1: height },
    { x0: 0, y0: midY, x1: midX, y1: height },
  ];

  const centers: Point[] = [];
  for (let i = 0; i < 4; i++) {
    const c = CORNERS[i]!;
    const z = zones[i]!;
    const hit = findColorBlob(data, width, height, z, c.r, c.g, c.b, step);
    if (!hit) return null;
    centers.push(hit);
  }

  const [tl, tr, br, bl] = centers as [Point, Point, Point, Point];
  const wTop = hypot(tr.x - tl.x, tr.y - tl.y);
  const wBot = hypot(br.x - bl.x, br.y - bl.y);
  const hLeft = hypot(bl.x - tl.x, bl.y - tl.y);
  const hRight = hypot(br.x - tr.x, br.y - tr.y);
  const minSide = Math.min(wTop, wBot, hLeft, hRight);
  const maxSide = Math.max(wTop, wBot, hLeft, hRight);
  if (minSide < Math.min(width, height) * 0.1) return null;
  if (maxSide / minSide > 2.4) return null;
  return [tl, tr, br, bl];
}

function findColorBlob(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  zone: { x0: number; y0: number; x1: number; y1: number },
  tr: number,
  tg: number,
  tb: number,
  step: number,
): Point | null {
  let best = 0;
  let bestX = 0;
  let bestY = 0;

  const x0 = Math.max(0, Math.floor(zone.x0));
  const y0 = Math.max(0, Math.floor(zone.y0));
  const x1 = Math.min(width, Math.ceil(zone.x1));
  const y1 = Math.min(height, Math.ceil(zone.y1));

  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const score = colorScore(data, width, x, y, tr, tg, tb);
      if (score > best) {
        best = score;
        bestX = x;
        bestY = y;
      }
    }
  }
  if (best < 0.45) return null;

  let rx = 0;
  let ry = 0;
  let rw = 0;
  const r0 = Math.max(x0, bestX - step * 5);
  const r1 = Math.min(x1, bestX + step * 5);
  const t0 = Math.max(y0, bestY - step * 5);
  const t1 = Math.min(y1, bestY + step * 5);
  for (let y = t0; y < t1; y++) {
    for (let x = r0; x < r1; x++) {
      const score = colorScore(data, width, x, y, tr, tg, tb);
      if (score < 0.4) continue;
      rx += x * score;
      ry += y * score;
      rw += score;
    }
  }
  if (rw < 1) return null;
  return { x: rx / rw, y: ry / rw };
}

function colorScore(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  tr: number,
  tg: number,
  tb: number,
): number {
  const o = (y * width + x) * 4;
  const r = data[o]!;
  const g = data[o + 1]!;
  const b = data[o + 2]!;
  const dr = r - tr;
  const dg = g - tg;
  const db = b - tb;
  const dist = Math.sqrt(dr * dr + dg * dg + db * db) / 441;
  if (dist > 0.55) return 0;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < 70) return 0;

  if (tr === 255 && tg === 0 && tb === 0) {
    if (r < g + 30 || r < b + 30) return 0;
  } else if (tr === 0 && tg === 255 && tb === 0) {
    if (g < r + 30 || g < b + 30) return 0;
  } else if (tr === 0 && tg === 0 && tb === 255) {
    if (b < r + 30 || b < g + 30) return 0;
  } else if (tr === 255 && tg === 255 && tb === 0) {
    if (r < 140 || g < 140 || b > 130) return 0;
    if (Math.abs(r - g) > 90) return 0;
  }

  const sat = max === 0 ? 0 : (max - min) / max;
  if (sat < 0.22 && !(tr === 255 && tg === 255)) return 0;
  return (1 - dist) * (0.45 + 0.55 * sat);
}

function hypot(a: number, b: number): number {
  return Math.sqrt(a * a + b * b);
}
