// The ONLY module that imports Rapier. Everything else imports from here.
import RAPIER from '@dimforge/rapier3d-compat';

let ready: Promise<void> | null = null;

/** Loads the Rapier WASM module. Safe to call more than once. */
export function initRapier(): Promise<void> {
  return (ready ??= RAPIER.init());
}

export { RAPIER };
export type {
  World,
  RigidBody,
  Collider,
  DynamicRayCastVehicleController,
} from '@dimforge/rapier3d-compat';
