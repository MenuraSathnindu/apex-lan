import type { CarSpec } from '../tuning.ts';

export const COMPOUNDS = ['soft', 'medium', 'hard'] as const;
export type Compound = (typeof COMPOUNDS)[number];

export const TYRE_WEAR_SETTINGS = ['off', 'normal', 'high'] as const;
/** Race setting (host picks it in the lobby): how fast tyres wear, or not at all. */
export type TyreWearSetting = (typeof TYRE_WEAR_SETTINGS)[number];

/** One car's set of tyres. Wear is shared by all four (the HUD shows one number). */
export interface TyreState {
  compound: Compound;
  /** 0 = new .. 1 = worn out. */
  wear: number;
  /** Multiplier from the race's wear setting (0 = wear off). */
  wearScale: number;
}

export const isCompound = (v: unknown): v is Compound => COMPOUNDS.includes(v as Compound);
export const isTyreWearSetting = (v: unknown): v is TyreWearSetting => TYRE_WEAR_SETTINGS.includes(v as TyreWearSetting);

export function createTyres(compound: Compound = 'medium'): TyreState {
  return { compound, wear: 0, wearScale: 1 };
}

/** Fresh set for a race start. */
export function fitTyres(t: TyreState, spec: CarSpec, compound: Compound, setting: TyreWearSetting): void {
  t.compound = compound;
  t.wear = 0;
  t.wearScale = spec.tyres.wearSettings[setting];
}

/** Grip left as tyres wear: a slow fade, then a steep drop past the cliff. */
export function wearGripFactor(wear: number, spec: CarSpec): number {
  const c = spec.tyres;
  const cliff = wear > c.cliffStart ? c.cliffLoss * ((wear - c.cliffStart) / (1 - c.cliffStart)) ** 2 : 0;
  return 1 - c.wearGripLoss * wear - cliff;
}

/** Grip multiplier (× frictionSlip) for the compound and its wear. */
export function tyreGrip(t: TyreState, spec: CarSpec): number {
  return spec.tyres.compounds[t.compound].grip * wearGripFactor(t.wear, spec);
}

/**
 * Wears the tyres by dt: proportional to distance, more under load (cornering / braking /
 * traction, as horizontal acceleration in g), scaled by the compound and the race setting.
 */
export function stepTyres(t: TyreState, spec: CarSpec, speed: number, accelG: number, dt: number): void {
  if (t.wearScale <= 0) return;
  const c = spec.tyres;
  const km = (Math.abs(speed) * dt) / 1000;
  const g = Math.min(accelG, c.maxLoadG);
  t.wear = Math.min(1, t.wear + c.compounds[t.compound].wearRate * t.wearScale * c.wearPerKm * km * (1 + c.loadFactor * g * g));
}
