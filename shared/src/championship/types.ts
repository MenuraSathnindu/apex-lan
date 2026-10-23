import type { ProfileSummary } from '../protocol/api.ts';
import type { QualifyingFormat } from '../race/sessions.ts';

export interface SeasonSettings {
  /** Laps per race (sprints run a third of it). */
  laps: number;
  qualifying: QualifyingFormat;
  /** +1 point for the race's fastest lap (top-10 finishers only). */
  fastestLapPoint: boolean;
  tyreWear: boolean;
}

export interface SeasonRound {
  round: number;
  trackId: string;
  sprint: boolean;
}

export interface SeasonTeam {
  id: number;
  name: string;
  primary: number;
  secondary: number;
}

export interface SeasonEntry {
  profile: ProfileSummary;
  teamId: number | null;
  /** Round the driver joined (earlier rounds count as absent). */
  joinedRound: number;
}

export type ResultSession = 'qualifying' | 'sprint' | 'race';

/** One driver's result in one session of one round. `teamId` is the team at that moment. */
export interface SeasonResult {
  round: number;
  session: ResultSession;
  profileId: number;
  teamId: number | null;
  position: number;
  dnf: boolean;
  bestLapMs: number | null;
  points: number;
  fastestLap: boolean;
}

export type SeasonStatus = 'setup' | 'active' | 'finished';

/** Everything about a season, as the server sends it (standings are computed from `results`). */
export interface ChampionshipView {
  id: number;
  name: string;
  status: SeasonStatus;
  settings: SeasonSettings;
  rounds: SeasonRound[];
  teams: SeasonTeam[];
  entries: SeasonEntry[];
  results: SeasonResult[];
  /** The session to run next, or null when the season is over. */
  next: { round: number; session: ResultSession } | null;
  championId: number | null;
}

/** A row of the seasons list. */
export interface SeasonListItem {
  id: number;
  name: string;
  status: SeasonStatus;
  rounds: number;
  next: { round: number; session: ResultSession } | null;
  championId: number | null;
}

/** What the host fills in to create a season. */
export interface SeasonDraft {
  name: string;
  settings: SeasonSettings;
  rounds: { trackId: string; sprint: boolean }[];
}
