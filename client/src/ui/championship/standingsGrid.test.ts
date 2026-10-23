import { describe, expect, it } from 'vitest';
import type { SeasonResult } from '@apex/shared';
import { cellClass } from './standingsGrid.ts';

const r = (position: number, points: number, dnf = false): SeasonResult => ({
  round: 1,
  session: 'race',
  profileId: 1,
  teamId: null,
  position,
  dnf,
  bestLapMs: null,
  points,
  fastestLap: false,
});

describe('results grid colours', () => {
  it('colours a result like a classic results table', () => {
    expect(cellClass(r(1, 25))).toBe('gold');
    expect(cellClass(r(2, 18))).toBe('silver');
    expect(cellClass(r(3, 15))).toBe('bronze');
    expect(cellClass(r(7, 6))).toBe('points');
    expect(cellClass(r(11, 0))).toBe('finished');
    expect(cellClass(r(4, 0, true))).toBe('dnf');
    expect(cellClass(null)).toBe('absent');
  });

  it('a DNF is red even in a podium position', () => {
    expect(cellClass(r(1, 0, true))).toBe('dnf');
  });
});
