import { runs, type BuiltTrack } from '../track/track.ts';
import { inPitLane } from './trackLimits.ts';

export type PitZone = 'none' | 'lane' | 'box';

/** The full-width part of each track's pit lane, as [first, last] sample (may run past n). */
const fullRuns = new WeakMap<BuiltTrack, [number, number] | null>();

function fullRun(track: BuiltTrack): [number, number] | null {
  let run = fullRuns.get(track);
  if (run === undefined) {
    const all = runs(track.samples.length, (i) => track.pitLaneFull[i] === 1);
    // No lane at all: runs() reports either nothing or (all false) nothing.
    run = all.length && track.pitLaneFull.some((v) => v === 1) ? all.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a)) : null;
    fullRuns.set(track, run);
  }
  return run;
}

/**
 * Where (x, z) is relative to the pit lane, near centreline sample i: in the lane, in the box
 * zone (the middle third of the full-width lane, where cars stop for tyres), or neither.
 */
export function pitZoneAt(track: BuiltTrack, i: number, x: number, z: number): PitZone {
  if (!inPitLane(track, i, x, z)) return 'none';
  // Along the ramps the lane runs right next to the road: only off the road on the pit side counts.
  const side = track.def.pitLane?.side ?? 1;
  const s = track.samples[i]!;
  if (side * ((x - s.x) * s.nx + (z - s.z) * s.nz) <= (side > 0 ? s.wl : s.wr)) return 'none';
  const run = fullRun(track);
  if (!run) return 'lane';
  const n = track.samples.length;
  const len = run[1] - run[0] + 1;
  const k = (((i - run[0]) % n) + n) % n;
  return k >= len / 3 && k <= (2 * len) / 3 ? 'box' : 'lane';
}
