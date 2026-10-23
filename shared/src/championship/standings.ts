import type { ProfileSummary } from '../protocol/api.ts';
import type { ChampionshipView, ResultSession, SeasonResult, SeasonRound, SeasonTeam } from './types.ts';

/** The sessions of a weekend, in order. */
export function sessionsOf(round: SeasonRound): ResultSession[] {
  return round.sprint ? ['qualifying', 'sprint', 'race'] : ['qualifying', 'race'];
}

/** The session after `done`, or null after the last race of the season. */
export function nextAfter(view: Pick<ChampionshipView, 'rounds'>, done: { round: number; session: ResultSession }): { round: number; session: ResultSession } | null {
  const idx = view.rounds.findIndex((r) => r.round === done.round);
  const round = view.rounds[idx];
  if (!round) return null;
  const sessions = sessionsOf(round);
  const at = sessions.indexOf(done.session);
  if (at >= 0 && at < sessions.length - 1) return { round: round.round, session: sessions[at + 1]! };
  const following = view.rounds[idx + 1];
  return following ? { round: following.round, session: 'qualifying' } : null;
}

export interface DriverStanding {
  profile: ProfileSummary;
  teamId: number | null;
  points: number;
  position: number;
  perRound: { round: number; race: SeasonResult | null; sprint: SeasonResult | null }[];
}

export interface TeamStanding {
  team: SeasonTeam;
  points: number;
  position: number;
  perRound: { round: number; points: number }[];
}

/** Countback key: how many times each position was reached (finishes only), compared best-first. */
function countback(results: SeasonResult[], session: ResultSession): number[] {
  const counts: number[] = [];
  for (const r of results) if (r.session === session && !r.dnf) counts[r.position - 1] = (counts[r.position - 1] ?? 0) + 1;
  return counts;
}

function compareCounts(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (b[i] ?? 0) - (a[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/**
 * Drivers' and teams' standings from the season's result rows. Ties: race countback (wins, then
 * 2nds, …), then sprint countback, then entry order. Team points are the points their drivers
 * scored while in that team.
 */
export function computeStandings(view: ChampionshipView): { drivers: DriverStanding[]; teams: TeamStanding[] } {
  const entered = new Set(view.entries.map((e) => e.profile.id));
  const results = view.results.filter((r) => entered.has(r.profileId));

  const drivers = view.entries.map((e, order) => {
    const own = results.filter((r) => r.profileId === e.profile.id);
    return {
      order,
      raceCb: countback(own, 'race'),
      sprintCb: countback(own, 'sprint'),
      standing: {
        profile: e.profile,
        teamId: e.teamId,
        points: own.reduce((a, r) => a + r.points, 0),
        position: 0,
        perRound: view.rounds.map((round) => ({
          round: round.round,
          race: own.find((r) => r.round === round.round && r.session === 'race') ?? null,
          sprint: own.find((r) => r.round === round.round && r.session === 'sprint') ?? null,
        })),
      } as DriverStanding,
    };
  });
  drivers.sort((a, b) => b.standing.points - a.standing.points || compareCounts(a.raceCb, b.raceCb) || compareCounts(a.sprintCb, b.sprintCb) || a.order - b.order);
  drivers.forEach((d, i) => (d.standing.position = i + 1));

  // Teams with at least one driver or one scored row.
  const teams = view.teams
    .map((team, order) => {
      const own = results.filter((r) => r.teamId === team.id);
      return {
        order,
        raceCb: countback(own, 'race'),
        standing: {
          team,
          points: own.reduce((a, r) => a + r.points, 0),
          position: 0,
          perRound: view.rounds.map((round) => ({ round: round.round, points: own.filter((r) => r.round === round.round).reduce((a, r) => a + r.points, 0) })),
        } as TeamStanding,
      };
    })
    .filter((t) => view.entries.some((e) => e.teamId === t.standing.team.id) || t.standing.points > 0);
  teams.sort((a, b) => b.standing.points - a.standing.points || compareCounts(a.raceCb, b.raceCb) || a.order - b.order);
  teams.forEach((t, i) => (t.standing.position = i + 1));

  return { drivers: drivers.map((d) => d.standing), teams: teams.map((t) => t.standing) };
}
