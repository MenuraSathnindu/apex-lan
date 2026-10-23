import type { BuiltTrack } from './track.ts';

/** A stretch of track in metres from the start line. `from > to` wraps over the line. */
export interface TrackZone {
  from: number;
  to: number;
}

export function inZone(zones: readonly TrackZone[] | undefined, s: number): boolean {
  if (!zones) return false;
  for (const z of zones) {
    if (z.from <= z.to ? s >= z.from && s <= z.to : s >= z.from || s <= z.to) return true;
  }
  return false;
}

/** Distance along the track from the start line (m) for a centreline sample index. */
export function distanceFromStart(track: BuiltTrack, sampleIndex: number): number {
  const s0 = track.samples[track.startIndex]!.s;
  return (((track.samples[sampleIndex]!.s - s0) % track.length) + track.length) % track.length;
}
