import * as THREE from 'three';
import { FX } from '@apex/shared';

interface Trail {
  x: number;
  y: number;
  z: number;
  /** Shade at the last point (1 = no mark, lower = darker). */
  shade: number;
  /** Edge vertices of the last quad, so consecutive quads join without gaps. */
  lx: number;
  lz: number;
  rx: number;
  rz: number;
  hasEdge: boolean;
  active: boolean;
}

function restart(t: Trail, x: number, y: number, z: number) {
  [t.x, t.y, t.z, t.shade] = [x, y, z, 1];
  t.hasEdge = false;
}

/** Restart a trail instead of joining if the wheel jumped further than this (respawn, teleport). */
const MAX_JOIN = 3;

/**
 * Tyre marks as one dynamic mesh: a ring buffer of quads that darken the road under them
 * (multiply blending, so they never look lighter than the asphalt and ignore lighting).
 * Old marks are overwritten once the buffer is full. One draw call for every car.
 */
export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly posAttr: THREE.BufferAttribute;
  private readonly colAttr: THREE.BufferAttribute;
  private readonly trails = new Map<string, Trail>();
  private readonly max = FX.skidSegments;
  private next = 0;
  private dirtyFrom = -1;
  private dirtyTo = -1;
  private wrapped = false;

  constructor() {
    const n = this.max;
    this.positions = new Float32Array(n * 4 * 3);
    this.colors = new Float32Array(n * 4 * 3).fill(1);
    const index = new Uint32Array(n * 6);
    for (let i = 0; i < n; i++) index.set([i * 4, i * 4 + 2, i * 4 + 1, i * 4 + 1, i * 4 + 2, i * 4 + 3], i * 6);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.MultiplyBlending,
      premultipliedAlpha: true,
      depthWrite: false,
      fog: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -6,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.name = 'skid-marks';
  }

  /**
   * Extends wheel `key`'s mark to (x, y, z) with strength 0..1. Call every tick while the
   * tyre slides; call `lift(key)` when it stops so the next mark starts fresh.
   */
  add(key: string, x: number, y: number, z: number, strength: number): void {
    let t = this.trails.get(key);
    if (!t) {
      t = { x, y, z, shade: 1, lx: 0, lz: 0, rx: 0, rz: 0, hasEdge: false, active: false };
      this.trails.set(key, t);
    }
    const shade = 1 - FX.skidDarkness * Math.min(1, Math.max(0, strength));
    if (!t.active) {
      // Start a new strip here (faded in from the road colour).
      restart(t, x, y, z);
      t.active = true;
      return;
    }
    const dx = x - t.x;
    const dz = z - t.z;
    const d = Math.hypot(dx, dz);
    if (d < FX.skidStep) return;
    if (d > MAX_JOIN) {
      restart(t, x, y, z);
      return;
    }
    const hw = FX.skidWidth / 2;
    const px = (-dz / d) * hw;
    const pz = (dx / d) * hw;
    if (!t.hasEdge) {
      [t.lx, t.lz, t.rx, t.rz] = [t.x + px, t.z + pz, t.x - px, t.z - pz];
    }
    const lift = 0.012;
    const i = this.next;
    const p = this.positions;
    const o = i * 12;
    p[o] = t.lx;
    p[o + 1] = t.y + lift;
    p[o + 2] = t.lz;
    p[o + 3] = t.rx;
    p[o + 4] = t.y + lift;
    p[o + 5] = t.rz;
    p[o + 6] = x + px;
    p[o + 7] = y + lift;
    p[o + 8] = z + pz;
    p[o + 9] = x - px;
    p[o + 10] = y + lift;
    p[o + 11] = z - pz;
    this.colors.fill(t.shade, o, o + 6);
    this.colors.fill(shade, o + 6, o + 12);
    [t.x, t.y, t.z, t.shade] = [x, y, z, shade];
    [t.lx, t.lz, t.rx, t.rz] = [x + px, z + pz, x - px, z - pz];
    t.hasEdge = true;

    if (this.dirtyFrom < 0) this.dirtyFrom = i;
    this.dirtyTo = i;
    this.next = (i + 1) % this.max;
    if (this.next === 0) this.wrapped = true;
  }

  /** The tyre stopped sliding: end its current strip. */
  lift(key: string): void {
    const t = this.trails.get(key);
    if (t) t.active = false;
  }

  forget(key: string): void {
    this.trails.delete(key);
  }

  /** Uploads the quads written since last frame. */
  update(): void {
    if (this.dirtyFrom < 0) return;
    for (const attr of [this.posAttr, this.colAttr]) {
      attr.clearUpdateRanges();
      if (this.dirtyTo >= this.dirtyFrom) attr.addUpdateRange(this.dirtyFrom * 12, (this.dirtyTo - this.dirtyFrom + 1) * 12);
      else {
        // Wrapped around the ring this frame.
        attr.addUpdateRange(this.dirtyFrom * 12, (this.max - this.dirtyFrom) * 12);
        attr.addUpdateRange(0, (this.dirtyTo + 1) * 12);
      }
      attr.needsUpdate = true;
    }
    this.dirtyFrom = this.dirtyTo = -1;
  }

  /** Number of quads drawn so far (capped at the buffer size). */
  get count(): number {
    return this.wrapped ? this.max : this.next;
  }

  clear(): void {
    this.positions.fill(0);
    this.colors.fill(1);
    this.next = 0;
    this.wrapped = false;
    for (const attr of [this.posAttr, this.colAttr]) {
      attr.clearUpdateRanges();
      attr.needsUpdate = true;
    }
    this.trails.clear();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
