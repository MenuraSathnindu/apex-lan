import { catmullRom, framesFromPoints, type TrackSample } from './spline.ts';

/** One centreline point: position (x, z) and the road's half-widths to the left and right (m). */
export type CenterPoint = readonly [x: number, z: number, wl: number, wr: number];

/**
 * Evenly spaced resample of a closed centreline: centripetal Catmull-Rom through the points
 * for the position, linear for the widths. Point 0 stays first.
 */
export function resampleClosed(pts: readonly CenterPoint[], spacing: number, sub = 16): [number, number, number, number][] {
  const n = pts.length;
  const at = (i: number) => pts[((i % n) + n) % n]!;
  const p2 = (i: number): [number, number] => [at(i)[0], at(i)[1]];

  const dense: [number, number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < sub; k++) {
      const t = k / sub;
      const [x, z] = catmullRom(p2(i - 1), p2(i), p2(i + 1), p2(i + 2), t);
      dense.push([x, z, at(i)[2] + (at(i + 1)[2] - at(i)[2]) * t, at(i)[3] + (at(i + 1)[3] - at(i)[3]) * t]);
    }
  }
  const cum = [0];
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1]!;
    const b = dense[i % dense.length]!;
    cum.push(cum[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cum[dense.length]!;
  const count = Math.max(8, Math.round(total / spacing));
  const step = total / count;
  const out: [number, number, number, number][] = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const target = k * step;
    while (cum[j + 1]! < target) j++;
    const a = dense[j]!;
    const b = dense[(j + 1) % dense.length]!;
    const w = (target - cum[j]!) / (cum[j + 1]! - cum[j]! || 1);
    out.push([a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w, a[3] + (b[3] - a[3]) * w]);
  }
  return out;
}

/** Length of a closed polyline (m). */
export function closedLength(pts: readonly (readonly [number, number, ...number[]])[]): number {
  let len = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    len += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return len;
}

/** Gaussian blur of a closed sequence of numbers (sigma in samples). */
export function smoothClosed(values: readonly number[], sigma: number): number[] {
  const n = values.length;
  if (sigma <= 0) return [...values];
  const r = Math.ceil(sigma * 3);
  const kernel = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
  const sum = kernel.reduce((a, b) => a + b, 0);
  return values.map((_, i) => {
    let acc = 0;
    for (let d = -r; d <= r; d++) acc += values[(i + d + n) % n]! * kernel[d + r]!;
    return acc / sum;
  });
}

/** Track samples (tangent, normal, curvature, widths) from an evenly spaced closed centreline. */
export function samplesFromCenterline(pts: readonly CenterPoint[], spacing: number): TrackSample[] {
  const even = resampleClosed(pts, spacing);
  const step = closedLength(even) / even.length;
  return framesFromPoints(
    even.map((p) => [p[0], p[1]] as const),
    step,
    even.map((p) => p[2]),
    even.map((p) => p[3]),
  );
}
