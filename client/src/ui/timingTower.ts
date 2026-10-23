import { CAR, CAR_COLORS, type CarState, type Compound, type PlayerInfo, type Standing } from '@apex/shared';
import { avatarHtml } from './avatar.ts';
import { formatTime } from './format.ts';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const secs = (ms: number) => `+${(ms / 1000).toFixed(3)}`;

/** What the tower needs besides standings and the roster. */
export interface TowerInfo {
  /** Championship team colour of a driver, or null (then their livery's colour is used). */
  teamColour(id: number): number | null;
  /** Latest reported state of a car (tyre wear, pit lane), or null. */
  car(id: number): Pick<CarState, 'tw' | 'pl'> | null;
  /** Overtake mode available to this car (its last detection-point crossing). */
  overtake(id: number): boolean;
  myId: number;
  /** Race distance in laps. */
  laps: number;
}

export interface TowerRow {
  id: number;
  pos: number;
  tag: string;
  name: string;
  photo: string | null;
  colour: number;
  gapText: string;
  tyre: Compound;
  /** Tyre wear 0..1, null if unknown. */
  wear: number | null;
  overtake: boolean;
  badges: string[];
  me: boolean;
  away: boolean;
}

/**
 * Rows of the timing tower. Races: the leader shows the lap, the others the gap to the leader or
 * the interval to the car ahead ("+1 LAP" when lapped). Qualifying: best lap, then gap to pole.
 */
export function towerRows(standings: readonly Standing[], players: readonly PlayerInfo[], info: TowerInfo, mode: 'leader' | 'interval', qualifying: boolean): TowerRow[] {
  const pole = standings[0]?.bestLap ?? null;
  return standings.map((s, i) => {
    const p = players.find((x) => x.id === s.id);
    const car = info.car(s.id);
    let gapText: string;
    if (qualifying) {
      gapText = s.bestLap === null ? 'no time' : i === 0 || pole === null ? formatTime(s.bestLap) : secs(s.bestLap - pole);
    } else if (i === 0) {
      gapText = `LAP ${Math.min(s.laps + 1, info.laps)}/${info.laps}`;
    } else if (s.lapsDown > 0) {
      gapText = `+${s.lapsDown} LAP${s.lapsDown > 1 ? 'S' : ''}`;
    } else if (s.gap === null) {
      gapText = '';
    } else if (mode === 'interval') {
      const ahead = standings[i - 1]!;
      gapText = secs(Math.max(0, s.gap - (ahead.gap ?? 0)));
    } else gapText = secs(s.gap);
    const badges: string[] = [];
    if (car?.pl === 1) badges.push('PIT');
    if (s.penaltyMs > 0) badges.push(`+${s.penaltyMs / 1000}s`);
    if (s.dnf) badges.push('DNF');
    else if (s.finishTime !== null && !qualifying) badges.push('FIN');
    if (p && !p.connected) badges.push('OUT');
    return {
      id: s.id,
      pos: s.pos,
      tag: p?.tag ?? '???',
      name: p?.name ?? `#${s.id}`,
      photo: p?.photo ?? null,
      colour: info.teamColour(s.id) ?? p?.livery.primary ?? CAR_COLORS[p?.color ?? 0] ?? 0xffffff,
      gapText,
      tyre: p?.tyre ?? 'medium',
      wear: car?.tw ?? null,
      overtake: info.overtake(s.id),
      badges,
      me: s.id === info.myId,
      away: p ? !p.connected : false,
    };
  });
}

/** Seconds each gap mode stays up before the tower switches (gap to leader ↔ interval). */
const MODE_SECONDS = 10;
/** Rebuild at most this often (ms). */
const REFRESH_MS = 200;

/** The left-side timing tower (DOM). */
export function createTimingTower(root: HTMLElement) {
  root.innerHTML = `<div class="tt-head"><span class="tt-title"></span><span class="tt-mode"></span></div><ol class="tt-rows"></ol>`;
  const title = root.querySelector<HTMLElement>('.tt-title')!;
  const modeEl = root.querySelector<HTMLElement>('.tt-mode')!;
  const list = root.querySelector<HTMLElement>('.tt-rows')!;
  let key = '';
  let lastAt = -Infinity;

  return {
    /** Call every frame; rebuilds at most 5 times a second, and only when something changed. */
    update(now: number, standings: readonly Standing[], players: readonly PlayerInfo[], info: TowerInfo, qualifying: boolean, heading: string) {
      if (now - lastAt < REFRESH_MS) return;
      lastAt = now;
      const mode = Math.floor(now / 1000 / MODE_SECONDS) % 2 === 0 ? 'leader' : 'interval';
      const rows = towerRows(standings, players, info, mode, qualifying);
      const k = heading + mode + JSON.stringify(rows);
      if (k === key) return;
      key = k;
      title.textContent = heading;
      modeEl.textContent = qualifying ? 'BEST LAP' : mode === 'leader' ? 'GAP' : 'INTERVAL';
      list.innerHTML = rows
        .map((r) => {
          const c = CAR.tyres.compounds[r.tyre];
          const wear = r.wear === null ? '' : `;--wear:${Math.round((1 - r.wear) * 100)}%`;
          return `<li class="tt-row${r.me ? ' me' : ''}${r.away ? ' away' : ''}">
            <span class="tt-pos">${r.pos}</span>
            <span class="tt-team" style="background:${hex(r.colour)}"></span>
            ${avatarHtml({ photo: r.photo, tag: r.tag, color: r.colour }, 22, 'tt-avatar')}
            <span class="tt-tag" title="${esc(r.name)}">${esc(r.tag)}</span>
            <span class="tt-gap">${esc(r.gapText)}</span>
            ${r.badges.map((b) => `<span class="tt-badge tt-${b.startsWith('+') ? 'pen' : b.toLowerCase()}">${esc(b)}</span>`).join('')}
            <span class="tt-ot">${r.overtake ? '⚡' : ''}</span>
            <span class="tt-tyre${r.wear === null ? '' : ' worn'}" style="--tc:${hex(c.color)}${wear}" title="${c.label}${r.wear === null ? '' : ` · ${Math.round(r.wear * 100)}% worn`}">${c.label[0]}</span>
          </li>`;
        })
        .join('');
    },
  };
}
