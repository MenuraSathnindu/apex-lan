import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../constants.ts';
import { inZone } from '../track/zones.ts';
import { CAR } from '../tuning.ts';
import { aeroCoefficients, createAero, stepAero, type AeroInput } from './aero.ts';

const base: AeroInput = { inZone: true, press: false, auto: false, brake: 0, steer: 0, speed: 60 };
const run = (a: ReturnType<typeof createAero>, i: Partial<AeroInput>, seconds: number) => {
  for (let k = 0; k < Math.round(seconds / FIXED_DT); k++) stepAero(a, CAR, { ...base, ...i }, FIXED_DT);
};

describe('active aero', () => {
  it('stays closed until the player asks, then opens inside a zone', () => {
    const a = createAero();
    run(a, {}, 1);
    expect(a.blend).toBe(0);
    run(a, { press: true }, FIXED_DT);
    run(a, {}, 1);
    expect(a.blend).toBe(1);
  });

  it('ignores the key outside a zone and when slow', () => {
    const a = createAero();
    run(a, { press: true, inZone: false }, 1);
    expect(a.open).toBe(false);
    run(a, { press: true, speed: 10 }, 1);
    expect(a.open).toBe(false);
  });

  it('opens by itself in auto mode', () => {
    const a = createAero();
    run(a, { auto: true }, 1);
    expect(a.blend).toBe(1);
  });

  it('snaps shut on braking, hard steering and when leaving the zone — faster than it opens', () => {
    for (const closer of [{ brake: 1 }, { steer: 1 }, { inZone: false }]) {
      const a = createAero();
      run(a, { auto: true }, 1);
      run(a, closer, CAR.aero.closeTime + 0.05);
      expect(a.blend).toBe(0);
    }
    const slow = createAero();
    run(slow, { auto: true }, CAR.aero.closeTime + 0.05);
    expect(slow.blend).toBeLessThan(1);
  });

  it('trades downforce for drag', () => {
    const closed = aeroCoefficients(createAero(), CAR);
    const open = aeroCoefficients({ blend: 1, open: true }, CAR);
    expect(open.drag).toBeLessThan(closed.drag);
    expect(open.downforce).toBeLessThan(closed.downforce);
    const half = aeroCoefficients({ blend: 0.5, open: true }, CAR);
    expect(half.drag).toBeCloseTo((open.drag + closed.drag) / 2);
  });
});

describe('track zones', () => {
  const zones = [
    { from: 1075, to: 135 },
    { from: 815, to: 900 },
  ];
  it('handles zones that wrap over the start line', () => {
    expect(inZone(zones, 1100)).toBe(true);
    expect(inZone(zones, 50)).toBe(true);
    expect(inZone(zones, 500)).toBe(false);
    expect(inZone(zones, 850)).toBe(true);
    expect(inZone(undefined, 10)).toBe(false);
  });
});
