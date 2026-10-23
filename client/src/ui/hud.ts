import type { BuiltTrack } from '@apex/shared';
import { keyLabel, type Action, type Bindings } from '../input/bindings.ts';
import { createMinimap, type MinimapCar } from './minimap.ts';
import { createPowerHud, type PowerFrame } from './powerHud.ts';
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
  power: PowerFrame;
}

/** Driving HUD: rev counter/speed/gear + power unit (bottom right), minimap (bottom left), key hints. */
export function createHud(root: HTMLElement, track: BuiltTrack) {
  root.innerHTML = `
    <div class="hud-power"></div>
    <div class="hud-speedo"></div>
    <div class="hud-minimap"></div>
    <div class="hud-help">
      <div class="hud-keys1"></div>
      <div><span class="hud-keys2"></span> <span class="hud-camera"></span> · <b>Esc</b> menu</div>
      <div class="hud-pad"></div>
    </div>`;
  const speedo = createSpeedometer(root.querySelector<HTMLElement>('.hud-speedo')!);
  const power = createPowerHud(root.querySelector<HTMLElement>('.hud-power')!);
  const minimap = createMinimap(root.querySelector<HTMLElement>('.hud-minimap')!, track);
  const cameraEl = root.querySelector<HTMLElement>('.hud-camera')!;
  const padEl = root.querySelector<HTMLElement>('.hud-pad')!;
  const last = { camera: '', pad: false };
  const keys1 = root.querySelector<HTMLElement>('.hud-keys1')!;
  const keys2 = root.querySelector<HTMLElement>('.hud-keys2')!;

  return {
    /** Shows the current key bindings in the hint line. */
    setBindings(b: Bindings) {
      const k = (a: Action) => (b[a].length ? b[a].map((c) => `<b>${keyLabel(c)}</b>`).join('/') : '<b>—</b>');
      keys1.innerHTML = `${k('throttle')} throttle · ${k('brake')} brake · ${k('left')} ${k('right')} steer`;
      keys2.innerHTML = `${k('boost')} boost · ${k('aero')} wings · ${k('handbrake')} handbrake · ${k('reset')} reset · ${k('camera')} camera`;
      const first = (a: Action) => (b[a][0] ? keyLabel(b[a][0]) : '—');
      power.setKeys(first('aero'), first('boost'));
    },

    setTrack(track: BuiltTrack) {
      minimap.setTrack(track);
    },

    update(f: HudFrame) {
      speedo.update(f.speedMs, f.rpm, f.gear);
      power.update(f.power);
      minimap.update(f.dt, f.me, f.others);
      // Only touch the DOM when something visible changed.
      if (f.camera !== last.camera) cameraEl.textContent = `(${f.camera})`;
      if (f.gamepad !== last.pad) {
        padEl.textContent = f.gamepad ? '🎮 Gamepad: RT/LT drive · stick steer · A/✕ handbrake · X/□ wings · RB/R1 boost · Y/△ camera · B/○ reset' : '';
      }
      last.camera = f.camera;
      last.pad = f.gamepad;
    },
  };
}
