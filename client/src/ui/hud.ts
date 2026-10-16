export function createHud(root: HTMLElement) {
  root.innerHTML = `
    <div class="hud-speed"><span class="hud-speed-value">0</span><span class="hud-speed-unit">km/h</span></div>
    <div class="hud-help">
      <div><b>W/S</b> or <b>↑/↓</b> throttle / brake · <b>A/D</b> or <b>←/→</b> steer</div>
      <div><b>Space</b> handbrake · <b>R</b> reset · <b>C</b> camera <span class="hud-camera"></span></div>
      <div class="hud-pad"></div>
    </div>`;
  const speedEl = root.querySelector<HTMLElement>('.hud-speed-value')!;
  const cameraEl = root.querySelector<HTMLElement>('.hud-camera')!;
  const padEl = root.querySelector<HTMLElement>('.hud-pad')!;
  let last = { speed: -1, camera: '', pad: false };

  return {
    update(speedMs: number, camera: string, gamepad: boolean) {
      const speed = Math.round(Math.abs(speedMs) * 3.6);
      // Only touch the DOM when something visible changed.
      if (speed !== last.speed) speedEl.textContent = String(speed);
      if (camera !== last.camera) cameraEl.textContent = `(${camera})`;
      if (gamepad !== last.pad) {
        padEl.textContent = gamepad ? '🎮 Gamepad: RT/LT drive · stick steer · A/✕ handbrake · Y/△ camera · B/○ reset' : '';
      }
      last = { speed, camera, pad: gamepad };
    },
  };
}
