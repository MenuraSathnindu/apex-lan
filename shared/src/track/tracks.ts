import type { TrackDef } from './track.ts';

/** "Apex Park": ~2 km club circuit — long straight, hairpin, fast esses, a sweeper. */
export const APEX_PARK: TrackDef = {
  id: 'apex-park',
  name: 'Apex Park',
  points: [
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
  start: [0, -60],
  roadWidth: 12,
  curbWidth: 1.2,
  runoff: 8,
  barrierHeight: 1.0,
  barrierThickness: 0.8,
  curbMaxRadius: 110,
  // Start/finish straight (wraps over the line) and the gentle straight through the back esses.
  aeroZones: [
    { from: 1075, to: 135 },
    { from: 815, to: 900 },
  ],
  // Just before the last corner, so the overtake boost is armed for the next lap's straights.
  detectionPoint: 1000,
};

export const TRACKS = { [APEX_PARK.id]: APEX_PARK } as const;
