import { describe, expect, it } from 'vitest';
import type { SectorEvent } from './raceTracker.ts';
import { SectorBoard } from './timing.ts';

const ev = (id: number, lap: number, sector: number, time: number, elapsed: number, valid = true): SectorEvent => ({ id, lap, sector, time, elapsed, valid });

/** Feeds a whole lap of three sectors. */
const lap = (b: SectorBoard, id: number, n: number, times: [number, number, number], valid = true) => {
  let elapsed = 0;
  return times.map((t, k) => b.add(ev(id, n, k, t, (elapsed += t), valid)));
};

describe('SectorBoard', () => {
  it('first valid sector is purple', () => {
    const b = new SectorBoard(3);
    expect(b.add(ev(1, 1, 0, 30_000, 30_000)).colour).toBe('purple');
  });

  it('slower but own best is green; equal to the session best is purple', () => {
    const b = new SectorBoard(3);
    b.add(ev(1, 1, 0, 30_000, 30_000));
    expect(b.add(ev(2, 1, 0, 31_000, 31_000)).colour).toBe('green');
    expect(b.add(ev(3, 1, 0, 30_000, 30_000)).colour).toBe('purple');
  });

  it('slower than own best is yellow', () => {
    const b = new SectorBoard(3);
    lap(b, 1, 1, [30_000, 30_000, 30_000]);
    expect(b.add(ev(1, 2, 0, 30_500, 30_500)).colour).toBe('yellow');
    expect(b.colours(1, 2)).toEqual(['yellow', null, null]);
  });

  it('invalid laps are uncoloured and set no bests', () => {
    const b = new SectorBoard(3);
    expect(lap(b, 1, 1, [20_000, 20_000, 20_000], false).map((r) => r.colour)).toEqual([null, null, null]);
    expect(b.add(ev(1, 2, 0, 30_000, 30_000)).colour).toBe('purple');
    expect(b.add(ev(1, 2, 1, 30_000, 60_000)).delta).toBeNull();
  });

  it('delta against the best lap cumulative split', () => {
    const b = new SectorBoard(3);
    expect(lap(b, 1, 1, [30_000, 31_000, 32_000]).map((r) => r.delta)).toEqual([null, null, null]);
    const r = lap(b, 1, 2, [29_800, 31_500, 31_000]);
    expect(r.map((x) => x.delta)).toEqual([-200, 300, -700]);
    // Lap 2 (91.3 s) is now the best lap: deltas compare with it.
    expect(b.add(ev(1, 3, 0, 30_000, 30_000)).delta).toBe(200);
  });

  it('reset forgets everything', () => {
    const b = new SectorBoard(3);
    lap(b, 1, 1, [30_000, 30_000, 30_000]);
    b.reset(3);
    expect(b.add(ev(1, 1, 0, 40_000, 40_000))).toEqual({ colour: 'purple', delta: null });
  });
});
