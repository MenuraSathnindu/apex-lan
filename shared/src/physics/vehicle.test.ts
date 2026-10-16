import { beforeAll, describe, expect, it } from 'vitest';
import { FIXED_DT } from '../constants.ts';
import { NEUTRAL_INPUT, type CarInput } from '../input.ts';
import { createTestGround } from '../track/testGround.ts';
import { measureHandling, type HandlingReport } from './handlingMetrics.ts';
import { initRapier } from './rapier.ts';
import { createVehicle, readWheelStates, stepVehicle, vehicleSpeed, type WheelState } from './vehicle.ts';
import { addStaticBoxes, createWorld } from './world.ts';

beforeAll(async () => {
  await initRapier();
});

function setup() {
  const world = createWorld();
  addStaticBoxes(world, createTestGround().filter((b) => b.kind === 'ground'));
  const car = createVehicle(world, { position: { x: 0, y: 1, z: 0 }, yaw: 0 });
  const run = (input: Partial<CarInput>, seconds: number) => {
    for (let i = 0; i < Math.round(seconds / FIXED_DT); i++) {
      stepVehicle(car, { ...NEUTRAL_INPUT, ...input }, FIXED_DT);
      world.step();
    }
  };
  return { world, car, run };
}

describe('vehicle conventions', () => {
  it('settles on its wheels', () => {
    const { car, run } = setup();
    run({}, 2);
    const states: WheelState[] = [];
    readWheelStates(car, states);
    expect(states.every((s) => s.inContact)).toBe(true);
    expect(Math.abs(vehicleSpeed(car))).toBeLessThan(0.1);
  });

  it('throttle drives toward +Z', () => {
    const { car, run } = setup();
    run({}, 1);
    run({ throttle: 1 }, 2);
    const p = car.body.translation();
    expect(p.z).toBeGreaterThan(10);
    expect(Math.abs(p.x)).toBeLessThan(0.5);
    expect(vehicleSpeed(car)).toBeGreaterThan(5);
  });

  it('steer +1 turns right (toward -X)', () => {
    const { car, run } = setup();
    run({}, 1);
    run({ throttle: 1 }, 1.5);
    run({ throttle: 0.5, steer: 1 }, 1);
    expect(car.body.translation().x).toBeLessThan(-1);
  });

  it('brake from standstill reverses', () => {
    const { car, run } = setup();
    run({}, 1);
    run({ brake: 1 }, 2);
    expect(vehicleSpeed(car)).toBeLessThan(-1);
    expect(car.body.translation().z).toBeLessThan(-1);
  });

  it('reset puts a flipped car upright', () => {
    const { car, run } = setup();
    run({}, 1);
    car.body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true); // upside down
    run({}, 1);
    run({ reset: true }, FIXED_DT);
    run({}, 1.5);
    const q = car.body.rotation();
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    expect(upY).toBeGreaterThan(0.95);
  });

  it('auto-resets after being stuck upside down', () => {
    const { car, run } = setup();
    run({}, 1);
    car.body.setTranslation({ x: 0, y: 1.5, z: 0 }, true);
    car.body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true);
    run({}, 5.5);
    const q = car.body.rotation();
    expect(1 - 2 * (q.x * q.x + q.z * q.z)).toBeGreaterThan(0.95);
  });
});

describe('handling stays in sane ranges', () => {
  let r: HandlingReport;
  beforeAll(() => {
    r = measureHandling();
  });

  it('suspension sag is realistic', () => {
    expect(r.restSagCm).toBeGreaterThan(3);
    expect(r.restSagCm).toBeLessThan(15);
  });
  it('accelerates like a sporty car', () => {
    expect(r.zeroTo100s).toBeGreaterThan(3);
    expect(r.zeroTo100s).toBeLessThan(8);
  });
  it('has a sensible top speed', () => {
    expect(r.topSpeedKmh).toBeGreaterThan(160);
    expect(r.topSpeedKmh).toBeLessThan(320);
  });
  it('brakes 100-0 in under 50 m', () => expect(r.brake100to0m).toBeLessThan(50));
  it('is grippy without the handbrake', () => {
    expect(r.cornerLateralG).toBeGreaterThan(0.9);
    expect(r.noHandbrakeSlipDeg).toBeLessThan(8);
  });
  it('does not roll over in hard cornering', () => {
    expect(r.cornerStayedUpright).toBe(true);
    expect(r.highSpeedTurnUpright).toBe(true);
  });
  it('drifts with the handbrake and recovers', () => {
    expect(r.handbrakeSlipDeg).toBeGreaterThan(15);
    expect(r.handbrakeSlipDeg).toBeLessThan(90);
    expect(r.handbrakeRecoverySlipDeg).toBeLessThan(10);
    expect(r.handbrakeEndSpeedKmh).toBeGreaterThan(20);
  });
});
