import type { SectorEvent } from './raceTracker.ts';

/** Broadcast sector colours: session best, personal best, slower. */
export type SectorColour = 'purple' | 'green' | 'yellow';

interface Driver {
  best: number[];
  /** Lap time so far at each sector line of the best lap. */
  bestSplits: number[] | null;
  bestLap: number;
  /** Elapsed at each sector line of the lap under way. */
  splits: number[];
  lap: number;
  colours: (SectorColour | null)[];
}

/**
 * Colours live sector times and works out the lap delta, from the server's sector events.
 * Invalid laps are shown without colour and never set a best.
 */
export class SectorBoard {
  private sessionBest: number[] = [];
  private readonly drivers = new Map<number, Driver>();

  constructor(private sectors: number) {}

  /** New session (or a track with a different number of sectors). */
  reset(sectors = this.sectors): void {
    this.sectors = sectors;
    this.sessionBest = [];
    this.drivers.clear();
  }

  add(e: SectorEvent): { colour: SectorColour | null; delta: number | null } {
    let d = this.drivers.get(e.id);
    if (!d) this.drivers.set(e.id, (d = { best: [], bestSplits: null, bestLap: Infinity, splits: [], lap: 0, colours: [] }));
    if (d.lap !== e.lap) {
      d.lap = e.lap;
      d.splits = [];
      d.colours = [];
    }
    d.splits[e.sector] = e.elapsed;
    const delta = d.bestSplits?.[e.sector] !== undefined ? e.elapsed - d.bestSplits[e.sector]! : null;
    let colour: SectorColour | null = null;
    if (e.valid) {
      const session = this.sessionBest[e.sector] ?? Infinity;
      const own = d.best[e.sector] ?? Infinity;
      colour = e.time <= session ? 'purple' : e.time <= own ? 'green' : 'yellow';
      if (e.time < session) this.sessionBest[e.sector] = e.time;
      if (e.time < own) d.best[e.sector] = e.time;
      // A complete valid lap faster than the best one: its splits are the new reference.
      if (e.sector === this.sectors - 1 && e.elapsed < d.bestLap && d.splits.length === this.sectors) {
        d.bestLap = e.elapsed;
        d.bestSplits = [...d.splits];
      }
    }
    d.colours[e.sector] = colour;
    return { colour, delta };
  }

  /** Colours of a driver's sectors on the given lap so far (null = not done / invalid). */
  colours(id: number, lap: number): (SectorColour | null)[] {
    const d = this.drivers.get(id);
    return Array.from({ length: this.sectors }, (_, k) => (d && d.lap === lap ? (d.colours[k] ?? null) : null));
  }
}
