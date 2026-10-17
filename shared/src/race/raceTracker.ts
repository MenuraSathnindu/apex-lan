import type { BuiltTrack } from '../track/track.ts';
import { RACE } from '../tuning.ts';
import { crossesGate, nearestSample, type Gate } from './checkpoints.ts';

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

  constructor(
    private readonly track: BuiltTrack,
    private readonly gates: Gate[],
    participants: readonly number[],
    readonly startsAt: number,
    readonly laps: number,
  ) {
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
      const gate = this.gates[r.nextGate]!;
      if (plausible && crossesGate(gate, r.x, r.z, x, z)) {
        if (r.nextGate === 0) events.push(this.completeLap(r, ts));
        r.nextGate = (r.nextGate + 1) % this.gates.length;
      }
    }
    r.x = x;
    r.z = z;
    r.ts = ts;
    r.hasPos = true;
    return events;
  }

  private completeLap(r: Racer, ts: number): LapEvent {
    const time = ts - r.lapStart;
    r.laps++;
    r.lastLap = time;
    const personalBest = r.bestLap === null || time < r.bestLap;
    if (personalBest) r.bestLap = time;
    const raceBest = this.raceBest === null || time < this.raceBest;
    if (raceBest) this.raceBest = time;
    r.lapStart = ts;
    const finished = r.laps >= this.laps;
    if (finished) {
      r.finishTime = ts - this.startsAt;
      this.firstFinishAt ??= ts;
    }
    return { id: r.id, lap: r.laps, time, personalBest, raceBest, finished };
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
      const fa = a.r.finishTime;
      const fb = b.r.finishTime;
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
    }));
  }
}
