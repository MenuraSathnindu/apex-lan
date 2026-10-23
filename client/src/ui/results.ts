import { CAR_COLORS, classifiedTime } from '@apex/shared';
import { avatarHtml } from './avatar.ts';
import type { Session } from '../game/session.ts';
import { formatTime } from './raceHud.ts';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** Results screen: podium for the top 3, full table, and the host's "Race again". */
export function createResults(root: HTMLElement, session: Session, onRaceAgain: () => void, onStandings: () => void = () => {}) {
  root.innerHTML = `
    <div class="res-panel">
      <h1 class="res-title">Results</h1>
      <div class="res-podium"></div>
      <table class="res-table">
        <thead><tr><th>#</th><th>Driver</th><th>Time</th><th>Best lap</th></tr></thead>
        <tbody></tbody>
      </table>
      <button type="button" class="res-standings" hidden>Championship standings</button>
      <button type="button" class="res-again">Race again</button>
      <p class="res-wait"></p>
    </div>`;
  const podium = root.querySelector<HTMLElement>('.res-podium')!;
  const tbody = root.querySelector<HTMLElement>('tbody')!;
  const again = root.querySelector<HTMLButtonElement>('.res-again')!;
  const wait = root.querySelector<HTMLElement>('.res-wait')!;
  again.addEventListener('click', () => onRaceAgain());
  const standingsBtn = root.querySelector<HTMLButtonElement>('.res-standings')!;
  standingsBtn.addEventListener('click', () => onStandings());
  const titleEl = root.querySelector<HTMLElement>('.res-title')!;
  let key = '';

  return {
    update() {
      const show = session.race.phase === 'results';
      root.hidden = !show;
      if (!show) return;
      again.hidden = !session.isHost;
      // Championship sessions: say which, offer the standings; the host continues from the hub.
      const info = session.race.session;
      const kind = info.kind === 'qualifying' ? 'Qualifying' : info.kind === 'sprint' ? 'Sprint' : info.kind === 'race' ? 'Race' : 'Results';
      titleEl.textContent = info.round ? `Round ${info.round.round} · ${kind}` : kind === 'Results' ? 'Results' : kind;
      standingsBtn.hidden = !info.round;
      again.textContent = info.round ? 'Back to lobby' : 'Race again';
      const host = session.players.find((p) => p.id === session.hostId);
      wait.textContent = session.isHost ? '' : `Waiting for ${host?.name ?? 'the host'} to start the next race…`;

      const k = JSON.stringify(session.standings) + session.players.map((p) => p.name + p.color + p.photo + p.tag).join();
      if (k === key) return;
      key = k;

      const winner = session.standings[0];
      const fastest = Math.min(...session.standings.map((s) => s.bestLap ?? Infinity));
      const nameOf = (id: number) => esc(session.playerName(id));
      const playerOf = (id: number) => session.players.find((p) => p.id === id);
      const colorOf = (id: number) => hex(playerOf(id)?.livery.primary ?? CAR_COLORS[0]);
      const avatarOf = (id: number, size: number) => {
        const p = playerOf(id);
        return avatarHtml({ photo: p?.photo ?? null, tag: p?.tag ?? '?', color: p?.livery.primary }, size, 'res-avatar');
      };

      // Podium order on screen: 2nd, 1st, 3rd.
      podium.innerHTML = [1, 0, 2]
        .map((i) => session.standings[i])
        .filter((s) => s && !s.dnf)
        .map(
          (s) => `<div class="res-step p${s!.pos}">
            ${avatarOf(s!.id, s!.pos === 1 ? 84 : 68)}
            <div class="res-name">${nameOf(s!.id)}</div>
            <div class="res-block"><span>${s!.pos}</span></div>
          </div>`,
        )
        .join('');

      tbody.innerHTML = session.standings
        .map((s) => {
          const pole = session.standings[0]?.bestLap ?? null;
          const time = session.race.session.kind === 'qualifying'
            ? s.bestLap === null
              ? 'no time'
              : s.pos === 1 || pole === null
                ? formatTime(s.bestLap)
                : `+${((s.bestLap - pole) / 1000).toFixed(3)}`
            : s.dnf
            ? 'DNF'
            : (s.id === winner?.id
                ? formatTime(classifiedTime(s))
                : `+${formatTime((classifiedTime(s) ?? 0) - (classifiedTime(winner!) ?? 0))}`) +
              (s.penaltyMs ? ` <small class="res-pen">incl. +${s.penaltyMs / 1000}s</small>` : '');
          const best = s.bestLap === fastest && s.bestLap !== null ? `<b class="purple">${formatTime(s.bestLap)}</b>` : formatTime(s.bestLap);
          return `<tr class="${s.id === session.myId ? 'me' : ''}">
            <td>${s.dnf ? '–' : s.pos}</td>
            <td><span class="dot" style="background:${colorOf(s.id)}"></span>${avatarOf(s.id, 22)} ${nameOf(s.id)}</td>
            <td>${time}</td><td>${best}</td></tr>`;
        })
        .join('');
    },
  };
}
