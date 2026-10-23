import type { CarState } from '@apex/shared';

/** How far past the newest snapshot we extrapolate with velocity before freezing (ms). */
const MAX_EXTRAPOLATION_MS = 150;
/** Keep this much history (ms). */
const HISTORY_MS = 1000;

export interface TimedState {
  ts: number;
  s: CarState;
}

/** Interpolated pose written into caller-owned arrays (no allocation per frame). */
export interface Pose {
  p: [number, number, number];
  q: [number, number, number, number];
  v: [number, number, number];
  wh: number[];
  b: 0 | 1;
  /** Wing opening 0..1. */
  a: number;
}

export function emptyPose(): Pose {
  return { p: [0, 0, 0], q: [0, 0, 0, 1], v: [0, 0, 0], wh: new Array(12).fill(0), b: 0, a: 0 };
}

function slerp(a: readonly number[], b: readonly number[], t: number, out: number[]) {
  let [bx, by, bz, bw] = b as [number, number, number, number];
  let dot = a[0]! * bx + a[1]! * by + a[2]! * bz + a[3]! * bw;
  if (dot < 0) {
    // Take the short way round.
    [bx, by, bz, bw, dot] = [-bx, -by, -bz, -bw, -dot];
  }
  let wa: number;
  let wb: number;
  if (dot > 0.9995) {
    wa = 1 - t;
    wb = t;
  } else {
    const theta = Math.acos(dot);
    const sin = Math.sin(theta);
    wa = Math.sin((1 - t) * theta) / sin;
    wb = Math.sin(t * theta) / sin;
  }
  out[0] = a[0]! * wa + bx * wb;
  out[1] = a[1]! * wa + by * wb;
  out[2] = a[2]! * wa + bz * wb;
  out[3] = a[3]! * wa + bw * wb;
  const len = Math.hypot(out[0], out[1], out[2], out[3]) || 1;
  for (let i = 0; i < 4; i++) out[i]! /= len;
}

/** A remote car's recent states on the server timeline, sampled with a fixed delay. */
export class SnapshotBuffer {
  private readonly buf: TimedState[] = [];

  get size(): number {
    return this.buf.length;
  }

  /** Newest server timestamp, or -Infinity if empty. */
  get latestTs(): number {
    return this.buf.at(-1)?.ts ?? -Infinity;
  }

  push(ts: number, s: CarState): void {
    if (ts <= this.latestTs) return; // duplicate or out of order
    this.buf.push({ ts, s });
    while (this.buf.length > 2 && this.buf[0]!.ts < ts - HISTORY_MS) this.buf.shift();
  }

  clear(): void {
    this.buf.length = 0;
  }

  /** Writes the state at server time `t` into `out`. Returns false if there's no data yet. */
  sample(t: number, out: Pose): boolean {
    const n = this.buf.length;
    if (n === 0) return false;
    const first = this.buf[0]!;
    const last = this.buf[n - 1]!;

    if (t <= first.ts || n === 1) {
      copy(first.s, out);
      return true;
    }
    if (t >= last.ts) {
      // Extrapolate a little with velocity, then hold.
      copy(last.s, out);
      const dt = Math.min(t - last.ts, MAX_EXTRAPOLATION_MS) / 1000;
      for (let i = 0; i < 3; i++) out.p[i] = last.s.p[i]! + last.s.v[i]! * dt;
      return true;
    }

    let i = n - 2;
    while (i > 0 && this.buf[i]!.ts > t) i--;
    const a = this.buf[i]!;
    const b = this.buf[i + 1]!;
    const k = (t - a.ts) / (b.ts - a.ts);
    for (let j = 0; j < 3; j++) {
      out.p[j] = a.s.p[j]! + (b.s.p[j]! - a.s.p[j]!) * k;
      out.v[j] = a.s.v[j]! + (b.s.v[j]! - a.s.v[j]!) * k;
    }
    slerp(a.s.q, b.s.q, k, out.q);
    // Steer, cumulative spin and wheel height all interpolate linearly.
    for (let j = 0; j < out.wh.length; j++) out.wh[j] = a.s.wh[j]! + (b.s.wh[j]! - a.s.wh[j]!) * k;
    out.b = k < 0.5 ? a.s.b : b.s.b;
    out.a = (a.s.a ?? 0) + ((b.s.a ?? 0) - (a.s.a ?? 0)) * k;
    return true;
  }
}

function copy(s: CarState, out: Pose) {
  for (let i = 0; i < 3; i++) {
    out.p[i] = s.p[i]!;
    out.v[i] = s.v[i]!;
  }
  for (let i = 0; i < 4; i++) out.q[i] = s.q[i]!;
  for (let i = 0; i < out.wh.length; i++) out.wh[i] = s.wh[i] ?? 0;
  out.b = s.b;
  out.a = s.a ?? 0;
}
