import * as THREE from 'three';
import { CAR, FX, type Vehicle } from '@apex/shared';
import type { ImpactEvent, LocalCarFx } from '../../game/localCarFx.ts';
import type { QualitySettings } from '../quality.ts';
import { SkidMarks } from './skidMarks.ts';
import { Smoke } from './smoke.ts';
import { Sparks } from './sparks.ts';

/** What effects need from a remote car (see RemoteCars). */
export interface RemoteFxSource {
  id: number;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  wheels: readonly { position: { x: number; y: number; z: number } }[];
  /** Sideways sliding speed (m/s). */
  slip: number;
  onGrass: boolean;
  pose: { v: readonly number[] };
}

const LOCAL_KEYS = ['me0', 'me1', 'me2', 'me3'];
const tmp = new THREE.Vector3();
const dir = new THREE.Vector3();
const nrm = new THREE.Vector3();
const at = new THREE.Vector3();
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const strengthOf = (slip: number) => clamp01((slip - FX.skidMinSlip) / (FX.skidFullSlip - FX.skidMinSlip));

/** Skid marks, tyre smoke and sparks for every car. */
export class Effects {
  readonly skid = new SkidMarks();
  readonly smoke = new Smoke();
  readonly sparks = new Sparks();
  private readonly smokeAcc = new Map<string, number>();
  private readonly remoteKeys = new Map<number, string[]>();
  private sparkAcc = 0;

  constructor(scene: THREE.Scene) {
    scene.add(this.skid.mesh, this.smoke.points, this.sparks.lines);
  }

  applyQuality(q: QualitySettings): void {
    this.smoke.setBudget(q.particles);
    this.sparks.setBudget(q.particles);
  }

  /** One wheel's skid mark + smoke. */
  private wheel(key: string, x: number, y: number, z: number, slip: number, onRoad: boolean, vx: number, vz: number, dt: number) {
    if (onRoad && slip > FX.skidMinSlip) this.skid.add(key, x, y, z, strengthOf(slip));
    else this.skid.lift(key);

    if (!onRoad || slip < FX.smokeMinSlip) return;
    const rate = FX.smokeRate * clamp01((slip - FX.smokeMinSlip) / (FX.skidFullSlip - FX.smokeMinSlip) + 0.2);
    let acc = (this.smokeAcc.get(key) ?? Math.random()) + rate * dt;
    for (; acc >= 1; acc--) {
      this.smoke.emit(
        x + (Math.random() - 0.5) * 0.3,
        y + 0.2,
        z + (Math.random() - 0.5) * 0.3,
        vx * 0.25 + (Math.random() - 0.5) * 1.2,
        0.4 + Math.random() * 0.6,
        vz * 0.25 + (Math.random() - 0.5) * 1.2,
      );
    }
    this.smokeAcc.set(key, acc);
  }

  /** Our own car, once per physics tick (after LocalCarFx.step). */
  localTick(fx: LocalCarFx, car: Vehicle, dt: number): void {
    const lv = car.body.linvel();
    for (let i = 0; i < 4; i++) {
      const w = fx.slips[i]!;
      this.wheel(LOCAL_KEYS[i]!, w.point.x, w.point.y, w.point.z, w.slip, w.inContact && w.surface !== 'grass', lv.x, lv.z, dt);
    }

    // Grinding along a barrier: a steady stream of sparks.
    if (fx.scrape > FX.scrapeMinSpeed) {
      nrm.copy(fx.scrapeNormal);
      dir.set(lv.x, lv.y, lv.z);
      dir.addScaledVector(nrm, -dir.dot(nrm)).normalize();
      this.sparkAcc += FX.sparkRate * (fx.scrape / 20) * dt;
      const n = Math.floor(this.sparkAcc);
      this.sparkAcc -= n;
      if (n > 0) this.sparks.burst(n, fx.scrapePoint, dir, nrm, fx.scrape);
    } else this.sparkAcc = 0;
  }

  /** A hit reported by LocalCarFx: a burst of sparks off barriers. */
  impact(hit: ImpactEvent, car: Vehicle): void {
    if (hit.kind !== 'barrier' || hit.dv < 2) return;
    const lv = car.body.linvel();
    nrm.copy(hit.normal);
    dir.set(lv.x, lv.y, lv.z);
    dir.addScaledVector(nrm, -dir.dot(nrm));
    const slide = dir.length();
    if (slide > 0.1) dir.divideScalar(slide);
    at.copy(hit.point);
    this.sparks.burst(Math.min(80, Math.round(FX.impactSparks * hit.dv)), at, dir, nrm, Math.max(slide, hit.dv));
  }

  /** A remote car, every rendered frame. Uses the body's sideways slide for all four tyres. */
  remoteFrame(car: RemoteFxSource, dt: number): void {
    let keys = this.remoteKeys.get(car.id);
    if (!keys) this.remoteKeys.set(car.id, (keys = [0, 1, 2, 3].map((i) => `r${car.id}-${i}`)));
    const [vx, , vz] = car.pose.v as [number, number, number];
    for (let i = 0; i < 4; i++) {
      const w = car.wheels[i]!.position;
      tmp.set(w.x, w.y - CAR.wheels.radius, w.z).applyQuaternion(car.quat).add(car.pos);
      this.wheel(keys[i]!, tmp.x, tmp.y, tmp.z, car.slip, !car.onGrass, vx, vz, dt);
    }
  }

  /** Every rendered frame. */
  update(dt: number, camera: THREE.PerspectiveCamera, drawingBufferHeight: number): void {
    this.skid.update();
    this.smoke.update(dt, camera, drawingBufferHeight);
    this.sparks.update(dt);
  }

  /** New race: wipe the old marks. */
  clear(): void {
    this.skid.clear();
  }
}
