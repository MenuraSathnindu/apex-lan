import { beforeAll, describe, expect, it } from 'vitest';
import { FIXED_DT } from '../constants.ts';
import { NEUTRAL_INPUT, type CarInput } from '../input.ts';
import { initRapier } from '../physics/rapier.ts';
import { addTrackColliders } from '../physics/trackColliders.ts';
import { createVehicle, stepVehicle, vehicleSpeed } from '../physics/vehicle.ts';
import { createWorld } from '../physics/world.ts';
import { buildTrack, distanceToCenterline } from './track.ts';
import { TRACKS } from './tracks.ts';
import { analyzeTrack } from './validate.ts';

beforeAll(async () => {
  await initRapier();
});

describe.each(Object.values(TRACKS))('track $name', (def) => {
  const track = buildTrack(def);

  it('has no corners too tight for its barriers', () => {
    const r = analyzeTrack(track);
    expect(r.minRadiusM).toBeGreaterThan(r.requiredMinRadiusM);
  });

  it('never runs close enough to itself for barriers to overlap', () => {
    const r = analyzeTrack(track);
    expect(r.minSeparationM).toBeGreaterThan(r.requiredSeparationM);
  });

  it('puts every grid slot on the road', () => {
    expect(track.spawnGrid).toHaveLength(8);
    for (const p of track.spawnGrid) {
      expect(distanceToCenterline(track, p.position.x, p.position.z)).toBeLessThan(def.roadWidth / 2 - 1);
    }
  });

  it('builds closed meshes with valid indices', () => {
    for (const m of [track.road, track.curbs, track.lines, track.barrierWalls, track.startLine]) {
      const verts = m.positions.length / 3;
      expect(m.indices.length % 3).toBe(0);
      expect(Math.max(...m.indices)).toBeLessThan(verts);
      expect(m.uvs.length / 2).toBe(verts);
    }
  });

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
    expect(distanceToCenterline(track, p.x, p.z)).toBeLessThan(def.roadWidth / 2);
    expect(vehicleSpeed(car)).toBeGreaterThan(10);

    // A car placed in the run-off area must report grass under every wheel.
    const grassWorld = createWorld();
    addTrackColliders(grassWorld, track);
    const s = track.samples[track.startIndex]!;
    const off = def.roadWidth / 2 + def.curbWidth + def.runoff / 2;
    const onGrass = createVehicle(grassWorld, {
      position: { x: s.x + s.nx * off, y: 1, z: s.z + s.nz * off },
      yaw: Math.atan2(s.tx, s.tz),
    });
    for (let i = 0; i < 60; i++) {
      stepVehicle(onGrass, NEUTRAL_INPUT, FIXED_DT);
      grassWorld.step();
    }
    expect(onGrass.surfaces).toEqual(['grass', 'grass', 'grass', 'grass']);
  });
});
