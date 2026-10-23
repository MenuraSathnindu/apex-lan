import type { CarInput } from '../input.ts';
import { CAR, type CarSpec, type SurfaceKind, type Vec3Like } from '../tuning.ts';
import { CAR_GROUPS, WHEEL_RAY_GROUPS } from './collisionGroups.ts';
import { aeroCoefficients, createAero, stepAero, type AeroCoefficients, type AeroState } from './aero.ts';
import { surfaceOf } from './surfaces.ts';
import { RAPIER, type DynamicRayCastVehicleController, type RigidBody, type World } from './rapier.ts';

/** Wheel order used everywhere: front-left, front-right, rear-left, rear-right. */
export const WHEEL_COUNT = 4;
const FRONT = [0, 1] as const;
const REAR = [2, 3] as const;

export interface SpawnPose {
  position: Vec3Like;
  /** Heading around +Y; 0 = facing +Z. */
  yaw: number;
}

export interface Vehicle {
  readonly spec: CarSpec;
  readonly world: World;
  readonly body: RigidBody;
  readonly controller: DynamicRayCastVehicleController;
  /** Current front-wheel angle (rad, positive = left), rate-limited toward the input target. */
  steerAngle: number;
  /** 0 = handbrake grip, 1 = full grip; eases back after releasing the handbrake. */
  rearGrip: number;
  upsideDownTime: number;
  /** Active-aero wing state (corner / straight mode). */
  readonly aero: AeroState;
  /** Set by the game each tick: the car is inside a straight-mode zone of the track. */
  inAeroZone: boolean;
  /** What each wheel touched last tick (FL, FR, RL, RR). */
  readonly surfaces: SurfaceKind[];
}

/** Per-wheel visual state, all in chassis space. */
export interface WheelState {
  /** Wheel centre in chassis space. */
  position: Vec3Like;
  /** Steering angle around chassis +Y (positive = left). */
  steer: number;
  /** Accumulated spin around the axle (positive = rolling forward). */
  spin: number;
  inContact: boolean;
}

/** Wheel attachment point in chassis space (FL, FR, RL, RR). */
export function wheelConnection(spec: CarSpec, i: number): Vec3Like {
  const w = spec.wheels;
  const left = i % 2 === 0; // FL, RL
  const front = i < 2;
  return { x: left ? w.halfTrack : -w.halfTrack, y: w.connectionY, z: front ? w.frontZ : w.rearZ };
}

function yawQuat(yaw: number) {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

export function createVehicle(world: World, pose: SpawnPose, spec: CarSpec = CAR): Vehicle {
  const c = spec.chassis;
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pose.position.x, pose.position.y, pose.position.z)
      .setRotation(yawQuat(pose.yaw))
      .setLinearDamping(c.linearDamping)
      .setAngularDamping(c.angularDamping)
      .setCanSleep(false)
      // Continuous collision so the car cannot tunnel through thin barriers at speed.
      .setCcdEnabled(true),
  );

  // Explicit mass properties: solid-box inertia (scaled) around a lowered centre of mass.
  const [sx, sy, sz] = [c.halfExtents.x * 2, c.halfExtents.y * 2, c.halfExtents.z * 2];
  const inertia = {
    x: (c.mass / 12) * (sy * sy + sz * sz) * c.inertiaScale.x,
    y: (c.mass / 12) * (sx * sx + sz * sz) * c.inertiaScale.y,
    z: (c.mass / 12) * (sx * sx + sy * sy) * c.inertiaScale.z,
  };
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(c.halfExtents.x, c.halfExtents.y, c.halfExtents.z)
      .setMassProperties(c.mass, c.centerOfMass, inertia, { x: 0, y: 0, z: 0, w: 1 })
      .setFriction(0.3)
      .setRestitution(0.1)
      .setCollisionGroups(CAR_GROUPS),
    body,
  );

  const controller = world.createVehicleController(body);
  // Never rely on Rapier's defaults (forward defaults to X). Note: these are property
  // setters, and the forward one is really named `setIndexForwardAxis` in Rapier's API.
  controller.indexUpAxis = 1;
  controller.setIndexForwardAxis = 2;

  const w = spec.wheels;
  for (let i = 0; i < WHEEL_COUNT; i++) {
    const front = i < 2;
    controller.addWheel(wheelConnection(spec, i), { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, w.suspensionRestLength, w.radius);
    controller.setWheelSuspensionStiffness(i, w.suspensionStiffness);
    controller.setWheelSuspensionCompression(i, w.suspensionCompression);
    controller.setWheelSuspensionRelaxation(i, w.suspensionRelaxation);
    controller.setWheelMaxSuspensionTravel(i, w.maxSuspensionTravel);
    controller.setWheelMaxSuspensionForce(i, w.maxSuspensionForce);
    controller.setWheelFrictionSlip(i, front ? w.frictionSlip.front : w.frictionSlip.rear);
    controller.setWheelSideFrictionStiffness(i, front ? w.sideFrictionStiffness.front : w.sideFrictionStiffness.rear);
  }

  return {
    spec,
    world,
    body,
    controller,
    steerAngle: 0,
    rearGrip: 1,
    upsideDownTime: 0,
    aero: createAero(),
    inAeroZone: false,
    surfaces: ['asphalt', 'asphalt', 'asphalt', 'asphalt'],
  };
}

