import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { presetLivery, type SeasonDraft, type SeasonResult } from '@apex/shared';
import { ChampionshipDb } from './championships.ts';
import { PlayerDb } from './database.ts';
import { MIGRATIONS } from './migrations.ts';

const draft: SeasonDraft = {
  name: 'Autumn cup',
  settings: { laps: 3, qualifying: { mode: 'oneShot' }, fastestLapPoint: true, tyreWear: true },
  rounds: [
    { trackId: 'monza', sprint: true },
    { trackId: 'spa', sprint: false },
  ],
};

function setup() {
  const players = new PlayerDb(':memory:');
  const ann = players.createProfile('Ann', 'ANN', presetLivery(0), 'h').id;
  const ben = players.createProfile('Ben', 'BEN', presetLivery(1), 'h').id;
  return { players, champs: new ChampionshipDb(players), ann, ben };
}
const row = (profileId: number, round: number, session: SeasonResult['session'], position: number, points: number, teamId: number | null = null): SeasonResult => ({
  round,
  session,
  profileId,
  teamId,
  position,
  dnf: false,
  bestLapMs: 80_000,
  points,
  fastestLap: false,
});

describe('migration 2', () => {
  it('upgrades a version-1 database and keeps old laps as valid', () => {
    const dir = mkdtempSync(join(tmpdir(), 'apex-db-'));
    const file = join(dir, 'v1.sqlite');
    const raw = new Database(file);
    raw.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)');
    raw.exec(MIGRATIONS[0]!.sql);
    raw.prepare('INSERT INTO schema_migrations VALUES (1, ?, 0)').run(MIGRATIONS[0]!.name);
    raw.prepare("INSERT INTO profile (name, name_key, tag, livery, pin_hash, created_at, updated_at) VALUES ('Ann', 'ann', 'ANN', ?, 'h', 0, 0)").run(JSON.stringify(presetLivery(0)));
    raw.prepare("INSERT INTO race (track_id, laps, starters, finished_at) VALUES ('monza', 1, 1, 0)").run();
    raw.prepare("INSERT INTO lap (race_id, profile_id, track_id, lap, time_ms, set_at) VALUES (1, 1, 'monza', 1, 80000, 0)").run();
    raw.close();
    const db = new PlayerDb(file);
    expect(db.schemaVersion).toBe(2);
    expect(db.hallOfFame('monza')).toHaveLength(1);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('ChampionshipDb', () => {
  it('creates a season in setup and lists it', () => {
    const { champs } = setup();
    const v = champs.create(draft, 1000);
    expect(v).toMatchObject({ name: 'Autumn cup', status: 'setup', settings: draft.settings, next: null, championId: null });
    expect(v.rounds).toEqual([
      { round: 1, trackId: 'monza', sprint: true },
      { round: 2, trackId: 'spa', sprint: false },
    ]);
    expect(champs.list()).toEqual([expect.objectContaining({ id: v.id, status: 'setup', rounds: 2 })]);
    expect(champs.view(424242)).toBeNull();
  });

  it('keeps entries and teams', () => {
    const { champs, ann, ben } = setup();
    const id = champs.create(draft, 0).id;
    const red = champs.createTeam(id, 'Red', 0xff0000, 0xffffff);
    champs.addEntry(id, ann, 1);
    champs.addEntry(id, ben, 2);
    champs.setTeam(id, ann, red.id);
    const v = champs.view(id)!;
    expect(v.teams).toEqual([red]);
    expect(v.entries.map((e) => [e.profile.name, e.teamId, e.joinedRound])).toEqual([
      ['Ann', red.id, 1],
      ['Ben', null, 2],
    ]);
  });

  it('starts at round 1 qualifying and advances only when a session is written', () => {
    const { champs, ann } = setup();
    const id = champs.create(draft, 0).id;
    champs.addEntry(id, ann, 1);
    champs.start(id);
    expect(champs.view(id)).toMatchObject({ status: 'active', next: { round: 1, session: 'qualifying' } });
    champs.writeSession(id, 1, 'qualifying', [row(ann, 1, 'qualifying', 1, 0)], null, { round: 1, session: 'sprint' }, null, 5);
    expect(champs.view(id)!.next).toEqual({ round: 1, session: 'sprint' });
    expect(champs.view(id)!.results).toHaveLength(1);
  });

  it('writes nothing and keeps the pointer when the write fails', () => {
    const { champs, ann } = setup();
    const id = champs.create(draft, 0).id;
    champs.addEntry(id, ann, 1);
    champs.start(id);
    expect(() => champs.writeSession(id, 1, 'qualifying', [row(ann, 1, 'qualifying', 1, 0), row(ann, 1, 'qualifying', 2, 0)], null, { round: 1, session: 'sprint' }, null, 5)).toThrow();
    expect(champs.view(id)).toMatchObject({ next: { round: 1, session: 'qualifying' }, results: [] });
  });

  it('finishes the season: champion, title on the career, sprint and race in career stats', () => {
    const { champs, players, ann, ben } = setup();
    const id = champs.create(draft, 0).id;
    champs.addEntry(id, ann, 1);
    champs.addEntry(id, ben, 1);
    champs.start(id);
    const career = (kind: 'race' | 'sprint') => ({
      trackId: 'spa',
      kind,
      laps: 3,
      finishedAt: 9,
      championshipId: id,
      results: [
        { profileId: ann, position: 1, grid: 1, dnf: false, laps: 3, totalMs: 1, bestLapMs: 1, fastestLap: false, pole: kind === 'race', points: kind === 'race' ? 25 : 8 },
        { profileId: ben, position: 2, grid: 2, dnf: false, laps: 3, totalMs: 2, bestLapMs: 2, fastestLap: false, pole: false, points: kind === 'race' ? 18 : 7 },
      ],
      lapTimes: [{ profileId: ann, lap: 1, timeMs: 70_000, sectors: null, valid: false }],
    });
    champs.writeSession(id, 1, 'sprint', [row(ann, 1, 'sprint', 1, 8), row(ben, 1, 'sprint', 2, 7)], career('sprint'), { round: 1, session: 'race' }, null, 9);
    champs.writeSession(id, 2, 'race', [row(ann, 2, 'race', 1, 25), row(ben, 2, 'race', 2, 18)], career('race'), null, ann, 10);
    const v = champs.view(id)!;
    expect(v).toMatchObject({ status: 'finished', next: null, championId: ann });
    expect(players.stats(ann)).toMatchObject({ championships: 1, races: 1, wins: 1, poles: 1, points: 33, laps: 2 });
    // The invalid lap counts as a lap driven but never as a best.
    expect(players.hallOfFame('spa')).toEqual([]);
    expect(players.trackRecords(ann)).toEqual([]);
  });
});
