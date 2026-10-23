import type {
  ChampionshipView,
  ResultSession,
  SeasonDraft,
  SeasonEntry,
  SeasonListItem,
  SeasonResult,
  SeasonSettings,
  SeasonStatus,
  SeasonTeam,
} from '@apex/shared';
import { PlayerDb, type RaceInput } from './database.ts';

interface ChampionshipRow {
  id: number;
  name: string;
  status: SeasonStatus;
  settings: string;
  next_round: number | null;
  next_session: ResultSession | null;
  champion_profile_id: number | null;
}

/** Where seasons live (SQLite in production; tests of the runner use a fake). */
export interface ChampionshipStore {
  create(draft: SeasonDraft, now: number): ChampionshipView;
  list(): SeasonListItem[];
  view(id: number): ChampionshipView | null;
  addEntry(id: number, profileId: number, joinedRound: number): void;
  setTeam(id: number, profileId: number, teamId: number | null): void;
  createTeam(id: number, name: string, primary: number, secondary: number): SeasonTeam;
  /** setup → active, next = round 1 qualifying. */
  start(id: number): void;
  /**
   * Stores one session's results, its career race (if any) and the next session, in one
   * transaction. `next === null` finishes the season with `championId` (and a career title).
   */
  writeSession(
    id: number,
    round: number,
    session: ResultSession,
    rows: SeasonResult[],
    career: RaceInput | null,
    next: { round: number; session: ResultSession } | null,
    championId: number | null,
    now: number,
  ): void;
}

/** Championship seasons in the player database. */
export class ChampionshipDb implements ChampionshipStore {
  private readonly q;

