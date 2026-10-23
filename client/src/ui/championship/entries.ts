import { CHAMPIONSHIP, type C2S, type ChampionshipView, type PlayerInfo } from '@apex/shared';
import { avatarHtml, esc } from '../avatar.ts';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export interface EntriesContext {
  view: ChampionshipView;
  isHost: boolean;
  /** Profile id this player is logged in as (null = guest). */
  myProfileId: number | null;
  /** Players in the room (for the host's "add driver"). */
  players: PlayerInfo[];
  send: (msg: C2S) => void;
}

/** Entries & teams tab: enter, add drivers (host), create / join / leave teams, move drivers (host). */
export function renderEntries(root: HTMLElement, ctx: EntriesContext): void {
  const { view, isHost, myProfileId } = ctx;
  const mine = view.entries.find((e) => e.profile.id === myProfileId);
  const locked = view.status !== 'setup';
  const canPickTeam = !!mine && (!locked || mine.teamId === null) && view.status !== 'finished';
  const addable = ctx.players.filter((p) => p.connected && p.profileId !== null && !view.entries.some((e) => e.profile.id === p.profileId));
  const members = (teamId: number) => view.entries.filter((e) => e.teamId === teamId);

  root.innerHTML = `
    <div class="ch-entries">
      <section>
        <h3>Drivers (${view.entries.length})</h3>
        ${
          view.status === 'finished'
            ? ''
            : myProfileId === null
              ? '<p class="pf-note">Log in to a profile (lobby → 👤) to enter.</p>'
              : mine
                ? `<p class="pf-note">You're entered${mine.joinedRound > 1 ? ` from round ${mine.joinedRound}` : ''}.</p>`
                : '<button type="button" class="pf-primary ch-enter">Enter the championship</button>'
        }
        ${
          isHost && addable.length && view.status !== 'finished'
            ? `<div class="ch-add"><select class="ch-add-driver">${addable.map((p) => `<option value="${p.profileId}">${esc(p.name)}</option>`).join('')}</select>
               <button type="button" class="ch-add-driver-btn">Add driver</button></div>`
            : ''
        }
        <ul class="ch-list">${view.entries
          .map(
            (e) => `<li>${avatarHtml({ ...e.profile, color: e.profile.livery.primary }, 24)} <b>${esc(e.profile.tag)}</b> ${esc(e.profile.name)}
              ${e.joinedRound > 1 ? `<small>from R${e.joinedRound}</small>` : ''}
              ${
                isHost && view.status !== 'finished'
                  ? `<select class="ch-move" data-profile="${e.profile.id}" title="Team (host)"><option value="">No team</option>${view.teams
                      .map((t) => `<option value="${t.id}" ${t.id === e.teamId ? 'selected' : ''}>${esc(t.name)}</option>`)
                      .join('')}</select>`
                  : ''
              }</li>`,
          )
          .join('')}</ul>
      </section>
      <section>
        <h3>Teams (${view.teams.length})</h3>
        ${locked ? '<p class="pf-note">Teams are locked now the season has started — drivers without a team can still join a free seat or start one.</p>' : ''}
        <ul class="ch-list">${view.teams
          .map((t) => {
            const m = members(t.id);
            const full = m.length >= CHAMPIONSHIP.teamSize;
            return `<li><span class="cg-swatch" style="--c:${hex(t.primary)};--c2:${hex(t.secondary)}"></span> <b>${esc(t.name)}</b>
              <small>${m.map((e) => esc(e.profile.name)).join(' · ') || 'empty'}</small>
              ${canPickTeam && mine!.teamId !== t.id && !full ? `<button type="button" class="ch-join" data-team="${t.id}">Join</button>` : ''}
              ${mine?.teamId === t.id && !locked ? '<button type="button" class="ch-leave">Leave</button>' : ''}</li>`;
          })
          .join('')}</ul>
        ${
          canPickTeam && mine!.teamId === null
            ? `<form class="ch-team-form">
                <input name="name" maxlength="${CHAMPIONSHIP.teamNameMax}" placeholder="New team name" required />
                <input name="primary" type="color" value="#d7263d" title="Team colour" />
                <input name="secondary" type="color" value="#f4f1ea" title="Second colour" />
                <button type="submit">Create team</button></form>`
            : ''
        }
      </section>
    </div>`;

  root.querySelector('.ch-enter')?.addEventListener('click', () => ctx.send({ t: 'champEnter' }));
  root.querySelector('.ch-add-driver-btn')?.addEventListener('click', () => {
    const id = Number(root.querySelector<HTMLSelectElement>('.ch-add-driver')!.value);
    ctx.send({ t: 'champAddEntrant', profileId: id });
  });
  for (const b of root.querySelectorAll<HTMLButtonElement>('.ch-join')) {
    b.addEventListener('click', () => ctx.send({ t: 'champTeamJoin', teamId: Number(b.dataset.team) }));
  }
  root.querySelector('.ch-leave')?.addEventListener('click', () => ctx.send({ t: 'champTeamLeave' }));
  for (const s of root.querySelectorAll<HTMLSelectElement>('.ch-move')) {
    s.addEventListener('change', () => ctx.send({ t: 'champMoveDriver', profileId: Number(s.dataset.profile), teamId: s.value ? Number(s.value) : null }));
  }
  root.querySelector<HTMLFormElement>('.ch-team-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    const color = (k: string) => parseInt(String(f.get(k)).slice(1), 16);
    ctx.send({ t: 'champTeamCreate', name: String(f.get('name')).trim(), primary: color('primary'), secondary: color('secondary') });
  });
}
