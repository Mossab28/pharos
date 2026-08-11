import type { Point } from "../shared/geometry";

/**
 * Find four finder centers. Scans a few ring sizes; picks one peak per corner.
 */
export function detectFinders(image: ImageData): [Point, Point, Point, Point] | null {
  const { width, height, data } = image;
  const step = Math.max(3, Math.floor(Math.min(width, height) / 220));
  const radii = [
    Math.max(6, Math.floor(step * 2)),
    Math.max(8, Math.floor(step * 3.2)),
    Math.max(10, Math.floor(step * 4.5)),
  ];
  const scores: { x: number; y: number; s: number }[] = [];

  for (let y = 10; y < height - 10; y += step) {
    for (let x = 10; x < width - 10; x += step) {
      let best = 0;
      for (const r of radii) {
        const s = finderScore(data, width, height, x, y, r);
        if (s > best) best = s;
      }
      if (best > 0.28) scores.push({ x, y, s: best });
    }
  }
  if (scores.length < 4) return null;

  scores.sort((a, b) => b.s - a.s);
  const peaks: { x: number; y: number; s: number }[] = [];
  const minDist = Math.min(width, height) * 0.1;
  for (const c of scores) {
    if (peaks.every((p) => hypot(p.x - c.x, p.y - c.y) > minDist)) {
      peaks.push(c);
      if (peaks.length >= 16) break;
    }
  }
  if (peaks.length < 4) return null;

  const tl = bestNear(peaks, 0, 0);
  const tr = bestNear(peaks, width, 0);
  const br = bestNear(peaks, width, height);
  const bl = bestNear(peaks, 0, height);
  if (!tl || !tr || !br || !bl) return null;

  const set = new Set([tl, tr, br, bl]);
  if (set.size < 4) return null;

  // Reject nonsense quads (too skinny / too small)
  const wTop = hypot(tr.x - tl.x, tr.y - tl.y);
  const wBot = hypot(br.x - bl.x, br.y - bl.y);
  const hLeft = hypot(bl.x - tl.x, bl.y - tl.y);
  const hRight = hypot(br.x - tr.x, br.y - tr.y);
  const minSide = Math.min(wTop, wBot, hLeft, hRight);
  const maxSide = Math.max(wTop, wBot, hLeft, hRight);
  if (minSide < Math.min(width, height) * 0.12) return null;
  if (maxSide / minSide > 2.2) return null;

  return [tl, tr, br, bl];
}

function bestNear(peaks: { x: number; y: number; s: number }[], cx: number, cy: number): Point | null {
  let best: { x: number; y: number; s: number } | null = null;
  let bestScore = -Infinity;
  for (const p of peaks) {
    const d = hypot(p.x - cx, p.y - cy);
    const score = p.s * 2000 - d;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}

function hypot(a: number, b: number): number {
  return Math.sqrt(a * a + b * b);
}

function lum(data: Uint8ClampedArray, width: number, height: number, x: number, y: number): number {
  x = Math.max(0, Math.min(width - 1, x));
  y = Math.max(0, Math.min(height - 1, y));
  const o = (y * width + x) * 4;
  return 0.299 * data[o]! + 0.587 * data[o + 1]! + 0.114 * data[o + 2]!;
}

function finderScore(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  r: number,
): number {
  const c = lum(data, width, height, x, y);
  let mid = 0;
  let out = 0;
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    mid += lum(data, width, height, Math.round(x + Math.cos(ang) * r * 0.45), Math.round(y + Math.sin(ang) * r * 0.45));
    out += lum(data, width, height, Math.round(x + Math.cos(ang) * r * 0.9), Math.round(y + Math.sin(ang) * r * 0.9));
  }
  mid /= 8;
  out /= 8;
  const s1 = (mid - c) / 255;
  const s2 = (mid - out) / 255;
  if (s1 < 0.12 || s2 < 0.12) return 0;
  if (c > 110) return 0; // center should be dark
  return Math.min(1, (s1 + s2) / 2);
}
