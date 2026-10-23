import type { SpawnPose } from '../physics/vehicle.ts';
import { boundaryAt, type BuiltTrack } from '../track/track.ts';
import { RACE } from '../tuning.ts';

/** An invisible line across the track that must be crossed in order. */
export interface Gate {
  index: number;
  /** Centre of the gate (on the centreline). */
  x: number;
  z: number;
  /** Driving direction (unit). */
  tx: number;
  tz: number;
  /** Left normal (unit). */
  nx: number;
  nz: number;
  /** Half the gate width: covers road, curbs and run-off up to the barriers. */
  halfWidth: number;
  /** Distance along the track from the start line (m). */
  s: number;
}

/** A gate across the track `distance` metres past the start line (wraps), e.g. the overtake detection point. */
export function gateAtDistance(track: BuiltTrack, distance: number, index = -1): Gate {
  const { samples, startIndex } = track;
  const n = samples.length;
  const step = samples[1]!.s;
  const d = ((distance % track.length) + track.length) % track.length;
  const i = (startIndex + Math.round(d / step)) % n;
  const smp = samples[i]!;
  // Covers road, kerbs and run-off up to the barrier (+1 m).
  const halfWidth = boundaryAt(track, i) + 1;
  return { index, x: smp.x, z: smp.z, tx: smp.tx, tz: smp.tz, nx: smp.nx, nz: smp.nz, halfWidth, s: d };
}

/**
 * Checkpoint gates, gate 0 on the start/finish line: the track's own list (generated tracks),
 * or one every ~`spacing` m.
 */
export function buildCheckpoints(track: BuiltTrack, spacing: number = RACE.checkpointSpacing): Gate[] {
  const own = track.def.checkpoints;
  if (own && own.length >= 3) return own.map((s, g) => gateAtDistance(track, s, g));
  const count = Math.max(3, Math.round(track.length / spacing));
  return Array.from({ length: count }, (_, g) => gateAtDistance(track, (g * track.length) / count, g));
}

/** True if moving from A to B crosses the gate in the driving direction. */
export function crossesGate(gate: Gate, ax: number, az: number, bx: number, bz: number): boolean {
  const da = (ax - gate.x) * gate.tx + (az - gate.z) * gate.tz;
  const db = (bx - gate.x) * gate.tx + (bz - gate.z) * gate.tz;
  if (!(da < 0 && db >= 0)) return false;
  const k = da / (da - db);
  const ix = ax + (bx - ax) * k;
  const iz = az + (bz - az) * k;
  return Math.abs((ix - gate.x) * gate.nx + (iz - gate.z) * gate.nz) <= gate.halfWidth;
}

/** Where to put a car that respawns at this gate: just past it, facing the right way. */
export function respawnPose(gate: Gate): SpawnPose {
  return {
    position: { x: gate.x + gate.tx * RACE.respawnAhead, y: 1.0, z: gate.z + gate.tz * RACE.respawnAhead },
    yaw: Math.atan2(gate.tx, gate.tz),
  };
}

/** Index of the nearest centreline sample, searching near `hint` first (cheap when tracking a car). */
export function nearestSample(track: BuiltTrack, x: number, z: number, hint = -1): number {
  const { samples } = track;
  const n = samples.length;
  const dist = (i: number) => (samples[i]!.x - x) ** 2 + (samples[i]!.z - z) ** 2;
  if (hint >= 0) {
    let best = hint;
    let bd = dist(hint);
    for (let d = -25; d <= 25; d++) {
      const i = (hint + d + n) % n;
      const di = dist(i);
      if (di < bd) [best, bd] = [i, di];
    }
    if (bd < 30 * 30) return best;
  }
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < n; i++) {
    const di = dist(i);
    if (di < bd) [best, bd] = [i, di];
  }
  return best;
}
