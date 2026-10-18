import type { BuiltTrack } from '@apex/shared';
import { createMinimap, type MinimapCar } from './minimap.ts';
import { createSpeedometer } from './speedometer.ts';

export interface HudFrame {
  dt: number;
  speedMs: number;
  rpm: number;
  gear: string;
  camera: string;
  gamepad: boolean;
  me: { x: number; z: number; yaw: number; color: number };
  others: Iterable<MinimapCar>;
}

/** Driving HUD: rev counter/speed/gear (bottom right), minimap (bottom left), key hints. */
export function createHud(root: HTMLElement, track: BuiltTrack) {
  root.innerHTML = `
    <div class="hud-speedo"></div>
    <div class="hud-minimap"></div>
    <div class="hud-help">
      <div><b>W/S</b> or <b>↑/↓</b> throttle / brake · <b>A/D</b> or <b>←/→</b> steer</div>
      <div><b>Space</b> handbrake · <b>R</b> reset · <b>C</b> camera <span class="hud-camera"></span> · <b>Esc</b> menu</div>
      <div class="hud-pad"></div>
    </div>`;
  const speedo = createSpeedometer(root.querySelector<HTMLElement>('.hud-speedo')!);
  const minimap = createMinimap(root.querySelector<HTMLElement>('.hud-minimap')!, track);
  const cameraEl = root.querySelector<HTMLElement>('.hud-camera')!;
  const padEl = root.querySelector<HTMLElement>('.hud-pad')!;
  const last = { camera: '', pad: false };

  return {
    update(f: HudFrame) {
      speedo.update(f.speedMs, f.rpm, f.gear);
      minimap.update(f.dt, f.me, f.others);
      // Only touch the DOM when something visible changed.
      if (f.camera !== last.camera) cameraEl.textContent = `(${f.camera})`;
      if (f.gamepad !== last.pad) {
        padEl.textContent = f.gamepad ? '🎮 Gamepad: RT/LT drive · stick steer · A/✕ handbrake · Y/△ camera · B/○ reset' : '';
      }
      last.camera = f.camera;
      last.pad = f.gamepad;
    },
  };
}
