import type { BuiltTrack } from '../track/track.ts';
import { RACE } from '../tuning.ts';
import { crossesGate, gateAtDistance, nearestSample, type Gate } from './checkpoints.ts';

/** One racer's standing, as broadcast to clients. Times are in ms. */
export interface Standing {
  id: number;
  /** 1-based race position. */
  pos: number;
  /** Laps completed. */
  laps: number;
  /** Index of the next checkpoint gate this racer must cross. */
  nextGate: number;
  /** Server time the current lap started. */
  lapStart: number;
  lastLap: number | null;
  bestLap: number | null;
  /** Total race time once finished. */
  finishTime: number | null;
  /** Didn't finish (only set once results are final). */
  dnf: boolean;
  /** Time penalties (ms), added to the finish time for the classification. */
  penaltyMs: number;
}

/** Finish time with penalties (what the classification is ordered by), or null if not finished. */
export function classifiedTime(s: Pick<Standing, 'finishTime' | 'penaltyMs'>): number | null {
  return s.finishTime === null ? null : s.finishTime + s.penaltyMs;
}

export interface LapEvent {
  id: number;
  /** Lap number just completed (1-based). */
  lap: number;
  time: number;
  personalBest: boolean;
  raceBest: boolean;
  /** This lap finished the race for them. */
  finished: boolean;
  /** Sector times (ms) of this lap, or null if a split was missed (e.g. a respawn). */
  sectors: number[] | null;
  /** False if the car jumped (respawn / teleport) during the lap: it counts, but not as a lap time. */
  valid: boolean;
}

/** A completed lap as kept for the results / player database. */
export interface LapRecord {
  lap: number;
  time: number;
  sectors: number[] | null;
  valid: boolean;
}

/**
 * A racer crossed the overtake detection point. `overtake` is true when the car directly ahead
 * (the last one to cross before them) was within RACE gap — extra ERS energy for the next lap.
 */
export interface DetectionEvent {
  id: number;
  /** Seconds behind the car ahead (null if nobody crossed before them). */
  gap: number | null;
  overtake: boolean;
}

/** A stewards' decision about a car: a track-limits warning, a time penalty, or a deleted lap. */
export interface StewardEvent {
  id: number;
  kind: 'warning' | 'penalty' | 'lapDeleted';
  reason: 'jumpStart' | 'trackLimits';
  /** Track-limits strikes so far (0 for a jump start). */
  strikes: number;
  /** Penalty added by this decision (ms), 0 for warnings and deleted laps. */
  penaltyMs: number;
}

interface Racer {
  id: number;
  x: number;
  z: number;
  ts: number;
  hasPos: boolean;
  hint: number;
  laps: number;
  nextGate: number;
  lapStart: number;
  lastLap: number | null;
  bestLap: number | null;
  finishTime: number | null;
  /** How many times they've crossed the detection point. */
  detections: number;
  /** Server time this lap crossed each sector line (index 0 = lap start). */
  splits: (number | null)[];
  history: LapRecord[];
  /** The current lap had an implausible jump (or was deleted for track limits). */
  invalid: boolean;
  penaltyMs: number;
}

const wrap = (d: number, len: number) => ((((d + len / 2) % len) + len) % len) - len / 2;

/**
 * Authoritative lap counting from reported positions. A lap only counts when every gate
 * was crossed in order, and only by plausible movement: a jump faster than
 * RACE.maxPlausibleSpeed (a teleport, a respawn, a fake position) never crosses anything.
 *
 * Cars start behind gate 0, so the first lap ends at the first crossing of the start line
 * after passing every other gate (lap 1 includes the run from the grid, like real racing).
 */
export class RaceTracker {
  private readonly racers = new Map<number, Racer>();
  private firstFinishAt: number | null = null;
  private raceBest: number | null = null;
  private final = false;
  private readonly detectionGate: Gate | null;
  /** crossings[k] = server times of everyone's (k+1)-th detection crossing, in order. */
  private readonly crossings: number[][] = [];
  private pendingDetections: DetectionEvent[] = [];
  /** Gate index where each sector starts (sector 1 = gate 0). */
  private readonly sectorGates: number[];

