import type { Vec3Like } from '../tuning.ts';

export interface QuatLike {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** A fixed box, used for both the physics collider and the rendered mesh. */
export interface StaticBox {
  kind: 'ground' | 'ramp' | 'bump' | 'block';
  halfExtents: Vec3Like;
  position: Vec3Like;
  rotation: QuatLike;
  friction?: number;
}

const IDENTITY: QuatLike = { x: 0, y: 0, z: 0, w: 1 };

function aboutX(angle: number): QuatLike {
  return { x: Math.sin(angle / 2), y: 0, z: 0, w: Math.cos(angle / 2) };
}

/** Ramp of given length/height, starting at (x, z) and rising toward +Z. */
function ramp(x: number, z: number, width: number, length: number, height: number): StaticBox {
  const angle = Math.atan2(height, length);
  const slope = Math.hypot(length, height);
  const thickness = 0.4;
  return {
    kind: 'ramp',
    halfExtents: { x: width / 2, y: thickness / 2, z: slope / 2 },
    // Centre of the slab, pushed down by half its thickness so the top surface starts at ground level.
    position: {
      x,
      y: height / 2 - (Math.cos(angle) * thickness) / 2,
      z: z + length / 2 + (Math.sin(angle) * thickness) / 2,
    },
    rotation: aboutX(-angle),
  };
}

/**
 * Phase 1 driving playground: big flat ground, a few ramps, a row of speed bumps
 * and some blocks to crash into. Replaced by spline tracks in phase 2.
 */
export function createTestGround(): StaticBox[] {
  const boxes: StaticBox[] = [
    {
      kind: 'ground',
      halfExtents: { x: 300, y: 0.5, z: 300 },
      position: { x: 0, y: -0.5, z: 0 },
      rotation: IDENTITY,
    },
    ramp(-12, 40, 6, 12, 1.6),
    ramp(14, 70, 8, 18, 3.2),
    ramp(-40, -30, 10, 10, 0.9),
  ];

  for (let i = 0; i < 6; i++) {
    boxes.push({
      kind: 'bump',
      halfExtents: { x: 4, y: 0.08, z: 0.25 },
      position: { x: 30, y: 0.03, z: 10 + i * 6 },
      rotation: IDENTITY,
    });
  }

  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    boxes.push({
      kind: 'block',
      halfExtents: { x: 1, y: 1, z: 1 },
      position: { x: Math.cos(a) * 60, y: 1, z: -60 + Math.sin(a) * 25 },
      rotation: IDENTITY,
    });
  }

  return boxes;
}
