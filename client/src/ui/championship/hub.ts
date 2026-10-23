import { computeStandings, sessionsOf, type C2S, type ChampionshipView, type SeasonDraft, type TrackIndexEntry } from '@apex/shared';
import type { Session } from '../../game/session.ts';
import { esc } from '../avatar.ts';
import { renderSeasonEditor } from './editor.ts';
import { renderEntries } from './entries.ts';
import { driversGridHtml, teamsGridHtml } from './standingsGrid.ts';

export interface HubDeps {
  session: Session;
  send: (msg: C2S) => void;
  tracks: () => TrackIndexEntry[];
  /** Opens the champion screen for a finished season. */
  showFinale: (view: ChampionshipView) => void;
}

type Tab = 'weekend' | 'drivers' | 'teams' | 'entries';
const SESSION_LABEL = { qualifying: 'Qualifying', sprint: 'Sprint', race: 'Race' } as const;

/**
 * The championship hub (lobby → 🏁): seasons list, new-season editor (host), and for the loaded
 * season the weekend card, drivers' and teams' standings and entries & teams.
 */
export function createChampionshipHub(root: HTMLElement, deps: HubDeps) {
  root.innerHTML = `
    <div class="pf-panel ch-panel" role="dialog" aria-label="Championship">
      <header class="pf-head">
        <h2 class="ch-title">Championship</h2>
        <button type="button" class="pf-close" aria-label="Close">✕</button>
      </header>
      <div class="pf-body ch-body"></div>
    </div>`;
  const body = root.querySelector<HTMLElement>('.ch-body')!;
  const title = root.querySelector<HTMLElement>('.ch-title')!;
  const { session } = deps;
  let tab: Tab = 'weekend';
  let editing = false;
  const trackName = (id: string) => {
    const t = deps.tracks().find((e) => e.id === id);
    return t ? `${t.name}, ${t.country}` : id;
  };

  const hide = () => (root.hidden = true);
  root.querySelector('.pf-close')!.addEventListener('click', hide);
  root.addEventListener('pointerdown', (e) => {
    if (e.target === root) hide();
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      hide();
    }
  });

  function render() {
    const view = session.champ;
    if (editing && session.isHost) {
      title.textContent = 'New season';
      return renderSeasonEditor(body, {
        tracks: deps.tracks,
        onCreate: (draft: SeasonDraft) => {
          editing = false;
          deps.send({ t: 'champCreate', draft });
        },
        onCancel: () => {
          editing = false;
          render();
        },
      });
    }
    if (!view) return renderSeasons();
    title.textContent = view.name;
    body.innerHTML = `
      <nav class="pf-tabs ch-tabs">
        ${(['weekend', 'drivers', 'teams', 'entries'] as Tab[])
          .map((t) => `<button type="button" data-tab="${t}" aria-selected="${t === tab}">${{ weekend: 'Weekend', drivers: 'Drivers', teams: 'Teams', entries: 'Entries & teams' }[t]}</button>`)
          .join('')}
      </nav>
      <div class="ch-tab"></div>`;
    for (const b of body.querySelectorAll<HTMLButtonElement>('.ch-tabs button')) {
      b.addEventListener('click', () => {
        tab = b.dataset.tab as Tab;
        render();
      });
    }
    const pane = body.querySelector<HTMLElement>('.ch-tab')!;
    if (tab === 'drivers') pane.innerHTML = driversGridHtml(view, trackName);
    else if (tab === 'teams') pane.innerHTML = teamsGridHtml(view, trackName);
    else if (tab === 'entries') {
      renderEntries(pane, { view, isHost: session.isHost, myProfileId: session.account?.id ?? null, players: session.players, send: deps.send });
    } else renderWeekend(pane, view);
  }

  function renderWeekend(pane: HTMLElement, view: ChampionshipView) {
    const host = session.isHost;
    const running = session.race.phase === 'countdown' || session.race.phase === 'racing';
    if (view.status === 'finished') {
      const champ = view.entries.find((e) => e.profile.id === view.championId);
      pane.innerHTML = `<div class="ch-card"><h3>Season finished</h3>
        <p>Champion: <b>${esc(champ?.profile.name ?? '—')}</b></p>
        <button type="button" class="pf-primary ch-finale">Champion ceremony</button>
        ${host ? '<button type="button" class="ch-close-season">Close season</button>' : ''}</div>`;
      pane.querySelector('.ch-finale')!.addEventListener('click', () => deps.showFinale(view));
    } else {
      const next = view.next ?? { round: 1, session: 'qualifying' as const };
      const round = view.rounds.find((r) => r.round === next.round)!;
      const q = view.settings.qualifying;
      const qualiText = q.mode === 'timed' ? `timed, ${q.minutes} min` : 'one-shot lap';
      const leader = computeStandings(view).drivers[0];
      pane.innerHTML = `<div class="ch-card">
          <p class="ch-kicker">${view.status === 'setup' ? 'Not started yet' : `Round ${round.round} of ${view.rounds.length}`}</p>
          <h3>${esc(trackName(round.trackId))}</h3>
          <ol class="ch-schedule">${sessionsOf(round)
            .map((s) => {
              const done = view.results.some((r) => r.round === round.round && r.session === s);
              const isNext = s === next.session && view.status !== 'setup';
              return `<li class="${done ? 'done' : isNext ? 'next' : ''}">${SESSION_LABEL[s]}${s === 'qualifying' ? ` (${qualiText})` : s === 'race' ? ` · ${view.settings.laps} laps` : ''}${done ? ' ✓' : isNext ? ' ← next' : ''}</li>`;
            })
            .join('')}</ol>
          <p class="pf-note">${view.entries.length} drivers · ${view.teams.length} teams${leader && leader.points > 0 ? ` · leader ${esc(leader.profile.name)} (${leader.points} pts)` : ''}${view.settings.fastestLapPoint ? ' · fastest-lap point on' : ''}${view.settings.tyreWear ? '' : ' · no tyre wear'}</p>
          ${
            host
              ? `<button type="button" class="pf-primary ch-start" ${running ? 'disabled' : ''}>${view.status === 'setup' ? 'Start season: ' : 'Start '}${SESSION_LABEL[next.session]}</button>
                 <button type="button" class="ch-close-season">Close season</button>`
              : `<p class="pf-note">Waiting for the host to start the ${SESSION_LABEL[next.session].toLowerCase()}.</p>`
          }
        </div>`;
      pane.querySelector('.ch-start')?.addEventListener('click', () => {
        deps.send({ t: 'champStartSession' });
        hide();
      });
    }
    pane.querySelector('.ch-close-season')?.addEventListener('click', () => deps.send({ t: 'champClose' }));
  }

  function renderSeasons() {
    title.textContent = 'Championship';
    const host = session.isHost;
    const list = session.champList;
    body.innerHTML = `
      <p class="pf-note">${host ? 'Start a new season, or resume one.' : 'Waiting for the host to load a season.'} Only logged-in profiles can race in a championship.</p>
      ${host ? '<button type="button" class="pf-primary ch-new">New season</button>' : ''}
      <table class="pf-table"><thead><tr><th>Season</th><th>Rounds</th><th>Status</th><th></th></tr></thead><tbody>
      ${
        list.length
          ? list
              .map(
                (s) => `<tr><td>${esc(s.name)}</td><td>${s.rounds}</td>
                  <td>${s.status === 'finished' ? 'Finished' : s.status === 'setup' ? 'Not started' : `Next: round ${s.next?.round} ${s.next?.session}`}</td>
                  <td>${host ? `<button type="button" class="ch-load" data-id="${s.id}">${s.status === 'finished' ? 'View' : 'Resume'}</button>` : ''}</td></tr>`,
              )
              .join('')
          : '<tr><td colspan="4">No seasons yet.</td></tr>'
      }</tbody></table>`;
    body.querySelector('.ch-new')?.addEventListener('click', () => {
      editing = true;
      render();
    });
    for (const b of body.querySelectorAll<HTMLButtonElement>('.ch-load')) {
      b.addEventListener('click', () => deps.send({ t: 'champLoad', id: Number(b.dataset.id) }));
    }
  }

  root.hidden = true;
  return {
    show(open: Tab = tab) {
      tab = open;
      root.hidden = false;
      deps.send({ t: 'champList' });
      render();
    },
    hide,
    /** Re-render if open (season, list or roster changed). */
    refresh() {
      if (!root.hidden) render();
    },
    get open() {
      return !root.hidden;
    },
  };
}
