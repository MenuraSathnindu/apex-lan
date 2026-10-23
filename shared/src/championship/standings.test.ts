import { describe, expect, it } from 'vitest';
import { presetLivery } from '../livery.ts';
import type { ProfileSummary } from '../protocol/api.ts';
import { PRESET_2026, sanitizeSeasonDraft } from './calendar.ts';
import { computeStandings, nextAfter, sessionsOf } from './standings.ts';
import type { ChampionshipView, SeasonResult } from './types.ts';

const profile = (id: number, name: string): ProfileSummary => ({ id, name, tag: name.slice(0, 3).toUpperCase(), livery: presetLivery(id), photo: null });
const settings = { laps: 5, qualifying: { mode: 'timed', minutes: 8 } as const, fastestLapPoint: false, tyreWear: true };

function view(results: SeasonResult[], over: Partial<ChampionshipView> = {}): ChampionshipView {
  return {
    id: 1,
    name: 'Test cup',
    status: 'active',
    settings,
    rounds: [
      { round: 1, trackId: 'monza', sprint: true },
      { round: 2, trackId: 'spa', sprint: false },
      { round: 3, trackId: 'suzuka', sprint: false },
    ],
    teams: [
      { id: 10, name: 'Red', primary: 0xff0000, secondary: 0xffffff },
      { id: 20, name: 'Blue', primary: 0x0000ff, secondary: 0xffffff },
    ],
    entries: [
      { profile: profile(1, 'Ann'), teamId: 10, joinedRound: 1 },
      { profile: profile(2, 'Ben'), teamId: 20, joinedRound: 1 },
      { profile: profile(3, 'Cat'), teamId: null, joinedRound: 2 },
    ],
    results,
    next: { round: 3, session: 'qualifying' },
    championId: null,
    ...over,
  };
}
const res = (round: number, session: SeasonResult['session'], profileId: number, position: number, points: number, teamId: number | null = null, dnf = false): SeasonResult => ({
  round,
  session,
  profileId,
  teamId,
  position,
  dnf,
  bestLapMs: null,
  points,
  fastestLap: false,
});

describe('preset calendar', () => {
  it('has 24 rounds with the six sprint weekends', () => {
    expect(PRESET_2026.label).toBe('Real 2026-style calendar');
    expect(PRESET_2026.rounds).toHaveLength(24);
    expect(PRESET_2026.rounds.filter((r) => r.sprint).map((r) => r.trackId)).toEqual(['shanghai', 'miami', 'montreal', 'silverstone', 'zandvoort', 'singapore']);
    expect(PRESET_2026.rounds[0]!.trackId).toBe('melbourne');
    expect(PRESET_2026.rounds.at(-1)!.trackId).toBe('yas-island');
  });
});

describe('season drafts', () => {
  const known = (id: string) => ['monza', 'spa'].includes(id);
  const good = { name: 'Autumn cup', settings, rounds: [{ trackId: 'monza', sprint: true }] };
  it('accepts a valid draft and trims the name', () => {
    expect(sanitizeSeasonDraft({ ...good, name: '  Autumn cup ' }, known)).toEqual(good);
  });
  it('rejects bad drafts with a reason', () => {
    for (const bad of [
      { ...good, rounds: [] },
      { ...good, rounds: Array.from({ length: 31 }, () => ({ trackId: 'monza', sprint: false })) },
      { ...good, rounds: [{ trackId: 'nowhere', sprint: false }] },
      { ...good, name: '' },
      { ...good, name: 'x'.repeat(41) },
      { ...good, settings: { ...settings, laps: 0 } },
      { ...good, settings: { ...settings, qualifying: { mode: 'timed', minutes: 7 } } },
      null,
    ]) {
      expect(typeof sanitizeSeasonDraft(bad, known)).toBe('string');
    }
  });
});

describe('weekend order', () => {
  it('runs qualifying, sprint if any, race, then the next round', () => {
    const v = view([]);
    expect(sessionsOf(v.rounds[0]!)).toEqual(['qualifying', 'sprint', 'race']);
    expect(sessionsOf(v.rounds[1]!)).toEqual(['qualifying', 'race']);
    expect(nextAfter(v, { round: 1, session: 'qualifying' })).toEqual({ round: 1, session: 'sprint' });
    expect(nextAfter(v, { round: 1, session: 'race' })).toEqual({ round: 2, session: 'qualifying' });
    expect(nextAfter(v, { round: 3, session: 'race' })).toBeNull();
  });
});

describe('standings', () => {
  it('adds sprint and race points; missed rounds are empty and worth 0', () => {
    const s = computeStandings(
      view([
        res(1, 'sprint', 1, 1, 8, 10),
        res(1, 'race', 1, 2, 18, 10),
        res(1, 'race', 2, 1, 25, 20),
        res(2, 'race', 3, 1, 25),
        res(2, 'qualifying', 1, 1, 0, 10),
      ]),
    );
    expect(s.drivers.map((d) => [d.profile.name, d.points, d.position])).toEqual([
      ['Ann', 26, 1],
      ['Ben', 25, 2],
      ['Cat', 25, 3],
    ]);
    const cat = s.drivers.find((d) => d.profile.name === 'Cat')!;
    expect(cat.perRound[0]).toEqual({ round: 1, race: null, sprint: null });
    expect(cat.perRound[1]!.race!.position).toBe(1);
  });

  it('breaks ties by countback: race wins, then 2nds, then sprint results, then entry order', () => {
    const tiedOnWins = computeStandings(view([res(1, 'race', 2, 1, 25), res(2, 'race', 1, 2, 18), res(2, 'race', 1, 1, 7)]));
    // Ann 25 (one P1 + one P2), Ben 25 (one P1): equal wins, Ann has a 2nd.
    expect(tiedOnWins.drivers.slice(0, 2).map((d) => d.profile.name)).toEqual(['Ann', 'Ben']);

    const sprintDecides = computeStandings(view([res(1, 'race', 1, 3, 15), res(2, 'race', 2, 3, 15), res(1, 'sprint', 2, 1, 0)]));
    expect(sprintDecides.drivers[0]!.profile.name).toBe('Ben');

    const fullyTied = computeStandings(view([res(1, 'race', 2, 5, 10), res(2, 'race', 1, 5, 10)]));
    expect(fullyTied.drivers.slice(0, 2).map((d) => d.profile.name)).toEqual(['Ann', 'Ben']);
  });

  it('team points stay with the team a driver drove for, teamless drivers are not in the teams table', () => {
    const s = computeStandings(
      view([res(1, 'race', 1, 1, 25, 10), res(2, 'race', 1, 1, 25, 20), res(2, 'race', 2, 2, 18, 20), res(2, 'race', 3, 3, 15)]),
    );
    expect(s.teams.map((t) => [t.team.name, t.points])).toEqual([
      ['Blue', 43],
      ['Red', 25],
    ]);
    expect(s.teams[0]!.perRound).toEqual([
      { round: 1, points: 0 },
      { round: 2, points: 43 },
      { round: 3, points: 0 },
    ]);
  });

  it('ignores results of profiles that are not entered (e.g. deleted)', () => {
    const s = computeStandings(view([res(1, 'race', 99, 1, 25)]));
    expect(s.drivers.map((d) => d.points)).toEqual([0, 0, 0]);
  });
});
