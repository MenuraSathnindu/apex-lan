import * as THREE from 'three';
import { FX } from '@apex/shared';

const GRAVITY = 9.81;
/** Streak length = velocity × this (s). */
const STREAK = 0.032;
const GROUND_Y = 0.03;

/**
 * Sparks as short additive line streaks (head + tail per spark) with HDR colour,
 * so the bloom pass makes them glow. Bounce once or twice off the ground and die.
 */
export class Sparks {
  readonly lines: THREE.LineSegments;
  private readonly max = FX.sparksMax;
  private limit = this.max;
  private readonly pos: Float32Array; // 2 vertices per spark
  private readonly col: Float32Array;
  private readonly p: Float32Array; // particle position
  private readonly v: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private next = 0;
  private alive = 0;

  constructor() {
    const n = this.max;
    this.pos = new Float32Array(n * 6);
    this.col = new Float32Array(n * 6);
    this.p = new Float32Array(n * 3);
    this.v = new Float32Array(n * 3);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.lines = new THREE.LineSegments(geo, mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 3;
    this.lines.name = 'sparks';
  }

  setBudget(fraction: number): void {
    this.limit = Math.max(16, Math.floor(this.max * fraction));
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
    const i = this.next;
    this.next = (i + 1) % this.limit;
    const o = i * 3;
    [this.p[o], this.p[o + 1], this.p[o + 2]] = [x, y, z];
    [this.v[o], this.v[o + 1], this.v[o + 2]] = [vx, vy, vz];
    this.age[i] = 0;
    this.life[i] = FX.sparkLife * (0.5 + Math.random());
  }

  /**
   * A spray of `count` sparks from a point: mostly along `dir` (the car's sliding direction),
   * kicked away from the wall along `normal`.
   */
  burst(count: number, at: THREE.Vector3Like, dir: THREE.Vector3Like, normal: THREE.Vector3Like, speed: number): void {
    for (let k = 0; k < count; k++) {
      const s = speed * (0.3 + Math.random() * 0.7);
      const kick = 1 + Math.random() * 4;
      this.emit(
        at.x,
        at.y,
        at.z,
        dir.x * s + normal.x * kick + (Math.random() - 0.5) * 3,
        dir.y * s + Math.abs(normal.y) * kick + Math.random() * 3,
        dir.z * s + normal.z * kick + (Math.random() - 0.5) * 3,
      );
    }
  }

  update(dt: number): void {
    const c = FX.sparkColor;
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      const o = i * 3;
      const o6 = i * 6;
      if (this.life[i] === 0) continue;
      const t = (this.age[i]! += dt) / this.life[i]!;
      if (t >= 1 || i >= this.limit) {
        this.life[i] = 0;
        this.col.fill(0, o6, o6 + 6);
        this.pos.fill(0, o6, o6 + 6);
        continue;
      }
      alive++;
      this.v[o + 1]! -= GRAVITY * dt;
      this.p[o]! += this.v[o]! * dt;
      this.p[o + 1]! += this.v[o + 1]! * dt;
      this.p[o + 2]! += this.v[o + 2]! * dt;
      if (this.p[o + 1]! < GROUND_Y && this.v[o + 1]! < 0) {
        this.p[o + 1] = GROUND_Y;
        this.v[o + 1] = -this.v[o + 1]! * 0.35;
        this.v[o]! *= 0.6;
        this.v[o + 2]! *= 0.6;
      }
      // Head at the particle, tail behind it along the velocity.
      this.pos[o6] = this.p[o]!;
      this.pos[o6 + 1] = this.p[o + 1]!;
      this.pos[o6 + 2] = this.p[o + 2]!;
      this.pos[o6 + 3] = this.p[o]! - this.v[o]! * STREAK;
      this.pos[o6 + 4] = this.p[o + 1]! - this.v[o + 1]! * STREAK;
      this.pos[o6 + 5] = this.p[o + 2]! - this.v[o + 2]! * STREAK;
      // Cools from white-yellow to dim orange.
      const heat = (1 - t) ** 1.5;
      this.col[o6] = c.r * heat;
      this.col[o6 + 1] = c.g * heat * heat;
      this.col[o6 + 2] = c.b * heat * heat * heat;
      this.col[o6 + 3] = this.col[o6]! * 0.3;
      this.col[o6 + 4] = this.col[o6 + 1]! * 0.3;
      this.col[o6 + 5] = this.col[o6 + 2]! * 0.3;
    }
    if (alive > 0 || this.alive > 0) {
      this.lines.geometry.getAttribute('position').needsUpdate = true;
      this.lines.geometry.getAttribute('color').needsUpdate = true;
    }
    this.alive = alive;
    this.lines.visible = alive > 0;
  }

  get activeCount(): number {
    return this.alive;
  }

  dispose(): void {
    this.lines.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
  }
}
