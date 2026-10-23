import type { CenterPoint } from './centerline.ts';
import { sampleClosedSpline } from './spline.ts';
import type { GridSlot, TrackDef } from './trackFile.ts';

/** Closed centreline from hand-placed control points, starting at the point nearest `start`. */
function centerlineFromControlPoints(points: readonly (readonly [number, number])[], start: readonly [number, number], half: number): CenterPoint[] {
  const smp = sampleClosedSpline(points, 5);
  let first = 0;
  let best = Infinity;
  smp.forEach((s, i) => {
    const d = Math.hypot(s.x - start[0], s.z - start[1]);
    if (d < best) [best, first] = [d, i];
  });
  return [...smp.slice(first), ...smp.slice(0, first)].map((s) => [s.x, s.z, half, half] as const);
}

/** Two staggered columns behind the start line. */
function staggeredGrid(slots: number, lateral: number): GridSlot[] {
  return Array.from({ length: slots }, (_, i) => ({
    back: 8 + Math.floor(i / 2) * 9 + (i % 2) * 4.5,
    offset: (i % 2 === 0 ? 1 : -1) * lateral,
  }));
}

/** "Apex Park": a fictional ~1.2 km club circuit — long straight, hairpin, fast esses, a sweeper. Built in. */
export const APEX_PARK: TrackDef = {
  id: 'apex-park',
  name: 'Apex Park',
  country: 'Fictional',
  street: false,
  laps: 3,
  centerline: centerlineFromControlPoints(
    [
      [0, -160],
      [0, 40],
      [-12, 120],
      [-60, 160],
      [-120, 150],
      [-150, 100],
      [-140, 40],
      [-180, 0],
      [-250, 10],
      [-290, -40],
      [-270, -110],
      [-200, -130],
      [-150, -200],
      [-90, -260],
      [-30, -250],
    ],
    [0, -60],
    6,
  ),
  sectors: [0, 400, 800],
  // Start/finish straight (wraps over the line) and the gentle straight through the back esses.
  aeroZones: [
    { from: 1075, to: 135 },
    { from: 815, to: 900 },
  ],
  // Just before the last corner, so the overtake boost is armed for the next lap's straights.
  detectionPoint: 1000,
  // On the outside (+X = left) of the start straight.
  pitLane: { side: 1, entry: 1090, exit: 110 },
  grid: staggeredGrid(8, 6 * 0.42),
};

/** Tracks built into the code. Generated real-world circuits load from client/public/tracks. */
export const TRACKS: Record<string, TrackDef> = { [APEX_PARK.id]: APEX_PARK };
