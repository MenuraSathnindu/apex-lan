import {
  CAR,
  CAR_COLORS,
  CAR_COLOR_NAMES,
  COMPOUNDS,
  LIVERY,
  MAX_PLAYERS,
  NAME_MAX_LENGTH,
  RACE,
  TYRE_WEAR_SETTINGS,
  presetLivery,
  type Compound,
  type Livery,
  type TrackIndexEntry,
  type TyreWearSetting,
} from '@apex/shared';
import type { Session } from '../game/session.ts';
import { drawTrackPreview } from './trackSelect.ts';
import { avatarHtml } from './avatar.ts';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export interface LobbyHandlers {
  onProfile(name: string, color: number, livery: Livery, tyre: Compound): void;
  onStart(): void;
  onLaps(laps: number): void;
  onTyreWear(wear: TyreWearSetting): void;
  /** Host clicked "Change": open the track picker. */
  onChooseTrack(): void;
  onAccount(): void;
  onHallOfFame(): void;
  onShowProfile(profileId: number): void;
}

/** Pre-race screen: name, colour, who's here, and the host's Start button. */
export function createLobby(root: HTMLElement, session: Session, handlers: LobbyHandlers, tracks: () => TrackIndexEntry[]) {
  root.innerHTML = `
    <div class="lobby-panel">
      <h1>apex-lan</h1>
      <p class="lobby-join">Friends join at <b>${esc(location.host)}</b></p>
      <div class="lobby-label">Track</div>
      <div class="lobby-track">
        <canvas class="lobby-track-map"></canvas>
        <div class="lobby-track-info"><b class="lobby-track-name"></b><span class="lobby-track-meta"></span></div>
        <button type="button" class="lobby-track-change">Change</button>
      </div>
      <div class="lobby-account">
        <button type="button" class="lobby-account-btn"></button>
        <button type="button" class="lobby-hof-btn">🏆 Hall of Fame</button>
      </div>
      <p class="lobby-auth-error" role="alert" hidden></p>
      <label class="lobby-label" for="lobby-name">Your name</label>
      <input id="lobby-name" class="lobby-name" maxlength="${NAME_MAX_LENGTH}" autocomplete="off" spellcheck="false" placeholder="Driver name" />
      <div class="lobby-label">Car colour</div>
      <div class="lobby-colors">
        ${CAR_COLORS.map(
          (c, i) => `<button type="button" class="lobby-color" data-color="${i}" style="--c:${hex(c)}" title="${CAR_COLOR_NAMES[i]}"></button>`,
        ).join('')}
      </div>
      <div class="lobby-label">Livery</div>
      <div class="lobby-livery">
        <label title="Main colour"><input type="color" data-livery="primary" /><span>Primary</span></label>
        <label title="Stripes and number roundels"><input type="color" data-livery="secondary" /><span>Secondary</span></label>
        <label title="Pinstripes, wing endplates"><input type="color" data-livery="accent" /><span>Accent</span></label>
        <label title="Race number"><input type="number" class="lobby-number" min="0" max="${LIVERY.numberMax}" step="1" /><span>Number</span></label>
      </div>
      <div class="lobby-label">Tyres</div>
      <div class="lobby-tyres">
        ${COMPOUNDS.map((c) => {
          const t = CAR.tyres.compounds[c];
          return `<button type="button" class="lobby-tyre" data-tyre="${c}" style="--c:${hex(t.color)}" title="Grip ×${t.grip}, wear ×${t.wearRate}"><b>${t.label[0]}</b>${t.label}</button>`;
        }).join('')}
      </div>
      <div class="lobby-label">Tyre wear</div>
      <div class="lobby-wear">
        ${TYRE_WEAR_SETTINGS.map((w) => `<button type="button" class="lobby-wear-btn" data-wear="${w}">${w[0]!.toUpperCase() + w.slice(1)}</button>`).join('')}
        <span class="lobby-wear-hint"></span>
      </div>
      <div class="lobby-label">Laps</div>
      <div class="lobby-laps">
        <button type="button" class="lobby-laps-btn" data-d="-1" aria-label="Fewer laps">−</button>
        <span class="lobby-laps-value"></span>
        <button type="button" class="lobby-laps-btn" data-d="1" aria-label="More laps">+</button>
        <span class="lobby-laps-hint"></span>
      </div>
      <div class="lobby-label">Players <span class="lobby-count"></span></div>
      <ul class="lobby-players"></ul>
      <button type="button" class="lobby-start">Start race</button>
      <p class="lobby-wait"></p>
    </div>`;

  const nameInput = root.querySelector<HTMLInputElement>('.lobby-name')!;
  const colorButtons = [...root.querySelectorAll<HTMLButtonElement>('.lobby-color')];
  const list = root.querySelector<HTMLElement>('.lobby-players')!;
  const count = root.querySelector<HTMLElement>('.lobby-count')!;
  const start = root.querySelector<HTMLButtonElement>('.lobby-start')!;
  const wait = root.querySelector<HTMLElement>('.lobby-wait')!;

  const liveryInputs = [...root.querySelectorAll<HTMLInputElement>('[data-livery]')];
  const numberInput = root.querySelector<HTMLInputElement>('.lobby-number')!;

  nameInput.value = session.profile.name;
  let nameTimer: ReturnType<typeof setTimeout> | undefined;
  const sendSoon = (livery = session.livery) => {
    clearTimeout(nameTimer);
    nameTimer = setTimeout(() => handlers.onProfile(nameInput.value, session.profile.color, livery, session.tyre), 250);
  };
  nameInput.addEventListener('input', () => sendSoon());

  /** The livery as currently shown in the inputs. */
  const liveryFromInputs = (): Livery => {
    const l = { ...session.livery };
    for (const input of liveryInputs) l[input.dataset.livery as 'primary' | 'secondary' | 'accent'] = parseInt(input.value.slice(1), 16);
    const n = Math.round(Number(numberInput.value));
    if (Number.isFinite(n) && n >= 0 && n <= LIVERY.numberMax) l.number = n;
    return l;
  };
  for (const input of [...liveryInputs, numberInput]) input.addEventListener('input', () => sendSoon(liveryFromInputs()));
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') nameInput.blur();
  });
  for (const b of colorButtons) {
    b.addEventListener('click', () => {
      if (b.disabled) return;
      // A colour picks that preset scheme, keeping your number.
      const color = Number(b.dataset.color);
      handlers.onProfile(nameInput.value, color, { ...presetLivery(color), number: session.livery.number }, session.tyre);
    });
  }
  const tyreButtons = [...root.querySelectorAll<HTMLButtonElement>('.lobby-tyre')];
  for (const b of tyreButtons) {
    b.addEventListener('click', () => handlers.onProfile(nameInput.value, session.profile.color, session.livery, b.dataset.tyre as Compound));
  }
  const wearButtons = [...root.querySelectorAll<HTMLButtonElement>('.lobby-wear-btn')];
  const wearHint = root.querySelector<HTMLElement>('.lobby-wear-hint')!;
  for (const b of wearButtons) {
    b.addEventListener('click', () => {
      if (session.isHost && b.dataset.wear !== session.race.tyreWear) handlers.onTyreWear(b.dataset.wear as TyreWearSetting);
    });
  }
  const trackMap = root.querySelector<HTMLCanvasElement>('.lobby-track-map')!;
  const trackName = root.querySelector<HTMLElement>('.lobby-track-name')!;
  const trackMeta = root.querySelector<HTMLElement>('.lobby-track-meta')!;
  const trackChange = root.querySelector<HTMLButtonElement>('.lobby-track-change')!;
  trackChange.addEventListener('click', () => handlers.onChooseTrack());
  let shownTrack = '';
  const accountBtn = root.querySelector<HTMLButtonElement>('.lobby-account-btn')!;
  const authError = root.querySelector<HTMLElement>('.lobby-auth-error')!;
  accountBtn.addEventListener('click', () => handlers.onAccount());
  root.querySelector('.lobby-hof-btn')!.addEventListener('click', () => handlers.onHallOfFame());
  list.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-profile]');
    if (row) handlers.onShowProfile(Number(row.dataset.profile));
  });
  start.addEventListener('click', () => handlers.onStart());
  const lapsValue = root.querySelector<HTMLElement>('.lobby-laps-value')!;
  const lapsHint = root.querySelector<HTMLElement>('.lobby-laps-hint')!;
  const lapButtons = [...root.querySelectorAll<HTMLButtonElement>('.lobby-laps-btn')];
  for (const b of lapButtons) {
    b.addEventListener('click', () => {
      const next = Math.max(RACE.minLaps, Math.min(RACE.maxLaps, session.race.laps + Number(b.dataset.d)));
      if (next !== session.race.laps) handlers.onLaps(next);
    });
  }

  const update = () => {
    if (session.full) {
      wait.textContent = `The room is full (${MAX_PLAYERS} players). Try again later.`;
      start.hidden = true;
      return;
    }
    if (!session.joined) {
      list.innerHTML = '';
      count.textContent = '';
      start.hidden = true;
      wait.textContent = 'Connecting to the host…';
      return;
    }
    // Show the server's default ("Player 3") as a placeholder so typing replaces it.
    if (session.me) nameInput.placeholder = session.me.name;
    // Logged in: the profile's name is fixed (it's the login).
    const account = session.account;
    nameInput.disabled = !!account;
    if (account) nameInput.value = account.name;
    else if (document.activeElement !== nameInput) nameInput.value = session.profile.name;
    accountBtn.innerHTML = account
      ? `${avatarHtml({ ...account, color: account.livery.primary }, 22)} ${esc(account.name)} · my profile`
      : '👤 Log in / create a profile';
    authError.hidden = !session.authError;
    authError.textContent = session.authError ?? '';
    const livery = session.livery;
    for (const input of liveryInputs) {
      if (document.activeElement !== input) input.value = hex(livery[input.dataset.livery as 'primary' | 'secondary' | 'accent']);
    }
    if (document.activeElement !== numberInput) numberInput.value = String(livery.number);

    const takenBy = new Map(session.players.filter((p) => p.id !== session.myId).map((p) => [p.color, p.name]));
    for (const b of colorButtons) {
      const i = Number(b.dataset.color);
      const owner = takenBy.get(i);
      b.disabled = owner !== undefined;
      b.title = owner ? `${CAR_COLOR_NAMES[i]} — taken by ${owner}` : CAR_COLOR_NAMES[i]!;
      b.classList.toggle('selected', session.me?.color === i);
    }

    count.textContent = `(${session.players.filter((p) => p.connected).length}/${MAX_PLAYERS})`;
    list.innerHTML = session.players
      .map((p) => {
        const tags = [p.id === session.hostId ? '<span class="badge">host</span>' : '', p.id === session.myId ? '<span class="badge you">you</span>' : '']
          .filter(Boolean)
          .join('');
        return `<li class="${p.connected ? '' : 'away'} ${p.profileId ? 'has-profile' : ''}" ${p.profileId ? `data-profile="${p.profileId}" title="View profile"` : ''}>
          <span class="slot">${p.slot + 1}</span>
          ${avatarHtml({ photo: p.photo, tag: p.tag, color: p.livery.primary }, 26)}
          <span class="num">#${p.livery.number}</span>
          <span class="name">${esc(p.name)}</span>${tags}
          ${p.connected ? '' : '<span class="status">reconnecting…</span>'}
        </li>`;
      })
      .join('');

    for (const b of tyreButtons) b.classList.toggle('selected', b.dataset.tyre === session.tyre);
    for (const b of wearButtons) {
      b.classList.toggle('selected', b.dataset.wear === session.race.tyreWear);
      b.disabled = !session.isHost;
    }
    wearHint.textContent = session.isHost ? '' : 'set by the host';

    const entry = tracks().find((t) => t.id === session.race.trackId);
    const key = `${session.race.trackId}|${entry ? 1 : 0}`;
    if (key !== shownTrack) {
      shownTrack = key;
      trackName.textContent = entry ? `${entry.name}, ${entry.country}` : session.race.trackId;
      trackMeta.textContent = entry ? `${entry.lengthKm.toFixed(2)} km${entry.street ? ' · street circuit' : ''}` : '';
      if (entry) requestAnimationFrame(() => drawTrackPreview(trackMap, entry, { width: 2 }));
    }
    trackChange.hidden = !session.isHost;

    lapsValue.textContent = String(session.race.laps);
    for (const b of lapButtons) {
      const d = Number(b.dataset.d);
      b.hidden = !session.isHost;
      b.disabled = d < 0 ? session.race.laps <= RACE.minLaps : session.race.laps >= RACE.maxLaps;
    }
    lapsHint.textContent = session.isHost ? '' : 'set by the host';

    start.hidden = !session.isHost;
    const host = session.players.find((p) => p.id === session.hostId);
    wait.textContent = session.isHost ? 'You are the host — start when everyone is in.' : `Waiting for ${host?.name ?? 'the host'} to start…`;
  };

  return {
    update,
    show(visible: boolean) {
      root.hidden = !visible;
      if (!visible && document.activeElement === nameInput) nameInput.blur();
    },
  };
}
