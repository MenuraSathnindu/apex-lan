import type { CenterPoint } from './centerline.ts';
import type { TrackZone } from './zones.ts';

/** Version of the generated track JSON (client/public/tracks/<id>.json). */
export const TRACK_FORMAT = 1;

export interface PitLaneDef {
  /** +1 = left of the racing direction, -1 = right. */
  side: 1 | -1;
  /** Where the lane leaves and rejoins the track (m from the start line; entry > exit wraps over the line). */
  entry: number;
  exit: number;
}

/** A grid slot: how far behind the start line (m) and the lateral offset (m, + = left). */
export interface GridSlot {
  back: number;
  offset: number;
}

/**
 * A circuit as data. Generated tracks come from `npm run tracks` (tools/build-tracks.ts);
 * hand-made ones (Apex Park) are built in code. Distances `s` are metres from the start line
 * along the centreline, in the racing direction.
 */
export interface TrackDef {
  id: string;
  /** Place name only — never a circuit's or event's trademarked name. */
  name: string;
  country: string;
  /** Street circuit: concrete walls close to the road instead of run-off. */
  street: boolean;
  /** Default race length for the lobby. */
  laps: number;
  /** Closed centreline in racing order, point 0 on the start/finish line; ~5 m apart. */
  centerline: readonly CenterPoint[];
  /** Start of each sector (first is 0). */
  sectors: readonly number[];
  /** Checkpoint gates (first is 0 = start/finish). Generated every ~100 m if missing. */
  checkpoints?: readonly number[];
  /** Straight-mode zones (wings may open). */
  aeroZones?: readonly TrackZone[];
  /** Overtake detection point. */
  detectionPoint?: number;
  pitLane?: PitLaneDef | null;
  grid: readonly GridSlot[];
  /** Our centreline length and the published length of the real circuit (km). */
  lengthKm?: number;
  realLengthKm?: number;
}

/** The JSON file: a TrackDef plus where the data came from. */
export interface TrackFile extends TrackDef {
  format: typeof TRACK_FORMAT;
  source: { dataset: string; file: string; license: string; attribution: string };
}

/** One row of client/public/tracks/index.json (the track select screen). */
export interface TrackIndexEntry {
  id: string;
  name: string;
  country: string;
  street: boolean;
  laps: number;
  lengthKm: number;
  /** Simplified outline for previews (x, z), racing order, start first. */
  preview: [number, number][];
}

/** Index entry for a track definition (preview: ~160 points of its centreline). */
export function trackIndexEntry(def: TrackDef): TrackIndexEntry {
  const cl = def.centerline;
  const every = Math.max(1, Math.round(cl.length / 160));
  let len = 0;
  cl.forEach((p, i) => {
    const q = cl[(i + 1) % cl.length]!;
    len += Math.hypot(q[0] - p[0], q[1] - p[1]);
  });
  return {
    id: def.id,
    name: def.name,
    country: def.country,
    street: def.street,
    laps: def.laps,
    lengthKm: Math.round(len) / 1000,
    preview: cl.filter((_, i) => i % every === 0).map((p) => [Math.round(p[0]), Math.round(p[1])]),
  };
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNumArray = (v: unknown): v is number[] => Array.isArray(v) && v.every(isNum);

/** Validates a parsed track JSON; throws with the reason if it's malformed. */
export function parseTrackFile(raw: unknown): TrackFile {
  const fail = (why: string): never => {
    throw new Error(`Bad track file: ${why}`);
  };
  if (typeof raw !== 'object' || raw === null) fail('not an object');
  const t = raw as Record<string, unknown>;
  if (t.format !== TRACK_FORMAT) fail(`format ${String(t.format)} (expected ${TRACK_FORMAT})`);
  for (const k of ['id', 'name', 'country'] as const) if (typeof t[k] !== 'string') fail(`${k} missing`);
  if (typeof t.street !== 'boolean') fail('street missing');
  if (!isNum(t.laps)) fail('laps missing');
  const cl = t.centerline;
  if (!Array.isArray(cl) || cl.length < 20 || !cl.every((p) => isNumArray(p) && p.length === 4 && p[2]! > 0 && p[3]! > 0)) {
    fail('centerline must be ≥ 20 points of [x, z, wl, wr] with positive widths');
  }
  if (!isNumArray(t.sectors) || t.sectors.length < 1) fail('sectors missing');
  if (t.checkpoints !== undefined && !isNumArray(t.checkpoints)) fail('checkpoints must be numbers');
  if (!Array.isArray(t.grid) || !t.grid.every((g) => isNum(g?.back) && isNum(g?.offset))) fail('grid missing');
  if (t.aeroZones !== undefined && !(Array.isArray(t.aeroZones) && t.aeroZones.every((z) => isNum(z?.from) && isNum(z?.to)))) {
    fail('aeroZones must be {from, to}[]');
  }
  if (t.detectionPoint !== undefined && !isNum(t.detectionPoint)) fail('detectionPoint must be a number');
  const pit = t.pitLane as Record<string, unknown> | null | undefined;
  if (pit && !((pit.side === 1 || pit.side === -1) && isNum(pit.entry) && isNum(pit.exit))) fail('pitLane must be {side, entry, exit}');
  return raw as TrackFile;
}
