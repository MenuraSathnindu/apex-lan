import { describe, expect, it } from 'vitest';
import { presetLivery, type ChampionshipView, type SeasonResult } from '@apex/shared';
import { finaleSummary } from './finale.ts';

const p = (id: number, name: string) => ({ id, name, tag: name.slice(0, 3).toUpperCase(), livery: presetLivery(id), photo: null });
const res = (round: number, profileId: number, position: number, points: number, teamId: number | null): SeasonResult => ({
  round,
  session: 'race',
  profileId,
  teamId,
  position,
  dnf: false,
  bestLapMs: null,
  points,
  fastestLap: false,
});

describe('finale summary', () => {
  it('names the champion with points and wins, the top three, and the team champion', () => {
    const view: ChampionshipView = {
      id: 1,
      name: 'Cup',
      status: 'finished',
      settings: { laps: 3, qualifying: { mode: 'oneShot' }, fastestLapPoint: false, tyreWear: true },
      rounds: [
        { round: 1, trackId: 'monza', sprint: false },
        { round: 2, trackId: 'spa', sprint: false },
      ],
      teams: [
        { id: 1, name: 'Red', primary: 0xff0000, secondary: 0xffffff },
        { id: 2, name: 'Blue', primary: 0x0000ff, secondary: 0xffffff },
      ],
      entries: [
        { profile: p(1, 'Ann'), teamId: 1, joinedRound: 1 },
        { profile: p(2, 'Ben'), teamId: 2, joinedRound: 1 },
        { profile: p(3, 'Cat'), teamId: 2, joinedRound: 1 },
        { profile: p(4, 'Dee'), teamId: null, joinedRound: 1 },
      ],
      results: [res(1, 1, 1, 25, 1), res(1, 2, 2, 18, 2), res(1, 3, 3, 15, 2), res(2, 1, 1, 25, 1), res(2, 3, 2, 18, 2), res(2, 2, 3, 15, 2)],
      next: null,
      championId: 1,
    };
    const s = finaleSummary(view);
    expect(s.champion).toMatchObject({ profile: { name: 'Ann' }, points: 50, wins: 2, team: { name: 'Red' } });
    expect(s.podium.map((d) => d.profile.name)).toEqual(['Ann', 'Ben', 'Cat']);
    expect(s.teamChampion).toMatchObject({ team: { name: 'Blue' }, points: 66 });
  });

  it('celebrates the stored champion even if the standings were recomputed differently', () => {
    const view = {
      id: 1,
      name: 'Cup',
      status: 'finished',
      settings: { laps: 3, qualifying: { mode: 'oneShot' }, fastestLapPoint: false, tyreWear: true },
      rounds: [{ round: 1, trackId: 'monza', sprint: false }],
      teams: [],
      entries: [
        { profile: p(1, 'Ann'), teamId: null, joinedRound: 1 },
        { profile: p(2, 'Ben'), teamId: null, joinedRound: 1 },
      ],
      results: [res(1, 2, 1, 25, null), res(1, 1, 2, 18, null)],
      next: null,
      championId: 1,
    } as ChampionshipView;
    expect(finaleSummary(view).champion!.profile.name).toBe('Ann');
  });
});
