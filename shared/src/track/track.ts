import type { SpawnPose } from '../physics/vehicle.ts';
import { TRACK_STYLE, type BarrierKind } from '../tuning.ts';
import { samplesFromCenterline } from './centerline.ts';
import type { TrackSample } from './spline.ts';
import type { TrackDef } from './trackFile.ts';

export type { TrackDef } from './trackFile.ts';

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
  height: number;
  thickness: number;
}

export interface BarrierMesh {
  kind: BarrierKind;
  /** Pit wall vs. track barrier (same look, different texture scale is possible later). */
  role: 'track' | 'pit';
  mesh: MeshData;
}

/** Where to put a building beside the track: centre, direction along the track, direction away from it. */
export interface Placement {
  x: number;
  z: number;
  /** Unit vector along the track and unit vector pointing away from it. */
  tx: number;
  tz: number;
  ox: number;
  oz: number;
  length: number;
  depth: number;
}

export interface BuiltTrack {
  def: TrackDef;
  /** Centreline samples every ~2 m; sample 0 is on the start/finish line. */
  samples: TrackSample[];
  length: number;
  /** Always 0 (kept so older code reads naturally). */
  startIndex: number;
  spawnGrid: SpawnPose[];
  road: MeshData;
  curbs: MeshData;
  lines: MeshData;
  startLine: MeshData;
  gravel: MeshData;
  /** Paved run-off (street circuits). */
  apron: MeshData;
  pitLane: MeshData;
  barrierMeshes: BarrierMesh[];
  barrierSegments: BarrierSegment[];
  /** Barrier distance from the centreline per sample, NaN where there is none (crossings). */
  barrierLeft: Float32Array;
  barrierRight: Float32Array;
  /** Height added per sample where the track crosses itself (the later part goes over). */
  lift: Float32Array;
  pitBuilding: Placement | null;
  /** Qualifying start places along the pit lane (falls back to the grid when there's no pit lane). */
  pitBoxes: SpawnPose[];
  /** Lateral offset of the pit lane's centre per sample (+ = left), NaN where there is no lane. */
  pitLaneCentre: Float32Array;
  /** 1 where the pit lane runs at full width (between the entry and exit ramps). */
  pitLaneFull: Uint8Array;
  grandstands: Placement[];
}

/** Heights above ground (y = 0 is grass). Wheels ray-cast down and hit the highest surface. */
export const TRACK_HEIGHTS = { road: 0.02, curb: 0.035, paint: 0.026, gravel: 0.012, apron: 0.017, pit: 0.018 } as const;

const BARRIER_EVERY = 2; // samples per barrier segment (~4 m)

function emptyMesh(): MeshData {
  return { positions: [], uvs: [], indices: [] };
}

type PerSample = (i: number) => number;

/**
 * Adds a flat strip between two lateral offsets (+ = left of centreline) for samples
 * [from, to] inclusive (indices may run past the end — they wrap). v runs along the track
 * (metres × vScale); u is the offset in metres (uMetres) or 0/1 across the strip.
 */
