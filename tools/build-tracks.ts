// Builds our track JSON (client/public/tracks/<id>.json + index.json) from two open datasets
// cloned into tools/data (git-ignored; see tools/README.md):
//   - TUMFTM racetrack-database (LGPL-3.0): smoothed centrelines in metres with real widths
//   - Tomislav Bacinger's circuits GeoJSON (MIT): lat/lon centrelines + published lengths
// TUMFTM is preferred (real widths). Bacinger is the geographic reference: TUMFTM tracks are
// rotated/moved onto it (north up), and its first point marks the start/finish line.
//
//   npm run tracks                 → the first five (Monza, Spa, Silverstone, Suzuka, Monaco)
//   npm run tracks -- --all        → every circuit in tools/tracks.config.ts
//   npm run tracks -- monza spa    → just these
//
// Also writes SVG previews to tools/out/ (git-ignored) for checking start lines and direction.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RACE,
  TRACK_FORMAT,
  closedLength,
  framesFromPoints,
  resampleClosed,
  smoothClosed,
  type CenterPoint,
  type GridSlot,
  type PitLaneDef,
  type TrackFile,
  type TrackIndexEntry,
  type TrackZone,
} from '../shared/src/index.ts';
import { FIRST_FIVE, TRACK_SOURCES, type TrackSourceConfig } from './tracks.config.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'tools', 'data');
const TUMFTM = join(DATA, 'racetrack-database');
const OUT = join(ROOT, 'client', 'public', 'tracks');
const PREVIEWS = join(ROOT, 'tools', 'out');

/** Every tunable of the generator in one place. */
const GEN = {
  /** Centreline spacing in the JSON (m). */
  spacing: 5,
  /** Default road width when the source has none (bacinger), m. */
  defaultWidth: 13,
  /** Each side's half-width is clamped to this range (data glitches), m. */
  minHalfWidth: 4,
  maxHalfWidth: 12,
  /** Gaussian smoothing (in samples) of positions and widths. */
  smoothTumftm: 0.6,
  smoothBacinger: 1.2,
  smoothWidths: 4,
  /** Straight-mode zones: radius above this for at least minStraight metres (street circuits: looser). */
  straightRadius: 500,
  minStraight: 300,
  streetStraightRadius: 250,
  streetMinStraight: 250,
  maxZones: 3,
  /** Zones start a bit after the straight begins and end before the braking zone (m). */
  zoneStartPad: 40,
  zoneEndPad: 80,
  /** Detection point this far before the longest zone (m). */
  detectionBefore: 220,
  checkpointSpacing: RACE.checkpointSpacing,
  gridSlots: 20,
  gridFirstBack: 10,
  gridSpacing: 8,
  /** Pit lane: wants this much of the start straight before / after the line (m). */
  pitBefore: 350,
  pitAfter: 300,
  pitMinLength: 200,
  /** The pit straight may curve this much (radius, m); street circuits rarely have a real straight. */
  pitStraightRadius: 300,
  streetPitStraightRadius: 120,
  /** Clearance the pit side needs beyond the road edge (m). */
  pitClearance: 30,
  /** Laps default: about this many km per race, clamped to the lobby range. */
  raceKm: 18,
  /** Length check: warn above this difference to the published length. */
  lengthTolerance: 0.03,
};

const R_EARTH = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

type Pt = [number, number, number, number];

interface Ref {
  /** Projected bacinger centreline (x east, z = -north), metres. */
  pts: [number, number][];
  props: { length?: number };
  file: string;
}

function bacingerDir(): string {
  // The repo folder name is whatever it was cloned as; find the one with circuits/.
  const dir = readdirSync(DATA).find((d) => existsSync(join(DATA, d, 'circuits')));
  if (!dir) throw new Error(`No GeoJSON circuits dataset in ${DATA} — see tools/README.md`);
  return join(DATA, dir);
}

function loadBacinger(id: string): Ref {
  const file = join(bacingerDir(), 'circuits', `${id}.geojson`);
  const geo = JSON.parse(readFileSync(file, 'utf8'));
  const feature = geo.features[0];
  let coords: [number, number][] = feature.geometry.coordinates;
  const [f, l] = [coords[0]!, coords[coords.length - 1]!];
  if (f[0] === l[0] && f[1] === l[1]) coords = coords.slice(0, -1);
  const lat0 = coords.reduce((a, c) => a + c[1], 0) / coords.length;
  const lon0 = coords.reduce((a, c) => a + c[0], 0) / coords.length;
  const k = Math.cos(rad(lat0));
  const pts = coords.map(([lon, lat]) => [R_EARTH * rad(lon - lon0) * k, -R_EARTH * rad(lat - lat0)] as [number, number]);
  return { pts, props: feature.properties ?? {}, file: `circuits/${id}.geojson` };
}

