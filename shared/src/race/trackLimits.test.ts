import { describe, expect, it } from 'vitest';
import { buildTrack } from '../track/track.ts';
import { APEX_PARK } from '../track/tracks.ts';
import { RACE, TRACK_STYLE } from '../tuning.ts';
import { TrackLimits, outsideLimits } from './trackLimits.ts';

const track = buildTrack(APEX_PARK);
const step = track.samples[1]!.s;
/** A sample half way round, away from the pit lane. */
const I = Math.round(track.length / 2 / step);
const smp = track.samples[I]!;
/** A point `off` metres left (+) / right (−) of the centreline at sample I. */
const lateral = (off: number) => [smp.x + smp.nx * off, smp.z + smp.nz * off] as const;
const beyondLeft = smp.wl + TRACK_STYLE.curbWidth + RACE.trackLimits.margin + 1;

describe('outsideLimits', () => {
  it('centre of the road is inside', () => {
    expect(outsideLimits(track, I, smp.x, smp.z)).toBe(false);
    expect(outsideLimits(track, I, ...lateral(smp.wl))).toBe(false);
  });

  it('2 m past the kerb is outside, on either side', () => {
    expect(outsideLimits(track, I, ...lateral(beyondLeft))).toBe(true);
    expect(outsideLimits(track, I, ...lateral(-(smp.wr + TRACK_STYLE.curbWidth + RACE.trackLimits.margin + 1)))).toBe(true);
  });

  it('the pit lane is not outside', () => {
    const pitI = track.pitLaneCentre.findIndex((c, i) => !Number.isNaN(c) && !Number.isNaN(track.pitLaneCentre[(i + 20) % track.samples.length]!));
    expect(pitI).toBeGreaterThanOrEqual(0);
    const p = track.samples[pitI + 10]!;
    const off = track.pitLaneCentre[pitI + 10]!;
    expect(Math.abs(off)).toBeGreaterThan(p.wl);
    expect(outsideLimits(track, pitI + 10, p.x + p.nx * off, p.z + p.nz * off)).toBe(false);
  });
});

describe('TrackLimits', () => {
  const fast = RACE.trackLimits.minSpeed + 5;

  it('one excursion = one strike even over many states', () => {
    const tl = new TrackLimits(track);
    expect(tl.onState(1, smp.x, smp.z, fast)).toBe(false);
    expect(tl.onState(1, ...lateral(beyondLeft), fast)).toBe(true);
    expect(tl.onState(1, ...lateral(beyondLeft + 1), fast)).toBe(false);
    expect(tl.onState(1, ...lateral(beyondLeft + 2), fast)).toBe(false);
  });

  it('slow excursions do not count', () => {
    const tl = new TrackLimits(track);
    tl.onState(1, smp.x, smp.z, 3);
    expect(tl.onState(1, ...lateral(beyondLeft), 3)).toBe(false);
  });

  it('a new strike after coming back', () => {
    const tl = new TrackLimits(track);
    tl.onState(1, smp.x, smp.z, fast);
    expect(tl.onState(1, ...lateral(beyondLeft), fast)).toBe(true);
    expect(tl.onState(1, smp.x, smp.z, fast)).toBe(false);
    expect(tl.onState(1, ...lateral(beyondLeft), fast)).toBe(true);
    // Another car is tracked separately.
    expect(tl.onState(2, ...lateral(beyondLeft), fast)).toBe(true);
  });
});
