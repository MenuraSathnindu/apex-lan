import { FIXED_DT } from '../constants.ts';
import type { StaticBox } from '../track/testGround.ts';
import { TRACK_GROUPS } from './collisionGroups.ts';
import { RAPIER, type World } from './rapier.ts';

export const GRAVITY = { x: 0, y: -9.81, z: 0 };

/** Creates a physics world with our fixed timestep. Call `initRapier()` first. */
export function createWorld(): World {
  const world = new RAPIER.World(GRAVITY);
  world.timestep = FIXED_DT;
  return world;
}

/** Adds fixed box colliders (ground, ramps, obstacles) to the world. */
export function addStaticBoxes(world: World, boxes: readonly StaticBox[]): void {
  for (const b of boxes) {
    const desc = RAPIER.ColliderDesc.cuboid(b.halfExtents.x, b.halfExtents.y, b.halfExtents.z)
      .setTranslation(b.position.x, b.position.y, b.position.z)
      .setRotation(b.rotation)
      .setFriction(b.friction ?? 1)
      .setCollisionGroups(TRACK_GROUPS);
    world.createCollider(desc);
  }
}
