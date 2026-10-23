import { describe, expect, it } from 'vitest';
import { RACE } from '../tuning.ts';
import { JumpStartJudge } from './jumpStart.ts';

const LIGHTS = 10_000;
const GO = 16_000;
const far = RACE.jumpStartDistance + 0.1;
/** Grid slots: car 1 at the origin, car 2 one row behind (−Z). */
const SLOTS = new Map([
  [1, { x: 0, z: 0 }],
  [2, { x: 0, z: -8 }],
]);

describe('JumpStartJudge', () => {
  it('nothing counts before the first light', () => {
    const j = new JumpStartJudge(LIGHTS, GO, SLOTS);
    expect(j.onState(1, 0, 0, LIGHTS - 500)).toBe(false);
    expect(j.onState(1, 0, 5, LIGHTS - 100)).toBe(false);
  });

  it('moving 1.5 m+ after the first light and before lights out is a jump start, reported once', () => {
    const j = new JumpStartJudge(LIGHTS, GO, SLOTS);
    expect(j.onState(1, 0, 0, LIGHTS + 100)).toBe(false);
    expect(j.onState(1, 0, far, GO - 500)).toBe(true);
    expect(j.onState(1, 0, far * 3, GO - 400)).toBe(false);
  });

  it('moving after lights out is fine', () => {
    const j = new JumpStartJudge(LIGHTS, GO, SLOTS);
    j.onState(1, 0, 0, LIGHTS + 100);
    expect(j.onState(1, 0, far * 4, GO)).toBe(false);
  });

  it('a car still elsewhere (track loading) is judged only once it is on its slot', () => {
    const j = new JumpStartJudge(LIGHTS, GO, SLOTS);
    // Still on the old track's grid after the first light: ignored.
    expect(j.onState(1, 200, 300, LIGHTS + 100)).toBe(false);
    expect(j.onState(1, 210, 300, LIGHTS + 2000)).toBe(false);
    // Placed on its slot (a teleport, not a jump start).
    expect(j.onState(1, 0.3, 0.2, LIGHTS + 2500)).toBe(false);
    expect(j.onState(1, 0.3, 0.2 + far, GO - 100)).toBe(true);
  });

  it('a car pushed by a jump-starter is not penalised', () => {
    const j = new JumpStartJudge(LIGHTS, GO, SLOTS);
    j.onState(1, 0, 0, LIGHTS + 100);
    j.onState(2, 0, -8, LIGHTS + 100);
    // Car 2 drives into car 1.
    expect(j.onState(2, 0, -3, LIGHTS + 1500)).toBe(true);
    expect(j.onState(1, 0, 2, LIGHTS + 1600)).toBe(false);
    // Car 2 backs away; car 1 sitting where it was pushed is still fine.
    j.onState(2, 0, -20, LIGHTS + 2500);
    expect(j.onState(1, 0, 2.3, LIGHTS + 2600)).toBe(false);
    // But driving off on its own is a jump start.
    expect(j.onState(1, 0, 2.3 + far, LIGHTS + 3000)).toBe(true);
  });

  it('ignores cars that are not entrants', () => {
    const j = new JumpStartJudge(LIGHTS, GO, SLOTS);
    j.onState(3, 0, 0, LIGHTS + 50);
    expect(j.onState(3, 0, 50, GO - 50)).toBe(false);
  });
});
