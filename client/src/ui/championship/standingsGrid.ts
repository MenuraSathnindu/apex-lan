import { computeStandings, type ChampionshipView, type SeasonResult } from '@apex/shared';
import { avatarHtml, esc } from '../avatar.ts';

export type CellClass = 'gold' | 'silver' | 'bronze' | 'points' | 'finished' | 'dnf' | 'absent';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** Colour of a results-grid cell: podium, points, finished, retired, or absent. */
export function cellClass(r: SeasonResult | null): CellClass {
  if (!r) return 'absent';
  if (r.dnf) return 'dnf';
  if (r.position === 1) return 'gold';
  if (r.position === 2) return 'silver';
  if (r.position === 3) return 'bronze';
  return r.points > 0 ? 'points' : 'finished';
}

/** Three-letter column heading for a round's track. */
const shortName = (name: string) => name.normalize('NFKD').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();

/**
 * Drivers' standings with a per-round results grid: race position in the cell (colour-coded),
 * sprint position as a superscript, ⏱ for the fastest lap, total points at the end.
 */
export function driversGridHtml(view: ChampionshipView, trackName: (id: string) => string): string {
  const { drivers } = computeStandings(view);
  const team = (id: number | null) => view.teams.find((t) => t.id === id);
  const head = view.rounds
    .map((r) => `<th class="cg-round" title="Round ${r.round}: ${esc(trackName(r.trackId))}${r.sprint ? ' (sprint)' : ''}">${esc(shortName(trackName(r.trackId)))}</th>`)
    .join('');
  const rows = drivers
    .map((d) => {
      const t = team(d.teamId);
      const cells = d.perRound
        .map(({ race, sprint }) => {
          const label = race ? (race.dnf ? 'Ret' : String(race.position)) : '';
          const sup = sprint ? `<sup title="Sprint">${sprint.dnf ? 'R' : sprint.position}</sup>` : '';
          const fl = race?.fastestLap ? '<span class="cg-fl" title="Fastest lap">⏱</span>' : '';
          return `<td class="cg-cell ${cellClass(race)}">${label}${sup}${fl}</td>`;
        })
        .join('');
      return `<tr>
        <td class="cg-pos">${d.position}</td>
        <td class="cg-driver">${avatarHtml({ ...d.profile, color: d.profile.livery.primary }, 24)}
          <b>${esc(d.profile.tag)}</b> ${esc(d.profile.name)}
          ${t ? `<span class="cg-team" style="--c:${hex(t.primary)}">${esc(t.name)}</span>` : ''}</td>
        ${cells}
        <td class="cg-points">${d.points}</td></tr>`;
    })
    .join('');
  return `<div class="cg-wrap"><table class="cg-table">
    <thead><tr><th>#</th><th>Driver</th>${head}<th>Pts</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="${view.rounds.length + 3}" class="cg-empty">No drivers entered yet.</td></tr>`}</tbody></table></div>`;
}

/** Teams' standings: points per round and total. */
export function teamsGridHtml(view: ChampionshipView, trackName: (id: string) => string): string {
  const { teams } = computeStandings(view);
  if (!teams.length) return '<p class="pf-note">No teams yet. Drivers can form teams of two under "Entries & teams".</p>';
  const head = view.rounds.map((r) => `<th class="cg-round" title="Round ${r.round}: ${esc(trackName(r.trackId))}">${esc(shortName(trackName(r.trackId)))}</th>`).join('');
  const rows = teams
    .map((t) => {
      const drivers = view.entries.filter((e) => e.teamId === t.team.id).map((e) => esc(e.profile.tag));
      const cells = t.perRound.map((p) => `<td class="cg-cell ${p.points > 0 ? 'points' : 'finished'}">${p.points || ''}</td>`).join('');
      return `<tr><td class="cg-pos">${t.position}</td>
        <td class="cg-driver"><span class="cg-swatch" style="--c:${hex(t.team.primary)};--c2:${hex(t.team.secondary)}"></span>
          <b>${esc(t.team.name)}</b> <small>${drivers.join(' · ')}</small></td>
        ${cells}<td class="cg-points">${t.points}</td></tr>`;
    })
    .join('');
  return `<div class="cg-wrap"><table class="cg-table"><thead><tr><th>#</th><th>Team</th>${head}<th>Pts</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
