// Headless driving scenarios that turn the tuning values into comparable numbers.
// Used by vehicle.test.ts and by `npm run handling`.
import { FIXED_DT } from '../constants.ts';
import { NEUTRAL_INPUT, type CarInput } from '../input.ts';
import { CAR, type CarSpec } from '../tuning.ts';
import { createVehicle, stepVehicle, vehicleSpeed, type Vehicle } from './vehicle.ts';
import { addStaticBoxes, createWorld } from './world.ts';
import type { World } from './rapier.ts';

interface Rig {
  world: World;
  car: Vehicle;
}

const FLAT_GROUND = [
  {
    kind: 'ground' as const,
    halfExtents: { x: 10_000, y: 0.5, z: 10_000 },
    position: { x: 0, y: -0.5, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
  },
];

function rig(spec: CarSpec): Rig {
  const world = createWorld();
  addStaticBoxes(world, FLAT_GROUND);
  const car = createVehicle(world, { position: { x: 0, y: 1, z: 0 }, yaw: 0 }, spec);
  return { world, car };
}

function step(r: Rig, input: Partial<CarInput>, ticks: number, each?: () => void) {
  const full = { ...NEUTRAL_INPUT, ...input };
  for (let i = 0; i < ticks; i++) {
    stepVehicle(r.car, full, FIXED_DT);
    r.world.step();
    each?.();
  }
}

function upY(car: Vehicle) {
  const q = car.body.rotation();
  return 1 - 2 * (q.x * q.x + q.z * q.z);
}

/** Roll angle (deg) — tilt around the forward axis. */
function rollDeg(car: Vehicle) {
  const q = car.body.rotation();
  // chassis right axis (-X local) world-Y component
  const rightY = -(2 * (q.x * q.y + q.w * q.z));
  return (Math.asin(Math.max(-1, Math.min(1, rightY))) * 180) / Math.PI;
}

const SECONDS = (s: number) => Math.round(s / FIXED_DT);

export interface HandlingReport {
  restSagCm: number;
  zeroTo100s: number;
  topSpeedKmh: number;
  brake100to0m: number;
  /** Steady full-lock corner at ~70 km/h entry. */
  cornerLateralG: number;
  cornerMaxRollDeg: number;
  cornerStayedUpright: boolean;
  /** Handbrake yanked mid-corner: peak angle between heading and velocity. */
  handbrakeSlipDeg: number;
  /** Slip angle 1.5 s after releasing the handbrake and straightening the wheel. */
  handbrakeRecoverySlipDeg: number;
  /** Speed at the end of the handbrake manoeuvre — a spin-out ends near 0. */
  handbrakeEndSpeedKmh: number;
  /** Same corner without handbrake, for comparison. */
  noHandbrakeSlipDeg: number;
  /** Full lock at 160 km/h — the harshest rollover test. */
  highSpeedTurnUpright: boolean;
}

function slipAngleDeg(car: Vehicle) {
  const v = car.body.linvel();
  const sp = Math.hypot(v.x, v.z);
  if (sp < 3) return 0;
  const q = car.body.rotation();
  const fx = 2 * (q.x * q.z + q.w * q.y);
  const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
  const cos = (fx * v.x + fz * v.z) / (Math.hypot(fx, fz) * sp);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

/** Accelerate in a straight line to the target speed (m/s), then return. */
function accelerateTo(r: Rig, target: number, maxSeconds = 30) {
  for (let i = 0; i < SECONDS(maxSeconds) && vehicleSpeed(r.car) < target; i++) step(r, { throttle: 1 }, 1);
}

export function measureHandling(spec: CarSpec = CAR, log?: (phase: string) => void): HandlingReport {
  log?.('sag');
  // Rest sag
  let r = rig(spec);
  step(r, {}, SECONDS(3));
  const rest = r.car.controller.wheelSuspensionLength(0) ?? 0;
  const restSagCm = (spec.wheels.suspensionRestLength - rest) * 100;

  log?.('accel');
  // 0-100 and top speed
  let t = 0;
  while (vehicleSpeed(r.car) < 100 / 3.6 && t < SECONDS(30)) {
    step(r, { throttle: 1 }, 1);
    t++;
  }
  const zeroTo100s = t * FIXED_DT;
  step(r, { throttle: 1 }, SECONDS(45));
  const topSpeedKmh = vehicleSpeed(r.car) * 3.6;

  log?.('braking');
  // Braking 100-0
  r = rig(spec);
  step(r, {}, SECONDS(1));
  accelerateTo(r, 100 / 3.6);
  const z0 = r.car.body.translation().z;
  for (let i = 0; i < SECONDS(15) && vehicleSpeed(r.car) > 0.5; i++) step(r, { brake: 1 }, 1);
  const brake100to0m = r.car.body.translation().z - z0;

  log?.('cornering');
  // Steady cornering
  r = rig(spec);
  step(r, {}, SECONDS(1));
  accelerateTo(r, 70 / 3.6);
  let maxRoll = 0;
  let upright = true;
  let latG = 0;
  step(r, { throttle: 0.5, steer: 1 }, SECONDS(4), () => {
    maxRoll = Math.max(maxRoll, Math.abs(rollDeg(r.car)));
    if (upY(r.car) < 0.5) upright = false;
    const v = r.car.body.linvel();
    latG = (Math.abs(r.car.body.angvel().y) * Math.hypot(v.x, v.z)) / 9.81;
  });

  // Handbrake vs no-handbrake slip
  log?.('handbrake');
  // Turn in, pull the handbrake briefly, then release and straighten the wheel.
  const slipRun = (handbrake: boolean) => {
    const s = rig(spec);
    step(s, {}, SECONDS(1));
    accelerateTo(s, 75 / 3.6);
    let peak = 0;
    const track = () => (peak = Math.max(peak, slipAngleDeg(s.car)));
    step(s, { steer: 0.7, throttle: 0.3 }, SECONDS(0.3), track);
    step(s, { steer: 0.7, handbrake }, SECONDS(0.5), track);
    step(s, { steer: 0, throttle: 0.5 }, SECONDS(1.5), track);
    return { peak, end: slipAngleDeg(s.car), endSpeed: vehicleSpeed(s.car) * 3.6 };
  };
  const hb = slipRun(true);

  log?.('high-speed');
  // High-speed full lock
  r = rig(spec);
  step(r, {}, SECONDS(1));
  accelerateTo(r, 160 / 3.6);
  let hsUpright = true;
  step(r, { steer: 1, throttle: 1 }, SECONDS(3), () => {
    if (upY(r.car) < 0.5) hsUpright = false;
  });

  return {
    restSagCm,
    zeroTo100s,
    topSpeedKmh,
    brake100to0m,
    cornerLateralG: latG,
    cornerMaxRollDeg: maxRoll,
    cornerStayedUpright: upright,
    handbrakeSlipDeg: hb.peak,
    handbrakeRecoverySlipDeg: hb.end,
    handbrakeEndSpeedKmh: hb.endSpeed,
    noHandbrakeSlipDeg: slipRun(false).peak,
    highSpeedTurnUpright: hsUpright,
  };
}
