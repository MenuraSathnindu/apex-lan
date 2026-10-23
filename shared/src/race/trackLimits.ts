import type { BuiltTrack } from '../track/track.ts';
import { RACE, TRACK_STYLE } from '../tuning.ts';
import { nearestSample } from './checkpoints.ts';

/** Lateral offset of (x, z) from the centreline at sample i (+ = left). */
function lateralOffset(track: BuiltTrack, i: number, x: number, z: number): number {
  const s = track.samples[i]!;
  return (x - s.x) * s.nx + (z - s.z) * s.nz;
}

/** True if (x, z) is in the pit lane next to sample i. */
export function inPitLane(track: BuiltTrack, i: number, x: number, z: number): boolean {
  const lane = track.pitLaneCentre[i]!;
  return !Number.isNaN(lane) && Math.abs(lateralOffset(track, i, x, z) - lane) <= TRACK_STYLE.pit.width / 2 + RACE.trackLimits.margin;
}

/**
 * Beyond track limits at sample i: the car's centre is more than RACE.trackLimits.margin past the
 * road edge + kerb on its side (and not in the pit lane).
 */
export function outsideLimits(track: BuiltTrack, i: number, x: number, z: number): boolean {
  const s = track.samples[i]!;
  const d = lateralOffset(track, i, x, z);
  const edge = (d >= 0 ? s.wl : s.wr) + TRACK_STYLE.curbWidth + RACE.trackLimits.margin;
  return Math.abs(d) > edge && !inPitLane(track, i, x, z);
}

/**
 * Counts track-limits excursions per car: one starts when a car is outside the limits faster
 * than RACE.trackLimits.minSpeed, and ends when it is back inside.
 */
export class TrackLimits {
  private readonly cars = new Map<number, { hint: number; out: boolean }>();

  constructor(private readonly track: BuiltTrack) {}

  /** Feed a reported position and speed (m/s). True when a new excursion (a strike) starts. */
  onState(id: number, x: number, z: number, speed: number): boolean {
    let car = this.cars.get(id);
    if (!car) this.cars.set(id, (car = { hint: -1, out: false }));
    car.hint = nearestSample(this.track, x, z, car.hint);
    if (!outsideLimits(this.track, car.hint, x, z)) {
      car.out = false;
      return false;
    }
    if (car.out || speed < RACE.trackLimits.minSpeed) return false;
    car.out = true;
    return true;
  }
}
