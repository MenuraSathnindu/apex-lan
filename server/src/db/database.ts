import { createHash, randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import {
  type CareerStats,
  type HallOfFameEntry,
  type HeadToHead,
  type Livery,
  type ProfilePage,
  type ProfileSummary,
  type TrackRecord,
} from '@apex/shared';
import { MIGRATIONS } from './migrations.ts';

/** URL path photos are served from (see http/api.ts). */
export const PHOTO_URL = '/photos/';

// --- Row types (what SQLite returns) -------------------------------------------

interface ProfileRow {
  id: number;
  name: string;
  name_key: string;
  tag: string;
  livery: string;
  pin_hash: string;
  photo: string | null;
  created_at: number;
  updated_at: number;
}

export interface Profile extends ProfileSummary {
  pinHash: string;
  photoFile: string | null;
}

/** One starter's result, as the room hands it over at the end of a race. */
export interface ResultInput {
  profileId: number | null;
  position: number;
  grid: number | null;
  dnf: boolean;
  laps: number;
  totalMs: number | null;
  bestLapMs: number | null;
  fastestLap: boolean;
  pole: boolean;
  points: number;
}

export interface LapInput {
  profileId: number;
  lap: number;
  timeMs: number;
  sectors: (number | null)[] | null;
  /** False for a lap with a respawn: it was driven, but it's never a best. Default true. */
  valid?: boolean;
}

export interface RaceInput {
  trackId: string;
  /** 'qualifying' rows only carry laps (no results); only 'race' rows count as races in the stats. */
  kind: 'race' | 'sprint' | 'qualifying';
  /** Set for sessions of a championship. */
  championshipId?: number;
  laps: number;
  finishedAt: number;
  results: ResultInput[];
  lapTimes: LapInput[];
}

const nameKey = (name: string) => name.trim().toLowerCase();
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * The host's player database (SQLite, one file). All queries are prepared once and typed.
 * Career stats are computed from the raw race / lap rows, so they can never drift.
 */
export class PlayerDb {
  readonly db: Database.Database;
  private readonly q;

  /** `file` = path of the database, or ':memory:' (tests). */
  constructor(file: string) {
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
    const db = this.db;
    this.q = {
      profileById: db.prepare<[number], ProfileRow>('SELECT * FROM profile WHERE id = ?'),
      profileByName: db.prepare<[string], ProfileRow>('SELECT * FROM profile WHERE name_key = ?'),
      allProfiles: db.prepare<[], ProfileRow>('SELECT * FROM profile ORDER BY name_key'),
      insertProfile: db.prepare<[string, string, string, string, string, number, number]>(
        'INSERT INTO profile (name, name_key, tag, livery, pin_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ),
      updateTag: db.prepare<[string, number, number]>('UPDATE profile SET tag = ?, updated_at = ? WHERE id = ?'),
      updateLivery: db.prepare<[string, number, number]>('UPDATE profile SET livery = ?, updated_at = ? WHERE id = ?'),
      updatePhoto: db.prepare<[string | null, number, number]>('UPDATE profile SET photo = ?, updated_at = ? WHERE id = ?'),
      insertToken: db.prepare<[string, number, number, number]>('INSERT INTO login_token (token_hash, profile_id, created_at, last_used) VALUES (?, ?, ?, ?)'),
      tokenProfile: db.prepare<[string], { profile_id: number }>('SELECT profile_id FROM login_token WHERE token_hash = ?'),
      touchToken: db.prepare<[number, string]>('UPDATE login_token SET last_used = ? WHERE token_hash = ?'),
      deleteToken: db.prepare<[string]>('DELETE FROM login_token WHERE token_hash = ?'),
      insertRace: db.prepare<[string, string, number, number, number, number | null]>(
        'INSERT INTO race (track_id, kind, laps, starters, finished_at, championship_id) VALUES (?, ?, ?, ?, ?, ?)',
      ),
      insertResult: db.prepare<[number, number, number | null, number | null, number, number, number | null, number | null, number, number, number]>(
        `INSERT INTO race_result (race_id, position, profile_id, grid, dnf, laps, total_ms, best_lap_ms, fastest_lap, pole, points)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      insertLap: db.prepare<[number, number, string, number, number, number | null, number | null, number | null, number, number]>(
        'INSERT INTO lap (race_id, profile_id, track_id, lap, time_ms, s1_ms, s2_ms, s3_ms, set_at, valid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ),
      stats: db.prepare<[number], Omit<CareerStats, 'championships' | 'laps'>>(
        // Only races count as races / wins / podiums; sprints add their points.
        `SELECT
           COALESCE(SUM(r.kind = 'race' AND r.starters >= 2), 0)                                    AS races,
           COALESCE(SUM(r.kind = 'race' AND r.starters < 2), 0)                                     AS practice,
           COALESCE(SUM(r.kind = 'race' AND r.starters >= 2 AND rr.position = 1 AND rr.dnf = 0), 0)  AS wins,
           COALESCE(SUM(r.kind = 'race' AND r.starters >= 2 AND rr.position <= 3 AND rr.dnf = 0), 0) AS podiums,
           COALESCE(SUM(r.kind = 'race' AND rr.pole), 0)                                            AS poles,
           COALESCE(SUM(r.kind = 'race' AND r.starters >= 2 AND rr.fastest_lap = 1), 0)             AS fastestLaps,
           COALESCE(SUM(r.kind = 'race' AND rr.dnf), 0)                                             AS dnfs,
           COALESCE(SUM(rr.points), 0)                                                              AS points
         FROM race_result rr JOIN race r ON r.id = rr.race_id
         WHERE rr.profile_id = ?`,
      ),
      titles: db.prepare<[number], { n: number }>('SELECT COUNT(*) AS n FROM championship_title WHERE profile_id = ?'),
      lapCount: db.prepare<[number], { n: number }>('SELECT COUNT(*) AS n FROM lap WHERE profile_id = ?'),
      trackRecords: db.prepare<
        [number],
        { track_id: string; best: number; s1: number | null; s2: number | null; s3: number | null; laps: number }
      >(
        `SELECT track_id, MIN(time_ms) AS best, MIN(s1_ms) AS s1, MIN(s2_ms) AS s2, MIN(s3_ms) AS s3, COUNT(*) AS laps
         FROM lap WHERE profile_id = ? AND valid = 1 GROUP BY track_id ORDER BY track_id`,
      ),
      bestLapOf: db.prepare<[number, string], { s1_ms: number | null; s2_ms: number | null; s3_ms: number | null; set_at: number }>(
        'SELECT s1_ms, s2_ms, s3_ms, set_at FROM lap WHERE profile_id = ? AND track_id = ? AND valid = 1 ORDER BY time_ms, set_at LIMIT 1',
      ),
      headToHead: db.prepare<[number, number], { opponent: number; ahead: number; behind: number }>(
        `SELECT other.profile_id AS opponent,
                SUM(me.position < other.position) AS ahead,
                SUM(me.position > other.position) AS behind
         FROM race_result me
         JOIN race_result other ON other.race_id = me.race_id AND other.profile_id IS NOT NULL AND other.profile_id != ?
         WHERE me.profile_id = ?
         GROUP BY other.profile_id
         ORDER BY (ahead + behind) DESC`,
      ),
      hallOfFame: db.prepare<
        [string, number],
        { profile_id: number; time_ms: number; s1_ms: number | null; s2_ms: number | null; s3_ms: number | null; set_at: number }
      >(
        // Each driver's fastest lap on the track (earliest wins a tie).
        `SELECT l.profile_id, l.time_ms, l.s1_ms, l.s2_ms, l.s3_ms, l.set_at
         FROM lap l
         WHERE l.track_id = ? AND l.valid = 1 AND NOT EXISTS (
           SELECT 1 FROM lap b WHERE b.track_id = l.track_id AND b.profile_id = l.profile_id AND b.valid = 1
             AND (b.time_ms < l.time_ms OR (b.time_ms = l.time_ms AND b.set_at < l.set_at)))
         ORDER BY l.time_ms, l.set_at
         LIMIT ?`,
      ),
      trackIds: db.prepare<[], { track_id: string }>('SELECT DISTINCT track_id FROM lap WHERE valid = 1 ORDER BY track_id'),
      addTitle: db.prepare<[number, string, number]>('INSERT INTO championship_title (profile_id, name, won_at) VALUES (?, ?, ?)'),
    };
  }

  private migrate() {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)');
    const done = new Set(this.db.prepare<[], { version: number }>('SELECT version FROM schema_migrations').all().map((r) => r.version));
    for (const m of MIGRATIONS) {
      if (done.has(m.version)) continue;
      this.db.transaction(() => {
        this.db.exec(m.sql);
        this.db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, Date.now());
      })();
    }
  }

  get schemaVersion(): number {
    return this.db.prepare<[], { v: number | null }>('SELECT MAX(version) AS v FROM schema_migrations').get()!.v ?? 0;
  }

  close(): void {
    this.db.close();
  }

  // --- Profiles ----------------------------------------------------------------

  private toProfile(row: ProfileRow): Profile {
    return {
      id: row.id,
      name: row.name,
      tag: row.tag,
      livery: JSON.parse(row.livery) as Livery,
      photo: row.photo ? PHOTO_URL + row.photo : null,
      pinHash: row.pin_hash,
      photoFile: row.photo,
    };
  }

  static summary(p: Profile): ProfileSummary {
    return { id: p.id, name: p.name, tag: p.tag, livery: p.livery, photo: p.photo };
  }

  profile(id: number): Profile | null {
    const row = this.q.profileById.get(id);
    return row ? this.toProfile(row) : null;
  }

  profileByName(name: string): Profile | null {
    const row = this.q.profileByName.get(nameKey(name));
    return row ? this.toProfile(row) : null;
  }

  profiles(): ProfileSummary[] {
    return this.q.allProfiles.all().map((r) => PlayerDb.summary(this.toProfile(r)));
  }

  /** Throws 'name taken' if another profile has the same name (case-insensitive). */
  createProfile(name: string, tag: string, livery: Livery, pinHash: string, now = Date.now()): Profile {
    if (this.q.profileByName.get(nameKey(name))) throw new Error('name taken');
    const { lastInsertRowid } = this.q.insertProfile.run(name.trim(), nameKey(name), tag, JSON.stringify(livery), pinHash, now, now);
    return this.profile(Number(lastInsertRowid))!;
  }

  setTag(id: number, tag: string, now = Date.now()): void {
    this.q.updateTag.run(tag, now, id);
  }

  setLivery(id: number, livery: Livery, now = Date.now()): void {
    this.q.updateLivery.run(JSON.stringify(livery), now, id);
  }

  /** Returns the previous photo file name (so the caller can delete it). */
  setPhoto(id: number, file: string | null, now = Date.now()): string | null {
    const old = this.q.profileById.get(id)?.photo ?? null;
    this.q.updatePhoto.run(file, now, id);
    return old;
  }

  // --- Login tokens -------------------------------------------------------------

  /** New random login token for a profile (only its hash is stored). */
  issueToken(profileId: number, now = Date.now()): string {
    const token = randomBytes(24).toString('base64url');
    this.q.insertToken.run(hashToken(token), profileId, now, now);
    return token;
  }

  /** The profile a token belongs to, or null. */
  profileForToken(token: string, now = Date.now()): Profile | null {
    if (typeof token !== 'string' || token.length < 16 || token.length > 128) return null;
    const h = hashToken(token);
    const row = this.q.tokenProfile.get(h);
    if (!row) return null;
    this.q.touchToken.run(now, h);
    return this.profile(row.profile_id);
  }

  revokeToken(token: string): void {
    this.q.deleteToken.run(hashToken(token));
  }

  // --- Races --------------------------------------------------------------------

  /** Stores a finished race (all starters + every lap of profiled drivers) in one transaction. */
  recordRace(race: RaceInput): number {
    return this.db.transaction(() => {
      const raceId = Number(
        this.q.insertRace.run(race.trackId, race.kind, race.laps, race.results.length, race.finishedAt, race.championshipId ?? null).lastInsertRowid,
      );
      for (const r of race.results) {
        this.q.insertResult.run(
          raceId,
          r.position,
          r.profileId,
          r.grid,
          r.dnf ? 1 : 0,
          r.laps,
          r.totalMs,
          r.bestLapMs,
          r.fastestLap ? 1 : 0,
          r.pole ? 1 : 0,
          r.points,
        );
      }
      for (const l of race.lapTimes) {
        const s = l.sectors ?? [];
        this.q.insertLap.run(raceId, l.profileId, race.trackId, l.lap, l.timeMs, s[0] ?? null, s[1] ?? null, s[2] ?? null, race.finishedAt, l.valid === false ? 0 : 1);
      }
      return raceId;
    })();
  }

  addChampionshipTitle(profileId: number, name: string, now = Date.now()): void {
    this.q.addTitle.run(profileId, name, now);
  }

  // --- Stats ----------------------------------------------------------------------

  stats(profileId: number): CareerStats {
    const s = this.q.stats.get(profileId)!;
    return { ...s, championships: this.q.titles.get(profileId)!.n, laps: this.q.lapCount.get(profileId)!.n };
  }

  trackRecords(profileId: number): TrackRecord[] {
    return this.q.trackRecords.all(profileId).map((r) => {
      const best = this.q.bestLapOf.get(profileId, r.track_id)!;
      return {
        trackId: r.track_id,
        bestLapMs: r.best,
        bestLapSectors: [best.s1_ms, best.s2_ms, best.s3_ms],
        bestSectors: [r.s1, r.s2, r.s3],
        laps: r.laps,
        setAt: best.set_at,
      };
    });
  }

  headToHead(profileId: number): HeadToHead[] {
    return this.q.headToHead.all(profileId, profileId).flatMap((r) => {
      const opponent = this.profile(r.opponent);
      return opponent ? [{ opponent: PlayerDb.summary(opponent), ahead: r.ahead, behind: r.behind }] : [];
    });
  }

  profilePage(profileId: number): ProfilePage | null {
    const p = this.profile(profileId);
    if (!p) return null;
    return { profile: PlayerDb.summary(p), stats: this.stats(profileId), tracks: this.trackRecords(profileId), headToHead: this.headToHead(profileId) };
  }

  /** Each driver's best lap on a track, fastest first. */
  hallOfFame(trackId: string, limit = 50): HallOfFameEntry[] {
    return this.q.hallOfFame.all(trackId, limit).flatMap((r, i) => {
      const p = this.profile(r.profile_id);
      return p ? [{ rank: i + 1, profile: PlayerDb.summary(p), lapMs: r.time_ms, sectors: [r.s1_ms, r.s2_ms, r.s3_ms], setAt: r.set_at }] : [];
    });
  }

  /** Tracks that have at least one recorded lap. */
  tracksWithLaps(): string[] {
    return this.q.trackIds.all().map((r) => r.track_id);
  }
}
