import type { CarSpec } from '../tuning.ts';

/**
 * Active aero: the wings are either closed (corner mode: downforce) or open (straight mode:
 * low drag). Straight mode is only allowed in the track's straight zones, and the wings snap
 * shut when braking, steering hard, slowing down or leaving the zone.
 */
export interface AeroState {
  /** 0 = corner mode (closed), 1 = straight mode (open). Animates the wings. */
  blend: number;
  /** Straight mode requested and currently allowed. */
  open: boolean;
}

export interface AeroInput {
  /** Car is inside one of the track's straight-mode zones. */
  inZone: boolean;
  /** Toggle pressed this tick. */
  press: boolean;
  /** Open automatically whenever allowed. */
  auto: boolean;
  /** Brake pedal 0..1. */
  brake: number;
  /** Steering -1..1. */
  steer: number;
  /** Forward speed (m/s). */
  speed: number;
}

export function createAero(): AeroState {
  return { blend: 0, open: false };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function stepAero(a: AeroState, spec: CarSpec, i: AeroInput, dt: number): void {
  const cfg = spec.aero;
  const allowed =
    i.inZone && i.brake <= cfg.brakeClose && Math.abs(i.steer) <= cfg.steerClose && i.speed >= cfg.minOpenSpeed;
  if (!allowed) a.open = false;
  else if (i.auto) a.open = true;
  else if (i.press) a.open = !a.open;

  const target = a.open ? 1 : 0;
  const rate = target > a.blend ? 1 / cfg.openTime : 1 / cfg.closeTime;
  a.blend = clamp01(a.blend + Math.sign(target - a.blend) * Math.min(Math.abs(target - a.blend), rate * dt));
}

export interface AeroCoefficients {
  drag: number;
  downforce: number;
}

/** Drag and downforce coefficients for the current wing angle (out is reused to avoid allocations). */
export function aeroCoefficients(a: AeroState, spec: CarSpec, out: AeroCoefficients = { drag: 0, downforce: 0 }): AeroCoefficients {
  const { corner, straight } = spec.aero.modes;
  out.drag = corner.drag + (straight.drag - corner.drag) * a.blend;
  out.downforce = corner.downforce + (straight.downforce - corner.downforce) * a.blend;
  return out;
}

/** Wing mode shown on the HUD. */
export function aeroModeLabel(a: AeroState): 'STRAIGHT' | 'CORNER' {
  return a.blend > 0.5 ? 'STRAIGHT' : 'CORNER';
}
