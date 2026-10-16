import type { BuiltTrack } from './track.ts';

export interface TrackReport {
  lengthM: number;
  minRadiusM: number;
  /** Closest approach between parts of the track that are far apart along it. */
  minSeparationM: number;
  /** Separation needed so barriers of neighbouring sections never overlap. */
  requiredSeparationM: number;
  /** Tightest radius allowed so the inner barrier offset doesn't fold over itself. */
  requiredMinRadiusM: number;
}

export function analyzeTrack(track: BuiltTrack): TrackReport {
  const { samples, def } = track;
  const n = samples.length;
  const barrier = def.roadWidth / 2 + def.curbWidth + def.runoff + def.barrierThickness;

  // Smooth curvature a little so single-sample noise doesn't dominate.
  let maxCurv = 0;
  for (let i = 0; i < n; i++) {
    let c = 0;
    for (let d = -2; d <= 2; d++) c += samples[(i + d + n) % n]!.curvature;
    maxCurv = Math.max(maxCurv, Math.abs(c / 5));
  }

  let minSep = Infinity;
  const step = samples[1]!.s;
  const skip = Math.ceil((barrier * 4) / step); // ignore neighbours along the track
  for (let i = 0; i < n; i += 2) {
    for (let j = i + skip; j < n; j += 2) {
      if (n - (j - i) < skip) continue;
      const a = samples[i]!;
      const b = samples[j]!;
      minSep = Math.min(minSep, Math.hypot(a.x - b.x, a.z - b.z));
    }
  }

  return {
    lengthM: track.length,
    minRadiusM: 1 / maxCurv,
    minSeparationM: minSep,
    requiredSeparationM: barrier * 2 + 4,
    requiredMinRadiusM: barrier + 6,
  };
}
