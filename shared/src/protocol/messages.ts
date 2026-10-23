// Wire protocol. Trust model (LAN, decided 2026-10-17): each client simulates its own car and
// reports its state; the server owns the room (players, host, race phase) and relays car states.

import type { Livery } from '../livery.ts';
import type { ProfileSummary } from './api.ts';
import type { Compound, TyreWearSetting } from '../physics/tyres.ts';
import type { DetectionEvent, LapEvent, Standing } from '../race/raceTracker.ts';
import type { SessionInfo } from '../race/sessions.ts';

export type RacePhase = 'lobby' | 'countdown' | 'racing' | 'results';

export interface PlayerInfo {
  id: number;
  name: string;
  /** Index into CAR_COLORS. */
  color: number;
  /** Grid slot 0..MAX_PLAYERS-1 (also the spawn position in the lobby). */
  slot: number;
  connected: boolean;
  /** Paint scheme and race number. */
  livery: Livery;
  /** Tyre compound for the next/current race. */
  tyre: Compound;
  /** Logged-in profile, or null for a guest. */
  profileId: number | null;
  /** Three letters for the timing tower (from the profile, or made from the name). */
  tag: string;
  /** Profile photo URL, or null. */
  photo: string | null;
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
  /** Tyre wear for the race (host picks it in the lobby). */
  tyreWear: TyreWearSetting;
  /** Track for the next/current race (host picks it in the lobby). */
  trackId: string;
  /** What kind of session this is (quick race, or a championship qualifying / sprint / race). */
  session: SessionInfo;
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
  /** Wing opening 0 (corner mode) .. 1 (straight mode), for the wing animation. Absent = 0. */
  a?: number;
  /** Battery level 0..1 and 1 while deploying (timing tower, boost effects). Absent = 0. */
  e?: number;
  d?: 0 | 1;
}

/** A relayed car state: who it belongs to and when the server received it. */
export interface CarSnapshot extends CarState {
  id: number;
  /** Server receive time (ms). Remote cars are interpolated on this timeline. */
  ts: number;
}

/** Client -> Server messages. */
export type C2S =
  | { t: 'hello'; sessionId: string | null; name: string; color: number; livery?: Livery; tyre?: Compound; token?: string | null }
  | { t: 'profile'; name: string; color: number; livery?: Livery; tyre?: Compound }
  | { t: 'state'; s: CarState }
  | { t: 'start' }
  | { t: 'setLaps'; laps: number }
  | { t: 'setTyreWear'; wear: TyreWearSetting }
  | { t: 'setTrack'; trackId: string }
  /** Log this connection in to a profile (login token), or back out to guest (null). */
  | { t: 'auth'; token: string | null }
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
  /** A racer crossed the overtake detection point: their ERS lap restarts, and overtake mode is on or off. */
  | { t: 'detect'; e: DetectionEvent }
  | { t: 'pong'; clientTime: number; serverTime: number }
  | { t: 'full' }
  /** Result of logging in on the socket (hello with a token, or `auth`). */
  | { t: 'auth'; ok: boolean; profile: ProfileSummary | null; reason?: string };
