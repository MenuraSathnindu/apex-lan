import type { SurfaceKind } from '../tuning.ts';
import type { Collider, World } from './rapier.ts';

// Rapier colliders have no user data, so surface types live in a side table per world.
const registry = new WeakMap<World, Map<number, SurfaceKind>>();

export function tagSurface(world: World, collider: Collider, surface: SurfaceKind): void {
  let map = registry.get(world);
  if (!map) registry.set(world, (map = new Map()));
  map.set(collider.handle, surface);
}

/** Surface of a collider; untagged colliders count as asphalt. */
export function surfaceOf(world: World, collider: Collider | null): SurfaceKind {
  if (!collider) return 'asphalt';
  return registry.get(world)?.get(collider.handle) ?? 'asphalt';
}
