import { NAME_MAX_LENGTH } from '../constants.ts';
import { readWheelStates, WHEEL_COUNT, type Vehicle, type WheelState } from '../physics/vehicle.ts';
import type { CarState } from './messages.ts';

const r = (v: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

const wheelScratch: WheelState[] = [];

/** Snapshot of a simulated car, rounded to keep messages small (mm / 1e-4 rad precision). */
export function packCarState(v: Vehicle, braking: boolean): CarState {
  const p = v.body.translation();
  const q = v.body.rotation();
  const lv = v.body.linvel();
  readWheelStates(v, wheelScratch);
  const wh: number[] = [];
  for (const w of wheelScratch) wh.push(r(w.steer, 3), r(w.spin, 2), r(w.position.y, 3));
  return {
    p: [r(p.x, 3), r(p.y, 3), r(p.z, 3)],
    q: [r(q.x, 4), r(q.y, 4), r(q.z, 4), r(q.w, 4)],
    v: [r(lv.x, 2), r(lv.y, 2), r(lv.z, 2)],
    wh,
    b: braking ? 1 : 0,
    a: r(v.aero.blend, 2),
    e: r(v.ers.charge / v.spec.ers.capacity, 2),
    d: v.ers.deploying > 0 ? 1 : 0,
  };
}

const finiteArray = (a: unknown, len: number, limit: number): boolean =>
  Array.isArray(a) && a.length === len && a.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= limit);

/** Server-side validation of a client-reported state (untrusted input). */
export function isValidCarState(s: unknown): s is CarState {
  if (typeof s !== 'object' || s === null) return false;
  const c = s as Record<string, unknown>;
  return (
    finiteArray(c.p, 3, 100_000) &&
    finiteArray(c.q, 4, 1.01) &&
    finiteArray(c.v, 3, 1_000) &&
    finiteArray(c.wh, WHEEL_COUNT * 3, 1e7) &&
    (c.b === 0 || c.b === 1) &&
    (c.a === undefined || (typeof c.a === 'number' && c.a >= 0 && c.a <= 1)) &&
    (c.e === undefined || (typeof c.e === 'number' && c.e >= 0 && c.e <= 1)) &&
    (c.d === undefined || c.d === 0 || c.d === 1)
  );
}

/** Trims, strips control characters and caps length. Empty → null. */
export function sanitizeName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, NAME_MAX_LENGTH);
  return clean.length ? clean : null;
}
