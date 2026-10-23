/** One tick of driver input. This is what clients send to the server. */
export interface CarInput {
  /** 0..1 */
  throttle: number;
  /** 0..1 — brakes when moving forward, reverses when (nearly) stopped. */
  brake: number;
  /** -1 (full left) .. +1 (full right) */
  steer: number;
  handbrake: boolean;
  /** One-shot: put the car back on its wheels. */
  reset: boolean;
  /** One-shot: toggle straight-mode wings (only has an effect inside a straight zone). */
  aero: boolean;
  /** Setting: open the wings automatically whenever allowed. */
  aeroAuto: boolean;
  /** Held: deploy stored electrical energy as extra power (boost). */
  boost: boolean;
}

export const NEUTRAL_INPUT: Readonly<CarInput> = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  reset: false,
  aero: false,
  aeroAuto: false,
  boost: false,
};
