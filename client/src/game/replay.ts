import { FX, MAX_PLAYERS } from '@apex/shared';

const R = FX.replay;
/** Floats per car per frame: position xyz + quaternion xyzw. */
const STRIDE = 7;

interface Vec3 {
  x: number;
  y: number;
  z: number;
}
interface Quat extends Vec3 {
  w: number;
}

export interface ReplayCarPose {
  id: number;
  pos: Vec3;
  quat: Quat;
}

export interface ReplayFrame {
  /** Server-clock time (ms). */
  t: number;
  ids: number[];
  /** STRIDE floats per id. */
  poses: Float32Array;
}

export type ReplayKind = 'crash' | 'overtake';

export interface ReplayClip {
  /** The car the camera watches. */
  subject: number;
  kind: ReplayKind;
  /** When it happened (server ms). */
  at: number;
  frames: ReplayFrame[];
}

/** One slot of the ring buffer (preallocated: recording allocates nothing). */
interface Slot {
  t: number;
  n: number;
  ids: Int32Array;
  poses: Float32Array;
}

/**
 * The last FX.replay.windowMs of every car's pose, and clips cut from it around events
 * (beforeMs before, afterMs after: a clip is ready afterMs after its event).
 */
export class ReplayRecorder {
  readonly clips: ReplayClip[] = [];
  private readonly slots: Slot[];
  private head = 0;
  private count = 0;
  private lastT = -Infinity;
  private pending: { subject: number; kind: ReplayKind; at: number }[] = [];

  constructor() {
    const capacity = Math.ceil((R.windowMs / 1000) * R.hz) + 2;
    this.slots = Array.from({ length: capacity }, () => ({ t: 0, n: 0, ids: new Int32Array(MAX_PLAYERS), poses: new Float32Array(MAX_PLAYERS * STRIDE) }));
  }

  get frameCount(): number {
    return this.count;
  }

  /** Oldest and newest recorded time, or null. */
  span(): { from: number; to: number } | null {
    if (!this.count) return null;
    return { from: this.slot(0).t, to: this.slot(this.count - 1).t };
  }

  /** Recorded frame k (0 = oldest). */
  private slot(k: number): Slot {
    const cap = this.slots.length;
    return this.slots[(this.head - this.count + k + cap * 2) % cap]!;
  }

  /** Call every rendered frame with the first `count` cars; keeps at most FX.replay.hz frames a second. */
  record(t: number, cars: readonly ReplayCarPose[], count = cars.length): void {
    if (t - this.lastT < 1000 / R.hz - 0.5) return;
    this.lastT = t;
    const cap = this.slots.length;
    const s = this.slots[this.head]!;
    s.t = t;
    s.n = 0;
    for (let k = 0; k < count && s.n < MAX_PLAYERS; k++) {
      const c = cars[k]!;
      const o = s.n * STRIDE;
      s.ids[s.n] = c.id;
      s.poses[o] = c.pos.x;
      s.poses[o + 1] = c.pos.y;
      s.poses[o + 2] = c.pos.z;
      s.poses[o + 3] = c.quat.x;
      s.poses[o + 4] = c.quat.y;
      s.poses[o + 5] = c.quat.z;
      s.poses[o + 6] = c.quat.w;
      s.n++;
    }
    this.head = (this.head + 1) % cap;
    this.count = Math.min(cap, this.count + 1);
    while (this.count > 1 && this.slot(0).t < t - R.windowMs) this.count--;
  }

  /** Ask for a clip around time t, unless one is already pending or kept within mergeMs. */
  requestClip(t: number, subject: number, kind: ReplayKind): void {
    const near = (at: number) => Math.abs(at - t) < R.mergeMs;
    if (this.pending.some((p) => near(p.at)) || this.clips.some((c) => near(c.at))) return;
    this.pending.push({ subject, kind, at: t });
  }

  /** Cuts the clips whose after-time has passed; returns the new ones. */
  poll(now: number): ReplayClip[] {
    const ready = this.pending.filter((p) => now >= p.at + R.afterMs);
    if (!ready.length) return [];
    this.pending = this.pending.filter((p) => !ready.includes(p));
    const out: ReplayClip[] = [];
    for (const p of ready) {
      const frames: ReplayFrame[] = [];
      for (let k = 0; k < this.count; k++) {
        const s = this.slot(k);
        if (s.t < p.at - R.beforeMs || s.t > p.at + R.afterMs) continue;
        frames.push({ t: s.t, ids: Array.from(s.ids.subarray(0, s.n)), poses: s.poses.slice(0, s.n * STRIDE) });
      }
      if (frames.length < 2) continue;
      const clip = { subject: p.subject, kind: p.kind, at: p.at, frames };
      this.clips.push(clip);
      out.push(clip);
    }
    while (this.clips.length > R.maxClips) this.clips.shift();
    return out;
  }

  clear(): void {
    this.count = 0;
    this.lastT = -Infinity;
    this.pending = [];
    this.clips.length = 0;
  }
}

export const newPose = (): { pos: Vec3; quat: Quat } => ({ pos: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 } });

/**
 * A car's pose at time t in a clip (interpolated between frames), written into `out`; null if
 * the car isn't in the clip around then.
 */
export function poseAt(clip: ReplayClip, t: number, id: number, out = newPose()): { pos: Vec3; quat: Quat } | null {
  const f = clip.frames;
  let i = 0;
  while (i < f.length - 2 && f[i + 1]!.t <= t) i++;
  const a = f[i]!;
  const b = f[i + 1] ?? a;
  const ia = a.ids.indexOf(id);
  const ib = b.ids.indexOf(id);
  if (ia < 0 && ib < 0) return null;
  const k = ia < 0 ? 1 : ib < 0 || b.t === a.t ? 0 : Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
  const pa = ia < 0 ? b.poses : a.poses;
  const pb = ib < 0 ? a.poses : b.poses;
  const oa = (ia < 0 ? ib : ia) * STRIDE;
  const ob = (ib < 0 ? ia : ib) * STRIDE;
  const lerp = (j: number) => pa[oa + j]! + (pb[ob + j]! - pa[oa + j]!) * k;
  out.pos.x = lerp(0);
  out.pos.y = lerp(1);
  out.pos.z = lerp(2);
  // Normalised lerp of the quaternion (same hemisphere first).
  const dot = pa[oa + 3]! * pb[ob + 3]! + pa[oa + 4]! * pb[ob + 4]! + pa[oa + 5]! * pb[ob + 5]! + pa[oa + 6]! * pb[ob + 6]!;
  const sgn = dot < 0 ? -1 : 1;
  const q = (j: number) => pa[oa + j]! + (sgn * pb[ob + j]! - pa[oa + j]!) * k;
  const qx = q(3);
  const qy = q(4);
  const qz = q(5);
  const qw = q(6);
  const len = Math.hypot(qx, qy, qz, qw) || 1;
  out.quat.x = qx / len;
  out.quat.y = qy / len;
  out.quat.z = qz / len;
  out.quat.w = qw / len;
  return out;
}

/** Cars that gained a place and are now in the top `top` (comparing two running orders). */
export function overtakesInTop(prev: readonly number[], next: readonly number[], top = 3): number[] {
  return next.filter((id, i) => i < top && prev.includes(id) && prev.indexOf(id) > i);
}
