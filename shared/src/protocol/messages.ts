// Wire protocol. Trust model (LAN, decided 2026-10-17): each client simulates its own car and
// reports its state; the server owns the room (players, host, race phase) and relays car states.

import type { LapEvent, Standing } from '../race/raceTracker.ts';

export type RacePhase = 'lobby' | 'countdown' | 'racing' | 'results';

export interface PlayerInfo {
  id: number;
  name: string;
  /** Index into CAR_COLORS. */
  color: number;
  /** Grid slot 0..MAX_PLAYERS-1 (also the spawn position in the lobby). */
  slot: number;
  connected: boolean;
}

export interface RaceState {
  phase: RacePhase;
  /** Increments on every start, so clients know to reset to the grid. */
  raceId: number;
  /** Server time (ms) when the countdown ends and racing begins. */
  startsAt: number;
  /** Laps for the current/next race (host picks in the lobby). */
  laps: number;
  /** Server time results will be shown at the latest (0 until someone finishes). */
  finishDeadline: number;
}

/** A car's state as reported by its owner. Numbers are rounded to keep messages small. */
export interface CarState {
  /** Chassis position. */
  p: [number, number, number];
  /** Chassis rotation quaternion. */
  q: [number, number, number, number];
  /** Linear velocity (for extrapolation and kinematic proxies). */
  v: [number, number, number];
  /** Per wheel FL, FR, RL, RR: [steer, spin, wheelCentreY] → 12 numbers. */
  wh: number[];
  /** 1 while braking (brake lights). */
  b: 0 | 1;
}

/** A relayed car state: who it belongs to and when the server received it. */
export interface CarSnapshot extends CarState {
  id: number;
  /** Server receive time (ms). Remote cars are interpolated on this timeline. */
  ts: number;
}

/** Client -> Server messages. */
export type C2S =
  | { t: 'hello'; sessionId: string | null; name: string; color: number }
  | { t: 'profile'; name: string; color: number }
  | { t: 'state'; s: CarState }
  | { t: 'start' }
  | { t: 'setLaps'; laps: number }
  | { t: 'endRace' }
  | { t: 'ping'; clientTime: number };

/** Server -> Client messages. */
export type S2C =
  | {
      t: 'welcome';
      playerId: number;
      /** Keep this (per tab) and send it back in `hello` to rejoin as the same player. */
      sessionId: string;
      hostId: number;
      players: PlayerInfo[];
      race: RaceState;
      /** Your last reported state, when rejoining mid-race. */
      resume: CarState | null;
    }
  | { t: 'roster'; hostId: number; players: PlayerInfo[] }
  | { t: 'race'; race: RaceState }
  | { t: 'snapshot'; cars: CarSnapshot[] }
  /** Live ranking (5 Hz while racing; final once results are in). */
  | { t: 'standings'; standings: Standing[] }
  | { t: 'lap'; e: LapEvent }
  | { t: 'pong'; clientTime: number; serverTime: number }
  | { t: 'full' };
