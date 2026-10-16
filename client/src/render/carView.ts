import * as THREE from 'three';
import type { WheelState } from '@apex/shared';

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
}

/** Places a CarModel from the physics pose + per-wheel state every frame. */
export class CarView {
  readonly root = new THREE.Group();
  /** Positioned at the wheel centre, rotated for steering (around Y). */
  private readonly pivots: THREE.Group[] = [];
  /** Child of the pivot, rotated for wheel spin (around X). */
  private readonly spinners: THREE.Group[] = [];

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
        o.castShadow = true;
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

  dispose(): void {
    this.root.removeFromParent();
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose();
    });
  }
}