  constructor(
    private readonly track: BuiltTrack,
    private readonly gates: Gate[],
    participants: readonly number[],
    readonly startsAt: number,
    readonly laps: number,
  ) {
    // Each sector line maps to the gate nearest to it (sector 1 starts at the line, gate 0).
    this.sectorGates = (track.def.sectors.length ? track.def.sectors : [0]).map((s, k) => {
      if (k === 0) return 0;
      let best = 1;
      for (let g = 1; g < gates.length; g++) if (Math.abs(gates[g]!.s - s) < Math.abs(gates[best]!.s - s)) best = g;
      return best;
    });
    const dp = track.def.detectionPoint;
    this.detectionGate = dp === undefined ? null : gateAtDistance(track, dp);
    for (const id of participants) {
      this.racers.set(id, {
        id,
        x: 0,
        z: 0,
        ts: 0,
        hasPos: false,
        hint: -1,
        laps: 0,
        nextGate: 1 % gates.length,
        lapStart: startsAt,
        lastLap: null,
        bestLap: null,
        finishTime: null,
        detections: 0,
        splits: this.sectorGates.map((_, k) => (k === 0 ? startsAt : null)),
        history: [],
        invalid: false,
        penaltyMs: 0,
      });
    }
  }

  isParticipant(id: number): boolean {
    return this.racers.has(id);
  }

  /** Feed every reported position (server receive time). Returns completed laps. */
  onState(id: number, x: number, z: number, ts: number): LapEvent[] {
    const r = this.racers.get(id);
    if (!r || this.final) return [];
    const events: LapEvent[] = [];
    const moved = r.hasPos && ts >= this.startsAt && r.finishTime === null;
    if (moved) {
      const dt = Math.max((ts - r.ts) / 1000, 1 / 30);
      const dist = Math.hypot(x - r.x, z - r.z);
      const plausible = dist <= RACE.maxPlausibleSpeed * dt + 5;
      if (!plausible) r.invalid = true;
      const gate = this.gates[r.nextGate]!;
      if (plausible && crossesGate(gate, r.x, r.z, x, z)) {
        const sector = this.sectorGates.indexOf(r.nextGate);
        if (sector > 0) r.splits[sector] = ts;
        if (r.nextGate === 0) events.push(this.completeLap(r, ts));
        r.nextGate = (r.nextGate + 1) % this.gates.length;
      }
      if (plausible && this.detectionGate && crossesGate(this.detectionGate, r.x, r.z, x, z)) this.onDetection(r, ts);
    }
    r.x = x;
    r.z = z;
    r.ts = ts;
    r.hasPos = true;
    return events;
  }

  private onDetection(r: Racer, ts: number): void {
    const times = (this.crossings[r.detections] ??= []);
    // The car ahead is whoever crossed this detection point (same lap) last before us.
    const ahead = times.length ? times[times.length - 1]! : null;
    const gap = ahead === null ? null : (ts - ahead) / 1000;
    times.push(ts);
    r.detections++;
    this.pendingDetections.push({ id: r.id, gap, overtake: gap !== null && gap <= RACE.overtakeMaxGap });
  }

  /** Detection-point crossings since the last call (for the room to announce). */
  takeDetections(): DetectionEvent[] {
    const out = this.pendingDetections;
    this.pendingDetections = [];
    return out;
  }

