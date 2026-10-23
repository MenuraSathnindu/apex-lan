// A simple robot driver for headless checks: pure-pursuit steering along the centreline and a
// speed plan from the curvature ahead. Used by tests and `npm run tracks:check` to prove that a
// track can be driven and that its checkpoints count a lap. Not a racing AI.
import { FIXED_DT } from '../constants.ts';
import { NEUTRAL_INPUT, type CarInput } from '../input.ts';
import { buildCheckpoints, nearestSample } from '../race/checkpoints.ts';
import { RaceTracker } from '../race/raceTracker.ts';
import type { BuiltTrack } from '../track/track.ts';
import type { CarSpec } from '../tuning.ts';
import { readChassisContacts } from './vehicleFx.ts';
import { addTrackColliders } from './trackColliders.ts';
import { createVehicle, resetVehicle, stepVehicle, vehicleSpeed, type Vehicle } from './vehicle.ts';
import { createWorld } from './world.ts';

const AUTOPILOT = {
  /** Share of the tyre grip the speed plan uses. */
  gripMargin: 0.75,
  /** Braking the plan assumes (m/s²) — well below what the car can do. */
  braking: 14,
  /** How far ahead the speed plan looks (m). */
  horizon: 250,
  /** Steering look-ahead: base + per m/s, clamped (m). */
  lookBase: 8,
  lookPerSpeed: 0.45,
  lookMax: 40,
};

export interface AutopilotState {
  hint: number;
}

/** Fills `out` with the input that follows the centreline at a safe speed. */
export function autopilotInput(car: Vehicle, track: BuiltTrack, state: AutopilotState, out: CarInput): CarInput {
  const { samples } = track;
  const n = samples.length;
  const step = samples[1]!.s;
  const spec = car.spec;
  const p = car.body.translation();
  const q = car.body.rotation();
  state.hint = nearestSample(track, p.x, p.z, state.hint);
  const speed = vehicleSpeed(car);
  const abs = Math.abs(speed);

  // Steering: pure pursuit towards a point ahead on the centreline.
  const look = Math.min(AUTOPILOT.lookMax, AUTOPILOT.lookBase + abs * AUTOPILOT.lookPerSpeed);
  const target = samples[(state.hint + Math.round(look / step)) % n]!;
  const fx = 2 * (q.x * q.z + q.w * q.y);
  const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
  const dx = target.x - p.x;
  const dz = target.z - p.z;
  // Left of the car = +X when facing +Z, i.e. (fz, -fx).
  const along = dx * fx + dz * fz;
  const left = dx * fz - dz * fx;
  const alpha = Math.atan2(left, along);
  const ld = Math.max(1, Math.hypot(dx, dz));
  const wheelbase = spec.wheels.frontZ - spec.wheels.rearZ;
  const wheelAngle = Math.atan((2 * Math.sin(alpha) * wheelbase) / ld); // + = left
  const st = spec.steering;
  const limit = st.maxAngle + (st.highSpeedAngle - st.maxAngle) * Math.min(1, abs / st.highSpeedRef);
  const steer = Math.max(-1, Math.min(1, -wheelAngle / limit));

  // Speed plan: the slowest of "corner speed at distance d, plus what braking from here allows".
  const mu = Math.min(spec.wheels.frictionSlip.front, spec.wheels.frictionSlip.rear) * AUTOPILOT.gripMargin;
  const k = spec.aero.modes.corner.downforce / spec.chassis.mass;
  let wanted = Infinity;
  for (let d = 0; d <= AUTOPILOT.horizon; d += step * 2) {
    const i = (state.hint + Math.round(d / step)) % n;
    let c = 0;
    for (let j = -2; j <= 2; j++) c += Math.abs(samples[(i + j + n) % n]!.curvature);
    c /= 5;
    // v² · c = μ (g + k v²)  →  v² = μ g / (c − μ k)
    const denom = c - mu * k;
    const vCorner = denom <= 0 ? Infinity : Math.sqrt((mu * 9.81) / denom);
    wanted = Math.min(wanted, Math.sqrt(vCorner * vCorner + 2 * AUTOPILOT.braking * d));
  }

  out.steer = steer;
  out.throttle = abs < wanted - 1 ? 1 : abs < wanted ? 0.3 : 0;
  out.brake = abs > wanted + 1 ? Math.min(1, (abs - wanted) / 6) : 0;
  out.handbrake = false;
  out.reset = false;
  out.aero = false;
  out.aeroAuto = false;
  out.boost = false;
  return out;
}

export interface LapDriveReport {
  completed: boolean;
  lapTimeS: number | null;
  /** Times the car got stuck/flipped and had to be put back on the track. */
  resets: number;
  /** Barrier contacts (impacts above 1 m/s). */
  barrierHits: number;
  topSpeedKmh: number;
}

/**
 * Drives one flying lap headlessly (start from grid slot 0), with the server's lap counter
 * watching the positions at 30 Hz like in a real race. A lap only counts if every checkpoint
 * gate was crossed in order.
 */
export function driveLap(track: BuiltTrack, spec?: CarSpec, maxSeconds = track.length / 12 + 60): LapDriveReport {
  const world = createWorld();
  addTrackColliders(world, track);
  const car = createVehicle(world, track.spawnGrid[0]!, spec);
  const tracker = new RaceTracker(track, buildCheckpoints(track), [1], 0, 1);
  const state: AutopilotState = { hint: -1 };
  const input: CarInput = { ...NEUTRAL_INPUT };
  let stuck = 0;
  let resets = 0;
  let barrierHits = 0;
  let top = 0;
  const ticks = Math.round(maxSeconds / FIXED_DT);
  for (let t = 0; t < ticks; t++) {
    autopilotInput(car, track, state, input);
    stepVehicle(car, input, FIXED_DT);
    world.step();
    const speed = Math.abs(vehicleSpeed(car));
    top = Math.max(top, speed);
    const { count, contacts } = readChassisContacts(car);
    for (let c = 0; c < count; c++) if (contacts[c]!.kind === 'barrier' && contacts[c]!.dv > 1) barrierHits++;
    stuck = speed < 1.5 && t > 120 ? stuck + FIXED_DT : 0;
    if (stuck > 3) {
      const smp = track.samples[(state.hint + 3) % track.samples.length]!;
      resetVehicle(car, { position: { x: smp.x, y: 1, z: smp.z }, yaw: Math.atan2(smp.tx, smp.tz) });
      resets++;
      stuck = 0;
    }
    if (t % 2 === 0) {
      const p = car.body.translation();
      const laps = tracker.onState(1, p.x, p.z, (t * 1000) / 60);
      if (laps.length) return { completed: true, lapTimeS: laps[0]!.time / 1000, resets, barrierHits, topSpeedKmh: top * 3.6 };
    }
  }
  return { completed: false, lapTimeS: null, resets, barrierHits, topSpeedKmh: top * 3.6 };
}

