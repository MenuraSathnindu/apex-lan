import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../constants.ts';
import { CAR } from '../tuning.ts';
import { createErs, lapBudgetLeft, newErsLap, refillErs, stepErs, type ErsInput } from './ers.ts';

const idle: ErsInput = { throttle: 0, brake: 0, boost: false, speed: 60 };
const run = (e: ReturnType<typeof createErs>, i: Partial<ErsInput>, seconds: number) => {
  let energyKw = 0;
  for (let k = 0; k < Math.round(seconds / FIXED_DT); k++) energyKw += stepErs(e, CAR, { ...idle, ...i }, FIXED_DT) * FIXED_DT;
  return energyKw; // joules delivered as extra drive
};

describe('ERS', () => {
  it('starts partly charged and refills for a new race', () => {
    const e = createErs(CAR);
    expect(e.charge).toBeCloseTo(CAR.ers.capacity * CAR.ers.startCharge);
    e.charge = 0;
    e.lapDeployed = 5;
    refillErs(e, CAR);
    expect(e.charge).toBeCloseTo(CAR.ers.capacity * CAR.ers.startCharge);
    expect(e.lapDeployed).toBe(0);
  });

  it('harvests under braking (more at higher speed) and when lifting off, but not when slow', () => {
    const braking = createErs(CAR);
    braking.charge = 0;
    run(braking, { brake: 1, speed: 80 }, 1);
    const slowBrake = createErs(CAR);
    slowBrake.charge = 0;
    run(slowBrake, { brake: 1, speed: 15 }, 1);
    const lift = createErs(CAR);
    lift.charge = 0;
    run(lift, { throttle: 0 }, 1);
    const crawl = createErs(CAR);
    crawl.charge = 0;
    run(crawl, { brake: 1, speed: 5 }, 1);
    expect(braking.charge).toBeGreaterThan(slowBrake.charge);
    expect(slowBrake.charge).toBeGreaterThan(lift.charge);
    expect(lift.charge).toBeGreaterThan(0);
    expect(crawl.charge).toBe(0);
  });

  it('never overcharges', () => {
    const e = createErs(CAR);
    e.charge = CAR.ers.capacity;
    run(e, { brake: 1 }, 2);
    expect(e.charge).toBe(CAR.ers.capacity);
  });

  it('deploys only with boost held and the throttle down, and conserves energy', () => {
    const e = createErs(CAR);
    const before = e.charge;
    expect(run(e, { throttle: 1 }, 1)).toBe(0);
    expect(e.charge).toBe(before);
    const delivered = run(e, { throttle: 1, boost: true }, 1);
    expect(delivered).toBeGreaterThan(CAR.ers.deployPower * 0.95);
    expect(before - e.charge).toBeCloseTo(delivered, 0);
    expect(e.deploying).toBeGreaterThan(0.9);
  });

  it('stops when the battery is empty and fades out toward top speed', () => {
    const e = createErs(CAR);
    e.charge = 0;
    expect(run(e, { throttle: 1, boost: true }, 0.5)).toBe(0);
    const fast = createErs(CAR);
    const slow = createErs(CAR);
    expect(run(fast, { throttle: 1, boost: true, speed: CAR.ers.taperToSpeed - 1 }, 0.5)).toBeLessThan(
      run(slow, { throttle: 1, boost: true, speed: 50 }, 0.5) / 2,
    );
    expect(run(createErs(CAR), { throttle: 1, boost: true, speed: CAR.ers.taperToSpeed + 5 }, 0.5)).toBe(0);
  });

  it('limits deployment per lap, and overtake mode unlocks extra energy and power for that lap', () => {
    const normal = createErs(CAR);
    normal.charge = CAR.ers.capacity;
    const dNormal = run(normal, { throttle: 1, boost: true, speed: 50 }, 20);
    expect(dNormal).toBeCloseTo(CAR.ers.lapDeployLimit, -3);
    expect(lapBudgetLeft(normal, CAR)).toBe(0);

    const ot = createErs(CAR);
    ot.charge = CAR.ers.capacity;
    ot.overtake = true;
    const dOt = run(ot, { throttle: 1, boost: true, speed: 50 }, 20);
    expect(dOt).toBeGreaterThan(dNormal + CAR.ers.overtake.extraLapEnergy * 0.95);

    const p1 = createErs(CAR);
    const p2 = createErs(CAR);
    p2.overtake = true;
    expect(run(p2, { throttle: 1, boost: true, speed: 50 }, 0.2)).toBeGreaterThan(run(p1, { throttle: 1, boost: true, speed: 50 }, 0.2));

    newErsLap(normal);
    expect(normal.lapDeployed).toBe(0);
    expect(normal.overtake).toBe(false);
  });
});
