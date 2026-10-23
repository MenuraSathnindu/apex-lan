import type { SpawnPose } from '../physics/vehicle.ts';
import { sampleClosedSpline, type TrackSample } from './spline.ts';
import type { TrackZone } from './zones.ts';

export interface TrackDef {
  id: string;
  name: string;
  /** Centreline control points (x, z) in metres, closed loop, in driving order. */
  points: readonly (readonly [number, number])[];
  /** Point nearest to the start/finish line; cars drive away from it in sample order. */
  start: readonly [number, number];
  roadWidth: number;
  curbWidth: number;
  /** Grass between the curb line and the barrier. */
  runoff: number;
  barrierHeight: number;
  barrierThickness: number;
  /** Curbs appear where the corner radius is tighter than this (m). */
  curbMaxRadius: number;
  /** Straights where the wings may open (straight mode), metres from the start line. */
  aeroZones?: readonly TrackZone[];
  /** Where the gap to the car ahead is measured for overtake mode (m from the start line). */
  detectionPoint?: number;
}

/** Plain-array mesh: renderer-agnostic so the server can share the same code. */
export interface MeshData {
  positions: number[];
  uvs: number[];
  indices: number[];
}

/** A straight barrier piece (physics cuboid). */
export interface BarrierSegment {
  cx: number;
  cz: number;
  halfLength: number;
  /** Rotation about +Y so the segment's local +Z runs along it. */
  yaw: number;
}

export interface BuiltTrack {
  def: TrackDef;
  samples: TrackSample[];
  length: number;
  startIndex: number;
  spawnGrid: SpawnPose[];
  road: MeshData;
  curbs: MeshData;
  lines: MeshData;
  startLine: MeshData;
  barrierWalls: MeshData;
  barrierSegments: BarrierSegment[];
}

/** Heights above ground (y = 0 is grass). Wheels ray-cast down and hit the highest surface. */
export const TRACK_HEIGHTS = { road: 0.02, curb: 0.035, paint: 0.026 } as const;

const SAMPLE_SPACING = 2;
const BARRIER_EVERY = 2; // samples per barrier segment (4 m)
const GRID_SLOTS = 8;

function emptyMesh(): MeshData {
  return { positions: [], uvs: [], indices: [] };
}

/**
 * Adds a flat strip between two lateral offsets (+ = left of centreline) for samples
 * [from, to] inclusive (indices may run past the end — they wrap). v runs along the track.
 */
