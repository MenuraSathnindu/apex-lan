import * as THREE from 'three';
import { CAMERA } from '@apex/shared';

export const CAMERA_MODES = ['chase', 'hood'] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];

const UP = new THREE.Vector3(0, 1, 0);
/** Three.js cameras look down -Z; our car faces +Z. */
const FACE_FORWARD = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI);

/** Frame-rate independent smoothing factor for a rate in 1/s. */
const smoothing = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class CameraRig {
  mode: CameraMode = 'chase';
  private snap = true;
  private yaw = 0;
  private readonly fwd = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private readonly targetQuat = new THREE.Quaternion();

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  cycle(): void {
    this.mode = CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length]!;
    this.snap = true;
  }

  update(dt: number, carPos: THREE.Vector3, carQuat: THREE.Quaternion, speed: number): void {
    if (this.mode === 'chase') this.updateChase(dt, carPos, carQuat, speed);
    else this.updateHood(dt, carPos, carQuat);
    this.snap = false;
  }

  private updateChase(dt: number, carPos: THREE.Vector3, carQuat: THREE.Quaternion, speed: number) {
    const c = CAMERA.chase;
    const cam = this.camera;

    // Follow heading only (ignore pitch/roll) so bumps and drifts don't shake the view.
    this.fwd.set(0, 0, 1).applyQuaternion(carQuat);
    const carYaw = Math.atan2(this.fwd.x, this.fwd.z);
    this.yaw = this.snap ? carYaw : this.yaw + wrapAngle(carYaw - this.yaw) * smoothing(c.yawLag, dt);
    this.fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));

    this.desired.copy(carPos).addScaledVector(this.fwd, -c.distance).addScaledVector(UP, c.height);
    if (this.snap || cam.position.distanceTo(this.desired) > c.snapDistance) cam.position.copy(this.desired);
    else cam.position.lerp(this.desired, smoothing(c.positionLag, dt));
    // Never sink below the car's roof line.
    cam.position.y = Math.max(cam.position.y, carPos.y + 0.5);

    this.lookAt.copy(carPos).addScaledVector(UP, c.lookHeight).addScaledVector(this.fwd, c.lookAhead);
    cam.lookAt(this.lookAt);

    const t = Math.min(Math.abs(speed) / c.fovSpeedRef, 1);
    const targetFov = c.baseFov + (c.maxFov - c.baseFov) * t * t;
    this.setFov(this.snap ? targetFov : cam.fov + (targetFov - cam.fov) * smoothing(c.fovLag, dt));
  }

  private updateHood(dt: number, carPos: THREE.Vector3, carQuat: THREE.Quaternion) {
    const h = CAMERA.hood;
    const cam = this.camera;
    cam.position.copy(this.offset.set(h.offset.x, h.offset.y, h.offset.z).applyQuaternion(carQuat).add(carPos));
    this.targetQuat.copy(carQuat).multiply(FACE_FORWARD);
    if (this.snap) cam.quaternion.copy(this.targetQuat);
    else cam.quaternion.slerp(this.targetQuat, smoothing(h.rotationLag, dt));
    this.setFov(h.fov);
  }

  private setFov(fov: number) {
    if (Math.abs(this.camera.fov - fov) < 1e-3) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }
}
