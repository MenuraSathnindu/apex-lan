import { describe, expect, it } from 'vitest';
import { APEX_PARK, buildTrack } from '@apex/shared';
import { PODIUM_DISTANCE, podiumPlacement } from './podiumPlacement.ts';

const track = buildTrack(APEX_PARK);

describe('podiumPlacement', () => {
  it('stands on the start straight, past the line, along the track', () => {
    const p = podiumPlacement(track);
    const s = track.samples[Math.round(PODIUM_DISTANCE / track.samples[1]!.s)]!;
    expect(Math.hypot(p.x - s.x, p.z - s.z)).toBeLessThan(0.01);
    expect(p.y).toBeCloseTo(track.lift[Math.round(PODIUM_DISTANCE / track.samples[1]!.s)]!);
    expect(Math.hypot(p.tx, p.tz)).toBeCloseTo(1);
    expect(p.tx * s.tx + p.tz * s.tz).toBeCloseTo(1);
    // Left normal is perpendicular to the driving direction.
    expect(p.nx * p.tx + p.nz * p.tz).toBeCloseTo(0);
  });

  it('is the same for every client', () => {
    expect(podiumPlacement(track)).toEqual(podiumPlacement(buildTrack(APEX_PARK)));
  });
});
