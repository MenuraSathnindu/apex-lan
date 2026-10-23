import { CAR, HUD, RACE, SectorBoard, type PitZone, type StewardEvent } from '@apex/shared';
import type { PitStop } from '../game/pitStop.ts';
import type { RaceController } from '../game/raceController.ts';
import { formatTime } from './format.ts';
import { createTimingTower, type TowerInfo } from './timingTower.ts';
import type { Session } from '../game/session.ts';
import type { ServerClock } from '../net/clock.ts';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
/** -234 → "−0.234", 1200 → "+1.200". */
const signed = (ms: number) => `${ms < 0 ? '−' : '+'}${(Math.abs(ms) / 1000).toFixed(3)}`;

/** What the race HUD reads from the live game besides the session. */
export interface RaceHudLive extends Pick<TowerInfo, 'car' | 'teamColour'> {
  /** Whose timing the panel and sector bar show: us, or the car we're watching. */
  focusId(): number;
  /** Sectors of the current track. */
  sectors(): number;
}

/** Headline for a stewards' decision about our own car. */
function stewardHeadline(e: StewardEvent): string {
  const why = e.reason === 'jumpStart' ? 'JUMP START' : 'TRACK LIMITS';
  if (e.kind === 'penalty') return `+${e.penaltyMs / 1000}s TIME PENALTY<small>${why}</small>`;
  if (e.kind === 'lapDeleted') return `LAP DELETED<small>${why}</small>`;
  const left = RACE.trackLimits.strikesPerPenalty - (e.strikes % RACE.trackLimits.strikesPerPenalty);
  return `TRACK LIMITS — WARNING<small>${left === 1 ? 'next one is a 5 s penalty' : `${left} more and it is a 5 s penalty`}</small>`;
}

const RESPAWN_TEXT = {
  manual: 'Respawned at last checkpoint',
  stuck: 'Stuck — respawned at last checkpoint',
  'off-track': 'Off track — respawned at last checkpoint',
  flipped: 'Flipped — respawned at last checkpoint',
};

/**
 * In-race HUD: timing tower, lap/position panel with sector bar, sector delta popups, stewards'
 * banners, chequered flag, pit lane, wrong-way banner, toasts.
 */
