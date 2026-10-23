import { CAR_COLORS, CAR_COLOR_NAMES, LIVERY, MAX_PLAYERS, NAME_MAX_LENGTH, RACE, presetLivery, type Livery } from '@apex/shared';
import type { Session } from '../game/session.ts';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export interface LobbyHandlers {
  onProfile(name: string, color: number, livery: Livery): void;
  onStart(): void;
  onLaps(laps: number): void;
}

/** Pre-race screen: name, colour, who's here, and the host's Start button. */
export function createLobby(root: HTMLElement, session: Session, handlers: LobbyHandlers) {
  root.innerHTML = `
    <div class="lobby-panel">
      <h1>apex-lan</h1>
      <p class="lobby-join">Friends join at <b>${esc(location.host)}</b></p>
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
    nameTimer = setTimeout(() => handlers.onProfile(nameInput.value, session.profile.color, livery), 250);
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
      handlers.onProfile(nameInput.value, color, { ...presetLivery(color), number: session.livery.number });
    });
  }
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
    if (document.activeElement !== nameInput) nameInput.value = session.profile.name;
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
        return `<li class="${p.connected ? '' : 'away'}">
          <span class="slot">${p.slot + 1}</span>
          <span class="dot" style="background:${hex(p.livery.primary)}"></span>
          <span class="num">#${p.livery.number}</span>
          <span class="name">${esc(p.name)}</span>${tags}
          ${p.connected ? '' : '<span class="status">reconnecting…</span>'}
        </li>`;
      })
      .join('');

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
