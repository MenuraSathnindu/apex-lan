import * as THREE from 'three';
import { FX } from '@apex/shared';
import { newPose, poseAt, type ReplayClip } from './replay.ts';

const R = FX.replay;
/** The trackside camera moves on to a new spot this often (ms), like a broadcast cutting cameras. */
const CUT_MS = 2500;

const tmpPose = newPose();
const left = new THREE.Vector3();
const quat = new THREE.Quaternion();

/**
 * Plays a replay clip: gives the pose of each car at the replay time and points a trackside camera
 * at the subject (a spot beside where the subject will be, re-chosen every CUT_MS).
 */
export class ReplayPlayer {
  clip: ReplayClip | null = null;
  private t = 0;
  private cut = -1;
  private readonly camPos = new THREE.Vector3();
  private readonly target = new THREE.Vector3();

  get playing(): boolean {
    return this.clip !== null;
  }

  start(clip: ReplayClip): void {
    this.clip = clip;
    this.t = clip.frames[0]!.t;
    this.cut = -1;
  }

  stop(): void {
    this.clip = null;
  }

  /** Advances the replay; stops at the end of the clip. */
  advance(dt: number): void {
    const clip = this.clip;
    if (!clip) return;
    this.t += dt * 1000;
    if (this.t > clip.frames.at(-1)!.t) this.stop();
  }

  /** Pose of a car right now in the replay (into `out`), or null if it isn't in the clip. */
  pose(id: number, out = newPose()) {
    return this.clip ? poseAt(this.clip, this.t, id, out) : null;
  }

  /** Places the camera: a fixed trackside spot per cut, looking at the subject. */
  applyCamera(camera: THREE.PerspectiveCamera): void {
    const clip = this.clip;
    if (!clip) return;
    const start = clip.frames[0]!.t;
    const cut = Math.floor((this.t - start) / CUT_MS);
    if (cut !== this.cut) {
      this.cut = cut;
      // Beside the point the subject reaches half way through this cut.
      const spot = poseAt(clip, start + cut * CUT_MS + CUT_MS / 2, clip.subject, tmpPose);
      if (spot) {
        quat.set(spot.quat.x, spot.quat.y, spot.quat.z, spot.quat.w);
        left.set(1, 0, 0).applyQuaternion(quat);
        const side = cut % 2 === 0 ? 1 : -1;
        this.camPos.set(spot.pos.x + left.x * R.cameraSide * side, spot.pos.y + R.cameraUp, spot.pos.z + left.z * R.cameraSide * side);
      }
    }
    const now = poseAt(clip, this.t, clip.subject, tmpPose);
    if (now) this.target.set(now.pos.x, now.pos.y + 0.5, now.pos.z);
    camera.position.copy(this.camPos);
    camera.lookAt(this.target);
  }
}
