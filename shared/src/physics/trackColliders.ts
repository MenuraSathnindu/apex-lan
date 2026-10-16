import type { BuiltTrack, MeshData } from '../track/track.ts';
import { TRACK_GROUPS } from './collisionGroups.ts';
import { RAPIER, type World } from './rapier.ts';
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

/** Builds every static collider for a track: grass ground, road, curbs, barriers. */
export function addTrackColliders(world: World, track: BuiltTrack): void {
  const b = trackBounds(track);
  const ground = world.createCollider(
    RAPIER.ColliderDesc.cuboid((b.maxX - b.minX) / 2 + GROUND_MARGIN, 0.5, (b.maxZ - b.minZ) / 2 + GROUND_MARGIN)
      .setTranslation(b.cx, -0.5, b.cz)
      .setCollisionGroups(TRACK_GROUPS),
  );
  tagSurface(world, ground, 'grass');

  tagSurface(world, world.createCollider(trimesh(track.road).setCollisionGroups(TRACK_GROUPS)), 'asphalt');
  if (track.curbs.indices.length > 0) {
    tagSurface(world, world.createCollider(trimesh(track.curbs).setCollisionGroups(TRACK_GROUPS)), 'curb');
  }

  const { barrierHeight: h, barrierThickness: t } = track.def;
  for (const seg of track.barrierSegments) {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(t / 2, h / 2, seg.halfLength)
        .setTranslation(seg.cx, h / 2, seg.cz)
        .setRotation({ x: 0, y: Math.sin(seg.yaw / 2), z: 0, w: Math.cos(seg.yaw / 2) })
        .setFriction(0.4)
        .setRestitution(0.2)
        .setCollisionGroups(TRACK_GROUPS),
    );
  }
}
