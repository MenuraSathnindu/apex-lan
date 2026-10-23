import { COUNTDOWN_MS } from '../constants.ts';
import { RACE } from '../tuning.ts';
import type { SessionKind } from './sessions.ts';

const L = RACE.lights;

/** Longest a light sequence can take (lead + every light + the longest hold). */
export const MAX_COUNTDOWN_MS = L.leadMs + L.count * L.intervalMs + L.holdMaxMs;

/**
 * How long all five lights stay on before going out: "random" between holdMin and holdMax, but
 * derived from the race number so the server and every client agree without a message.
 */
export function lightsHoldMs(raceId: number): number {
  // Integer hash (xorshift-multiply) of the race number → 0..1.
  let h = (raceId | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  const u = (h >>> 0) / 0xffffffff;
  return Math.round(L.holdMinMs + u * (L.holdMaxMs - L.holdMinMs));
}

/** Time from the start command to GO: the light sequence for races, a plain 3-2-1 for qualifying. */
export function countdownMs(kind: SessionKind, raceId: number): number {
  return kind === 'qualifying' ? COUNTDOWN_MS : L.leadMs + L.count * L.intervalMs + lightsHoldMs(raceId);
}

/** Server time the first light comes on. */
export function lightsStartAt(startsAt: number, raceId: number): number {
  return startsAt - lightsHoldMs(raceId) - (L.count - 1) * L.intervalMs;
}

/** How many lights are lit at `now` (0 before the first and again from lights out = startsAt). */
export function litLights(now: number, startsAt: number, raceId: number): number {
  if (now >= startsAt) return 0;
  const since = now - lightsStartAt(startsAt, raceId);
  if (since < 0) return 0;
  return Math.min(L.count, Math.floor(since / L.intervalMs) + 1);
}