  constructor(private readonly players: PlayerDb) {
    const db = players.db;
    this.q = {
      insert: db.prepare<[string, string, number]>("INSERT INTO championship (name, status, settings, created_at) VALUES (?, 'setup', ?, ?)"),
      insertRound: db.prepare<[number, number, string, number]>('INSERT INTO championship_round (championship_id, round, track_id, sprint) VALUES (?, ?, ?, ?)'),
      get: db.prepare<[number], ChampionshipRow>('SELECT * FROM championship WHERE id = ?'),
      all: db.prepare<[], ChampionshipRow & { rounds: number }>(
        'SELECT c.*, (SELECT COUNT(*) FROM championship_round r WHERE r.championship_id = c.id) AS rounds FROM championship c ORDER BY c.id DESC',
      ),
      rounds: db.prepare<[number], { round: number; track_id: string; sprint: number }>('SELECT round, track_id, sprint FROM championship_round WHERE championship_id = ? ORDER BY round'),
      teams: db.prepare<[number], { id: number; name: string; primary_color: number; secondary_color: number }>(
        'SELECT id, name, primary_color, secondary_color FROM championship_team WHERE championship_id = ? ORDER BY id',
      ),
      entries: db.prepare<[number], { profile_id: number; team_id: number | null; joined_round: number }>(
        'SELECT profile_id, team_id, joined_round FROM championship_entry WHERE championship_id = ? ORDER BY joined_round, rowid',
      ),
      results: db.prepare<
        [number],
        { round: number; session: ResultSession; profile_id: number; team_id: number | null; position: number; dnf: number; best_lap_ms: number | null; points: number; fastest_lap: number }
      >('SELECT * FROM championship_result WHERE championship_id = ? ORDER BY round, session, position'),
      insertEntry: db.prepare<[number, number, number]>('INSERT INTO championship_entry (championship_id, profile_id, joined_round) VALUES (?, ?, ?)'),
      setTeam: db.prepare<[number | null, number, number]>('UPDATE championship_entry SET team_id = ? WHERE championship_id = ? AND profile_id = ?'),
      insertTeam: db.prepare<[number, string, number, number]>('INSERT INTO championship_team (championship_id, name, primary_color, secondary_color) VALUES (?, ?, ?, ?)'),
      start: db.prepare<[number]>("UPDATE championship SET status = 'active', next_round = 1, next_session = 'qualifying' WHERE id = ? AND status = 'setup'"),
      insertResult: db.prepare<[number, number, string, number, number | null, number, number, number | null, number, number]>(
        `INSERT INTO championship_result (championship_id, round, session, profile_id, team_id, position, dnf, best_lap_ms, points, fastest_lap)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      advance: db.prepare<[number, string, number]>('UPDATE championship SET next_round = ?, next_session = ? WHERE id = ?'),
      finish: db.prepare<[number | null, number, number]>(
        "UPDATE championship SET status = 'finished', next_round = NULL, next_session = NULL, champion_profile_id = ?, finished_at = ? WHERE id = ?",
      ),
    };
  }

  create(draft: SeasonDraft, now: number): ChampionshipView {
    const id = this.players.db.transaction(() => {
      const newId = Number(this.q.insert.run(draft.name, JSON.stringify(draft.settings), now).lastInsertRowid);
      draft.rounds.forEach((r, i) => this.q.insertRound.run(newId, i + 1, r.trackId, r.sprint ? 1 : 0));
      return newId;
    })();
    return this.view(id)!;
  }

  list(): SeasonListItem[] {
    return this.q.all.all().map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      rounds: r.rounds,
      next: r.next_round !== null && r.next_session ? { round: r.next_round, session: r.next_session } : null,
      championId: r.champion_profile_id,
    }));
  }

  view(id: number): ChampionshipView | null {
    const row = this.q.get.get(id);
    if (!row) return null;
    const entries: SeasonEntry[] = this.q.entries.all(id).flatMap((e) => {
      const p = this.players.profile(e.profile_id);
      return p ? [{ profile: PlayerDb.summary(p), teamId: e.team_id, joinedRound: e.joined_round }] : [];
    });
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      settings: JSON.parse(row.settings) as SeasonSettings,
      rounds: this.q.rounds.all(id).map((r) => ({ round: r.round, trackId: r.track_id, sprint: r.sprint === 1 })),
      teams: this.q.teams.all(id).map((t) => ({ id: t.id, name: t.name, primary: t.primary_color, secondary: t.secondary_color })),
      entries,
      results: this.q.results.all(id).map((r) => ({
        round: r.round,
        session: r.session,
        profileId: r.profile_id,
        teamId: r.team_id,
        position: r.position,
        dnf: r.dnf === 1,
        bestLapMs: r.best_lap_ms,
        points: r.points,
        fastestLap: r.fastest_lap === 1,
      })),
      next: row.next_round !== null && row.next_session ? { round: row.next_round, session: row.next_session } : null,
      championId: row.champion_profile_id,
    };
  }

  addEntry(id: number, profileId: number, joinedRound: number): void {
    this.q.insertEntry.run(id, profileId, joinedRound);
  }

  setTeam(id: number, profileId: number, teamId: number | null): void {
    this.q.setTeam.run(teamId, id, profileId);
  }

  createTeam(id: number, name: string, primary: number, secondary: number): SeasonTeam {
    const teamId = Number(this.q.insertTeam.run(id, name, primary, secondary).lastInsertRowid);
    return { id: teamId, name, primary, secondary };
  }

  start(id: number): void {
    this.q.start.run(id);
  }

  writeSession(
    id: number,
    round: number,
    session: ResultSession,
    rows: SeasonResult[],
    career: RaceInput | null,
    next: { round: number; session: ResultSession } | null,
    championId: number | null,
    now: number,
  ): void {
    const season = this.q.get.get(id);
    this.players.db.transaction(() => {
      for (const r of rows) {
        this.q.insertResult.run(id, round, session, r.profileId, r.teamId, r.position, r.dnf ? 1 : 0, r.bestLapMs, r.points, r.fastestLap ? 1 : 0);
      }
      if (career) this.players.recordRace({ ...career, championshipId: id });
      if (next) this.q.advance.run(next.round, next.session, id);
      else {
        this.q.finish.run(championId, now, id);
        if (championId !== null && season) this.players.addChampionshipTitle(championId, season.name, now);
      }
    })();
  }
}
