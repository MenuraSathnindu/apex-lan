import { beforeAll, describe, expect, it } from 'vitest';
import { FIXED_DT } from '../constants.ts';
import { NEUTRAL_INPUT, type CarInput } from '../input.ts';
import { driveLap } from '../physics/autopilot.ts';
import { initRapier } from '../physics/rapier.ts';
import { addTrackColliders } from '../physics/trackColliders.ts';
import { createVehicle, stepVehicle, vehicleSpeed } from '../physics/vehicle.ts';
import { createWorld } from '../physics/world.ts';
import { buildTrack, distanceToCenterline } from './track.ts';
import { trackContract } from './trackContract.testutil.ts';
import { TRACKS } from './tracks.ts';

beforeAll(async () => {
  await initRapier();
});

describe.each(Object.values(TRACKS))('track $name', (def) => {
  const track = buildTrack(def);

  it('meets the track contract', () => trackContract(track));

  it('lets a car drive off the grid on asphalt, and detects grass off-track', () => {
    const world = createWorld();
    addTrackColliders(world, track);
    const car = createVehicle(world, track.spawnGrid[0]!);
    const run = (input: Partial<CarInput>, seconds: number) => {
      for (let i = 0; i < Math.round(seconds / FIXED_DT); i++) {
        stepVehicle(car, { ...NEUTRAL_INPUT, ...input }, FIXED_DT);
        world.step();
      }
    };
    run({}, 1);
    expect(car.surfaces).toEqual(['asphalt', 'asphalt', 'asphalt', 'asphalt']);
    run({ throttle: 1 }, 2);
    const p = car.body.translation();
    expect(distanceToCenterline(track, p.x, p.z)).toBeLessThan(6);
    expect(vehicleSpeed(car)).toBeGreaterThan(10);

    // A car placed on the grass beside the main straight (the side without the pit lane) reports grass.
    const grassWorld = createWorld();
    addTrackColliders(grassWorld, track);
    const i = Math.round(60 / track.samples[1]!.s);
    const s = track.samples[i]!;
    const side = def.pitLane?.side === 1 ? -1 : 1;
    const off = side * ((side > 0 ? s.wl : s.wr) + 5);
    const onGrass = createVehicle(grassWorld, { position: { x: s.x + s.nx * off, y: 1, z: s.z + s.nz * off }, yaw: Math.atan2(s.tx, s.tz) });
    for (let k = 0; k < 60; k++) {
      stepVehicle(onGrass, NEUTRAL_INPUT, FIXED_DT);
      grassWorld.step();
    }
    expect(onGrass.surfaces).toEqual(['grass', 'grass', 'grass', 'grass']);
  });

  it('can be driven round, and the checkpoints count the lap', () => {
    const r = driveLap(track);
    expect(r.completed).toBe(true);
    expect(r.resets).toBe(0);
  });
});
