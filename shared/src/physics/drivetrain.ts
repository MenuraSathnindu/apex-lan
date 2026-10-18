import { CAR, DRIVETRAIN } from '../tuning.ts';

export type DrivetrainSpec = typeof DRIVETRAIN;

/**
 * A simple automatic gearbox for engine sound and the HUD. The physics engine model
 * (`CAR.engine`, constant power) doesn't use gears, so this only has to look and sound
 * right: rpm follows wheel speed through the current ratio, shifts up near the redline
 * (earlier at light throttle), shifts down as speed drops, with a short throttle cut on shifts.
 */
export interface DrivetrainState {
  /** -1 = reverse, 0 = neutral, 1..n = forward gears. */
  gear: number;
  rpm: number;
  /** Seconds left in the current shift (throttle cut). */
  shifting: number;
  /** Effective throttle after shift cuts and the rev limiter (0..1) — drive the engine sound with this. */
  load: number;
  /** True for one step when a shift happened (for a sound cue). */
  shifted: boolean;
}

export function createDrivetrain(spec: DrivetrainSpec = DRIVETRAIN): DrivetrainState {
  return { gear: 0, rpm: spec.idleRpm, shifting: 0, load: 0, shifted: false };
}

const RPM_PER_MS = 60 / (2 * Math.PI * CAR.wheels.radius);

/** Engine rpm the wheels would force in a gear at this speed (no clutch slip). */
export function wheelRpm(speed: number, gear: number, spec: DrivetrainSpec = DRIVETRAIN): number {
  const ratio = gear < 0 ? spec.reverseRatio : gear === 0 ? 0 : spec.ratios[gear - 1]!;
  return Math.abs(speed) * RPM_PER_MS * ratio * spec.finalDrive;
}

/**
 * Advances the gearbox by dt.
 * @param speed signed forward speed (m/s)
 * @param throttle 0..1 (accelerator — for reverse, pass the brake pedal while reversing)
 * @param braking true while the brake pedal is pressed and the car moves forward
 */
export function stepDrivetrain(
  s: DrivetrainState,
  speed: number,
  throttle: number,
  braking: boolean,
  dt: number,
  spec: DrivetrainSpec = DRIVETRAIN,
): void {
  s.shifted = false;
  const top = spec.ratios.length;
  const abs = Math.abs(speed);

  // Gear selection.
  if (speed < -0.5) {
    s.gear = -1;
  } else if (abs < 0.3 && throttle === 0) {
    s.gear = 0;
  } else if (s.gear <= 0) {
    s.gear = 1;
  } else if (s.shifting <= 0) {
    const upAt = spec.lazyUpshiftRpm + (spec.upshiftRpm - spec.lazyUpshiftRpm) * throttle;
    const downAt = braking ? spec.brakingDownshiftRpm : spec.downshiftRpm;
    if (s.gear < top && wheelRpm(speed, s.gear, spec) > upAt) {
      s.gear++;
      s.shifting = spec.shiftTime;
      s.shifted = true;
    } else if (s.gear > 1 && wheelRpm(speed, s.gear, spec) < downAt && wheelRpm(speed, s.gear - 1, spec) < upAt * 0.95) {
      s.gear--;
      s.shifting = spec.shiftTime * 0.7;
      s.shifted = true;
    }
  }
  s.shifting = Math.max(0, s.shifting - dt);

  // Target rpm.
  const cut = s.shifting > 0 ? 0 : throttle;
  let target: number;
  if (s.gear === 0) {
    // Neutral: free revving.
    target = spec.idleRpm + (spec.redlineRpm - spec.idleRpm) * cut;
    const rate = target > s.rpm ? spec.freeRevUp : spec.freeRevDown;
    s.rpm += Math.sign(target - s.rpm) * Math.min(Math.abs(target - s.rpm), rate * dt);
  } else {
    target = wheelRpm(speed, s.gear, spec);
    // Clutch slip while launching: revs rise ahead of the wheels, fading out as the clutch bites.
    const clutch = s.gear === 1 || s.gear === -1 ? Math.max(0, 1 - abs / spec.clutchSpeed) : 0;
    target = Math.max(target, spec.idleRpm + spec.launchRpm * cut * clutch, spec.idleRpm);
    s.rpm += (target - s.rpm) * (1 - Math.exp(-spec.rpmResponse * dt));
  }

  // Rev limiter: bounce off the limit with the throttle cut.
  let load = cut;
  if (s.rpm >= spec.limiterRpm) {
    s.rpm = spec.limiterRpm - 250;
    load = 0;
  }
  s.rpm = Math.max(spec.idleRpm * 0.9, s.rpm);
  s.load = load;
}

/** Gear as shown on the HUD. */
export function gearLabel(gear: number): string {
  return gear < 0 ? 'R' : gear === 0 ? 'N' : String(gear);
}
