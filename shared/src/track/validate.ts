import type { BuiltTrack } from './track.ts';

export interface TrackReport {
  lengthM: number;
  /** Tightest corner (curvature smoothed over ~10 m). */
  minRadiusM: number;
  /** Places where the track crosses itself (each is lifted like a bridge). */
  crossings: number;
  /** Share of the lap that has a barrier on each side (gaps are crossings / merges). */
  barrierCoverage: number;
  /** Narrowest road (m). */
  minWidthM: number;
}

export function analyzeTrack(track: BuiltTrack): TrackReport {
  const { samples, lift } = track;
  const n = samples.length;
  let maxCurv = 0;
  for (let i = 0; i < n; i++) {
    let c = 0;
    for (let d = -2; d <= 2; d++) c += samples[(i + d + n) % n]!.curvature;
    maxCurv = Math.max(maxCurv, Math.abs(c / 5));
  }
  let crossings = 0;
  for (let i = 0; i < n; i++) if (lift[i]! > 0 && !(lift[(i - 1 + n) % n]! > 0)) crossings++;
  let covered = 0;
  for (let i = 0; i < n; i++) covered += (Number.isNaN(track.barrierLeft[i]!) ? 0 : 0.5) + (Number.isNaN(track.barrierRight[i]!) ? 0 : 0.5);
  return {
    lengthM: track.length,
    minRadiusM: 1 / maxCurv,
    crossings,
    barrierCoverage: covered / n,
    minWidthM: Math.min(...samples.map((s) => s.wl + s.wr)),
  };
}
