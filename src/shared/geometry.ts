export type Point = { x: number; y: number };

/** 3×3 homography, row-major. */
export type Homography = Float64Array;

/** Homography mapping four source points to four destination points. */
export function homographyFromPoints(src: [Point, Point, Point, Point], dst: [Point, Point, Point, Point]): Homography {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const s = src[i]!;
    const d = dst[i]!;
    A.push([s.x, s.y, 1, 0, 0, 0, -d.x * s.x, -d.x * s.y]);
    b.push(d.x);
    A.push([0, 0, 0, s.x, s.y, 1, -d.y * s.x, -d.y * s.y]);
    b.push(d.y);
  }
  const h = solve8(A, b);
  return new Float64Array([h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!, 1]);
}

/** Convenience: unit square (0,0),(1,0),(1,1),(0,1) → dst. */
export function computeHomography(dst: [Point, Point, Point, Point]): Homography {
  return homographyFromPoints(
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    dst,
  );
}

function solve8(A: number[][], b: number[]): number[] {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    [M[col], M[piv]] = [M[piv]!, M[col]!];
    const div = M[col]![col]!;
    if (Math.abs(div) < 1e-12) throw new Error("singular");
    for (let c = col; c <= n; c++) M[col]![c]! /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r]![col]!;
      for (let c = col; c <= n; c++) M[r]![c]! -= f * M[col]![c]!;
    }
  }
  return M.map((row) => row[n]!);
}

export function applyHomography(h: Homography, u: number, v: number): Point {
  const x = h[0]! * u + h[1]! * v + h[2]!;
  const y = h[3]! * u + h[4]! * v + h[5]!;
  const w = h[6]! * u + h[7]! * v + h[8]!;
  return { x: x / w, y: y / w };
}
