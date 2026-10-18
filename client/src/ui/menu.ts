import type { SettingsStore, UserSettings } from '../game/userSettings.ts';
import { CAMERA_LIMITS } from '../game/userSettings.ts';
import { ACTIONS, bindKey, DEFAULT_BINDINGS, keyLabel, RESERVED_KEYS, unbindKey, type Action } from '../input/bindings.ts';
import type { QualityManager, QualityMode } from '../render/quality.ts';

const QUALITY_MODES: { mode: QualityMode; label: string; hint: string }[] = [
  { mode: 'auto', label: 'Auto', hint: 'Picks the best level your device can run smoothly' },
  { mode: 'low', label: 'Low', hint: 'No shadows or effects — for weak laptops' },
  { mode: 'medium', label: 'Medium', hint: 'Shadows, bloom' },
  { mode: 'high', label: 'High', hint: 'Sharp soft shadows, ambient occlusion, glass refraction' },
];

const VOLUMES: { key: 'master' | 'engine' | 'effects' | 'ui'; label: string }[] = [
  { key: 'master', label: 'Master' },
  { key: 'engine', label: 'Engines' },
  { key: 'effects', label: 'Tyres, wind & impacts' },
  { key: 'ui', label: 'Countdown beeps' },
];

const TABS = ['audio', 'graphics', 'controls', 'camera'] as const;
type Tab = (typeof TABS)[number];

const GAMEPAD_HELP = 'RT / R2 throttle · LT / L2 brake · left stick steer · A / ✕ handbrake · B / ○ reset · Y / △ camera · Start menu';

/**
 * Pause menu (Esc, the ☰ button, or gamepad Start): audio volumes, graphics quality,
 * key bindings and camera options. Multiplayer can't pause, so the race keeps going and
 * your car just gets no input while it's open.
 */
