import type { BuiltTrack } from '@apex/shared';

/** The podium goes up on the start straight this far past the line (m). */
export const PODIUM_DISTANCE = 60;

export interface PodiumPlacement {
  x: number;
  y: number;
  z: number;
  /** Driving direction and left normal (unit). */
  tx: number;
  tz: number;
  nx: number;
  nz: number;
}

/**
 * Where the post-race podium stands: on the start straight just past the line (the race is over
 * and the scene hides every other car, so the road is free).
 */
export function podiumPlacement(track: BuiltTrack): PodiumPlacement {
  const i = Math.round(PODIUM_DISTANCE / track.samples[1]!.s) % track.samples.length;
  const s = track.samples[i]!;
  return { x: s.x, y: track.lift[i]!, z: s.z, tx: s.tx, tz: s.tz, nx: s.nx, nz: s.nz };
}