export function createRaceHud(root: HTMLElement, session: Session, clock: ServerClock, race: RaceController, pit: { zone: PitZone; stop: PitStop }, live: RaceHudLive) {
  root.innerHTML = `
    <div class="rh-session" hidden></div>
    <div class="rh-panel">
      <div class="rh-row"><span class="rh-label">POS</span><span class="rh-pos"></span></div>
      <div class="rh-row"><span class="rh-label">LAP</span><span class="rh-lap"></span></div>
      <div class="rh-time rh-current"></div>
      <div class="rh-sub">Last <span class="rh-last"></span></div>
      <div class="rh-sub">Best <span class="rh-best"></span></div>
      <div class="rh-sectors"></div>
    </div>
    <div class="rh-tower"></div>
    <div class="rh-delta" hidden></div>
    <div class="rh-steward" hidden></div>
    <div class="rh-flag" hidden><div class="rh-flag-cloth"></div>CHEQUERED FLAG</div>
    <div class="rh-wrongway">WRONG WAY</div>
    <div class="rh-pit" hidden></div>
    <div class="rh-banner"></div>
    <div class="rh-toasts"></div>`;
  const $ = (s: string) => root.querySelector<HTMLElement>(s)!;
  const panel = $('.rh-panel');
  const sessionEl = $('.rh-session');
  const posEl = $('.rh-pos');
  const lapEl = $('.rh-lap');
  const curEl = $('.rh-current');
  const lastEl = $('.rh-last');
  const bestEl = $('.rh-best');
  const tower = createTimingTower($('.rh-tower'));
  const sectorsEl = $('.rh-sectors');
  const deltaEl = $('.rh-delta');
  const stewardEl = $('.rh-steward');
  const flagEl = $('.rh-flag');
  const board = new SectorBoard(3);
  /** Race the sector board belongs to, the focus car's lap on the bar, and banner timers. */
  let boardRace = -1;
  let barKey = '';
  let barLap = 0;
  let deltaTimer: ReturnType<typeof setTimeout> | undefined;
  let stewardTimer: ReturnType<typeof setTimeout> | undefined;
  let flagShownFor = -1;
  const towerInfo: TowerInfo = { car: (id) => live.car(id), teamColour: (id) => live.teamColour(id), overtake: (id) => session.overtakes.get(id) ?? false, myId: 0, laps: 0 };
  const wrongEl = $('.rh-wrongway');
  const bannerEl = $('.rh-banner');
  const toastEl = $('.rh-toasts');
  const pitEl = $('.rh-pit');
  let pitKey = '';
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
        session.sectorEvents.length = 0;
        session.stewardEvents.length = 0;
        return;
      }
      const focus = live.focusId();
      const me = session.standings.find((s) => s.id === focus);
      const total = session.standings.length;
      panel.hidden = !me;
      const info = session.race.session;
      const qualifying = info.kind === 'qualifying';

      // Session label: "R3/24 · Qualifying · 6:12 left" (championship), "Qualifying" etc.
      if (info.kind !== 'free' || info.round) {
        const kind = info.kind === 'qualifying' ? 'Qualifying' : info.kind === 'sprint' ? 'Sprint' : 'Race';
        let text = info.round ? `R${info.round.round}/${info.round.rounds} · ${kind}` : kind;
        if (qualifying && info.endsAt) {
          const left = info.endsAt - clock.now();
          text += left > 0 ? ` · ${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')} left` : ' · finish your lap';
        } else if (qualifying) text += ' · one flying lap';
        if (session.me && !session.me.entrant) text += ' · spectating (C: next car)';
        sessionEl.textContent = text;
        sessionEl.hidden = false;
      } else sessionEl.hidden = true;

      if (me) {
        posEl.textContent = `${me.pos}/${total}`;
        lapEl.textContent = qualifying ? String(me.laps + 1) : `${Math.min(me.laps + 1, laps)}/${laps}`;
        const running = phase === 'racing' && me.finishTime === null;
        curEl.textContent = running ? formatTime(clock.now() - me.lapStart) : formatTime(me.finishTime ?? 0);
        lastEl.textContent = formatTime(me.lastLap);
        bestEl.textContent = formatTime(me.bestLap);
      }

      // Timing tower (rebuilt at most 5 Hz).
      towerInfo.myId = focus;
      towerInfo.laps = laps;
      const leader = session.standings[0];
      const heading = qualifying ? 'QUALIFYING' : leader ? `LAP ${Math.min(leader.laps + 1, laps)}/${laps}` : `${laps} LAPS`;
      tower.update(performance.now(), session.standings, session.players, towerInfo, qualifying, heading);

      // Sectors: colour every event; the focus car's bar and delta popup.
      if (boardRace !== session.race.raceId) {
        boardRace = session.race.raceId;
        board.reset(live.sectors());
        barLap = 0;
        barKey = '';
      }
      for (const e of session.sectorEvents.splice(0)) {
        const { colour, delta } = board.add(e);
        if (e.id !== focus) continue;
        barLap = e.lap;
        const text = delta === null ? formatTime(e.time) : signed(delta);
        deltaEl.className = `rh-delta ${colour ?? 'invalid'} ${delta === null ? '' : delta <= 0 ? 'faster' : 'slower'}`;
        deltaEl.innerHTML = `<b>S${e.sector + 1}</b> ${text}`;
        deltaEl.hidden = false;
        clearTimeout(deltaTimer);
        deltaTimer = setTimeout(() => (deltaEl.hidden = true), HUD.sectorPopupMs);
      }
      const colours = board.colours(focus, barLap);
      const bk = `${live.sectors()}:${colours.join()}`;
      if (bk !== barKey) {
        barKey = bk;
        sectorsEl.innerHTML = colours.map((c, k) => `<i class="${c ?? ''}" title="S${k + 1}"></i>`).join('');
      }

      // Stewards: a banner for our car, a toast for penalties to others.
      for (const e of session.stewardEvents.splice(0)) {
        if (e.id === focus) {
          stewardEl.innerHTML = stewardHeadline(e);
          stewardEl.className = `rh-steward ${e.kind}`;
          stewardEl.hidden = false;
          clearTimeout(stewardTimer);
          stewardTimer = setTimeout(() => (stewardEl.hidden = true), HUD.stewardBannerMs);
        } else if (e.kind === 'penalty') {
          toast(`${esc(session.playerName(e.id))}: +${e.penaltyMs / 1000}s (${e.reason === 'jumpStart' ? 'jump start' : 'track limits'})`, 'other');
        }
      }

      // Chequered flag when the leader finishes (once per race).
      if (finishDeadline && phase === 'racing' && flagShownFor !== session.race.raceId) {
        flagShownFor = session.race.raceId;
        flagEl.hidden = false;
        setTimeout(() => (flagEl.hidden = true), HUD.flagMs);
      }

      // Pit lane: limiter tag, and the tyre choice during a stop.
      const stop = pit.stop;
      const pk = stop.holding ? `stop:${stop.choice}:${Math.round(stop.progress * 20)}` : pit.zone !== 'none' && phase === 'racing' ? 'limiter' : '';
      if (pk !== pitKey) {
        pitKey = pk;
        pitEl.hidden = !pk;
        pitEl.classList.toggle('stopping', stop.holding);
        if (stop.holding) {
          const c = CAR.tyres.compounds[stop.choice];
          pitEl.innerHTML = `PIT STOP<div class="rh-pit-tyre">◀ <b style="color:${hex(c.color)}">${c.label}</b> ▶</div><div class="rh-pit-bar"><i style="width:${Math.round(stop.progress * 100)}%"></i></div>`;
        } else pitEl.innerHTML = 'PIT LIMITER <small>80 km/h</small>';
      }

      wrongEl.classList.toggle('show', race.wrongWay && phase === 'racing' && !me?.finishTime);

      // Finished / waiting-for-results banner.
      if (me?.finishTime != null) {
        const left = finishDeadline ? Math.max(0, Math.ceil((finishDeadline - clock.now()) / 1000)) : 0;
        bannerEl.innerHTML = `FINISHED <b>P${me.pos}</b> · ${formatTime(me.finishTime + me.penaltyMs)}<small>Cool-down lap · results in ${left}s or when everyone's in</small>`;
        bannerEl.hidden = false;
      } else if (finishDeadline && phase === 'racing') {
        const left = Math.max(0, Math.ceil((finishDeadline - clock.now()) / 1000));
        bannerEl.innerHTML = `<small>Leader finished — ${left}s to cross the line</small>`;
        bannerEl.hidden = false;
      } else bannerEl.hidden = true;

      // Lap toasts.
      for (const e of session.lapEvents.splice(0)) {
        if (e.id === focus) {
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
