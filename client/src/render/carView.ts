import * as THREE from 'three';
import { CAR_MODEL, type WheelState } from '@apex/shared';

/**
 * A car's visual parts, independent of where they came from (placeholder boxes now,
 * a GLTF later). Conventions — any model source must follow them:
 *  - `body` is positioned relative to the physics chassis origin (collision box centre),
 *    facing +Z, Y up. Bake any model offset/scale into `body`.
 *  - each wheel Object3D is centred on its own origin with its axle along X and no
 *    rotation. For a GLTF: detach the wheel node, reset its position, keep its mesh.
 *  - wheel order: FL, FR, RL, RR.
 */
export interface CarModel {
  body: THREE.Object3D;
  wheels: [THREE.Object3D, THREE.Object3D, THREE.Object3D, THREE.Object3D];
  /** Emissive materials that brighten when braking. */
  brakeLights?: THREE.MeshStandardMaterial[];
  /** Glass materials; quality presets switch refraction (transmission) on/off. */
  glass?: THREE.MeshPhysicalMaterial[];
  /** Body paint materials, recoloured when a player picks a different colour. */
  paint?: THREE.MeshStandardMaterial[];
  /** Fine detail hidden on distant cars (level of detail). */
  detail?: THREE.Object3D[];
  /** Meshes that shouldn't cast shadows (hidden inside the body, see-through, tiny). */
  noShadow?: Set<THREE.Object3D>;
}

/** Places a CarModel from the physics pose + per-wheel state every frame. */
export class CarView {
  readonly root = new THREE.Group();
  /** Positioned at the wheel centre, rotated for steering (around Y). */
  private readonly pivots: THREE.Group[] = [];
  /** Child of the pivot, rotated for wheel spin (around X). */
  private readonly spinners: THREE.Group[] = [];
  private detailVisible = true;

  constructor(readonly model: CarModel) {
    this.root.add(model.body);
    for (const wheel of model.wheels) {
      const pivot = new THREE.Group();
      const spinner = new THREE.Group();
      spinner.add(wheel);
      pivot.add(spinner);
      this.root.add(pivot);
      this.pivots.push(pivot);
      this.spinners.push(spinner);
    }
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = !model.noShadow?.has(o);
        o.receiveShadow = true;
      }
    });
  }

  update(position: THREE.Vector3, quaternion: THREE.Quaternion, wheels: readonly WheelState[]): void {
    this.root.position.copy(position);
    this.root.quaternion.copy(quaternion);
    for (let i = 0; i < this.pivots.length; i++) {
      const w = wheels[i];
      if (!w) continue;
      this.pivots[i]!.position.set(w.position.x, w.position.y, w.position.z);
      this.pivots[i]!.rotation.y = w.steer;
      this.spinners[i]!.rotation.x = w.spin;
    }
  }

  /** Level of detail: show/hide the fine parts (far-away cars don't need the cockpit). */
  setDetail(visible: boolean): void {
    if (visible === this.detailVisible) return;
    this.detailVisible = visible;
    for (const o of this.model.detail ?? []) o.visible = visible;
  }

  setPaint(color: THREE.ColorRepresentation): void {
    for (const m of this.model.paint ?? []) m.color.set(color);
  }

  setBraking(on: boolean): void {
    const intensity = on ? CAR_MODEL.brakeLightOn : CAR_MODEL.brakeLightIdle;
    for (const m of this.model.brakeLights ?? []) m.emissiveIntensity = intensity;
  }

  /** Real refraction is expensive; low/medium use plain transparency instead. */
  setGlassTransmission(enabled: boolean): void {
    for (const m of this.model.glass ?? []) {
      m.transmission = enabled ? 1 : 0;
      m.transparent = !enabled;
      m.opacity = enabled ? 1 : 0.45;
      m.needsUpdate = true;
    }
  }

  /**
   * Removes the car and frees its materials. Geometry is left alone: cars cloned from the
   * same GLB share it.
   */
  dispose(): void {
    this.root.removeFromParent();
    const seen = new Set<THREE.Material>();
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) seen.add(m);
    });
    for (const m of seen) m.dispose();
  }
}
