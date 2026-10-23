import type { CarSpec } from '../tuning.ts';

/** Battery + deployment state of one car. Energy in joules. */
export interface ErsState {
  charge: number;
  /** Energy deployed since the lap counter was last reset (J). */
  lapDeployed: number;
  /** Overtake mode unlocked for this lap (granted by the server at the detection point). */
  overtake: boolean;
  /** 0..1: how hard the motor is deploying right now (for the HUD, sound and remote cars). */
  deploying: number;
  /** 0..1: harvesting right now. */
  harvesting: number;
}

export interface ErsInput {
  throttle: number;
  brake: number;
  /** Boost key held. */
  boost: boolean;
  /** Forward speed (m/s). */
  speed: number;
}

export function createErs(spec: CarSpec): ErsState {
  return { charge: spec.ers.capacity * spec.ers.startCharge, lapDeployed: 0, overtake: false, deploying: 0, harvesting: 0 };
}

/** Full battery reset for a race start. */
export function refillErs(e: ErsState, spec: CarSpec): void {
  e.charge = spec.ers.capacity * spec.ers.startCharge;
  e.lapDeployed = 0;
  e.overtake = false;
  e.deploying = 0;
  e.harvesting = 0;
}

/** Call when the car starts a new lap: the per-lap budget refills and overtake mode ends. */
export function newErsLap(e: ErsState): void {
  e.lapDeployed = 0;
  e.overtake = false;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Energy that may still be deployed this lap (J). */
export function lapBudgetLeft(e: ErsState, spec: CarSpec): number {
  const o = spec.ers.overtake;
  return Math.max(0, spec.ers.lapDeployLimit + (e.overtake ? o.extraLapEnergy : 0) - e.lapDeployed);
}

/**
 * Advances the battery by dt and returns the extra engine power being deployed (W).
 * Harvests under braking and lift-off; deploys while boost is held with throttle applied.
 */
export function stepErs(e: ErsState, spec: CarSpec, i: ErsInput, dt: number): number {
  const c = spec.ers;
  const speed = Math.abs(i.speed);

  // Harvest.
  let harvest = 0;
  if (i.speed > c.harvestMinSpeed) {
    if (i.brake > 0.05) harvest = c.harvestBrakePower * i.brake * clamp01(speed / c.brakeFullSpeed);
    else if (i.throttle < 0.05) harvest = c.harvestLiftPower;
  }
  const gained = Math.min(harvest * c.harvestEfficiency * dt, c.capacity - e.charge);
  e.charge += gained;
  e.harvesting = harvest > 0 && gained > 0 ? 1 : 0;

  // Deploy.
  e.deploying = 0;
  if (!i.boost || i.throttle < 0.05 || i.brake > 0.05 || i.speed < 5) return 0;
  const taper = clamp01((c.taperToSpeed - speed) / (c.taperToSpeed - c.taperFromSpeed));
  const cap = (c.deployPower + (e.overtake ? c.overtake.extraPower : 0)) * taper * clamp01(i.throttle);
  const energy = Math.min(cap * dt, e.charge, lapBudgetLeft(e, spec));
  if (energy <= 0) return 0;
  e.charge -= energy;
  e.lapDeployed += energy;
  const power = energy / dt;
  e.deploying = clamp01(power / c.deployPower);
  return power;
}
