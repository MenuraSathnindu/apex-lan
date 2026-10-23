import { NEUTRAL_INPUT, type CarInput } from '@apex/shared';
import { DEFAULT_BINDINGS, type Bindings } from './bindings.ts';
import { createGamepad } from './gamepad.ts';
import { createKeyboard } from './keyboard.ts';

/** Merges keyboard + gamepad into one CarInput per physics tick. */
export function createInputController() {
  const kb = createKeyboard();
  const pad = createGamepad();
  let KEYS: Bindings = DEFAULT_BINDINGS;
  let enabled = true;
  let menuRequested = false;
  const any = (codes: string[]) => codes.some((c) => kb.isDown(c));
  const pressed = (codes: string[]) => codes.map((c) => kb.consumePress(c)).some(Boolean);
  let cameraRequested = false;
  let aeroAuto = false;
  const input: CarInput = { ...NEUTRAL_INPUT };

  return {
    get gamepadConnected() {
      return pad.connected;
    },

    setBindings(b: Bindings) {
      KEYS = b;
    },

    /** Open the wings automatically inside straight zones (a setting). */
    setAeroAuto(on: boolean) {
      aeroAuto = on;
    },

    /** While disabled (menu open) the car gets neutral input and key presses are dropped. */
    setEnabled(on: boolean) {
      enabled = on;
      kb.clearPresses();
    },

    /** Call once per physics tick. Returns a reused object — copy it if you keep it. */
    sample(): CarInput {
      const gp = pad.poll();
      if (gp?.menuPressed) menuRequested = true;
      if (!enabled) {
        Object.assign(input, NEUTRAL_INPUT);
        return input;
      }
      const kbSteer = (any(KEYS.right) ? 1 : 0) - (any(KEYS.left) ? 1 : 0);

      input.throttle = Math.max(any(KEYS.throttle) ? 1 : 0, gp?.throttle ?? 0);
      input.brake = Math.max(any(KEYS.brake) ? 1 : 0, gp?.brake ?? 0);
      input.steer = gp && gp.steer !== 0 ? gp.steer : kbSteer;
      input.handbrake = any(KEYS.handbrake) || !!gp?.handbrake;
      input.reset = pressed(KEYS.reset) || !!gp?.resetPressed;
      input.aero = pressed(KEYS.aero) || !!gp?.aeroPressed;
      input.aeroAuto = aeroAuto;
      if (pressed(KEYS.camera) || gp?.cameraPressed) cameraRequested = true;
      return input;
    },

    /** True once after gamepad Start/Options was pressed. */
    consumeMenuToggle(): boolean {
      const r = menuRequested;
      menuRequested = false;
      return r;
    },

    /** True once after C / gamepad Y was pressed. Call once per frame. */
    consumeCameraCycle(): boolean {
      const r = cameraRequested;
      cameraRequested = false;
      return r;
    },
  };
}
