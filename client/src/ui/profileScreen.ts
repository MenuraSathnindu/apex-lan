import { LIVERY, NAME_MAX_LENGTH, PROFILE_RULES, defaultTag, type HallOfFameEntry, type Livery, type ProfilePage, type ProfileSummary } from '@apex/shared';
import { ApiCallError, type AccountClient } from '../game/accountClient.ts';
import { avatarHtml, esc, formatLap, formatSector } from './avatar.ts';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export interface ProfileScreenDeps {
  account: AccountClient;
  /** The profile this connection is logged in as (from the server), or null. */
  me: () => ProfileSummary | null;
  /** Livery to start a new profile from (what the player has now). */
  currentLivery: () => Livery;
  trackName: (id: string) => string;
  /** Called after create / login with the new token in `account`, and after logout. */
  onLogin: () => void;
  onLogout: () => void;
}

type Tab = 'me' | 'profile' | 'hof';

/**
 * Player profiles: create / log in, your profile (photo, tag, stats), anyone's profile page,
 * and the per-track Hall of Fame. A full-screen overlay opened from the lobby.
 */
export function createProfileScreen(root: HTMLElement, deps: ProfileScreenDeps) {
  root.innerHTML = `
    <div class="pf-panel" role="dialog" aria-label="Profiles">
      <header class="pf-head">
        <nav class="pf-tabs">
          <button type="button" data-tab="me">My profile</button>
          <button type="button" data-tab="profile" hidden>Driver</button>
          <button type="button" data-tab="hof">Hall of Fame</button>
        </nav>
        <button type="button" class="pf-close" aria-label="Close">✕</button>
      </header>
      <div class="pf-body"></div>
    </div>`;
  const body = root.querySelector<HTMLElement>('.pf-body')!;
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('.pf-tabs button')];
  const profileTab = tabs.find((b) => b.dataset.tab === 'profile')!;
  let tab: Tab = 'me';
  let viewing = 0;
  let hofTrack = '';
  /** Stale responses (the user switched tab meanwhile) are dropped. */
  let generation = 0;

  const selectTab = (t: Tab) => {
    tab = t;
    for (const b of tabs) b.setAttribute('aria-selected', String(b.dataset.tab === t));
    profileTab.hidden = t !== 'profile';
    void render();
  };
  for (const b of tabs) b.addEventListener('click', () => selectTab(b.dataset.tab as Tab));
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

  const errorText = (err: unknown) => (err instanceof ApiCallError ? err.message : 'something went wrong');

  async function render() {
    const gen = ++generation;
    if (tab === 'me') {
      const me = deps.me();
      if (!me) return renderSignIn();
      body.innerHTML = `${myHeader(me)}<div class="pf-page"><p class="pf-wait">Loading stats…</p></div>`;
      wireMyHeader();
      await fillPage(me.id, gen);
    } else if (tab === 'profile') {
      body.innerHTML = '<div class="pf-page"><p class="pf-wait">Loading…</p></div>';
      await fillPage(viewing, gen, true);
    } else await renderHallOfFame(gen);
  }

  // --- Sign in / create -----------------------------------------------------------

  function renderSignIn() {
    const l = deps.currentLivery();
    body.innerHTML = `
      <div class="pf-auth">
        <form class="pf-card pf-create" autocomplete="off">
          <h3>Create a profile</h3>
          <label>Name <input name="name" maxlength="${NAME_MAX_LENGTH}" required minlength="${PROFILE_RULES.nameMin}" /></label>
          <div class="pf-row">
            <label>Tag <input name="tag" maxlength="3" pattern="[A-Za-z]{3}" required class="pf-tag" title="Three letters, shown on the timing tower" /></label>
            <label>Number <input name="number" type="number" min="0" max="${LIVERY.numberMax}" value="${l.number}" required /></label>
          </div>
          <div class="pf-row pf-colors">
            <label>Primary <input name="primary" type="color" value="${hex(l.primary)}" /></label>
            <label>Secondary <input name="secondary" type="color" value="${hex(l.secondary)}" /></label>
            <label>Accent <input name="accent" type="color" value="${hex(l.accent)}" /></label>
          </div>
          <div class="pf-row">
            <label>PIN <input name="pin" type="password" inputmode="numeric" pattern="\\d{4}" maxlength="4" required /></label>
            <label>PIN again <input name="pin2" type="password" inputmode="numeric" pattern="\\d{4}" maxlength="4" required /></label>
          </div>
          <label>Photo (optional) <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" /></label>
          <p class="pf-note">The PIN only stops friends on this LAN from driving as you. It is not real security — don't use a PIN you use anywhere else.</p>
          <p class="pf-error" role="alert"></p>
          <button type="submit" class="pf-primary">Create profile</button>
        </form>
        <form class="pf-card pf-login" autocomplete="off">
          <h3>Log in</h3>
          <p class="pf-note">Already have a profile on this host? Log in on this device.</p>
          <label>Name <input name="name" maxlength="${NAME_MAX_LENGTH}" required /></label>
          <label>PIN <input name="pin" type="password" inputmode="numeric" pattern="\\d{4}" maxlength="4" required /></label>
          <p class="pf-error" role="alert"></p>
          <button type="submit" class="pf-primary">Log in</button>
        </form>
      </div>`;
    const create = body.querySelector<HTMLFormElement>('.pf-create')!;
    const login = body.querySelector<HTMLFormElement>('.pf-login')!;
    const nameInput = create.elements.namedItem('name') as HTMLInputElement;
    const tagInput = create.elements.namedItem('tag') as HTMLInputElement;
    let tagEdited = false;
    tagInput.addEventListener('input', () => (tagEdited = true));
    nameInput.addEventListener('input', () => {
      if (!tagEdited) tagInput.value = defaultTag(nameInput.value);
    });

    create.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(create);
      const err = create.querySelector<HTMLElement>('.pf-error')!;
      const pin = String(f.get('pin'));
      if (pin !== String(f.get('pin2'))) return void (err.textContent = 'The two PINs are different.');
      const photo = f.get('photo');
      const file = photo instanceof File && photo.size > 0 ? photo : null;
      if (file && !PHOTO_TYPES.includes(file.type)) return void (err.textContent = 'Photo must be JPEG, PNG or WebP.');
      if (file && file.size > PROFILE_RULES.photoMaxBytes) return void (err.textContent = 'Photo must be 5 MB or smaller.');
      const color = (k: string) => parseInt(String(f.get(k)).slice(1), 16);
      err.textContent = '';
      try {
        await deps.account.create({
          name: String(f.get('name')),
          tag: String(f.get('tag')).toUpperCase(),
          pin,
          livery: { primary: color('primary'), secondary: color('secondary'), accent: color('accent'), number: Number(f.get('number')) },
        });
        if (file) {
          try {
            await deps.account.uploadPhoto(file);
          } catch (photoErr) {
            alert(`Profile created, but the photo was refused: ${errorText(photoErr)}`);
          }
        }
        deps.onLogin();
      } catch (e2) {
        err.textContent = errorText(e2);
      }
    });

    login.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(login);
      const err = login.querySelector<HTMLElement>('.pf-error')!;
      err.textContent = '';
      try {
        await deps.account.login(String(f.get('name')), String(f.get('pin')));
        deps.onLogin();
      } catch (e2) {
        err.textContent = errorText(e2);
      }
    });
  }

  // --- Your profile ---------------------------------------------------------------

  function myHeader(me: ProfileSummary) {
    return `
      <div class="pf-me">
        ${avatarHtml({ ...me, color: me.livery.primary }, 96, 'pf-avatar')}
        <div class="pf-me-info">
          <h2>${esc(me.name)} <span class="pf-number">#${me.livery.number}</span></h2>
          <label class="pf-inline">Tag <input class="pf-tag" maxlength="3" value="${esc(me.tag)}" /> <button type="button" class="pf-save-tag">Save</button></label>
          <div class="pf-actions">
            <label class="pf-button">Change photo<input type="file" accept="image/jpeg,image/png,image/webp" hidden /></label>
            ${me.photo ? '<button type="button" class="pf-remove-photo">Remove photo</button>' : ''}
            <button type="button" class="pf-logout">Log out</button>
          </div>
          <p class="pf-note">Colours and number: change them in the lobby — they're saved to your profile.</p>
          <p class="pf-error" role="alert"></p>
        </div>
      </div>`;
  }

  function wireMyHeader() {
    const err = body.querySelector<HTMLElement>('.pf-me .pf-error')!;
    const run = async (task: () => Promise<unknown>) => {
      err.textContent = '';
      try {
        await task();
        // The server pushes the change to the room; re-render once the roster has it.
        setTimeout(() => void render(), 150);
      } catch (e) {
        err.textContent = errorText(e);
      }
    };
    body.querySelector('.pf-save-tag')!.addEventListener('click', () => {
      const tag = body.querySelector<HTMLInputElement>('.pf-me .pf-tag')!.value.toUpperCase();
      void run(() => deps.account.update({ tag }));
    });
    body.querySelector<HTMLInputElement>('.pf-me input[type=file]')!.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (!PHOTO_TYPES.includes(file.type)) return void (err.textContent = 'Photo must be JPEG, PNG or WebP.');
      if (file.size > PROFILE_RULES.photoMaxBytes) return void (err.textContent = 'Photo must be 5 MB or smaller.');
      void run(() => deps.account.uploadPhoto(file));
    });
    body.querySelector('.pf-remove-photo')?.addEventListener('click', () => void run(() => deps.account.removePhoto()));
    body.querySelector('.pf-logout')!.addEventListener('click', async () => {
      await deps.account.logout().catch(() => {});
      deps.onLogout();
      void render();
    });
  }

  // --- Profile page (stats, bests, head-to-head) ------------------------------------

  async function fillPage(id: number, gen: number, withHeader = false) {
    let page: ProfilePage;
    try {
      page = await deps.account.profilePage(id);
    } catch (e) {
      if (gen === generation) body.querySelector('.pf-page')!.innerHTML = `<p class="pf-error">${esc(errorText(e))}</p>`;
      return;
    }
    if (gen !== generation) return;
    const { profile: p, stats: s, tracks, headToHead } = page;
    const stat = (label: string, value: number) => `<div class="pf-stat"><b>${value}</b><span>${label}</span></div>`;
    body.querySelector('.pf-page')!.innerHTML = `
      ${withHeader ? `<div class="pf-me">${avatarHtml({ ...p, color: p.livery.primary }, 96, 'pf-avatar')}<div class="pf-me-info"><h2>${esc(p.name)} <span class="pf-number">#${p.livery.number}</span></h2><span class="pf-tagline">${esc(p.tag)}</span></div></div>` : ''}
      <div class="pf-stats">
        ${stat('Races', s.races)}${stat('Wins', s.wins)}${stat('Podiums', s.podiums)}${stat('Poles', s.poles)}
        ${stat('Fastest laps', s.fastestLaps)}${stat('DNFs', s.dnfs)}${stat('Points', s.points)}${stat('Titles', s.championships)}
        ${stat('Laps', s.laps)}${stat('Practice runs', s.practice)}
      </div>
      <h3>Personal bests</h3>
      ${
        tracks.length
          ? `<table class="pf-table"><thead><tr><th>Track</th><th>Best lap</th><th>S1</th><th>S2</th><th>S3</th><th title="Sum of the best sectors">Ideal</th><th>Laps</th></tr></thead><tbody>
            ${tracks
              .map((t) => {
                const ideal = t.bestSectors.every((x) => x !== null) ? t.bestSectors.reduce((a, b) => a! + b!, 0) : null;
                return `<tr><td>${esc(deps.trackName(t.trackId))}</td><td class="pf-time">${formatLap(t.bestLapMs)}</td>
                  ${t.bestSectors.map((b, i) => `<td class="pf-time" title="Best: ${formatSector(b)} · in best lap: ${formatSector(t.bestLapSectors[i])}">${formatSector(b)}</td>`).join('')}
                  <td class="pf-time">${formatLap(ideal)}</td><td>${t.laps}</td></tr>`;
              })
              .join('')}</tbody></table>`
          : '<p class="pf-note">No laps recorded yet. Race with a profile to set some.</p>'
      }
      <h3>Head to head</h3>
      ${
        headToHead.length
          ? `<table class="pf-table"><thead><tr><th></th><th>Driver</th><th>Ahead</th><th>Behind</th></tr></thead><tbody>
            ${headToHead
              .map(
                (h) =>
                  `<tr class="pf-link" data-id="${h.opponent.id}"><td>${avatarHtml({ ...h.opponent, color: h.opponent.livery.primary }, 28)}</td><td>${esc(h.opponent.name)}</td><td>${h.ahead}</td><td>${h.behind}</td></tr>`,
              )
              .join('')}</tbody></table>`
          : '<p class="pf-note">No races against other profiles yet.</p>'
      }`;
    wireProfileLinks();
  }

  function wireProfileLinks() {
    for (const row of body.querySelectorAll<HTMLElement>('.pf-link')) {
      row.addEventListener('click', () => showProfile(Number(row.dataset.id)));
    }
  }

  // --- Hall of fame ----------------------------------------------------------------

  async function renderHallOfFame(gen: number) {
    body.innerHTML = '<p class="pf-wait">Loading…</p>';
    let tracks: string[];
    try {
      tracks = (await deps.account.hallOfFameTracks()).tracks;
    } catch (e) {
      body.innerHTML = `<p class="pf-error">${esc(errorText(e))}</p>`;
      return;
    }
    if (gen !== generation) return;
    if (!tracks.length) {
      body.innerHTML = '<p class="pf-note">No laps recorded yet. Race with a profile and the fastest laps of every track show up here.</p>';
      return;
    }
    if (!tracks.includes(hofTrack)) hofTrack = tracks[0]!;
    body.innerHTML = `
      <label class="pf-inline">Track <select class="pf-track">${tracks
        .map((t) => `<option value="${esc(t)}"${t === hofTrack ? ' selected' : ''}>${esc(deps.trackName(t))}</option>`)
        .join('')}</select></label>
      <div class="pf-hof"><p class="pf-wait">Loading…</p></div>`;
    body.querySelector<HTMLSelectElement>('.pf-track')!.addEventListener('change', (e) => {
      hofTrack = (e.target as HTMLSelectElement).value;
      void render();
    });
    let rows: HallOfFameEntry[];
    try {
      rows = await deps.account.hallOfFame(hofTrack);
    } catch (e) {
      body.querySelector('.pf-hof')!.innerHTML = `<p class="pf-error">${esc(errorText(e))}</p>`;
      return;
    }
    if (gen !== generation) return;
    const best = rows[0]?.lapMs ?? 0;
    body.querySelector('.pf-hof')!.innerHTML = `
      <table class="pf-table"><thead><tr><th>#</th><th></th><th>Driver</th><th>Lap</th><th>Gap</th><th>S1</th><th>S2</th><th>S3</th><th>Set</th></tr></thead><tbody>
      ${rows
        .map(
          (r) => `<tr class="pf-link" data-id="${r.profile.id}"><td>${r.rank}</td><td>${avatarHtml({ ...r.profile, color: r.profile.livery.primary }, 28)}</td>
            <td><b>${esc(r.profile.tag)}</b> ${esc(r.profile.name)}</td><td class="pf-time">${formatLap(r.lapMs)}</td>
            <td class="pf-time">${r.rank === 1 ? '' : `+${((r.lapMs - best) / 1000).toFixed(3)}`}</td>
            ${r.sectors.map((x) => `<td class="pf-time">${formatSector(x)}</td>`).join('')}
            <td>${new Date(r.setAt).toLocaleDateString()}</td></tr>`,
        )
        .join('')}</tbody></table>`;
    wireProfileLinks();
  }

  function showProfile(id: number) {
    viewing = id;
    root.hidden = false;
    selectTab(deps.me()?.id === id ? 'me' : 'profile');
  }

  root.hidden = true;
  return {
    showAccount() {
      root.hidden = false;
      selectTab('me');
    },
    showProfile,
    showHallOfFame(trackId?: string) {
      if (trackId) hofTrack = trackId;
      root.hidden = false;
      selectTab('hof');
    },
    /** Re-render if open (e.g. after logging in, or the roster changed our profile). */
    refresh() {
      if (!root.hidden) void render();
    },
    get open() {
      return !root.hidden;
    },
  };
}
