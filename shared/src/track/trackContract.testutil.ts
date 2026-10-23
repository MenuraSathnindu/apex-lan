// Shared assertions for every track (built-in and generated). Imported by tests only.
import { expect } from 'vitest';
import { buildCheckpoints } from '../race/checkpoints.ts';
import { closedLength } from './centerline.ts';
import { distanceToCenterline, type BuiltTrack } from './track.ts';
import { analyzeTrack } from './validate.ts';

/** Checks every track must pass (also run on the generated circuits by the server tests). */
export function trackContract(track: BuiltTrack) {
  const r = analyzeTrack(track);
  // Corners a car can get round, a road a car fits on, barriers almost everywhere.
  expect(r.minRadiusM).toBeGreaterThan(8);
  expect(r.minWidthM).toBeGreaterThan(7);
  expect(r.barrierCoverage).toBeGreaterThan(0.9);

  // Length matches the centreline it came from.
  expect(track.length).toBeCloseTo(closedLength(track.def.centerline), -1);

  // Grid on the road, gates in order along the lap.
  expect(track.spawnGrid.length).toBeGreaterThanOrEqual(8);
  for (const p of track.spawnGrid) expect(distanceToCenterline(track, p.position.x, p.position.z)).toBeLessThan(6);
  const gates = buildCheckpoints(track);
  expect(gates[0]!.s).toBe(0);
  for (let g = 1; g < gates.length; g++) expect(gates[g]!.s).toBeGreaterThan(gates[g - 1]!.s);

  // Meshes are valid.
  const meshes = [track.road, track.curbs, track.lines, track.startLine, track.gravel, track.apron, track.pitLane, ...track.barrierMeshes.map((b) => b.mesh)];
  for (const m of meshes) {
    const verts = m.positions.length / 3;
    expect(m.indices.length % 3).toBe(0);
    if (m.indices.length) expect(Math.max(...m.indices)).toBeLessThan(verts);
    expect(m.uvs.length / 2).toBe(verts);
    expect(m.positions.every(Number.isFinite)).toBe(true);
  }
  expect(track.barrierSegments.every((s) => Number.isFinite(s.cx) && Number.isFinite(s.cz) && s.halfLength > 0)).toBe(true);
}

