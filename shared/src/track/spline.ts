/** A point on the track centreline, resampled at even arc-length spacing. */
export interface TrackSample {
  x: number;
  z: number;
  /** Unit tangent (driving direction). */
  tx: number;
  tz: number;
  /** Unit left normal (+X when driving toward +Z). */
  nx: number;
  nz: number;
  /** Distance along the centreline from sample 0 (m). */
  s: number;
  /** Signed curvature (1/m); positive = turning left. */
  curvature: number;
  /** Road half-widths to the left (+normal side) and right of the centreline (m). */
  wl: number;
  wr: number;
}

type P2 = readonly [number, number];

/** Centripetal Catmull-Rom point between p1 and p2 (no cusps or self-loops on sharp corners). */
export function catmullRom(p0: P2, p1: P2, p2: P2, p3: P2, t: number): [number, number] {
  const knot = (a: P2, b: P2) => Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]) ** 0.5, 1e-6);
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const u = t1 + (t2 - t1) * t;
  const lerp = (a: P2, b: P2, ta: number, tb: number): [number, number] => {
    const w = (u - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

/** Samples a closed spline through `points` every `spacing` metres (approximately). */
export function sampleClosedSpline(points: readonly P2[], spacing: number): TrackSample[] {
  const n = points.length;
  const at = (i: number) => points[((i % n) + n) % n]!;

  // 1. Dense polyline.
  const dense: [number, number][] = [];
  const SUB = 64;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < SUB; k++) dense.push(catmullRom(at(i - 1), at(i), at(i + 1), at(i + 2), k / SUB));
  }

  // 2. Cumulative length.
  const cum = [0];
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1]!;
    const b = dense[i % dense.length]!;
    cum.push(cum[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cum[dense.length]!;
  const count = Math.max(8, Math.round(total / spacing));
  const step = total / count;

  // 3. Resample at even spacing.
  const pts: [number, number][] = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const target = k * step;
    while (cum[j + 1]! < target) j++;
    const a = dense[j]!;
    const b = dense[(j + 1) % dense.length]!;
    const w = (target - cum[j]!) / (cum[j + 1]! - cum[j]!);
    pts.push([a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w]);
  }

  return framesFromPoints(pts, step, 0, 0);
}

/**
 * Tangents, left normals and signed curvature for an evenly spaced closed polyline.
 * `widths` gives each point's [left, right] half-width, or constant ones are used.
 */
export function framesFromPoints(
  pts: readonly (readonly [number, number])[],
  step: number,
  wl: number | readonly number[],
  wr: number | readonly number[],
): TrackSample[] {
  const count = pts.length;
  return pts.map((p, k) => {
    const prev = pts[(k - 1 + count) % count]!;
    const next = pts[(k + 1) % count]!;
    let tx = next[0] - prev[0];
    let tz = next[1] - prev[1];
    const len = Math.hypot(tx, tz);
    tx /= len;
    tz /= len;
    // Turning angle between incoming and outgoing segments over 2 steps.
    const inX = p[0] - prev[0];
    const inZ = p[1] - prev[1];
    const outX = next[0] - p[0];
    const outZ = next[1] - p[1];
    // Positive = left turn (heading +Z, turning toward +X).
    const angle = Math.atan2(inZ * outX - inX * outZ, inX * outX + inZ * outZ);
    return {
      x: p[0],
      z: p[1],
      tx,
      tz,
      nx: tz,
      nz: -tx,
      s: k * step,
      curvature: angle / step,
      wl: typeof wl === 'number' ? wl : wl[k]!,
      wr: typeof wr === 'number' ? wr : wr[k]!,
    };
  });
}
