import { INPUT } from '@apex/shared';

/** Button indices in the W3C "standard" gamepad mapping (Xbox / PlayStation). */
const BTN = {
  A_CROSS: 0,
  B_CIRCLE: 1,
  X_SQUARE: 2,
  Y_TRIANGLE: 3,
  RB_R1: 5,
  LT_L2: 6,
  RT_R2: 7,
  VIEW_SHARE: 8,
  START_OPTIONS: 9,
} as const;

export interface GamepadSample {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  resetPressed: boolean;
  aeroPressed: boolean;
  boost: boolean;
  cameraPressed: boolean;
  menuPressed: boolean;
}

function deadzone(v: number, dz: number) {
  const a = Math.abs(v);
  return a < dz ? 0 : (Math.sign(v) * (a - dz)) / (1 - dz);
}

/**
 * Polls the first connected gamepad. Note: browsers only expose gamepads to secure
 * contexts (https or localhost) — friends on plain http://<lan-ip> fall back to keyboard.
 */
export function createGamepad() {
  let prev: boolean[] = [];
  let connected = false;

  const edge = (pad: Gamepad, i: number) => !!pad.buttons[i]?.pressed && !prev[i];

  return {
    get connected() {
      return connected;
    },
    poll(): GamepadSample | null {
      let pads: (Gamepad | null)[] = [];
      try {
        pads = navigator.getGamepads?.() ?? [];
      } catch {
        // Insecure context or permissions policy: no gamepad support.
      }
      const pad = pads.find((p): p is Gamepad => !!p && p.connected);
      connected = !!pad;
      if (!pad) {
        prev = [];
        return null;
      }

      const trigger = (i: number) => deadzone(pad.buttons[i]?.value ?? 0, INPUT.triggerDeadzone);
      const rawSteer = deadzone(pad.axes[0] ?? 0, INPUT.gamepadDeadzone);
      const sample: GamepadSample = {
        throttle: trigger(BTN.RT_R2),
        brake: trigger(BTN.LT_L2),
        steer: Math.sign(rawSteer) * Math.abs(rawSteer) ** INPUT.gamepadSteerExponent,
        handbrake: !!pad.buttons[BTN.A_CROSS]?.pressed,
        resetPressed: edge(pad, BTN.VIEW_SHARE) || edge(pad, BTN.B_CIRCLE),
        boost: !!pad.buttons[BTN.RB_R1]?.pressed,
        aeroPressed: edge(pad, BTN.X_SQUARE),
        cameraPressed: edge(pad, BTN.Y_TRIANGLE),
        menuPressed: edge(pad, BTN.START_OPTIONS),
      };
      prev = pad.buttons.map((b) => b.pressed);
      return sample;
    },
  };
}