function loadTumftm(name: string): Pt[] {
  const text = readFileSync(join(TUMFTM, 'tracks', `${name}.csv`), 'utf8');
  const pts: Pt[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [x, y, wr, wl] = line.split(',').map(Number);
    // x east, y north → our z = -north. Left/right stay as they are (no mirroring).
    pts.push([x!, -y!, wl!, wr!]);
  }
  // Some files repeat the first point at the end.
  const a = pts[0]!;
  const b = pts[pts.length - 1]!;
  if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.5) pts.pop();
  return pts;
}

const centroid = (pts: readonly (readonly number[])[]) => {
  let x = 0;
  let z = 0;
  for (const p of pts) {
    x += p[0]!;
    z += p[1]!;
  }
  return [x / pts.length, z / pts.length] as const;
};

/** Mean distance from each point of `b` to its nearest point of `a`. */
function meanNearest(a: readonly (readonly number[])[], b: readonly (readonly number[])[]): number {
  let sum = 0;
  for (const p of b) {
    let best = Infinity;
    for (const q of a) best = Math.min(best, (p[0]! - q[0]!) ** 2 + (p[1]! - q[1]!) ** 2);
    sum += Math.sqrt(best);
  }
  return sum / b.length;
}

/** Rotates + moves TUMFTM points onto the reference (best rotation by brute force + refinement). */
function alignToRef(pts: Pt[], ref: Ref): { pts: Pt[]; angleDeg: number; errorM: number } {
  const evenRef = resampleClosed(ref.pts.map((p) => [p[0], p[1], 1, 1] as const), closedLength(ref.pts) / 300, 8);
  const even = resampleClosed(pts, closedLength(pts) / 300, 4);
  const [rcx, rcz] = centroid(evenRef);
  const [cx, cz] = centroid(even);
  const centred = even.map((p) => [p[0] - cx, p[1] - cz]);
  const refC = evenRef.map((p) => [p[0] - rcx, p[1] - rcz]);
  const score = (deg: number) => {
    const c = Math.cos(rad(deg));
    const s = Math.sin(rad(deg));
    return meanNearest(
      centred.map(([x, z]) => [x! * c - z! * s, x! * s + z! * c]),
      refC.filter((_, i) => i % 2 === 0),
    );
  };
  let best = 0;
  let bestErr = Infinity;
  for (let d = -180; d < 180; d += 2) {
    const e = score(d);
    if (e < bestErr) [best, bestErr] = [d, e];
  }
  for (const stepDeg of [0.5, 0.1]) {
    for (let d = best - 4 * stepDeg; d <= best + 4 * stepDeg; d += stepDeg) {
      const e = score(d);
      if (e < bestErr) [best, bestErr] = [d, e];
    }
  }
  const c = Math.cos(rad(best));
  const s = Math.sin(rad(best));
  const out = pts.map(([x, z, wl, wr]) => {
    const dx = x - cx;
    const dz = z - cz;
    return [dx * c - dz * s + rcx, dx * s + dz * c + rcz, wl, wr] as Pt;
  });
  return { pts: out, angleDeg: best, errorM: bestErr };
}

const wrap = (s: number, len: number) => ((s % len) + len) % len;
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** Runs (in sample indices, wrapping) where `pred` holds. */
function runsOf(n: number, pred: (i: number) => boolean): [number, number][] {
  const on = Array.from({ length: n }, (_, i) => pred(i));
  if (on.every(Boolean)) return [[0, n - 1]];
  const start = on.indexOf(false);
  const out: [number, number][] = [];
  let a = -1;
  for (let k = 1; k <= n; k++) {
    const i = (start + k) % n;
    if (on[i] && a < 0) a = start + k;
    if (!on[i] && a >= 0) {
      out.push([a, start + k - 1]);
      a = -1;
    }
  }
  if (a >= 0) out.push([a, start + n]);
  return out;
}

interface Report {
  id: string;
  dataset: string;
  lengthKm: number;
  realKm: number | null;
  diff: number | null;
  minRadius: number;
  closeApproaches: number;
  zones: number;
  pit: string;
  notes: string[];
}