function yawInertia(spec: CarSpec): number {
  const c = spec.chassis;
  const [sx, sz] = [c.halfExtents.x * 2, c.halfExtents.z * 2];
  return (c.mass / 12) * (sx * sx + sz * sz) * c.inertiaScale.y;
}

const aeroScratch: AeroCoefficients = { drag: 0, downforce: 0 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const approach = (cur: number, target: number, maxDelta: number) =>
  cur < target ? Math.min(target, cur + maxDelta) : Math.max(target, cur - maxDelta);

/**
 * Applies one tick of input to the vehicle and updates its controller.
 * Call order each tick: `stepVehicle()` for every car → `world.step()`.
 */
export function stepVehicle(v: Vehicle, input: CarInput, dt: number): void {
  const { spec, body, controller } = v;
  const speed = controller.currentVehicleSpeed(); // signed, along chassis forward
  const absSpeed = Math.abs(speed);

  if (input.reset) resetVehicle(v);

  // --- Steering: speed-sensitive limit, rate-limited. Input +1 = right = negative angle.
  const st = spec.steering;
  const limit = lerp(st.maxAngle, st.highSpeedAngle, clamp(absSpeed / st.highSpeedRef, 0, 1));
  const target = -clamp(input.steer, -1, 1) * limit;
  const returning = Math.abs(target) < Math.abs(v.steerAngle) || Math.sign(target) !== Math.sign(v.steerAngle);
  v.steerAngle = approach(v.steerAngle, target, (returning ? st.returnRate : st.turnRate) * dt);
  for (const i of FRONT) controller.setWheelSteering(i, v.steerAngle);

  // --- Drive / brake / reverse.
  const eng = spec.engine;
  const throttle = clamp(input.throttle, 0, 1);
  const brakePedal = clamp(input.brake, 0, 1);
  let driveForce = 0;
  let brake = 0;

  if (throttle > 0) {
    if (speed < -eng.reverseEngageSpeed) brake = throttle; // rolling backwards: throttle brakes first
    else driveForce = throttle * Math.min(eng.maxForce, eng.power / Math.max(absSpeed, 1));
  }
  if (brakePedal > 0) {
    if (speed > eng.reverseEngageSpeed) brake = Math.max(brake, brakePedal);
    else if (speed > -eng.reverseMaxSpeed) driveForce -= brakePedal * eng.reverseForce;
  }

  const driven = eng.drive === 'rear' ? REAR : eng.drive === 'front' ? FRONT : ([0, 1, 2, 3] as const);
  for (let i = 0; i < WHEEL_COUNT; i++) controller.setWheelEngineForce(i, 0);
  for (const i of driven) controller.setWheelEngineForce(i, driveForce / driven.length);

  const b = spec.brakes;
  const coast = throttle === 0 && brakePedal === 0 ? b.engineBraking : 0;
  const frontBrake = brake * b.strength * b.frontBias * 2 + coast;
  const rearBrake = brake * b.strength * (1 - b.frontBias) * 2 + coast;
  for (const i of FRONT) controller.setWheelBrake(i, frontBrake);

  // --- Handbrake: lock-ish rear brakes + drop rear grip; grip eases back on release.
  const hb = spec.handbrake;
  v.rearGrip = input.handbrake ? 0 : Math.min(1, v.rearGrip + dt / hb.gripRecoveryTime);
  const w = spec.wheels;
  for (const i of REAR) {
    controller.setWheelBrake(i, input.handbrake ? Math.max(rearBrake, hb.rearBrake) : rearBrake);
    controller.setWheelSideFrictionStiffness(i, lerp(hb.rearSideFrictionStiffness, w.sideFrictionStiffness.rear, v.rearGrip));
  }

  // --- Tyre grip per wheel: base × handbrake × surface (from last tick's contact).
  let surfaceDrag = 0;
  for (let i = 0; i < WHEEL_COUNT; i++) {
    const front = i < 2;
    const base = front ? w.frictionSlip.front : lerp(hb.rearFrictionSlip, w.frictionSlip.rear, v.rearGrip);
    const surface = spec.surfaces[v.surfaces[i]!];
    controller.setWheelFrictionSlip(i, base * surface.grip);
    if (controller.wheelIsInContact(i)) surfaceDrag += surface.drag;
  }

  // --- Active aero: wings open on the straights, snap shut under braking / steering.
  stepAero(
    v.aero,
    spec,
    { inZone: v.inAeroZone, press: input.aero, auto: input.aeroAuto, brake: brakePedal, steer: input.steer, speed: absSpeed },
    dt,
  );
  const coeff = aeroCoefficients(v.aero, spec, aeroScratch);

  // --- Aerodynamics + rolling/surface resistance as one-shot impulses
  // (addForce would persist across steps).
  const vel = body.linvel();
  const vMag = Math.hypot(vel.x, vel.y, vel.z);
  if (vMag > 0.01) {
    const a = spec.aero;
    const resist = (coeff.drag * vMag * vMag + (a.rolling + surfaceDrag) * vMag) * dt;
    const up = rotate(body.rotation(), { x: 0, y: 1, z: 0 });
    const down = coeff.downforce * absSpeed * absSpeed * dt;
    body.applyImpulse(
      {
        x: (-vel.x / vMag) * resist - up.x * down,
        y: (-vel.y / vMag) * resist - up.y * down,
        z: (-vel.z / vMag) * resist - up.z * down,
      },
      true,
    );
  }

  controller.updateVehicle(dt, undefined, WHEEL_RAY_GROUPS);
  for (let i = 0; i < WHEEL_COUNT; i++) v.surfaces[i] = surfaceOf(v.world, controller.wheelGroundObject(i));

  // --- Stability assist: steer the yaw rate toward the bicycle-model target.
  const as = spec.assist;
  if (as.yawStability > 0 && !input.handbrake && absSpeed > as.minSpeed) {
    const wheelbase = w.frontZ - w.rearZ;
    const up = rotate(body.rotation(), { x: 0, y: 1, z: 0 });
    const ang = body.angvel();
    const yawRate = ang.x * up.x + ang.y * up.y + ang.z * up.z;
    // What the steering asks for, capped by what the tyres can deliver (a = v·ω ≤ μ·g).
    // Downforce adds to the wheel load, so the grip limit grows with speed².
    const loadG = 9.81 + (coeff.downforce * absSpeed * absSpeed) / spec.chassis.mass;
    const gripLimit = (w.frictionSlip.front * loadG) / absSpeed;
    const targetYawRate = clamp((speed * Math.tan(v.steerAngle)) / wheelbase, -gripLimit, gripLimit);
    // Only remove excess rotation (oversteer); never add yaw the tyres aren't producing.
    const excess =
      Math.sign(yawRate) !== Math.sign(targetYawRate) ? yawRate : Math.sign(yawRate) * Math.max(0, Math.abs(yawRate) - Math.abs(targetYawRate));
    if (excess !== 0) {
      const fade = clamp((absSpeed - as.minSpeed) / as.minSpeed, 0, 1);
      const torqueImpulse = -excess * as.yawStability * fade * yawInertia(spec) * dt;
      body.applyTorqueImpulse({ x: up.x * torqueImpulse, y: up.y * torqueImpulse, z: up.z * torqueImpulse }, true);
    }
  }

  // --- Auto-reset when stuck on its roof or side.
  const upY = rotate(body.rotation(), { x: 0, y: 1, z: 0 }).y;
  v.upsideDownTime = upY < 0.3 && absSpeed < 2 ? v.upsideDownTime + dt : 0;
  if (v.upsideDownTime > spec.safety.autoResetAfter) resetVehicle(v);
}

/** Puts the car upright at its current spot (lifted slightly), keeping its heading. */
export function resetVehicle(v: Vehicle, pose?: SpawnPose): void {
  const { body } = v;
  let target = pose;
  if (!target) {
    const p = body.translation();
    const fwd = rotate(body.rotation(), { x: 0, y: 0, z: 1 });
    target = {
      position: { x: p.x, y: Math.max(p.y, 0) + v.spec.safety.resetLift, z: p.z },
      yaw: Math.atan2(fwd.x, fwd.z),
    };
  }
  body.setTranslation(target.position, true);
  body.setRotation(yawQuat(target.yaw), true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  v.steerAngle = 0;
  v.rearGrip = 1;
  v.upsideDownTime = 0;
  v.aero.blend = 0;
  v.aero.open = false;
}

/** Fills `out` with the visual state of each wheel (chassis space). */
export function readWheelStates(v: Vehicle, out: WheelState[]): void {
  const { controller, spec } = v;
  for (let i = 0; i < WHEEL_COUNT; i++) {
    const conn = wheelConnection(spec, i);
    const susp = controller.wheelSuspensionLength(i) ?? spec.wheels.suspensionRestLength;
    const s = (out[i] ??= { position: { x: 0, y: 0, z: 0 }, steer: 0, spin: 0, inContact: false });
    s.position.x = conn.x;
    s.position.y = conn.y - susp;
    s.position.z = conn.z;
    s.steer = controller.wheelSteering(i) ?? 0;
    s.spin = controller.wheelRotation(i) ?? 0;
    s.inContact = controller.wheelIsInContact(i);
  }
}

/** Signed forward speed (m/s). */
export function vehicleSpeed(v: Vehicle): number {
  return v.controller.currentVehicleSpeed();
}

function rotate(q: { x: number; y: number; z: number; w: number }, v: Vec3Like): Vec3Like {
  // v' = v + 2w(q×v) + 2q×(q×v)
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}
