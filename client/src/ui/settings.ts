import type { QualityManager, QualityMode } from '../render/quality.ts';

const MODES: { mode: QualityMode; label: string; hint: string }[] = [
  { mode: 'auto', label: 'Auto', hint: 'Picks the best level your device can run smoothly' },
  { mode: 'low', label: 'Low', hint: 'No shadows or effects — for weak laptops' },
  { mode: 'medium', label: 'Medium', hint: 'Shadows, bloom' },
  { mode: 'high', label: 'High', hint: 'Sharp soft shadows, ambient occlusion, glass refraction' },
];

/** Settings panel: Esc or the gear button toggles it. */
export function createSettings(root: HTMLElement, quality: QualityManager) {
  root.innerHTML = `
    <button class="settings-gear" type="button" aria-label="Settings" title="Settings (Esc)">⚙</button>
    <div class="settings-panel" hidden>
      <h2>Graphics</h2>
      <div class="settings-options" role="radiogroup">
        ${MODES.map(
          (m) => `<label class="settings-option">
            <input type="radio" name="quality" value="${m.mode}" />
            <span><b>${m.label}</b><small>${m.hint}</small></span>
          </label>`,
        ).join('')}
      </div>
      <p class="settings-status"></p>
      <button class="settings-close" type="button">Close</button>
    </div>`;

  const panel = root.querySelector<HTMLElement>('.settings-panel')!;
  const status = root.querySelector<HTMLElement>('.settings-status')!;
  const radios = [...root.querySelectorAll<HTMLInputElement>('input[name=quality]')];

  const sync = () => {
    for (const r of radios) r.checked = r.value === quality.mode;
    const auto = quality.mode === 'auto' ? (quality.settled ? ' (auto)' : ' (auto, measuring…)') : '';
    status.textContent = `Now: ${quality.level}${auto} · ${quality.fps.toFixed(0)} fps`;
  };
  const toggle = (open = panel.hidden) => {
    panel.hidden = !open;
    if (open) sync();
  };

  root.querySelector('.settings-gear')!.addEventListener('click', () => toggle());
  root.querySelector('.settings-close')!.addEventListener('click', () => toggle(false));
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') toggle();
  });
  for (const r of radios) {
    r.addEventListener('change', () => {
      quality.setMode(r.value as QualityMode);
      sync();
    });
  }
  // Keep the fps readout live while open.
  setInterval(() => !panel.hidden && sync(), 500);

  return { get open() { return !panel.hidden; } };
}