function build(cfg: TrackSourceConfig): { file: TrackFile; index: TrackIndexEntry; report: Report; ref: Ref | null } {
  const notes: string[] = [];
  const ref = cfg.bacinger ? loadBacinger(cfg.bacinger) : null;
  let raw: Pt[];
  let dataset: string;
  let smooth: number;
  let startPoint: readonly [number, number] | null = null;

  if (cfg.tumftm) {
    raw = loadTumftm(cfg.tumftm);
    dataset = 'tumftm';
    smooth = GEN.smoothTumftm;
    if (ref) {
      const a = alignToRef(raw, ref);
      raw = a.pts;
      notes.push(`aligned to reference: rotated ${a.angleDeg.toFixed(1)}°, mean error ${a.errorM.toFixed(1)} m`);
      if (a.errorM > 25) notes.push(`⚠ poor alignment — check the start line and direction in the preview`);
      startPoint = ref.pts[0]!;
    } else notes.push('no geographic reference: start/finish = first point of the file (check the preview)');
  } else if (ref) {
    const half = GEN.defaultWidth / 2;
    raw = ref.pts.map(([x, z]) => [x, z, half, half]);
    dataset = 'bacinger';
    smooth = GEN.smoothBacinger;
    startPoint = ref.pts[0]!;
    notes.push(`no width data: ${GEN.defaultWidth} m wide everywhere`);
  } else throw new Error(`${cfg.id}: no source`);

  // Racing direction: TUMFTM files are in racing order; the reference is used to compare.
  if (cfg.reverse) raw.reverse();

  // Resample evenly, smooth, clamp widths.
  let pts = resampleClosed(raw, GEN.spacing, dataset === 'tumftm' ? 6 : 24);
  const xs = smoothClosed(pts.map((p) => p[0]), smooth);
  const zs = smoothClosed(pts.map((p) => p[1]), smooth);
  const clampW = (w: number) => Math.min(GEN.maxHalfWidth, Math.max(GEN.minHalfWidth, w));
  const wls = smoothClosed(pts.map((p) => p[2]), GEN.smoothWidths).map(clampW);
  const wrs = smoothClosed(pts.map((p) => p[3]), GEN.smoothWidths).map(clampW);
  pts = pts.map((_, i) => [xs[i]!, zs[i]!, wls[i]!, wrs[i]!]);

  // Start/finish: nearest point to the reference start, shifted if configured.
  let start = 0;
  if (startPoint) {
    let best = Infinity;
    pts.forEach((p, i) => {
      const d = (p[0] - startPoint![0]) ** 2 + (p[1] - startPoint![1]) ** 2;
      if (d < best) [best, start] = [d, i];
    });
  }
  start = wrap(start + Math.round((cfg.startShift ?? 0) / GEN.spacing), pts.length);
  pts = [...pts.slice(start), ...pts.slice(0, start)];
  // Re-space exactly from the new start.
  pts = resampleClosed(pts, GEN.spacing, 4);

  const n = pts.length;
  const L = closedLength(pts);
  const step = L / n;
  const frames = framesFromPoints(
    pts.map((p) => [p[0], p[1]] as const),
    step,
    pts.map((p) => p[2]),
    pts.map((p) => p[3]),
  );
  const curv = smoothClosed(
    frames.map((f) => f.curvature),
    2,
  );
  const sOf = (i: number) => wrap(i, n) * step;

  // Direction check against the reference (its point order is the drawing order, which for
  // most circuits is the racing order). Signed area tells clockwise vs anticlockwise.
  if (ref) {
    const area = (p: readonly (readonly number[])[]) => {
      let a = 0;
      for (let i = 0; i < p.length; i++) {
        const q = p[i]!;
        const r = p[(i + 1) % p.length]!;
        a += q[0]! * r[1]! - r[0]! * q[1]!;
      }
      return a;
    };
    const same = Math.sign(area(pts)) === Math.sign(area(ref.pts));
    if (!same) notes.push('reference is drawn in the opposite direction');
  }

  // Straight-mode zones: the longest low-curvature stretches.
  const straightR = cfg.street ? GEN.streetStraightRadius : GEN.straightRadius;
  const minStraight = cfg.street ? GEN.streetMinStraight : GEN.minStraight;
  const straight = runsOf(n, (i) => Math.abs(curv[i]!) < 1 / straightR)
    .map(([a, b]) => ({ a, b, len: (b - a + 1) * step }))
    .filter((r) => r.len >= minStraight)
    .sort((x, y) => y.len - x.len)
    .slice(0, GEN.maxZones);
  const aeroZones: TrackZone[] = straight.map((r) => ({
    from: round(sOf(r.a) + GEN.zoneStartPad, 0) % round(L, 0),
    to: round(wrap(sOf(r.b) - GEN.zoneEndPad, L), 0),
  }));
  const detectionPoint = straight.length ? round(wrap(sOf(straight[0]!.a) + GEN.zoneStartPad - GEN.detectionBefore, L), 0) : round(L * 0.9, 0);
  if (!straight.length) notes.push('no straight long enough for a straight-mode zone');

  // Sectors (thirds), checkpoints (~100 m).
  const sectors = [0, round(L / 3, 0), round((2 * L) / 3, 0)];
  const cpCount = Math.max(10, Math.round(L / GEN.checkpointSpacing));
  const checkpoints = Array.from({ length: cpCount }, (_, k) => round((k * L) / cpCount, 1));

  // Grid: staggered, behind the line.
  const grid: GridSlot[] = [];
  for (let i = 0; i < GEN.gridSlots; i++) {
    const back = GEN.gridFirstBack + i * GEN.gridSpacing;
    const f = frames[wrap(-Math.round(back / step), n)]!;
    const side = i % 2 === 0 ? 1 : -1;
    grid.push({ back, offset: round(side * (side > 0 ? f.wl : f.wr) * 0.45, 2) });
  }
  const gridCurv = Math.max(...grid.map((g) => Math.abs(curv[wrap(-Math.round(g.back / step), n)]!)));
  if (gridCurv > 1 / 150) notes.push(`grid sits in a curve (radius ${(1 / gridCurv).toFixed(0)} m)`);

  // Pit lane: on the start straight, on the side with room.
  const nearestFar = (x: number, z: number, i: number) => {
    let best = Infinity;
    const far = Math.round(150 / step);
    for (let j = 0; j < n; j += 2) {
      const d = Math.abs(j - i);
      if (Math.min(d, n - d) < far) continue;
      best = Math.min(best, Math.hypot(frames[j]!.x - x, frames[j]!.z - z) - Math.max(frames[j]!.wl, frames[j]!.wr));
    }
    return best;
  };
  let pitLane: PitLaneDef | null = null;
  {
    // Extent of the (fairly) straight bit around the line.
    const ok = (i: number) => Math.abs(curv[wrap(i, n)]!) < 1 / (cfg.street ? GEN.streetPitStraightRadius : GEN.pitStraightRadius);
    let a = 0;
    while (a > -Math.round(GEN.pitBefore / step) && ok(a - 1)) a--;
    let b = 0;
    while (b < Math.round(GEN.pitAfter / step) && ok(b + 1)) b++;
    if ((b - a) * step >= GEN.pitMinLength) {
      let bestSide: 1 | -1 = -1;
      let bestClear = -Infinity;
      for (const side of [1, -1] as const) {
        let clear = Infinity;
        for (let i = a; i <= b; i += 2) {
          const f = frames[wrap(i, n)]!;
          const edge = side > 0 ? f.wl : f.wr;
          for (const o of [10, 20, GEN.pitClearance]) {
            const off = side * (edge + o);
            clear = Math.min(clear, nearestFar(f.x + f.nx * off, f.z + f.nz * off, wrap(i, n)) - 8);
          }
        }
        if (clear > bestClear) [bestSide, bestClear] = [side, clear];
      }
      if (bestClear > 0) pitLane = { side: bestSide, entry: round(sOf(a), 0), exit: round(sOf(b), 0) };
      else notes.push('no room for a pit lane beside the start straight');
    } else notes.push('start straight too short for a pit lane');
  }

  // Checks: tightest corner, parts of the track that come close to each other (crossings).
  let minRadius = Infinity;
  for (const c of curv) minRadius = Math.min(minRadius, 1 / Math.max(Math.abs(c), 1e-9));
  let close = 0;
  const skip = Math.round(120 / step);
  for (let i = 0; i < n; i += 4) {
    for (let j = i + skip; j < n; j += 4) {
      if (n - (j - i) < skip) continue;
      const fi = frames[i]!;
      const fj = frames[j]!;
      if (Math.hypot(fi.x - fj.x, fi.z - fj.z) < (fi.wl + fi.wr + fj.wl + fj.wr) / 2 + 2) close++;
    }
  }
  if (close) notes.push(`${close} close approaches/crossings between distant parts of the track (bridges or tight parallels)`);

  const realKm = ref?.props.length ? ref.props.length / 1000 : (cfg.realLengthKm ?? null);
  const lengthKm = L / 1000;
  const diff = realKm ? (lengthKm - realKm) / realKm : null;
  if (diff !== null && Math.abs(diff) > GEN.lengthTolerance) notes.push(`⚠ length differs from the published ${realKm} km by ${(diff * 100).toFixed(1)} %`);

  const laps = Math.min(RACE.maxLaps, Math.max(3, Math.round(GEN.raceKm / lengthKm)));
  const attribution =
    dataset === 'tumftm'
      ? 'Centreline and widths: TUMFTM racetrack-database (Chair of Automotive Technology, Technical University of Munich), LGPL-3.0; originally from OpenStreetMap contributors. Resampled, smoothed, aligned and processed by apex-lan.'
      : 'Centreline: circuits GeoJSON dataset by Tomislav Bacinger, MIT. Projected to metres, smoothed, widths added and processed by apex-lan.';
  const file: TrackFile = {
    format: TRACK_FORMAT,
    id: cfg.id,
    name: cfg.name,
    country: cfg.country,
    street: !!cfg.street,
    laps,
    lengthKm: round(lengthKm, 3),
    ...(realKm ? { realLengthKm: realKm } : {}),
    centerline: pts.map((p) => [round(p[0]), round(p[1]), round(p[2]), round(p[3])] as CenterPoint),
    sectors,
    checkpoints,
    aeroZones,
    detectionPoint,
    pitLane,
    grid,
    source: {
      dataset,
      file: dataset === 'tumftm' ? `tracks/${cfg.tumftm}.csv` : ref!.file,
      license: dataset === 'tumftm' ? 'LGPL-3.0' : 'MIT',
      attribution,
    },
  };
  const every = Math.max(1, Math.round(n / 160));
  const index: TrackIndexEntry = {
    id: cfg.id,
    name: cfg.name,
    country: cfg.country,
    street: !!cfg.street,
    laps,
    lengthKm: round(lengthKm, 3),
    preview: pts.filter((_, i) => i % every === 0).map((p) => [round(p[0], 0), round(p[1], 0)]),
  };
  return {
    file,
    index,
    ref,
    report: {
      id: cfg.id,
      dataset,
      lengthKm,
      realKm,
      diff,
      minRadius,
      closeApproaches: close,
      zones: aeroZones.length,
      pit: pitLane ? `${pitLane.side > 0 ? 'left' : 'right'} ${pitLane.entry}→${pitLane.exit} m` : 'none',
      notes,
    },
  };
}

