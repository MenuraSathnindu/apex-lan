import { describe, expect, it } from 'vitest';
import { presetLivery } from '@apex/shared';
import { PlayerDb, type ResultInput } from './database.ts';
import { MIGRATIONS } from './migrations.ts';

const fresh = () => new PlayerDb(':memory:');
const result = (profileId: number | null, position: number, extra: Partial<ResultInput> = {}): ResultInput => ({
  profileId,
  position,
  grid: position,
  dnf: false,
  laps: 3,
  totalMs: 100_000 + position * 1000,
  bestLapMs: 30_000 + position * 100,
  fastestLap: false,
  pole: false,
  points: 0,
  ...extra,
});

describe('PlayerDb', () => {
  it('applies every migration once', () => {
    const db = fresh();
    expect(db.schemaVersion).toBe(MIGRATIONS.at(-1)!.version);
    // Re-running is a no-op on the same file.
    expect(() => (db as unknown as { migrate(): void }).migrate()).not.toThrow();
  });

  it('creates profiles with unique, case-insensitive names', () => {
    const db = fresh();
    const ann = db.createProfile('Ann', 'ANN', presetLivery(0), 'hash');
    expect(db.profileByName('ANN')!.id).toBe(ann.id);
    expect(() => db.createProfile('ann', 'ANX', presetLivery(1), 'hash')).toThrow('name taken');
    db.setTag(ann.id, 'AAA');
    db.setLivery(ann.id, { ...presetLivery(3), number: 44 });
    expect(db.profile(ann.id)).toMatchObject({ tag: 'AAA', livery: { number: 44 } });
    expect(db.setPhoto(ann.id, 'a.webp')).toBeNull();
    expect(db.setPhoto(ann.id, 'b.webp')).toBe('a.webp');
    expect(db.profile(ann.id)!.photo).toBe('/photos/b.webp');
  });

  it('logs in by token and stores only its hash', () => {
    const db = fresh();
    const ann = db.createProfile('Ann', 'ANN', presetLivery(0), 'hash');
    const token = db.issueToken(ann.id);
    expect(db.profileForToken(token)!.id).toBe(ann.id);
    const stored = db.db.prepare('SELECT token_hash FROM login_token').all() as { token_hash: string }[];
    expect(stored.map((r) => r.token_hash)).not.toContain(token);
    db.revokeToken(token);
    expect(db.profileForToken(token)).toBeNull();
    expect(db.profileForToken('short')).toBeNull();
  });

  it('computes career stats, personal bests, sector bests and head-to-head from raw races', () => {
    const db = fresh();
    const ann = db.createProfile('Ann', 'ANN', presetLivery(0), 'h').id;
    const ben = db.createProfile('Ben', 'BEN', presetLivery(1), 'h').id;
    // Race 1 at Monza: Ann wins (fastest lap), a guest second, Ben third.
    db.recordRace({
      trackId: 'monza',
      kind: 'race',
      laps: 3,
      finishedAt: 1000,
      results: [result(ann, 1, { points: 25, fastestLap: true }), result(null, 2, { points: 18 }), result(ben, 3, { points: 15 })],
      lapTimes: [
        { profileId: ann, lap: 1, timeMs: 82_000, sectors: [30_000, 26_000, 26_000] },
        { profileId: ann, lap: 2, timeMs: 80_000, sectors: [29_000, 25_500, 25_500] },
        { profileId: ben, lap: 1, timeMs: 81_500, sectors: [28_500, 27_000, 26_000] },
      ],
    });
    // Race 2 at Spa: Ben wins, Ann DNF.
    db.recordRace({
      trackId: 'spa',
      kind: 'race',
      laps: 2,
      finishedAt: 2000,
      results: [result(ben, 1, { points: 25 }), result(ann, 2, { dnf: true, totalMs: null })],
      lapTimes: [{ profileId: ben, lap: 1, timeMs: 120_000, sectors: null }],
    });
    // A solo run counts as practice: laps yes, wins no.
    db.recordRace({ trackId: 'monza', kind: 'race', laps: 1, finishedAt: 3000, results: [result(ben, 1)], lapTimes: [{ profileId: ben, lap: 1, timeMs: 79_000, sectors: null }] });
    db.addChampionshipTitle(ann, 'Autumn cup');

    expect(db.stats(ann)).toEqual({ races: 2, practice: 0, wins: 1, podiums: 1, poles: 0, fastestLaps: 1, dnfs: 1, points: 25, championships: 1, laps: 2 });
    expect(db.stats(ben)).toMatchObject({ races: 2, practice: 1, wins: 1, podiums: 2, points: 40, laps: 3 });

    const annMonza = db.trackRecords(ann).find((t) => t.trackId === 'monza')!;
    expect(annMonza).toMatchObject({ bestLapMs: 80_000, bestLapSectors: [29_000, 25_500, 25_500], bestSectors: [29_000, 25_500, 25_500], laps: 2 });
    const benMonza = db.trackRecords(ben).find((t) => t.trackId === 'monza')!;
    // Best lap is the practice one (no sectors), best sectors come from any lap.
    expect(benMonza).toMatchObject({ bestLapMs: 79_000, bestLapSectors: [null, null, null], bestSectors: [28_500, 27_000, 26_000] });

    expect(db.headToHead(ann)).toEqual([{ opponent: expect.objectContaining({ id: ben }), ahead: 1, behind: 1 }]);

    const hof = db.hallOfFame('monza');
    expect(hof.map((e) => [e.rank, e.profile.name, e.lapMs])).toEqual([
      [1, 'Ben', 79_000],
      [2, 'Ann', 80_000],
    ]);
    expect(db.tracksWithLaps()).toEqual(['monza', 'spa']);
    expect(db.profilePage(ann)!.profile.tag).toBe('ANN');
    expect(db.profilePage(999)).toBeNull();
  });

  it('refuses two results for the same profile in one race', () => {
    const db = fresh();
    const ann = db.createProfile('Ann', 'ANN', presetLivery(0), 'h').id;
    expect(() => db.recordRace({ trackId: 'monza', kind: 'race', laps: 1, finishedAt: 1, results: [result(ann, 1), result(ann, 2)], lapTimes: [] })).toThrow();
    // The transaction rolled back: no half-written race.
    expect(db.stats(ann).races).toBe(0);
  });
});
