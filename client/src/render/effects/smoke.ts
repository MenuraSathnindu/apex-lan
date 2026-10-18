import * as THREE from 'three';
import { FX } from '@apex/shared';

/** Soft, slightly lumpy puff texture drawn once on a canvas. */
function puffTexture(): THREE.Texture {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  let seed = 3;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9; i++) {
    const x = size / 2 + (rand() - 0.5) * size * 0.3;
    const y = size / 2 + (rand() - 0.5) * size * 0.3;
    const r = size * (0.22 + rand() * 0.18);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute float aSpin;
  uniform float uScale;
  varying float vAlpha;
  varying float vSpin;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aAlpha > 0.0 ? aSize * uScale / max(-mv.z, 0.1) : 0.0;
    vAlpha = aAlpha;
    vSpin = aSpin;
  }`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  varying float vAlpha;
  varying float vSpin;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float c = cos(vSpin), s = sin(vSpin);
    p = mat2(c, -s, s, c) * p + 0.5;
    float a = texture2D(uMap, p).a * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor, a);
  }`;

/**
 * Tyre smoke: a fixed pool of point sprites updated on the CPU (a few hundred at most).
 * Dead particles get alpha 0 and a zero point size, so the whole pool is one draw call.
 */
export class Smoke {
  readonly points: THREE.Points;
  private readonly max = FX.smokeMax;
  private limit = this.max;
  private readonly pos: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly spin: Float32Array;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly spinRate: Float32Array;
  private readonly material: THREE.ShaderMaterial;
  private next = 0;
  private alive = 0;

  constructor() {
    const n = this.max;
    this.pos = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.spin = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    this.spinRate = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSpin', new THREE.BufferAttribute(this.spin, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uMap: { value: puffTexture() },
        uColor: { value: new THREE.Color(FX.smokeBrightness, FX.smokeBrightness, FX.smokeBrightness) },
        uScale: { value: 500 },
      },
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    this.points.name = 'tyre-smoke';
  }

  /** Quality budget: fraction of the pool in use. */
  setBudget(fraction: number): void {
    this.limit = Math.max(16, Math.floor(this.max * fraction));
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
    const i = this.next;
    this.next = (i + 1) % this.limit;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.age[i] = 0;
    this.life[i] = FX.smokeLife * (0.7 + Math.random() * 0.6);
    this.spin[i] = Math.random() * Math.PI * 2;
    this.spinRate[i] = (Math.random() - 0.5) * 1.2;
    this.alpha[i] = 0.0001;
  }

  update(dt: number, camera: THREE.PerspectiveCamera, drawingBufferHeight: number): void {
    this.material.uniforms.uScale!.value = drawingBufferHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    let alive = 0;
    const drag = Math.exp(-1.6 * dt);
    for (let i = 0; i < this.max; i++) {
      if (this.alpha[i] === 0) continue;
      const a = (this.age[i]! += dt);
      const t = a / this.life[i]!;
      if (t >= 1 || i >= this.limit) {
        this.alpha[i] = 0;
        continue;
      }
      alive++;
      const o = i * 3;
      this.vel[o]! *= drag;
      this.vel[o + 1] = this.vel[o + 1]! * drag + 0.5 * dt; // buoyant
      this.vel[o + 2]! *= drag;
      this.pos[o]! += this.vel[o]! * dt;
      this.pos[o + 1]! += this.vel[o + 1]! * dt;
      this.pos[o + 2]! += this.vel[o + 2]! * dt;
      this.spin[i]! += this.spinRate[i]! * dt;
      this.size[i] = FX.smokeStartSize + (FX.smokeEndSize - FX.smokeStartSize) * Math.sqrt(t);
      this.alpha[i] = Math.max(0.0001, FX.smokeOpacity * Math.min(1, t * 8) * (1 - t) ** 1.6);
    }
    // Skip the uploads entirely while there's no smoke.
    if (alive > 0 || this.alive > 0) {
      const geo = this.points.geometry;
      for (const name of ['position', 'aSize', 'aAlpha', 'aSpin']) geo.getAttribute(name).needsUpdate = true;
    }
    this.alive = alive;
    this.points.visible = alive > 0;
  }

  get activeCount(): number {
    return this.alive;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.uniforms.uMap!.value.dispose();
    this.material.dispose();
  }
}