function addStrip(
  mesh: MeshData,
  samples: TrackSample[],
  from: number,
  to: number,
  offA: PerSample,
  offB: PerSample,
  y: PerSample,
  vScale: number,
  totalLength: number,
  uMetres = false,
) {
  const n = samples.length;
  const base = mesh.positions.length / 3;
  for (let k = from; k <= to; k++) {
    const i = ((k % n) + n) % n;
    const smp = samples[i]!;
    const s = smp.s + Math.floor(k / n) * totalLength; // keep v increasing across the seam
    const a = offA(i);
    const b = offB(i);
    for (const [off, u] of [
      [a, 0],
      [b, 1],
    ] as const) {
      mesh.positions.push(smp.x + smp.nx * off, y(i), smp.z + smp.nz * off);
      mesh.uvs.push(uMetres ? off : u, s * vScale);
    }
  }
  const leftToRight = offA(((from % n) + n) % n) > offB(((from % n) + n) % n);
  for (let k = 0; k < to - from; k++) {
    const a = base + k * 2;
    // Two triangles, counter-clockwise seen from above (normal +Y).
    if (leftToRight) mesh.indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    else mesh.indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
}

/** Runs of consecutive sample indices where `pred` holds (wrapping), dilated by `pad`. b may exceed n. */
export function runs(n: number, pred: (i: number) => boolean, pad = 0): [number, number][] {
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

/** Wall mesh + physics segments along a run of samples at per-sample offsets (+ = left). */
function buildBarrierRun(
  samples: TrackSample[],
  from: number,
  to: number,
  offset: PerSample,
  side: 1 | -1,
  height: number,
  thickness: number,
  lift: Float32Array,
  walls: MeshData,
  segments: BarrierSegment[],
) {
  const n = samples.length;
  const closed = to - from >= n;
  const ks: number[] = [];
  for (let k = from; k < (closed ? from + n : to); k += BARRIER_EVERY) ks.push(k);
  if (!closed) ks.push(to);
  if (ks.length < 2) return;
  const idx = ks.map((k) => ((k % n) + n) % n);
  const pts = idx.map((i) => {
    const smp = samples[i]!;
    const o = offset(i);
    return [smp.x + smp.nx * o, smp.z + smp.nz * o, lift[i]!] as const;
  });
  const count = closed ? pts.length + 1 : pts.length;

  // Inner face (toward the track), top, outer face. Each face has its own vertices so lighting
  // stays crisp at the 90° edges. Cross-section corners as [outward offset, y].
  const corners = [
    [0, 0],
    [0, height],
    [side * thickness, height],
    [side * thickness, 0],
  ] as const;
  for (let f = 0; f < 3; f++) {
    const base = walls.positions.length / 3;
    let along = 0;
    for (let k = 0; k < count; k++) {
      const p = pts[k % pts.length]!;
      if (k > 0) {
        const q = pts[k - 1]!;
        along += Math.hypot(p[0] - q[0], p[1] - q[1]);
      }
      const smp = samples[idx[k % idx.length]!]!;
      for (const c of [corners[f]!, corners[f + 1]!]) {
        walls.positions.push(p[0] + smp.nx * c[0], c[1] + p[2], p[1] + smp.nz * c[0]);
        // u along the wall (4 m per repeat); v: 0..1 up the inner face, 1..2 over the top.
        walls.uvs.push(along / 4, f === 1 ? 1 + (c === corners[1] ? 0 : 1) : c[1] / height);
      }
    }
    for (let k = 0; k < count - 1; k++) {
      const a = base + k * 2;
      walls.indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  // Physics: one cuboid per segment, pushed outward by half the thickness.
  for (let k = 0; k < count - 1; k++) {
    const a = pts[k]!;
    const b = pts[(k + 1) % pts.length]!;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    const smp = samples[idx[k]!]!;
    segments.push({
      cx: (a[0] + b[0]) / 2 + smp.nx * side * (thickness / 2),
      cz: (a[1] + b[1]) / 2 + smp.nz * side * (thickness / 2),
      // Slight overlap so there are no gaps at the joints.
      halfLength: len / 2 + 0.3,
      yaw: Math.atan2(dx, dz),
      height,
      thickness,
    });
  }
}

/** Spatial hash of centreline samples, for "is another part of the track near here?" queries. */
class SampleGrid {
  private readonly cells = new Map<number, number[]>();
  constructor(
    private readonly samples: TrackSample[],
    private readonly cell: number,
  ) {
    samples.forEach((s, i) => {
      const key = this.key(Math.floor(s.x / cell), Math.floor(s.z / cell));
      const list = this.cells.get(key);
      if (list) list.push(i);
      else this.cells.set(key, [i]);
    });
  }

  private key(cx: number, cz: number) {
    return (cx + 32768) * 65536 + (cz + 32768);
  }

  /**
   * Smallest (distance − road half-width) from (x, z) to samples of *other* parts of the track
   * (more than `sameSection` samples away from `i` along it), and that sample's index.
   */
  gap(x: number, z: number, i: number, sameSection: number): { gap: number; j: number } {
    const n = this.samples.length;
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    let best = Infinity;
    let bestJ = -1;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const j of this.cells.get(this.key(cx + dx, cz + dz)) ?? []) {
          const d = Math.abs(j - i);
          if (Math.min(d, n - d) <= sameSection) continue;
          const s = this.samples[j]!;
          const g = Math.hypot(s.x - x, s.z - z) - Math.max(s.wl, s.wr);
          if (g < best) [best, bestJ] = [g, j];
        }
      }
    }
    return { gap: best, j: bestJ };
  }
}

const smoothstep = (t: number) => t * t * (3 - 2 * t);

/** Index range of a [from, to] stretch in metres from the start line (wrapping), as sample indices. */
function sampleRange(from: number, to: number, step: number, length: number): [number, number] {
  const a = Math.round(from / step);
  let b = Math.round(to / step);
  if (to < from) b += Math.round(length / step);
  return [a, b];
}

export function buildTrack(def: TrackDef): BuiltTrack {
  const S = TRACK_STYLE;
  const samples = samplesFromCenterline(def.centerline, S.sampleSpacing);
  const n = samples.length;
  const step = samples[1]!.s;
  const length = step * n;
  const wrapI = (i: number) => ((i % n) + n) % n;
  const edgeOf = (i: number, side: 1 | -1) => (side > 0 ? samples[i]!.wl : samples[i]!.wr);

  // Curvature, lightly smoothed so single-sample noise doesn't place kerbs.
  const kappa = samples.map((_, i) => {
    let c = 0;
    for (let d = -3; d <= 3; d++) c += samples[wrapI(i + d)]!.curvature;
    return c / 7;
  });

  const grid = new SampleGrid(samples, 24);
  const same = Math.round(S.sameSectionDistance / step);

  // Crossings: where another part of the track runs over this sample's road, the later part
  // is lifted a little (a bridge in real life) so the two roads don't z-fight.
  const crossing = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const smp = samples[i]!;
    const { gap, j } = grid.gap(smp.x, smp.z, i, same);
    if (gap < 0 && j >= 0 && j < i) crossing[i] = 1;
  }
  const lift = new Float32Array(n);
  const RAMP = 20;
  for (let i = 0; i < n; i++) {
    if (!crossing[i]) continue;
    for (let d = -RAMP; d <= RAMP; d++) {
      const k = wrapI(i + d);
      lift[k] = Math.max(lift[k]!, S.crossingLift * (1 - Math.abs(d) / (RAMP + 1)));
    }
  }

  // Pit lane: lateral position of the lane centre per sample (NaN outside the pit zone).
  const pit = def.pitLane ?? null;
  const laneCentre = new Float32Array(n).fill(NaN);
  const laneFull = new Uint8Array(n);
  let pitRange: [number, number] | null = null;
  if (pit) {
    pitRange = sampleRange(pit.entry, pit.exit, step, length);
    const [a, b] = pitRange;
    const ramp = Math.min(S.pit.ramp / step, (b - a) / 3);
    for (let k = a; k <= b; k++) {
      const i = wrapI(k);
      const edge = edgeOf(i, pit.side);
      const full = edge + S.pit.gap + S.pit.width / 2;
      const t = Math.min(1, (k - a) / ramp, (b - k) / ramp);
      laneCentre[i] = pit.side * (edge - S.pit.width / 2 + 1 + (full - (edge - S.pit.width / 2 + 1)) * smoothstep(Math.max(0, t)));
      if (t >= 1) laneFull[i] = 1;
    }
  }
  const inPit = (i: number, side: 1 | -1) => !!pit && side === pit.side && !Number.isNaN(laneCentre[i]!);

  // Kerbs on both sides of corners (not where a pit lane leaves the track).
  const curbAt = new Uint8Array(n);
  for (const [a, b] of runs(n, (i) => Math.abs(kappa[i]!) > 1 / S.curbMaxRadius, 3)) {
    for (let k = a; k <= b; k++) curbAt[wrapI(k)] = 1;
  }
  // Gravel on the outside of tight corners (permanent circuits).
  const gravelSide = new Int8Array(n); // +1 / -1 = side with gravel, 0 = none
  if (!def.street) {
    const pad = Math.round(S.permanent.gravelPad / step);
    for (let i = 0; i < n; i++) {
      if (Math.abs(kappa[i]!) < 1 / S.permanent.gravelRadius) continue;
      const outside = kappa[i]! > 0 ? -1 : 1;
      for (let d = -pad; d <= pad; d++) gravelSide[wrapI(i + d)] = outside;
    }
  }

  // Barrier offsets per side: wanted run-off, limited by the corner radius on the inside and by
  // other parts of the track nearby (barriers meet halfway; none at all at a crossing).
  const barrierAt = { 1: new Float32Array(n), [-1]: new Float32Array(n) } as Record<1 | -1, Float32Array>;
  for (const side of [1, -1] as const) {
    const out = barrierAt[side];
    for (let i = 0; i < n; i++) {
      const smp = samples[i]!;
      const edge = edgeOf(i, side);
      const base = edge + (curbAt[i] ? S.curbWidth : 0);
      let wanted = def.street
        ? base + S.street.runoff
        : base + (gravelSide[i] === side ? S.permanent.gravelRunoff : S.permanent.grassRunoff);
      if (Math.sign(kappa[i]!) === side && kappa[i] !== 0) wanted = Math.min(wanted, 1 / Math.abs(kappa[i]!) - 1.5);
      let hit = Infinity;
      for (let o = edge + 0.5; o <= wanted + S.crossingMargin + 1; o += 1.5) {
        const { gap } = grid.gap(smp.x + smp.nx * side * o, smp.z + smp.nz * side * o, i, same);
        if (gap < S.crossingMargin) {
          hit = o;
          break;
        }
      }
      if (hit <= edge + 1.5) out[i] = NaN;
      else out[i] = Math.max(edge + 0.6, Math.min(wanted, hit === Infinity ? wanted : edge + (hit - edge) / 2));
    }
    // Smooth: a moving minimum then a moving average, so walls don't zig-zag.
    const src = Float32Array.from(out);
    for (let i = 0; i < n; i++) {
      if (Number.isNaN(src[i]!)) continue;
      let m = Infinity;
      for (let d = -3; d <= 3; d++) {
        const v = src[wrapI(i + d)]!;
        if (!Number.isNaN(v)) m = Math.min(m, v);
      }
      out[i] = m;
    }
    const mins = Float32Array.from(out);
    for (let i = 0; i < n; i++) {
      if (Number.isNaN(mins[i]!)) continue;
      let sum = 0;
      let cnt = 0;
      for (let d = -3; d <= 3; d++) {
        const v = mins[wrapI(i + d)]!;
        if (!Number.isNaN(v)) [sum, cnt] = [sum + v, cnt + 1];
      }
      out[i] = sum / cnt;
    }
    // Pit side: the barrier goes behind the lane.
    if (pit && side === pit.side) {
      for (let i = 0; i < n; i++) {
        if (!inPit(i, side)) continue;
        const behindLane = Math.abs(laneCentre[i]!) + S.pit.width / 2 + 2;
        out[i] = Number.isNaN(out[i]!) ? behindLane : Math.max(out[i]!, behindLane);
      }
    }
  }
  const barrier = (side: 1 | -1) => (i: number) => side * barrierAt[side][i]!;

  const y = (h: number) => (i: number) => h + lift[i]!;

  // --- Meshes.
  const road = emptyMesh();
  addStrip(road, samples, 0, n, (i) => samples[i]!.wl, (i) => -samples[i]!.wr, y(TRACK_HEIGHTS.road), 1, length, true);

  // Kerbs: one red+white pair per 4 m.
  const curbs = emptyMesh();
  for (const side of [1, -1] as const) {
    const on = (i: number) => !!curbAt[i] && !Number.isNaN(barrierAt[side][i]!) && !inPit(i, side);
    for (const [a, b] of runs(n, on)) {
      addStrip(curbs, samples, a, b, (i) => side * (edgeOf(i, side) + (side > 0 ? S.curbWidth : 0)), (i) => side * (edgeOf(i, side) + (side > 0 ? 0 : S.curbWidth)), y(TRACK_HEIGHTS.curb), 1 / 4, length);
    }
  }

  // White edge lines.
  const lines = emptyMesh();
  const li = S.lineInset;
  const lw = S.lineWidth;
  addStrip(lines, samples, 0, n, (i) => samples[i]!.wl - li, (i) => samples[i]!.wl - li - lw, y(TRACK_HEIGHTS.paint), 1 / 4, length);
  addStrip(lines, samples, 0, n, (i) => -samples[i]!.wr + li + lw, (i) => -samples[i]!.wr + li, y(TRACK_HEIGHTS.paint), 1 / 4, length);

  // Start/finish: a 2 m chequered band across the road (u 0..1 across, v 0..1 along).
  const startLine = emptyMesh();
  {
    const smp = samples[0]!;
    for (const along of [-1, 1]) {
      for (const off of [smp.wl, -smp.wr]) {
        startLine.positions.push(smp.x + smp.tx * along + smp.nx * off, TRACK_HEIGHTS.paint + 0.002 + lift[0]!, smp.z + smp.tz * along + smp.nz * off);
        startLine.uvs.push(off > 0 ? 0 : 1, along > 0 ? 1 : 0);
      }
    }
    startLine.indices.push(0, 2, 1, 1, 2, 3);
  }

  // Run-off: gravel traps (permanent) or a paved strip (street), up to the barrier.
  const gravel = emptyMesh();
  const apron = emptyMesh();
  for (const side of [1, -1] as const) {
    const inner = (i: number) => side * (edgeOf(i, side) + (curbAt[i] ? S.curbWidth : 0));
    const outer = (i: number) => side * (barrierAt[side][i]! - 0.2);
    if (def.street) {
      for (const [a, b] of runs(n, (i) => !Number.isNaN(barrierAt[side][i]!) && !inPit(i, side))) {
        addStrip(apron, samples, a, b, side > 0 ? outer : inner, side > 0 ? inner : outer, y(TRACK_HEIGHTS.apron), 1, length, true);
      }
    } else {
      const on = (i: number) => gravelSide[i] === side && !Number.isNaN(barrierAt[side][i]!) && !inPit(i, side) && !lift[i];
      for (const [a, b] of runs(n, on)) {
        addStrip(gravel, samples, a, b, side > 0 ? outer : inner, side > 0 ? inner : outer, () => TRACK_HEIGHTS.gravel, 1, length, true);
      }
    }
  }

  // Pit lane surface + its edge lines, and the pit wall between it and the track.
  const pitLane = emptyMesh();
  const barrierMeshes: BarrierMesh[] = [];
  const barrierSegments: BarrierSegment[] = [];
  let pitBuilding: Placement | null = null;
  const pitBoxes: SpawnPose[] = [];
  if (pit && pitRange) {
    const [a, b] = pitRange;
    const w = S.pit.width / 2;
    const lo = (i: number) => laneCentre[i]! - w;
    const hi = (i: number) => laneCentre[i]! + w;
    addStrip(pitLane, samples, a, b, hi, lo, () => TRACK_HEIGHTS.pit, 1, length, true);
    for (const [fa, fb] of runs(n, (i) => !!laneFull[i])) {
      addStrip(lines, samples, fa, fb, (i) => hi(i) - li, (i) => hi(i) - li - lw, () => TRACK_HEIGHTS.pit + 0.006, 1 / 4, length);
      addStrip(lines, samples, fa, fb, (i) => lo(i) + li + lw, (i) => lo(i) + li, () => TRACK_HEIGHTS.pit + 0.006, 1 / 4, length);
      const wall = S.pit.wall;
      const mesh = emptyMesh();
      buildBarrierRun(samples, fa, fb, (i) => pit.side * (edgeOf(i, pit.side) + S.pit.gap / 2 - wall.thickness / 2), pit.side, wall.height, wall.thickness, lift, mesh, barrierSegments);
      barrierMeshes.push({ kind: wall.kind, role: 'pit', mesh });

      // Qualifying start places in the lane, one every PIT_BOX_SPACING m, front first.
      const every = Math.max(1, Math.round(S.pit.boxSpacing / step));
      for (let k = fb - every; k >= fa && pitBoxes.length < S.pit.boxes; k -= every) {
        const smp = samples[wrapI(k)]!;
        const off = laneCentre[wrapI(k)]!;
        pitBoxes.push({ position: { x: smp.x + smp.nx * off, y: 1.0, z: smp.z + smp.nz * off }, yaw: Math.atan2(smp.tx, smp.tz) });
      }

      // Pit building behind the lane, along the full-width part.
      const mid = wrapI(Math.round((fa + fb) / 2));
      const smp = samples[mid]!;
      const off = barrierAt[pit.side][mid]! + 1.5 + S.pit.buildingDepth / 2;
      pitBuilding = {
        x: smp.x + smp.nx * pit.side * off,
        z: smp.z + smp.nz * pit.side * off,
        tx: smp.tx,
        tz: smp.tz,
        ox: smp.nx * pit.side,
        oz: smp.nz * pit.side,
        length: Math.min((fb - fa) * step, 320),
        depth: S.pit.buildingDepth,
      };
    }
  }

  // Track barriers, in runs (gaps at crossings).
  {
    const style = def.street ? S.street.barrier : S.permanent.barrier;
    const mesh = emptyMesh();
    for (const side of [1, -1] as const) {
      for (const [a, b] of runs(n, (i) => !Number.isNaN(barrierAt[side][i]!))) {
        if (b - a < 3) continue;
        buildBarrierRun(samples, a, b, barrier(side), side, style.height, style.thickness, lift, mesh, barrierSegments);
      }
    }
    barrierMeshes.push({ kind: style.kind, role: 'track', mesh });
  }

  // Grid slots from the definition.
  const spawnGrid: SpawnPose[] = def.grid.map((g) => {
    const smp = samples[wrapI(-Math.round(g.back / step))]!;
    return {
      position: { x: smp.x + smp.nx * g.offset, y: 1.0 + lift[wrapI(-Math.round(g.back / step))]!, z: smp.z + smp.nz * g.offset },
      yaw: Math.atan2(smp.tx, smp.tz),
    };
  });

  // Grandstands: along the start straight (not on the pit side) and outside the tightest corners,
  // wherever nothing else of the track is close.
  const G = S.grandstand;
  const grandstands: Placement[] = [];
  const tryStand = (i: number, side: 1 | -1, extra: number) => {
    const off = barrierAt[side][i]!;
    if (Number.isNaN(off) || inPit(i, side)) return;
    const smp = samples[i]!;
    const d = off + extra + G.depth / 2;
    const x = smp.x + smp.nx * side * d;
    const z = smp.z + smp.nz * side * d;
    if (grid.gap(x, z, -1, -1).gap < G.clearance) return; // -1, -1: compare with every sample
    if (grandstands.some((g) => Math.hypot(g.x - x, g.z - z) < G.length)) return;
    grandstands.push({ x, z, tx: smp.tx, tz: smp.tz, ox: smp.nx * side, oz: smp.nz * side, length: G.length, depth: G.depth });
  };
  for (let s = -G.straightBefore; s <= G.straightAfter; s += G.spacing) {
    const i = wrapI(Math.round(s / step));
    if (Math.abs(kappa[i]!) > 1 / 300) continue;
    for (const side of [1, -1] as const) if (!pit || side !== pit.side) tryStand(i, side, 3);
  }
  const apexes = kappa
    .map((k, i) => ({ k: Math.abs(k), i }))
    .filter(({ k, i }) => k > 1 / 80 && k >= Math.abs(kappa[wrapI(i - 1)]!) && k >= Math.abs(kappa[wrapI(i + 1)]!))
    .sort((p, q) => q.k - p.k);
  const usedApex: number[] = [];
  for (const { i } of apexes) {
    if (usedApex.length >= G.corners) break;
    if (usedApex.some((u) => Math.min(Math.abs(u - i), n - Math.abs(u - i)) * step < 200)) continue;
    usedApex.push(i);
    tryStand(i, kappa[i]! > 0 ? -1 : 1, 6);
  }

  const barrierLeft = Float32Array.from(barrierAt[1]);
  const barrierRight = Float32Array.from(barrierAt[-1]);
  return {
    def,
    samples,
    length,
    startIndex: 0,
    spawnGrid,
    road,
    curbs,
    lines,
    startLine,
    gravel,
    apron,
    pitLane,
    barrierMeshes,
    barrierSegments,
    barrierLeft,
    barrierRight,
    lift,
    pitBuilding,
    pitBoxes: pitBoxes.length >= def.grid.length || pitBoxes.length >= S.pit.boxes ? pitBoxes : spawnGrid,
    pitLaneCentre: laneCentre,
    pitLaneFull: laneFull,
    grandstands,
  };
}

/** How far from the centreline the track's boundary is at sample i (barrier, or road + 15 m where there is none). */
export function boundaryAt(track: BuiltTrack, i: number): number {
  const s = track.samples[i]!;
  const l = track.barrierLeft[i]!;
  const r = track.barrierRight[i]!;
  return Math.max(Number.isNaN(l) ? s.wl + 15 : l, Number.isNaN(r) ? s.wr + 15 : r);
}

/** How far (x, z) is outside the track's boundary (negative = inside it). Brute force: setup code only. */
export function clearanceFrom(track: BuiltTrack, x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < track.samples.length; i++) {
    const s = track.samples[i]!;
    best = Math.min(best, Math.hypot(s.x - x, s.z - z) - boundaryAt(track, i));
  }
  return best;
}

/** Distance from (x, z) to the nearest centreline sample (brute force; fine for setup code). */
export function distanceToCenterline(track: BuiltTrack, x: number, z: number): number {
  let best = Infinity;
  for (const smp of track.samples) best = Math.min(best, (smp.x - x) ** 2 + (smp.z - z) ** 2);
  return Math.sqrt(best);
}
