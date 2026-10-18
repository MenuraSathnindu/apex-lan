import { beforeAll, describe, expect, it } from 'vitest';
import { FIXED_DT } from '../constants.ts';
import { NEUTRAL_INPUT, type CarInput } from '../input.ts';
import { TRACK_GROUPS } from './collisionGroups.ts';
import { initRapier, RAPIER } from './rapier.ts';
import { tagSurface } from './surfaces.ts';
import { createVehicle, stepVehicle } from './vehicle.ts';
import { emptyWheelSlips, readChassisContacts, readWheelSlip } from './vehicleFx.ts';
import { createWorld } from './world.ts';

beforeAll(async () => {
  await initRapier();
});

function setup(withWall = false) {
  const world = createWorld();
  const ground = world.createCollider(RAPIER.ColliderDesc.cuboid(200, 0.5, 200).setTranslation(0, -0.5, 0).setCollisionGroups(TRACK_GROUPS));
  tagSurface(world, ground, 'asphalt');
  if (withWall) {
    // A wall across the road 20 m ahead (untagged = barrier).
    world.createCollider(RAPIER.ColliderDesc.cuboid(10, 0.6, 0.2).setTranslation(0, 0.6, 20).setCollisionGroups(TRACK_GROUPS));
  }
  const car = createVehicle(world, { position: { x: 0, y: 1, z: 0 }, yaw: 0 });
  const slips = emptyWheelSlips();
  const step = (input: Partial<CarInput>) => {
    const i = { ...NEUTRAL_INPUT, ...input };
    stepVehicle(car, i, FIXED_DT);
    world.step();
    readWheelSlip(car, i, slips);
  };
  const run = (input: Partial<CarInput>, seconds: number) => {
    for (let k = 0; k < Math.round(seconds / FIXED_DT); k++) step(input);
  };
  return { world, car, slips, step, run };
}

const maxSlip = (s: { slip: number }[]) => Math.max(...s.map((w) => w.slip));

describe('wheel slip', () => {
  it('is ~0 when cruising straight', () => {
    const { car, slips, run } = setup();
    run({}, 1);
    car.body.setLinvel({ x: 0, y: 0, z: 20 }, true);
    run({}, 0.5);
    expect(slips.every((w) => w.inContact && w.surface === 'asphalt')).toBe(true);
    expect(maxSlip(slips)).toBeLessThan(0.5);
  });

  it('is large when the car slides sideways', () => {
    const { car, slips, run, step } = setup();
    run({}, 1);
    car.body.setLinvel({ x: 15, y: 0, z: 0 }, true); // sideways
    step({});
    expect(maxSlip(slips)).toBeGreaterThan(10);
  });

  it('rear tyres slide under the handbrake at speed', () => {
    const { car, slips, run } = setup();
    run({}, 1);
    car.body.setLinvel({ x: 0, y: 0, z: 25 }, true);
    run({ handbrake: true }, 0.1);
    expect(slips[2]!.slip).toBeGreaterThan(5);
    expect(slips[0]!.slip).toBeLessThan(slips[2]!.slip);
  });

  it('fakes wheelspin at a full-throttle launch on the driven (rear) wheels', () => {
    const { slips, run, step } = setup();
    run({}, 1);
    step({ throttle: 1 });
    expect(slips[2]!.slip).toBeGreaterThan(3);
    expect(slips[0]!.slip).toBeLessThan(1);
  });
});

describe('chassis contacts', () => {
  it('reports nothing while driving on the road', () => {
    const { car, run } = setup(true);
    run({}, 1);
    expect(readChassisContacts(car).count).toBe(0);
  });

  it('reports a barrier hit with an impact strength and a normal pointing back at the car', () => {
    const { car, run, step } = setup(true);
    run({}, 1);
    car.body.setLinvel({ x: 0, y: 0, z: 18 }, true);
    let best = 0;
    let normalZ = 0;
    for (let k = 0; k < 120; k++) {
      step({});
      const { count, contacts } = readChassisContacts(car);
      for (let i = 0; i < count; i++) {
        const c = contacts[i]!;
        expect(c.kind).toBe('barrier');
        if (c.dv > best) [best, normalZ] = [c.dv, c.normal.z];
      }
    }
    expect(best).toBeGreaterThan(5);
    expect(normalZ).toBeLessThan(-0.8);
  });
});
