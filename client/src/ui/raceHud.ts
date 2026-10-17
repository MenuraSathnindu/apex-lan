import { CAR_COLORS } from '@apex/shared';
import type { RaceController } from '../game/raceController.ts';
import type { Session } from '../game/session.ts';
import type { ServerClock } from '../net/clock.ts';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** 83456 → "1:23.456". */
export function formatTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '–:––.–––';
  const t = Math.max(0, ms);
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const milli = Math.floor(t % 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(milli).padStart(3, '0')}`;
}

const RESPAWN_TEXT = {
  manual: 'Respawned at last checkpoint',
  stuck: 'Stuck — respawned at last checkpoint',
  'off-track': 'Off track — respawned at last checkpoint',
  flipped: 'Flipped — respawned at last checkpoint',
};

/** In-race HUD: lap/position/timing panel, live ranking, wrong-way banner, toasts. */
export function createRaceHud(root: HTMLElement, session: Session, clock: ServerClock, race: RaceController) {
  root.innerHTML = `
    <div class="rh-panel">
      <div class="rh-row"><span class="rh-label">POS</span><span class="rh-pos"></span></div>
      <div class="rh-row"><span class="rh-label">LAP</span><span class="rh-lap"></span></div>
      <div class="rh-time rh-current"></div>
      <div class="rh-sub">Last <span class="rh-last"></span></div>
      <div class="rh-sub">Best <span class="rh-best"></span></div>
    </div>
    <ol class="rh-ranking"></ol>
    <div class="rh-wrongway">WRONG WAY</div>
    <div class="rh-banner"></div>
    <div class="rh-toasts"></div>`;
  const $ = (s: string) => root.querySelector<HTMLElement>(s)!;
  const panel = $('.rh-panel');
  const posEl = $('.rh-pos');
  const lapEl = $('.rh-lap');
  const curEl = $('.rh-current');
  const lastEl = $('.rh-last');
  const bestEl = $('.rh-best');
  const rankEl = $('.rh-ranking');
  const wrongEl = $('.rh-wrongway');
  const bannerEl = $('.rh-banner');
  const toastEl = $('.rh-toasts');
  let rankKey = '';
  let lastRespawnShown = 0;

  const toast = (html: string, cls = '') => {
    const el = document.createElement('div');
    el.className = `rh-toast ${cls}`;
    el.innerHTML = html;
    toastEl.append(el);
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3200);
  };

  return {
    /** Call every frame. */
    update() {
      const { phase, laps, finishDeadline } = session.race;
      const active = phase === 'countdown' || phase === 'racing';
      root.hidden = !active;
      if (!active) {
        session.lapEvents.length = 0;
        return;
      }
      const me = session.myStanding;
      const total = session.standings.length;
      panel.hidden = !me;

      if (me) {
        posEl.textContent = `${me.pos}/${total}`;
        lapEl.textContent = `${Math.min(me.laps + 1, laps)}/${laps}`;
        const running = phase === 'racing' && me.finishTime === null;
        curEl.textContent = running ? formatTime(clock.now() - me.lapStart) : formatTime(me.finishTime ?? 0);
        lastEl.textContent = formatTime(me.lastLap);
        bestEl.textContent = formatTime(me.bestLap);
      }

      // Ranking list (only rebuilt when it changes).
      const key = session.standings.map((s) => `${s.id}:${s.laps}:${s.finishTime ?? ''}`).join('|') + session.players.length;
      if (key !== rankKey) {
        rankKey = key;
        rankEl.innerHTML = session.standings
          .map((s) => {
            const p = session.players.find((x) => x.id === s.id);
            const status = s.finishTime !== null ? 'FIN' : `L${Math.min(s.laps + 1, laps)}`;
            return `<li class="${s.id === session.myId ? 'me' : ''} ${p?.connected === false ? 'away' : ''}">
              <span class="rk-pos">${s.pos}</span>
              <span class="rk-dot" style="background:${hex(CAR_COLORS[p?.color ?? 0] ?? 0xffffff)}"></span>
              <span class="rk-name">${esc(p?.name ?? `#${s.id}`)}</span>
              <span class="rk-status">${status}</span></li>`;
          })
          .join('');
      }

      wrongEl.classList.toggle('show', race.wrongWay && phase === 'racing' && !me?.finishTime);

      // Finished / waiting-for-results banner.
      if (me?.finishTime != null) {
        const left = finishDeadline ? Math.max(0, Math.ceil((finishDeadline - clock.now()) / 1000)) : 0;
        bannerEl.innerHTML = `FINISHED <b>P${me.pos}</b> · ${formatTime(me.finishTime)}<small>Results in ${left}s or when everyone's in</small>`;
        bannerEl.hidden = false;
      } else if (finishDeadline && phase === 'racing') {
        const left = Math.max(0, Math.ceil((finishDeadline - clock.now()) / 1000));
        bannerEl.innerHTML = `<small>Leader finished — ${left}s to cross the line</small>`;
        bannerEl.hidden = false;
      } else bannerEl.hidden = true;

      // Lap toasts.
      for (const e of session.lapEvents.splice(0)) {
        if (e.id === session.myId) {
          const tag = e.raceBest ? ' <b class="purple">fastest lap!</b>' : e.personalBest ? ' <b class="green">personal best</b>' : '';
          toast(e.finished ? `Finish! Lap ${e.lap}: ${formatTime(e.time)}${tag}` : `Lap ${e.lap}: ${formatTime(e.time)}${tag}`);
        } else if (e.raceBest) {
          toast(`${esc(session.playerName(e.id))} — fastest lap ${formatTime(e.time)}`, 'other');
        } else if (e.finished) {
          toast(`${esc(session.playerName(e.id))} finished`, 'other');
        }
      }
      if (race.lastRespawn && race.lastRespawn.at !== lastRespawnShown) {
        lastRespawnShown = race.lastRespawn.at;
        toast(RESPAWN_TEXT[race.lastRespawn.reason], 'warn');
      }
    },
  };
}
