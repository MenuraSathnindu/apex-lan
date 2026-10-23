import * as THREE from 'three';
import { CAR_MODEL, type Livery, type WheelState } from '@apex/shared';

/**
 * A car's visual parts, independent of where they came from (procedural primitives, or the
 * GLB). Conventions — any model source must follow them:
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
  /** Repaints the bodywork (primary/secondary/accent colours + number). */
  setLivery?: (livery: Livery) => void;
  /** Sidewall marking materials, coloured by the tyre compound. */
  tyreMarkings?: THREE.MeshStandardMaterial[];
  /** Movable wing flaps (hinge at the node origin, see CAR_MODEL.wingNodes). */
  wings?: { rear: THREE.Object3D[]; front: THREE.Object3D[] };
  /** Fine detail hidden on distant cars (level of detail). */
  detail?: THREE.Object3D[];
  /** Meshes that shouldn't cast shadows (hidden inside the body, see-through, tiny). */
  noShadow?: Set<THREE.Object3D>;
  /** Frees what the model owns beyond its materials (textures, generated geometry). */
  dispose?: () => void;
}

/** Places a CarModel from the physics pose + per-wheel state every frame. */
export class CarView {
  readonly root = new THREE.Group();
  /** Positioned at the wheel centre, rotated for steering (around Y). */
  private readonly pivots: THREE.Group[] = [];
  /** Child of the pivot, rotated for wheel spin (around X). */
  private readonly spinners: THREE.Group[] = [];
  private detailVisible = true;
  /** Wing flaps with their rest rotation and how far they turn when fully open. */
  private readonly flaps: { obj: THREE.Object3D; base: number; open: number }[] = [];
  private wingBlend = -1;

  constructor(readonly model: CarModel) {
    this.root.add(model.body);
    for (const obj of model.wings?.rear ?? []) this.flaps.push({ obj, base: obj.rotation.x, open: CAR_MODEL.wing.rearOpenAngle });
    for (const obj of model.wings?.front ?? []) this.flaps.push({ obj, base: obj.rotation.x, open: CAR_MODEL.wing.frontOpenAngle });
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

  setLivery(livery: Livery): void {
    this.model.setLivery?.(livery);
  }

  /** Wing opening 0 (corner mode, closed) .. 1 (straight mode, open). */
  setWingOpen(blend: number): void {
    if (Math.abs(blend - this.wingBlend) < 0.004) return;
    this.wingBlend = blend;
    for (const f of this.flaps) f.obj.rotation.x = f.base + f.open * blend;
  }

  /** Tyre compound colour on the sidewall markings. */
  setTyreColor(color: THREE.ColorRepresentation): void {
    for (const m of this.model.tyreMarkings ?? []) {
      m.color.set(color);
      m.emissive.set(color);
    }
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
    this.model.dispose?.();
  }
}
