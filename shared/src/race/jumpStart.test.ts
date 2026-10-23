import { describe, expect, it } from 'vitest';
import { RACE } from '../tuning.ts';
import { JumpStartJudge } from './jumpStart.ts';

const LIGHTS = 10_000;
const GO = 16_000;
const far = RACE.jumpStartDistance + 0.1;

describe('JumpStartJudge', () => {
  it('no reference before the first light: moving then is fine', () => {
    const j = new JumpStartJudge(LIGHTS, GO, [1]);
    expect(j.onState(1, 0, 0, LIGHTS - 500)).toBe(false);
    expect(j.onState(1, 30, 0, LIGHTS - 100)).toBe(false);
    // The first state at the first light is the reference.
    expect(j.onState(1, 30, 0, LIGHTS + 10)).toBe(false);
    expect(j.onState(1, 30, 1, GO - 10)).toBe(false);
  });

  it('moving 1.5 m+ after the first light and before lights out is a jump start, reported once', () => {
    const j = new JumpStartJudge(LIGHTS, GO, [1]);
    expect(j.onState(1, 5, 5, LIGHTS + 100)).toBe(false);
    expect(j.onState(1, 5, 5 + far, GO - 500)).toBe(true);
    expect(j.onState(1, 5, 5 + far * 3, GO - 400)).toBe(false);
  });

  it('moving after lights out is fine', () => {
    const j = new JumpStartJudge(LIGHTS, GO, [1]);
    j.onState(1, 0, 0, LIGHTS + 100);
    expect(j.onState(1, 0, far * 4, GO)).toBe(false);
  });

  it('the reference is the first state at/after the first light', () => {
    const j = new JumpStartJudge(LIGHTS, GO, [1]);
    // Still being put on the grid (lobby pose) before the lights: ignored.
    j.onState(1, 100, 100, LIGHTS - 200);
    j.onState(1, 0, 0, LIGHTS + 50);
    expect(j.onState(1, 0, 1, GO - 100)).toBe(false);
    expect(j.onState(1, 0, far, GO - 50)).toBe(true);
  });

  it('ignores cars that are not entrants', () => {
    const j = new JumpStartJudge(LIGHTS, GO, [1]);
    j.onState(2, 0, 0, LIGHTS + 50);
    expect(j.onState(2, 0, 50, GO - 50)).toBe(false);
  });
});