function addStrip(
  mesh: MeshData,
  samples: TrackSample[],
  from: number,
  to: number,
  offA: number,
  offB: number,
  y: number,
  uScale: number,
  vScale: number,
  totalLength: number,
) {
  const n = samples.length;
  const base = mesh.positions.length / 3;
  for (let k = from; k <= to; k++) {
    const smp = samples[k % n]!;
    const s = smp.s + Math.floor(k / n) * totalLength; // keep v increasing across the seam
    for (const off of [offA, offB]) {
      mesh.positions.push(smp.x + smp.nx * off, y, smp.z + smp.nz * off);
      mesh.uvs.push(off * uScale, s * vScale);
    }
  }
  for (let k = 0; k < to - from; k++) {
    const a = base + k * 2;
    // Two triangles, counter-clockwise seen from above (normal +Y).
    if (offA > offB) mesh.indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    else mesh.indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
}

/** Runs of consecutive sample indices where `pred` holds (wrapping), dilated by `pad`. */
function runs(n: number, pred: (i: number) => boolean, pad: number): [number, number][] {
  const on = Array.from({ length: n }, () => false);
  for (let i = 0; i < n; i++) if (pred(i)) for (let d = -pad; d <= pad; d++) on[(i + d + n) % n] = true;
  if (on.every(Boolean)) return [[0, n]];
  const out: [number, number][] = [];
  const startAt = on.indexOf(false);
  let runStart = -1;
  for (let k = 1; k <= n; k++) {
    const i = (startAt + k) % n;
    if (on[i] && runStart < 0) runStart = startAt + k;
    if (!on[i] && runStart >= 0) {
      out.push([runStart, startAt + k - 1]);
      runStart = -1;
    }
  }
  if (runStart >= 0) out.push([runStart, startAt + n]);
  return out;
}

function buildBarrier(
  samples: TrackSample[],
  offset: number,
  height: number,
  thickness: number,
  walls: MeshData,
  segments: BarrierSegment[],
) {
  const n = samples.length;
  const side = Math.sign(offset);
  const pts: [number, number][] = [];
  for (let k = 0; k < n; k += BARRIER_EVERY) {
    const smp = samples[k]!;
    pts.push([smp.x + smp.nx * offset, smp.z + smp.nz * offset]);
  }

  // Wall mesh: inner face (toward the track), top, outer face. Each face gets its own
  // vertices so lighting stays crisp at the 90° edges. Rendered double-sided.
  // Cross-section corners as [outward offset, y].
  const corners = [
    [0, 0],
    [0, height],
    [side * thickness, height],
    [side * thickness, 0],
  ] as const;
  for (let f = 0; f < 3; f++) {
    const base = walls.positions.length / 3;
    let along = 0;
    for (let k = 0; k <= pts.length; k++) {
      const p = pts[k % pts.length]!;
      if (k > 0) {
        const q = pts[k - 1]!;
        along += Math.hypot(p[0] - q[0], p[1] - q[1]);
      }
      const smp = samples[(k * BARRIER_EVERY) % n]!;
      for (const c of [corners[f]!, corners[f + 1]!]) {
        walls.positions.push(p[0] + smp.nx * c[0], c[1], p[1] + smp.nz * c[0]);
        // u along the wall (4 m per repeat); v: 0..1 up the inner face, 1..2 over the top.
        walls.uvs.push(along / 4, f === 1 ? 1 + (c === corners[1] ? 0 : 1) : c[1] / height);
      }
    }
    for (let k = 0; k < pts.length; k++) {
      const a = base + k * 2;
      walls.indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  // Physics: one cuboid per segment, pushed outward by half the thickness.
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k]!;
    const b = pts[(k + 1) % pts.length]!;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    const smp = samples[(k * BARRIER_EVERY) % n]!;
    segments.push({
      cx: (a[0] + b[0]) / 2 + smp.nx * side * (thickness / 2),
      cz: (a[1] + b[1]) / 2 + smp.nz * side * (thickness / 2),
      // Slight overlap so there are no gaps at the joints.
      halfLength: len / 2 + 0.3,
      yaw: Math.atan2(dx, dz),
    });
  }
}

export function buildTrack(def: TrackDef): BuiltTrack {
  const samples = sampleClosedSpline(def.points, SAMPLE_SPACING);
  const n = samples.length;
  const step = samples[1]!.s;
  const length = step * n;
  const half = def.roadWidth / 2;

  let startIndex = 0;
  let best = Infinity;
  samples.forEach((smp, i) => {
    const d = Math.hypot(smp.x - def.start[0], smp.z - def.start[1]);
    if (d < best) [best, startIndex] = [d, i];
  });

  const road = emptyMesh();
  addStrip(road, samples, 0, n, half, -half, TRACK_HEIGHTS.road, 1 / def.roadWidth, 1 / def.roadWidth, length);

  // Curbs on both sides of corners. v scale: one red+white pair per 4 m.
  const curbs = emptyMesh();
  for (const [a, b] of runs(n, (i) => Math.abs(samples[i]!.curvature) > 1 / def.curbMaxRadius, 3)) {
    addStrip(curbs, samples, a, b, half + def.curbWidth, half, TRACK_HEIGHTS.curb, 1 / def.curbWidth, 1 / 4, length);
    addStrip(curbs, samples, a, b, -half, -half - def.curbWidth, TRACK_HEIGHTS.curb, 1 / def.curbWidth, 1 / 4, length);
  }

  // White edge lines, 25 cm wide, 30 cm in from the edge.
  const lines = emptyMesh();
  addStrip(lines, samples, 0, n, half - 0.3, half - 0.55, TRACK_HEIGHTS.paint, 1, 1 / 4, length);
  addStrip(lines, samples, 0, n, -half + 0.55, -half + 0.3, TRACK_HEIGHTS.paint, 1, 1 / 4, length);

  // Start/finish: a 2 m chequered band across the road (u 0..1 across, v 0..1 along).
  const startLine = emptyMesh();
  {
    const smp = samples[startIndex]!;
    for (const along of [-1, 1]) {
      for (const off of [half, -half]) {
        startLine.positions.push(
          smp.x + smp.tx * along + smp.nx * off,
          TRACK_HEIGHTS.paint + 0.002,
          smp.z + smp.tz * along + smp.nz * off,
        );
        startLine.uvs.push(off > 0 ? 0 : 1, along > 0 ? 1 : 0);
      }
    }
    startLine.indices.push(0, 2, 1, 1, 2, 3);
  }

  const barrierWalls = emptyMesh();
  const barrierSegments: BarrierSegment[] = [];
  const barrierOffset = half + def.curbWidth + def.runoff;
  buildBarrier(samples, barrierOffset, def.barrierHeight, def.barrierThickness, barrierWalls, barrierSegments);
  buildBarrier(samples, -barrierOffset, def.barrierHeight, def.barrierThickness, barrierWalls, barrierSegments);

  // Grid behind the start line, two staggered columns.
  const spawnGrid: SpawnPose[] = [];
  for (let i = 0; i < GRID_SLOTS; i++) {
    const back = 8 + Math.floor(i / 2) * 9 + (i % 2) * 4.5;
    const smp = samples[(startIndex - Math.round(back / step) + n * 4) % n]!;
    const lateral = (i % 2 === 0 ? 1 : -1) * half * 0.42;
    spawnGrid.push({
      position: { x: smp.x + smp.nx * lateral, y: 1.0, z: smp.z + smp.nz * lateral },
      yaw: Math.atan2(smp.tx, smp.tz),
    });
  }

  return { def, samples, length, startIndex, spawnGrid, road, curbs, lines, startLine, barrierWalls, barrierSegments };
}

/** Distance from (x, z) to the nearest centreline sample (brute force; fine for setup code). */
export function distanceToCenterline(track: BuiltTrack, x: number, z: number): number {
  let best = Infinity;
  for (const smp of track.samples) best = Math.min(best, (smp.x - x) ** 2 + (smp.z - z) ** 2);
  return Math.sqrt(best);
}
