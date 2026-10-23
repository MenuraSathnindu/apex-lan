// HTTP API (profiles, photos, stats). Live race data stays on the WebSocket; these are
// request/response calls to the host: /api/... (JSON) and /photos/<file>.webp.
import type { Livery } from '../livery.ts';

/** What everyone may see about a player profile. */
export interface ProfileSummary {
  id: number;
  name: string;
  /** Three capital letters, shown on the timing tower. */
  tag: string;
  livery: Livery;
  /** URL path of the 256×256 photo, or null. */
  photo: string | null;
}

export interface CareerStats {
  /** Races with at least two starters (solo runs count as practice). */
  races: number;
  practice: number;
  wins: number;
  podiums: number;
  poles: number;
  fastestLaps: number;
  dnfs: number;
  points: number;
  championships: number;
  laps: number;
}

/** A driver's best on one track: fastest lap and best sector times (any laps). */
export interface TrackRecord {
  trackId: string;
  bestLapMs: number;
  /** Sectors of the best lap (null if unknown). */
  bestLapSectors: (number | null)[];
  /** Best time in each sector across all laps. */
  bestSectors: (number | null)[];
  laps: number;
  setAt: number;
}

export interface HeadToHead {
  opponent: ProfileSummary;
  /** Races where we finished ahead / behind them. */
  ahead: number;
  behind: number;
}

export interface ProfilePage {
  profile: ProfileSummary;
  stats: CareerStats;
  tracks: TrackRecord[];
  headToHead: HeadToHead[];
}

export interface HallOfFameEntry {
  rank: number;
  profile: ProfileSummary;
  lapMs: number;
  sectors: (number | null)[];
  setAt: number;
}

/** Create / log in / edit. The PIN is 4 digits. */
export interface CreateProfileRequest {
  name: string;
  tag: string;
  livery: Livery;
  pin: string;
}
export interface LoginRequest {
  name: string;
  pin: string;
}
export interface UpdateProfileRequest {
  tag?: string;
  livery?: Livery;
}
/** Successful create / login: the token stays in the browser and logs in next time. */
export interface AuthResponse {
  profile: ProfileSummary;
  token: string;
}
export interface ApiError {
  error: string;
}

export const PROFILE_RULES = {
  nameMin: 2,
  tagLength: 3,
  pinLength: 4,
  /** Photo uploads: size limit before processing, and the stored square size. */
  photoMaxBytes: 5 * 1024 * 1024,
  photoSize: 256,
} as const;

/** "Ann Lee" → "ANN"; letters only, padded with X. */
export function defaultTag(name: string): string {
  const letters = name.normalize('NFKD').replace(/[^A-Za-z]/g, '').toUpperCase();
  return (letters + 'XXX').slice(0, PROFILE_RULES.tagLength);
}

/** Three letters A–Z, or null. */
export function sanitizeTag(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(t) ? t : null;
}

export const isPin = (v: unknown): v is string => typeof v === 'string' && /^\d{4}$/.test(v);