/** A quick SVG of the track: road, start (S), direction arrows, zones, detection, sectors, pit side. */
function previewSvg(file: TrackFile, ref: Ref | null): string {
  const pts = file.centerline;
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const pad = 60;
  const W = 900;
  const scale = (W - 2 * pad) / Math.max(maxX - minX, maxZ - minZ);
  const X = (x: number) => (pad + (x - minX) * scale).toFixed(1);
  const Y = (z: number) => (pad + (z - minZ) * scale).toFixed(1);
  const n = pts.length;
  const L = (file.lengthKm ?? 0) * 1000;
  const at = (s: number) => pts[Math.round(wrap(s, L) / (L / n)) % n]!;
  const path = (list: readonly (readonly number[])[]) => list.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]!)},${Y(p[1]!)}`).join('') + 'Z';
  const parts: string[] = [];
  if (ref) parts.push(`<path d="${path(ref.pts)}" fill="none" stroke="#f0a" stroke-width="1" stroke-dasharray="4 3"/>`);
  parts.push(`<path d="${path(pts)}" fill="none" stroke="#333" stroke-width="${Math.max(2, 12 * scale)}" stroke-linejoin="round"/>`);
  for (const z of file.aeroZones ?? []) {
    const seg: (readonly number[])[] = [];
    const len = wrap(z.to - z.from, L);
    for (let d = 0; d <= len; d += 10) seg.push(at(z.from + d));
    parts.push(`<path d="${seg.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]!)},${Y(p[1]!)}`).join('')}" fill="none" stroke="#2c6" stroke-width="5"/>`);
  }
  for (let k = 1; k < 12; k++) {
    const a = at((k * L) / 12);
    const b = at((k * L) / 12 + 15);
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    const [ux, uz] = [dx / l, dz / l];
    const tip = [a[0] + ux * 40, a[1] + uz * 40];
    parts.push(
      `<path d="M${X(a[0] - uz * 15)},${Y(a[1] + ux * 15)}L${X(tip[0]!)},${Y(tip[1]!)}L${X(a[0] + uz * 15)},${Y(a[1] - ux * 15)}" fill="none" stroke="#06c" stroke-width="2"/>`,
    );
  }
  const dot = (s: number, color: string, label: string) => {
    const p = at(s);
    parts.push(`<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="7" fill="${color}"/><text x="${X(p[0])}" y="${Y(p[1])}" dx="10" dy="-8" font-size="16" fill="${color}" font-family="sans-serif">${label}</text>`);
  };
  file.sectors.forEach((s, i) => i && dot(s, '#888', `S${i + 1}`));
  if (file.detectionPoint !== undefined) dot(file.detectionPoint, '#a0f', 'DET');
  if (file.pitLane) {
    dot(file.pitLane.entry, '#e80', 'pit in');
    dot(file.pitLane.exit, '#e80', 'pit out');
  }
  if (ref) parts.push(`<circle cx="${X(ref.pts[0]![0])}" cy="${Y(ref.pts[0]![1])}" r="11" fill="none" stroke="#f0a" stroke-width="2"/>`);
  dot(0, '#d00', 'START');
  const H = Number(Y(maxZ)) + pad;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#fff"/>
<text x="12" y="24" font-size="18" font-family="sans-serif">${file.name}, ${file.country} — ${file.lengthKm} km (published ${file.realLengthKm ?? '?'} km). North up. Arrows = direction, green = straight zones, pink dashed = reference</text>
${parts.join('\n')}</svg>`;
}

