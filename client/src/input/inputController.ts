import { NEUTRAL_INPUT, type CarInput } from '@apex/shared';
import { createGamepad } from './gamepad.ts';
import { createKeyboard } from './keyboard.ts';

const KEYS = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
  reset: ['KeyR'],
  camera: ['KeyC'],
};

/** Merges keyboard + gamepad into one CarInput per physics tick. */
export function createInputController() {
  const kb = createKeyboard();
  const pad = createGamepad();
  const any = (codes: string[]) => codes.some((c) => kb.isDown(c));
  const pressed = (codes: string[]) => codes.map((c) => kb.consumePress(c)).some(Boolean);
  let cameraRequested = false;
  const input: CarInput = { ...NEUTRAL_INPUT };

  return {
    get gamepadConnected() {
      return pad.connected;
    },

    /** Call once per physics tick. Returns a reused object — copy it if you keep it. */
    sample(): CarInput {
      const gp = pad.poll();
      const kbSteer = (any(KEYS.right) ? 1 : 0) - (any(KEYS.left) ? 1 : 0);

      input.throttle = Math.max(any(KEYS.throttle) ? 1 : 0, gp?.throttle ?? 0);
      input.brake = Math.max(any(KEYS.brake) ? 1 : 0, gp?.brake ?? 0);
      input.steer = gp && gp.steer !== 0 ? gp.steer : kbSteer;
      input.handbrake = any(KEYS.handbrake) || !!gp?.handbrake;
      input.reset = pressed(KEYS.reset) || !!gp?.resetPressed;
      if (pressed(KEYS.camera) || gp?.cameraPressed) cameraRequested = true;
      return input;
    },

    /** True once after C / gamepad Y was pressed. Call once per frame. */
    consumeCameraCycle(): boolean {
      const r = cameraRequested;
      cameraRequested = false;
      return r;
    },
  };
}
