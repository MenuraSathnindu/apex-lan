import type { CarInput } from '../input.ts';
import { FX, type SurfaceKind, type Vec3Like } from '../tuning.ts';
import { GROUP } from './collisionGroups.ts';
import type { Collider, TempContactManifold } from './rapier.ts';
import { surfaceTag } from './surfaces.ts';
import { WHEEL_COUNT, type Vehicle } from './vehicle.ts';

/**
 * Read-only helpers that turn the vehicle's physics state into things effects and audio
 * care about: how much each tyre is sliding, and what the chassis is hitting.
 * Nothing here changes the simulation.
 */

export interface WheelSlip {
  /** Sliding speed of the tyre over the ground (m/s): sideways slip + locked/spinning wheels. */
  slip: number;
  inContact: boolean;
  surface: SurfaceKind;
  /** Contact point in world space (valid when inContact). */
  point: Vec3Like;
}

export function emptyWheelSlips(): WheelSlip[] {
  return Array.from({ length: WHEEL_COUNT }, () => ({ slip: 0, inContact: false, surface: 'asphalt' as SurfaceKind, point: { x: 0, y: 0, z: 0 } }));
}

const v3 = () => ({ x: 0, y: 0, z: 0 });
const tmpA = v3();
const tmpB = v3();

function rotateInto(q: { x: number; y: number; z: number; w: number }, x: number, y: number, z: number, out: Vec3Like) {
  const tx = 2 * (q.y * z - q.z * y);
  const ty = 2 * (q.z * x - q.x * z);
  const tz = 2 * (q.x * y - q.y * x);
  out.x = x + q.w * tx + (q.y * tz - q.z * ty);
  out.y = y + q.w * ty + (q.z * tx - q.x * tz);
  out.z = z + q.w * tz + (q.x * ty - q.y * tx);
  return out;
}

/** Fills `out` (length 4, see emptyWheelSlips) with each tyre's slip. Call after stepVehicle. */
export function readWheelSlip(v: Vehicle, input: CarInput, out: WheelSlip[]): void {
  const { body, controller, spec } = v;
  const q = body.rotation();
  const lin = body.linvel();
  const ang = body.angvel();
  const com = body.worldCom();
  const speed = controller.currentVehicleSpeed();
  const drive = spec.engine.drive;
  const launch = speed >= -0.1 ? input.throttle * FX.launchSlip * Math.max(0, 1 - Math.abs(speed) / FX.launchSlipSpeed) : 0;

  for (let i = 0; i < WHEEL_COUNT; i++) {
    const w = out[i]!;
    w.inContact = controller.wheelIsInContact(i);
    w.surface = v.surfaces[i]!;
    if (!w.inContact) {
      w.slip = 0;
      continue;
    }
    const p = controller.wheelContactPoint(i);
    if (p) [w.point.x, w.point.y, w.point.z] = [p.x, p.y, p.z];
    // Ground velocity of the chassis at the contact point: v + ω × r.
    const rx = w.point.x - com.x;
    const ry = w.point.y - com.y;
    const rz = w.point.z - com.z;
    const vx = lin.x + ang.y * rz - ang.z * ry;
    const vy = lin.y + ang.z * rx - ang.x * rz;
    const vz = lin.z + ang.x * ry - ang.y * rx;
    // Wheel axes in world space (steer: + = left, chassis left = +X).
    const steer = controller.wheelSteering(i) ?? 0;
    const side = rotateInto(q, Math.cos(steer), 0, -Math.sin(steer), tmpA);
    const fwd = rotateInto(q, Math.sin(steer), 0, Math.cos(steer), tmpB);
    const lateral = Math.abs(vx * side.x + vy * side.y + vz * side.z);
    const along = vx * fwd.x + vy * fwd.y + vz * fwd.z;

    const rear = i >= 2;
    let longitudinal = 0;
    if (rear && input.handbrake) longitudinal = Math.abs(along) * FX.handbrakeSlipFactor * (1 - v.rearGrip);
    const driven = drive === 'all' || (drive === 'rear') === rear;
    if (driven) longitudinal = Math.max(longitudinal, launch);
    w.slip = Math.hypot(lateral, longitudinal);
  }
}

export type ContactKind = 'barrier' | 'car' | 'ground';

export interface ChassisContact {
  kind: ContactKind;
  /** Average contact point (world). */
  point: Vec3Like;
  /** Unit normal pointing from the obstacle into our car. */
  normal: Vec3Like;
  /** Velocity change the contact applied this tick (m/s) — impact strength. */
  dv: number;
  /** Speed of the chassis sliding along the obstacle at the contact (m/s). */
  slideSpeed: number;
}

const pool: ChassisContact[] = [];
let count = 0;
let current: Vehicle | null = null;
let chassis: Collider | null = null;
let other: Collider | null = null;

const onManifold = (m: TempContactManifold, flipped: boolean) => {
  const n = m.numSolverContacts();
  if (n === 0 || !current || !other) return;
  const c = (pool[count] ??= { kind: 'barrier', point: v3(), normal: v3(), dv: 0, slideSpeed: 0 });
  let px = 0;
  let py = 0;
  let pz = 0;
  let k = 0;
  for (let i = 0; i < n; i++) {
    const p = m.solverContactPoint(i);
    if (!p) continue;
    k++;
    px += p.x;
    py += p.y;
    pz += p.z;
  }
  if (k === 0) return;
  [c.point.x, c.point.y, c.point.z] = [px / k, py / k, pz / k];
  // Manifold normal points from its collider1 to collider2. We want obstacle → car.
  const mn = m.normal();
  const sign = flipped ? 1 : -1;
  [c.normal.x, c.normal.y, c.normal.z] = [mn.x * sign, mn.y * sign, mn.z * sign];

  let impulse = 0;
  for (let i = 0; i < m.numContacts(); i++) impulse += m.contactImpulse(i);
  c.dv = impulse / current.body.mass();

  // Relative velocity at the contact, minus its normal component.
  const body = current.body;
  const com = body.worldCom();
  const lin = body.linvel();
  const ang = body.angvel();
  const rx = c.point.x - com.x;
  const ry = c.point.y - com.y;
  const rz = c.point.z - com.z;
  let vx = lin.x + ang.y * rz - ang.z * ry;
  let vy = lin.y + ang.z * rx - ang.x * rz;
  let vz = lin.z + ang.x * ry - ang.y * rx;
  const otherBody = other.parent();
  if (otherBody) {
    const ov = otherBody.linvel();
    [vx, vy, vz] = [vx - ov.x, vy - ov.y, vz - ov.z];
  }
  const vn = vx * c.normal.x + vy * c.normal.y + vz * c.normal.z;
  c.slideSpeed = Math.hypot(vx - vn * c.normal.x, vy - vn * c.normal.y, vz - vn * c.normal.z);

  const membership = (other.collisionGroups() >>> 16) & 0xffff;
  c.kind = membership & GROUP.REMOTE_PROXY ? 'car' : surfaceTag(current.world, other) ? 'ground' : 'barrier';
  count++;
};

const onPair = (c2: Collider) => {
  other = c2;
  current!.world.contactPair(chassis!, c2, onManifold);
};

/**
 * Lists what the chassis touched in the last world.step(). Returns the number of entries
 * written to the shared result array (reused between calls — copy what you keep).
 */
export function readChassisContacts(v: Vehicle): { count: number; contacts: readonly ChassisContact[] } {
  count = 0;
  current = v;
  chassis = v.body.collider(0);
  v.world.contactPairsWith(chassis, onPair);
  current = null;
  other = null;
  return { count, contacts: pool };
}