  private completeLap(r: Racer, ts: number): LapEvent {
    const time = ts - r.lapStart;
    // Sector times from the splits, if every one was crossed this lap.
    const marks = [...r.splits, ts];
    const sectors = marks.every((m, k) => m !== null && (k === 0 || m > marks[k - 1]!))
      ? marks.slice(1).map((m, k) => m! - marks[k]!)
      : null;
    r.splits = this.sectorGates.map((_, k) => (k === 0 ? ts : null));
    const valid = !r.invalid;
    r.invalid = false;
    r.laps++;
    r.lastLap = time;
    const personalBest = valid && (r.bestLap === null || time < r.bestLap);
    if (personalBest) r.bestLap = time;
    const raceBest = personalBest && (this.raceBest === null || time < this.raceBest);
    if (raceBest) this.raceBest = time;
    r.lapStart = ts;
    const finished = r.laps >= this.laps;
    if (finished) {
      r.finishTime = ts - this.startsAt;
      this.firstFinishAt ??= ts;
    }
    r.history.push({ lap: r.laps, time, sectors, valid });
    return { id: r.id, lap: r.laps, time, personalBest, raceBest, finished, sectors, valid };
  }

  /** Has this racer taken the chequered flag? */
  hasFinished(id: number): boolean {
    return this.racers.get(id)?.finishTime != null;
  }

  /** A time penalty, served by adding it to the racer's finish time. */
  addPenalty(id: number, ms: number): void {
    const r = this.racers.get(id);
    if (r) r.penaltyMs += ms;
  }

  /** The racer's current lap still counts as a lap, but not as a lap time (e.g. track limits in qualifying). */
  invalidateLap(id: number): void {
    const r = this.racers.get(id);
    if (r) r.invalid = true;
  }

  /** Every completed lap of a racer. */
  lapsOf(id: number): readonly LapRecord[] {
    return this.racers.get(id)?.history ?? [];
  }

  /** Who set the fastest lap of the race (earliest wins a tie), or null. */
  fastestLap(): { id: number; time: number } | null {
    let best: { id: number; time: number } | null = null;
    for (const r of this.racers.values()) {
      if (r.bestLap !== null && (best === null || r.bestLap < best.time)) best = { id: r.id, time: r.bestLap };
    }
    return best;
  }

  /** Race over: everyone still connected has finished, or the grace period after the winner ran out. */
  isOver(now: number, connected: ReadonlySet<number>): boolean {
    if (this.firstFinishAt === null) return false;
    if (now - this.firstFinishAt >= RACE.finishGraceMs) return true;
    for (const r of this.racers.values()) if (r.finishTime === null && connected.has(r.id)) return false;
    return true;
  }

  /** Freeze results: unfinished racers become DNF. */
  finalize(): void {
    this.final = true;
  }

  /** Race progress in "gates": laps × gates + gates passed this lap + fraction to the next. */
  private progress(r: Racer): number {
    const n = this.gates.length;
    const passed = (r.nextGate - 1 + n) % n; // gates passed this lap (gate 0 counts as the lap start)
    if (!r.hasPos) return r.laps * n + passed - 1;
    r.hint = nearestSample(this.track, r.x, r.z, r.hint);
    const s = this.track.samples[r.hint]!.s;
    const prev = this.gates[(r.nextGate - 1 + n) % n]!;
    const spacing = this.track.length / n;
    const frac = Math.max(-1, Math.min(0.999, wrap(s - (prev.s + this.track.samples[this.track.startIndex]!.s), this.track.length) / spacing));
    return r.laps * n + passed + frac;
  }

  standings(): Standing[] {
    const rows = [...this.racers.values()].map((r) => ({ r, progress: this.progress(r) }));
    rows.sort((a, b) => {
      const fa = classifiedTime(a.r);
      const fb = classifiedTime(b.r);
      if (fa !== null || fb !== null) return (fa ?? Infinity) - (fb ?? Infinity);
      return b.progress - a.progress;
    });
    return rows.map(({ r }, i) => ({
      id: r.id,
      pos: i + 1,
      laps: r.laps,
      nextGate: r.nextGate,
      lapStart: r.lapStart,
      lastLap: r.lastLap,
      bestLap: r.bestLap,
      finishTime: r.finishTime,
      dnf: this.final && r.finishTime === null,
      penaltyMs: r.penaltyMs,
    }));
  }
}
