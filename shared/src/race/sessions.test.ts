import { describe, expect, it } from 'vitest';
import { fastestLapBonus, qualifyingOrder, qualifyingOver, sessionPoints, sprintLaps, type QualiLap } from './sessions.ts';

describe('session rules', () => {
  it('sprints run a third of the race laps, at least one', () => {
    expect(sprintLaps(3)).toBe(1);
    expect(sprintLaps(10)).toBe(3);
    expect(sprintLaps(1)).toBe(1);
  });

  it('awards race and sprint points to finishers only', () => {
    expect(sessionPoints('race', 1, false)).toBe(25);
    expect(sessionPoints('race', 10, false)).toBe(1);
    expect(sessionPoints('race', 11, false)).toBe(0);
    expect(sessionPoints('race', 1, true)).toBe(0);
    expect(sessionPoints('sprint', 1, false)).toBe(8);
    expect(sessionPoints('sprint', 8, false)).toBe(1);
    expect(sessionPoints('sprint', 9, false)).toBe(0);
    expect(sessionPoints('qualifying', 1, false)).toBe(0);
    expect(sessionPoints('free', 1, false)).toBe(0);
  });

  it('gives the fastest-lap point only in races, top 10, when enabled', () => {
    expect(fastestLapBonus('race', 10, false, true, true)).toBe(1);
    expect(fastestLapBonus('race', 11, false, true, true)).toBe(0);
    expect(fastestLapBonus('race', 1, true, true, true)).toBe(0);
    expect(fastestLapBonus('race', 1, false, false, true)).toBe(0);
    expect(fastestLapBonus('race', 1, false, true, false)).toBe(0);
    expect(fastestLapBonus('sprint', 1, false, true, true)).toBe(0);
  });
});

describe('qualifying order', () => {
  const laps: QualiLap[] = [
    { id: 1, lap: 1, time: 90_000, valid: true },
    { id: 2, lap: 1, time: 85_000, valid: false },
    { id: 2, lap: 2, time: 88_000, valid: true },
    { id: 1, lap: 2, time: 87_000, valid: true },
    { id: 3, lap: 1, time: 80_000, valid: false },
  ];

  it('timed: best valid lap, drivers without a time last in entry order', () => {
    expect(qualifyingOrder({ mode: 'timed', minutes: 8 }, laps, [4, 3, 2, 1])).toEqual([
      { id: 1, best: 87_000 },
      { id: 2, best: 88_000 },
      { id: 4, best: null },
      { id: 3, best: null },
    ]);
  });

  it('one-shot: only lap 2 counts, and only if valid', () => {
    const oneShot = [...laps, { id: 3, lap: 2, time: 99_000, valid: false }];
    expect(qualifyingOrder({ mode: 'oneShot' }, oneShot, [1, 2, 3])).toEqual([
      { id: 1, best: 87_000 },
      { id: 2, best: 88_000 },
      { id: 3, best: null },
    ]);
  });

  it('equal times: the lap set first wins', () => {
    const tie: QualiLap[] = [
      { id: 2, lap: 1, time: 80_000, valid: true },
      { id: 1, lap: 1, time: 80_000, valid: true },
    ];
    expect(qualifyingOrder({ mode: 'timed', minutes: 5 }, tie, [1, 2]).map((r) => r.id)).toEqual([2, 1]);
  });
});

describe('qualifying end', () => {
  const timed = { mode: 'timed', minutes: 8 } as const;
  const none = new Set<number>();
  it('timed: runs to the flag, then lets laps under way finish within the overrun', () => {
    expect(qualifyingOver(timed, 1000, 0, 2000, none, none, [1])).toBe(false);
    expect(qualifyingOver(timed, 2000, 0, 2000, none, none, [1])).toBe(true);
    expect(qualifyingOver(timed, 2500, 0, 2000, new Set([1]), none, [1])).toBe(false);
    expect(qualifyingOver(timed, 2000 + 120_000, 0, 2000, new Set([1]), none, [1])).toBe(true);
  });

  it('one-shot: ends when every entrant has done the flying lap, or after 5 minutes', () => {
    const one = { mode: 'oneShot' } as const;
    expect(qualifyingOver(one, 10_000, 0, 0, none, new Set([1]), [1, 2])).toBe(false);
    expect(qualifyingOver(one, 10_000, 0, 0, none, new Set([1, 2]), [1, 2])).toBe(true);
    expect(qualifyingOver(one, 300_000, 0, 0, none, new Set([1]), [1, 2])).toBe(true);
  });
});
