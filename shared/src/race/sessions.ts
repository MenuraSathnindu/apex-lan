import { CHAMPIONSHIP } from '../tuning.ts';

/** What the room is running: a quick race, or a championship weekend session. */
export type SessionKind = 'free' | 'qualifying' | 'sprint' | 'race';

export type QualifyingFormat = { mode: 'timed'; minutes: 5 | 8 | 12 } | { mode: 'oneShot' };

export interface SessionInfo {
  kind: SessionKind;
  /** Laps to run (free, sprint, race). */
  laps: number;
  qualifying: QualifyingFormat | null;
  /** Server time a timed qualifying ends (0 otherwise). */
  endsAt: number;
  /** Championship context for the HUD, or null for a free race. */
  round: { championshipId: number; round: number; rounds: number; trackId: string } | null;
}

export function freeSession(laps: number): SessionInfo {
  return { kind: 'free', laps, qualifying: null, endsAt: 0, round: null };
}

/** A third of the race distance, at least one lap. */
export function sprintLaps(raceLaps: number): number {
  return Math.max(1, Math.round(raceLaps / 3));
}

/** Championship points for a classified position (finishers only). */
export function sessionPoints(kind: SessionKind, position: number, dnf: boolean): number {
  if (dnf) return 0;
  const table = kind === 'race' ? CHAMPIONSHIP.racePoints : kind === 'sprint' ? CHAMPIONSHIP.sprintPoints : [];
  return table[position - 1] ?? 0;
}

/** +1 for the race's fastest lap, if the season has it on and the holder finished in the top 10. */
export function fastestLapBonus(kind: SessionKind, position: number, dnf: boolean, isFastest: boolean, enabled: boolean): number {
  return enabled && isFastest && kind === 'race' && !dnf && position <= CHAMPIONSHIP.fastestLapTopN ? CHAMPIONSHIP.fastestLapBonus : 0;
}

/** A completed qualifying lap, in the order laps were completed. */
export interface QualiLap {
  id: number;
  lap: number;
  time: number;
  valid: boolean;
}

/**
 * Grid order from qualifying. Timed: each driver's best valid lap. One-shot: lap 2 (the flying
 * lap after the warm-up), if valid. Equal times: whoever set it first. No time: at the back, in
 * entry order.
 */
export function qualifyingOrder(format: QualifyingFormat, laps: readonly QualiLap[], entrants: readonly number[]): { id: number; best: number | null }[] {
  const best = new Map<number, { time: number; at: number }>();
  laps.forEach((l, at) => {
    if (!l.valid || !entrants.includes(l.id)) return;
    if (format.mode === 'oneShot' && l.lap !== 2) return;
    const cur = best.get(l.id);
    if (!cur || l.time < cur.time) best.set(l.id, { time: l.time, at });
  });
  const timed = [...best.entries()].sort((a, b) => a[1].time - b[1].time || a[1].at - b[1].at).map(([id, b]) => ({ id, best: b.time as number | null }));
  return [...timed, ...entrants.filter((id) => !best.has(id)).map((id) => ({ id, best: null }))];
}

/**
 * Is qualifying over? Timed: at the flag, unless someone is on a lap they started before it —
 * then until they finish it, at most CHAMPIONSHIP.qualiOverrunMs. One-shot: when every entrant
 * has done the flying lap, or after CHAMPIONSHIP.oneShotMaxMs.
 */
export function qualifyingOver(
  format: QualifyingFormat,
  now: number,
  startsAt: number,
  endsAt: number,
  inLapIds: ReadonlySet<number>,
  doneIds: ReadonlySet<number>,
  entrants: readonly number[],
): boolean {
  if (format.mode === 'timed') {
    if (now < endsAt) return false;
    return inLapIds.size === 0 || now >= endsAt + CHAMPIONSHIP.qualiOverrunMs;
  }
  return entrants.every((id) => doneIds.has(id)) || now >= startsAt + CHAMPIONSHIP.oneShotMaxMs;
}
