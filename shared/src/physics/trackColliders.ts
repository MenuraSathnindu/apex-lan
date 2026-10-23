import type { BuiltTrack, MeshData } from '../track/track.ts';
import type { SurfaceKind } from '../tuning.ts';
import { TRACK_GROUPS } from './collisionGroups.ts';
import { RAPIER, type Collider, type World } from './rapier.ts';
import { tagSurface } from './surfaces.ts';

/** Grass extends this far beyond the track's bounding box. */
export const GROUND_MARGIN = 400;

function trimesh(mesh: MeshData) {
  return RAPIER.ColliderDesc.trimesh(new Float32Array(mesh.positions), new Uint32Array(mesh.indices));
}

export function trackBounds(track: BuiltTrack) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const s of track.samples) {
    minX = Math.min(minX, s.x);
    maxX = Math.max(maxX, s.x);
    minZ = Math.min(minZ, s.z);
    maxZ = Math.max(maxZ, s.z);
  }
  return { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
}

/**
 * Builds every static collider for a track: grass ground, road, kerbs, gravel, paved run-off,
 * pit lane, barriers. Returns them so the track can be swapped out (`removeTrackColliders`).
 */
export function addTrackColliders(world: World, track: BuiltTrack): Collider[] {
  const created: Collider[] = [];
  const b = trackBounds(track);
  const ground = world.createCollider(
    RAPIER.ColliderDesc.cuboid((b.maxX - b.minX) / 2 + GROUND_MARGIN, 0.5, (b.maxZ - b.minZ) / 2 + GROUND_MARGIN)
      .setTranslation(b.cx, -0.5, b.cz)
      .setCollisionGroups(TRACK_GROUPS),
  );
  tagSurface(world, ground, 'grass');
  created.push(ground);

  const surface = (mesh: MeshData, kind: SurfaceKind) => {
    if (mesh.indices.length === 0) return;
    const c = world.createCollider(trimesh(mesh).setCollisionGroups(TRACK_GROUPS));
    tagSurface(world, c, kind);
    created.push(c);
  };
  surface(track.road, 'asphalt');
  surface(track.curbs, 'curb');
  surface(track.gravel, 'gravel');
  surface(track.apron, 'asphalt');
  surface(track.pitLane, 'asphalt');

  for (const seg of track.barrierSegments) {
    created.push(
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(seg.thickness / 2, seg.height / 2, seg.halfLength)
          .setTranslation(seg.cx, seg.height / 2, seg.cz)
          .setRotation({ x: 0, y: Math.sin(seg.yaw / 2), z: 0, w: Math.cos(seg.yaw / 2) })
          .setFriction(0.4)
          .setRestitution(0.2)
          .setCollisionGroups(TRACK_GROUPS),
      ),
    );
  }
  return created;
}

export function removeTrackColliders(world: World, colliders: Collider[]): void {
  for (const c of colliders) world.removeCollider(c, false);
}