// --- main -----------------------------------------------------------------

const args = process.argv.slice(2);
const wanted = args.includes('--all') ? TRACK_SOURCES.filter((t) => !t.disabled).map((t) => t.id) : args.filter((a) => !a.startsWith('--'));
const ids = wanted.length ? wanted : FIRST_FIVE;
if (!existsSync(TUMFTM)) {
  console.error(`Missing ${TUMFTM}. Clone the datasets first — see tools/README.md.`);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });
mkdirSync(PREVIEWS, { recursive: true });

const reports: Report[] = [];
const indexPath = join(OUT, 'index.json');
const index: TrackIndexEntry[] = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : [];
for (const id of ids) {
  const cfg = TRACK_SOURCES.find((t) => t.id === id);
  if (!cfg) throw new Error(`Unknown track ${id} (see tools/tracks.config.ts)`);
  const { file, index: entry, report, ref } = build(cfg);
  writeFileSync(join(OUT, `${id}.json`), JSON.stringify(file));
  writeFileSync(join(PREVIEWS, `${id}.svg`), previewSvg(file, ref));
  const at = index.findIndex((e) => e.id === id);
  if (at >= 0) index[at] = entry;
  else index.push(entry);
  reports.push(report);
}
// Keep the index in config order.
const order = new Map(TRACK_SOURCES.map((t, i) => [t.id, i]));
index.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
writeFileSync(indexPath, JSON.stringify(index));

// Licences travel with the data.
copyFileSync(join(TUMFTM, 'LICENSE'), join(OUT, 'LICENSE-TUMFTM-racetrack-database.txt'));
copyFileSync(join(bacingerDir(), 'LICENSE.md'), join(OUT, 'LICENSE-bacinger-circuits.txt'));

console.log('\nTrack build report\n');
for (const r of reports) {
  const len = `${r.lengthKm.toFixed(3)} km`;
  const real = r.realKm ? `${r.realKm.toFixed(3)} km (${r.diff! >= 0 ? '+' : ''}${(r.diff! * 100).toFixed(1)} %)` : 'unknown';
  console.log(`${r.id.padEnd(18)} ${r.dataset.padEnd(9)} ${len.padStart(10)}  published ${real.padEnd(22)} min radius ${r.minRadius.toFixed(0).padStart(4)} m  zones ${r.zones}  pit ${r.pit}`);
  for (const note of r.notes) console.log(`${''.padEnd(20)}- ${note}`);
}
console.log(`\nWrote ${ids.length} track(s) to client/public/tracks, previews in tools/out/.`);