export function createMenu(root: HTMLElement, store: SettingsStore, quality: QualityManager, onOpenChange: (open: boolean) => void) {
  root.innerHTML = `
    <button class="menu-button" type="button" aria-label="Menu" title="Menu (Esc)">☰</button>
    <div class="menu" hidden>
      <div class="menu-panel" role="dialog" aria-label="Menu">
        <header class="menu-head">
          <h1>Paused</h1>
          <p class="menu-note">The race keeps running — it's multiplayer. Your car coasts while this is open.</p>
        </header>
        <nav class="menu-tabs" role="tablist">
          ${TABS.map((t) => `<button type="button" role="tab" class="menu-tab" data-tab="${t}">${t[0]!.toUpperCase() + t.slice(1)}</button>`).join('')}
        </nav>

        <section class="menu-section" data-tab="audio">
          ${VOLUMES.map(
            (v) => `<label class="menu-row"><span>${v.label}</span>
              <input type="range" min="0" max="100" step="1" data-volume="${v.key}" /><output data-volume-out="${v.key}"></output></label>`,
          ).join('')}
          <label class="menu-check"><input type="checkbox" data-mute /> Mute all sound</label>
        </section>

        <section class="menu-section" data-tab="graphics">
          <div class="menu-options" role="radiogroup">
            ${QUALITY_MODES.map(
              (m) => `<label class="menu-option"><input type="radio" name="quality" value="${m.mode}" />
                <span><b>${m.label}</b><small>${m.hint}</small></span></label>`,
            ).join('')}
          </div>
          <p class="menu-status"></p>
          <label class="menu-check"><input type="checkbox" data-fps /> Show FPS counter</label>
        </section>

        <section class="menu-section" data-tab="controls">
          <table class="menu-keys"><tbody>
            ${ACTIONS.map(
              (a) => `<tr><th>${a.label}</th>
                <td><button type="button" class="menu-key" data-action="${a.id}" data-slot="0"></button></td>
                <td><button type="button" class="menu-key" data-action="${a.id}" data-slot="1"></button></td></tr>`,
            ).join('')}
            <tr><th>Menu</th><td><span class="menu-key fixed">Esc</span></td><td></td></tr>
          </tbody></table>
          <p class="menu-hint">Click a key, then press the new one. <b>Esc</b> cancels, <b>Delete</b> clears the slot.</p>
          <p class="menu-hint">🎮 ${GAMEPAD_HELP}. Browsers only expose gamepads on <b>localhost</b> or https, so on a friend's http:// LAN link it's keyboard only.</p>
          <button type="button" class="menu-secondary" data-reset-keys>Reset to defaults</button>
        </section>

        <section class="menu-section" data-tab="camera">
          <div class="menu-row"><span>View</span>
            <span class="menu-seg">
              <label><input type="radio" name="cam" value="chase" /> Chase</label>
              <label><input type="radio" name="cam" value="hood" /> Hood</label>
            </span></div>
          <label class="menu-row"><span>Chase distance</span>
            <input type="range" min="${CAMERA_LIMITS.distance[0] * 100}" max="${CAMERA_LIMITS.distance[1] * 100}" step="5" data-cam-distance /><output data-cam-distance-out></output></label>
          <label class="menu-row"><span>Field of view</span>
            <input type="range" min="${CAMERA_LIMITS.fovOffset[0]}" max="${CAMERA_LIMITS.fovOffset[1]}" step="1" data-cam-fov /><output data-cam-fov-out></output></label>
          <label class="menu-check"><input type="checkbox" data-cam-speedfov /> Widen view with speed</label>
          <p class="menu-hint">Tip: <b>C</b> (or your camera key) switches view while driving.</p>
        </section>

        <footer class="menu-foot"><button type="button" class="menu-resume">Resume</button></footer>
      </div>
    </div>`;

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const $$ = <T extends HTMLElement>(sel: string) => [...root.querySelectorAll<T>(sel)];
  const overlay = $('.menu');
  const isOpen = () => overlay.hidden !== true;
  const status = $('.menu-status');
  let tab: Tab = 'audio';
  /** Key slot waiting for a key press, if any. */
  let listening: HTMLButtonElement | null = null;

  const showTab = (t: Tab) => {
    tab = t;
    for (const b of $$<HTMLButtonElement>('.menu-tab')) b.setAttribute('aria-selected', String(b.dataset.tab === t));
    for (const s of $$('.menu-section')) s.hidden = s.dataset.tab !== t;
    if (t === 'graphics') syncQuality();
  };

  const syncQuality = () => {
    for (const r of $$<HTMLInputElement>('input[name=quality]')) r.checked = r.value === quality.mode;
    const auto = quality.mode === 'auto' ? (quality.settled ? ' (auto)' : ' (auto, measuring…)') : '';
    status.textContent = `Now: ${quality.level}${auto} · ${quality.fps.toFixed(0)} fps`;
  };

  /** Writes the stored settings into the controls. */
  const sync = (s: UserSettings) => {
    for (const v of VOLUMES) {
      $<HTMLInputElement>(`[data-volume="${v.key}"]`).value = String(Math.round(s.audio[v.key] * 100));
      $(`[data-volume-out="${v.key}"]`).textContent = `${Math.round(s.audio[v.key] * 100)}%`;
    }
    $<HTMLInputElement>('[data-mute]').checked = s.audio.muted;
    $<HTMLInputElement>('[data-fps]').checked = s.showFps;
    for (const b of $$<HTMLButtonElement>('.menu-key[data-action]')) {
      if (b === listening) continue;
      const code = s.bindings[b.dataset.action as Action][Number(b.dataset.slot)];
      b.textContent = code ? keyLabel(code) : '—';
      b.classList.toggle('empty', !code);
    }
    for (const r of $$<HTMLInputElement>('input[name=cam]')) r.checked = r.value === s.camera.mode;
    $<HTMLInputElement>('[data-cam-distance]').value = String(Math.round(s.camera.distance * 100));
    $('[data-cam-distance-out]').textContent = `${Math.round(s.camera.distance * 100)}%`;
    $<HTMLInputElement>('[data-cam-fov]').value = String(s.camera.fovOffset);
    $('[data-cam-fov-out]').textContent = `${s.camera.fovOffset > 0 ? '+' : ''}${s.camera.fovOffset}°`;
    $<HTMLInputElement>('[data-cam-speedfov]').checked = s.camera.speedFov;
  };
  store.subscribe(sync);

  const stopListening = () => {
    listening?.classList.remove('listening');
    listening = null;
    sync(store.value);
  };

  const setOpen = (open: boolean) => {
    if (open === isOpen()) return;
    overlay.hidden = !open;
    if (!open) stopListening();
    else showTab(tab);
    onOpenChange(open);
  };

  // --- Wiring.
  $('.menu-button').addEventListener('click', () => setOpen(!isOpen()));
  $('.menu-resume').addEventListener('click', () => setOpen(false));
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) setOpen(false); // click outside the panel
  });
  for (const b of $$<HTMLButtonElement>('.menu-tab')) b.addEventListener('click', () => showTab(b.dataset.tab as Tab));

  for (const v of VOLUMES) {
    $<HTMLInputElement>(`[data-volume="${v.key}"]`).addEventListener('input', (e) => {
      const value = Number((e.target as HTMLInputElement).value) / 100;
      store.update((s) => (s.audio[v.key] = value));
    });
  }
  $<HTMLInputElement>('[data-mute]').addEventListener('change', (e) => store.update((s) => (s.audio.muted = (e.target as HTMLInputElement).checked)));
  $<HTMLInputElement>('[data-fps]').addEventListener('change', (e) => store.update((s) => (s.showFps = (e.target as HTMLInputElement).checked)));
  for (const r of $$<HTMLInputElement>('input[name=quality]')) {
    r.addEventListener('change', () => {
      quality.setMode(r.value as QualityMode);
      syncQuality();
    });
  }
  for (const r of $$<HTMLInputElement>('input[name=cam]')) {
    r.addEventListener('change', () => store.update((s) => (s.camera.mode = r.value as UserSettings['camera']['mode'])));
  }
  $<HTMLInputElement>('[data-cam-distance]').addEventListener('input', (e) =>
    store.update((s) => (s.camera.distance = Number((e.target as HTMLInputElement).value) / 100)),
  );
  $<HTMLInputElement>('[data-cam-fov]').addEventListener('input', (e) =>
    store.update((s) => (s.camera.fovOffset = Number((e.target as HTMLInputElement).value))),
  );
  $<HTMLInputElement>('[data-cam-speedfov]').addEventListener('change', (e) =>
    store.update((s) => (s.camera.speedFov = (e.target as HTMLInputElement).checked)),
  );

  for (const b of $$<HTMLButtonElement>('.menu-key[data-action]')) {
    b.addEventListener('click', () => {
      const was = listening;
      stopListening();
      if (was === b) return;
      listening = b;
      b.classList.add('listening');
      b.textContent = 'press a key…';
    });
  }
  $('[data-reset-keys]').addEventListener('click', () => store.update((s) => (s.bindings = structuredClone(DEFAULT_BINDINGS))));

  // Capture phase, so a key being bound never reaches the game's keyboard handler.
  window.addEventListener(
    'keydown',
    (e) => {
      if (listening) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const action = listening.dataset.action as Action;
        const slot = Number(listening.dataset.slot);
        if (e.code === 'Escape') return stopListening();
        if (e.code === 'Delete' || e.code === 'Backspace') {
          store.update((s) => (s.bindings = unbindKey(s.bindings, action, slot)));
          return stopListening();
        }
        if (RESERVED_KEYS.has(e.code)) return;
        store.update((s) => (s.bindings = bindKey(s.bindings, action, slot, e.code)));
        return stopListening();
      }
      if (e.code === 'Escape') {
        e.preventDefault();
        setOpen(!isOpen());
      }
    },
    { capture: true },
  );
  // Keep the fps readout live while the graphics tab is open.
  setInterval(() => isOpen() && tab === 'graphics' && syncQuality(), 500);

  return {
    get open() {
      return isOpen();
    },
    toggle(open = !isOpen()) {
      setOpen(open);
    },
  };
}
