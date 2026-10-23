import { describe, expect, it } from 'vitest';
import { buildTrack } from '../track/track.ts';
import { APEX_PARK } from '../track/tracks.ts';
import { pitZoneAt } from './pitLane.ts';

const track = buildTrack(APEX_PARK);
const n = track.samples.length;
const full = [...Array(n).keys()].filter((i) => track.pitLaneFull[i]);
/** A point on the lane centre at sample i. */
const lane = (i: number) => {
  const s = track.samples[i]!;
  const off = track.pitLaneCentre[i]!;
  return [s.x + s.nx * off, s.z + s.nz * off] as const;
};

describe('pitZoneAt', () => {
  it('the lane near its ends is lane, the middle of the lane is the box, the track is none', () => {
    expect(full.length).toBeGreaterThan(20);
    // Walk the full-width run in driving order (it may wrap past sample 0).
    const start = full.find((i) => !track.pitLaneFull[(i - 1 + n) % n])!;
    const len = full.length;
    const at = (k: number) => (start + k) % n;
    expect(pitZoneAt(track, at(1), ...lane(at(1)))).toBe('lane');
    expect(pitZoneAt(track, at(Math.floor(len / 2)), ...lane(at(Math.floor(len / 2))))).toBe('box');
    expect(pitZoneAt(track, at(len - 2), ...lane(at(len - 2)))).toBe('lane');
    const mid = at(Math.floor(len / 2));
    expect(pitZoneAt(track, mid, track.samples[mid]!.x, track.samples[mid]!.z)).toBe('none');
  });

  it('a track without a pit lane has no pit zone', () => {
    const plain = buildTrack({ ...APEX_PARK, pitLane: null });
    const s = plain.samples[10]!;
    expect(pitZoneAt(plain, 10, s.x + s.nx * 20, s.z + s.nz * 20)).toBe('none');
  });
});
