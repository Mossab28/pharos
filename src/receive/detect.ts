import type { Point } from "../shared/geometry";

/**
 * Find four finder centers roughly at the corners of a Pharos frame.
 * Strategy: downsample luminance, look for nested black-white-black rings
 * via local contrast, then pick the best candidate near each image corner.
 */
export function detectFinders(image: ImageData): [Point, Point, Point, Point] | null {
  const { width, height, data } = image;
  const step = Math.max(2, Math.floor(Math.min(width, height) / 400));
  const scores: { x: number; y: number; s: number }[] = [];

  for (let y = 8; y < height - 8; y += step) {
    for (let x = 8; x < width - 8; x += step) {
      const s = finderScore(data, width, x, y, step * 3);
      if (s > 0.35) scores.push({ x, y, s });
    }
  }
  if (scores.length < 4) return null;

  // Non-max suppression
  scores.sort((a, b) => b.s - a.s);
  const peaks: { x: number; y: number; s: number }[] = [];
  const minDist = Math.min(width, height) * 0.08;
  for (const c of scores) {
    if (peaks.every((p) => hypot(p.x - c.x, p.y - c.y) > minDist)) {
      peaks.push(c);
      if (peaks.length >= 12) break;
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
  return [tl, tr, br, bl];
}

function bestNear(peaks: { x: number; y: number; s: number }[], cx: number, cy: number): Point | null {
  let best: { x: number; y: number; s: number } | null = null;
  let bestScore = -Infinity;
  for (const p of peaks) {
    const d = hypot(p.x - cx, p.y - cy);
    const score = p.s * 1000 - d;
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

function lum(data: Uint8ClampedArray, width: number, x: number, y: number): number {
  const o = (y * width + x) * 4;
  return 0.299 * data[o]! + 0.587 * data[o + 1]! + 0.114 * data[o + 2]!;
}

function finderScore(data: Uint8ClampedArray, width: number, x: number, y: number, r: number): number {
  // Sample rings: center dark, mid light, outer dark
  const c = lum(data, width, x, y);
  let mid = 0, midN = 0, out = 0, outN = 0;
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    const mx = Math.round(x + Math.cos(ang) * r * 0.45);
    const my = Math.round(y + Math.sin(ang) * r * 0.45);
    const ox = Math.round(x + Math.cos(ang) * r * 0.85);
    const oy = Math.round(y + Math.sin(ang) * r * 0.85);
    mid += lum(data, width, mx, my);
    midN++;
    out += lum(data, width, ox, oy);
    outN++;
  }
  mid /= midN;
  out /= outN;
  // Want c dark, mid bright, out dark
  const s1 = (mid - c) / 255;
  const s2 = (mid - out) / 255;
  if (s1 < 0.15 || s2 < 0.15) return 0;
  return Math.min(1, (s1 + s2) / 2);
}
