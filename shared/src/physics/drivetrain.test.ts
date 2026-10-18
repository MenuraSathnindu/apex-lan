import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../constants.ts';
import { DRIVETRAIN } from '../tuning.ts';
import { createDrivetrain, gearLabel, stepDrivetrain, wheelRpm } from './drivetrain.ts';

const run = (s: ReturnType<typeof createDrivetrain>, speed: number, throttle: number, seconds: number, braking = false) => {
  for (let i = 0; i < Math.round(seconds / FIXED_DT); i++) stepDrivetrain(s, speed, throttle, braking, FIXED_DT);
};

describe('drivetrain (sound/HUD gearbox)', () => {
  it('idles in neutral when stopped', () => {
    const s = createDrivetrain();
    run(s, 0, 0, 1);
    expect(s.gear).toBe(0);
    expect(gearLabel(s.gear)).toBe('N');
    expect(s.rpm).toBeCloseTo(DRIVETRAIN.idleRpm, -1);
  });

  it('revs up with clutch slip at launch, in first', () => {
    const s = createDrivetrain();
    run(s, 0.5, 1, 0.5);
    expect(s.gear).toBe(1);
    expect(s.rpm).toBeGreaterThan(DRIVETRAIN.idleRpm + DRIVETRAIN.launchRpm * 0.8);
  });

  it('shifts up through the gears while accelerating and never passes the limiter', () => {
    const s = createDrivetrain();
    let maxRpm = 0;
    const gears = new Set<number>();
    for (let v = 0; v <= 64; v += 0.05) {
      stepDrivetrain(s, v, 1, false, FIXED_DT);
      maxRpm = Math.max(maxRpm, s.rpm);
      gears.add(s.gear);
    }
    expect(s.gear).toBe(DRIVETRAIN.ratios.length);
    expect([...gears].filter((g) => g > 0).length).toBe(DRIVETRAIN.ratios.length);
    expect(maxRpm).toBeLessThanOrEqual(DRIVETRAIN.limiterRpm);
    // Top gear at top speed sits below the redline.
    expect(wheelRpm(64, DRIVETRAIN.ratios.length)).toBeLessThan(DRIVETRAIN.redlineRpm);
  });

  it('cruising shifts earlier than flat out', () => {
    const lazy = createDrivetrain();
    const flat = createDrivetrain();
    for (let v = 0; v <= 20; v += 0.05) {
      stepDrivetrain(lazy, v, 0.2, false, FIXED_DT);
      stepDrivetrain(flat, v, 1, false, FIXED_DT);
    }
    expect(lazy.gear).toBeGreaterThan(flat.gear);
  });

  it('shifts down when slowing and cuts load during a shift', () => {
    const s = createDrivetrain();
    for (let v = 0; v <= 50; v += 0.05) stepDrivetrain(s, v, 1, false, FIXED_DT);
    const high = s.gear;
    let sawCut = false;
    for (let v = 50; v >= 8; v -= 0.1) {
      stepDrivetrain(s, v, 0, true, FIXED_DT);
      if (s.shifted) sawCut = true;
    }
    expect(s.gear).toBeLessThan(high);
    expect(sawCut).toBe(true);
    expect(s.load).toBe(0);
  });

  it('selects reverse when rolling backwards', () => {
    const s = createDrivetrain();
    run(s, -3, 0.5, 0.3);
    expect(gearLabel(s.gear)).toBe('R');
    expect(s.rpm).toBeGreaterThan(DRIVETRAIN.idleRpm);
  });
});
