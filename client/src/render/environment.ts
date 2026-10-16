import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { ASSETS, ENVIRONMENT } from '@apex/shared';
import type { QualitySettings } from './quality.ts';

export type EnvironmentSource = 'hdri' | 'procedural-sky';

/** Reads pixel i of an HDR DataTexture as linear RGB (handles half and full float). */
function hdrPixel(data: ArrayLike<number>, i: number, half: boolean): [number, number, number] {
  const f = half ? THREE.DataUtils.fromHalfFloat : (v: number) => v;
  return [f(data[i * 4]!), f(data[i * 4 + 1]!), f(data[i * 4 + 2]!)];
}

/** Equirect pixel → world direction, matching three's equirectUv() with flipY = true. */
function equirectDir(px: number, py: number, w: number, h: number): THREE.Vector3 {
  const u = (px + 0.5) / w;
  const v = 1 - (py + 0.5) / h;
  const phi = (u - 0.5) * Math.PI * 2;
  const theta = (v - 0.5) * Math.PI;
  return new THREE.Vector3(Math.cos(theta) * Math.cos(phi), Math.sin(theta), Math.cos(theta) * Math.sin(phi));
}

/** Finds the sun (brightest region) and the average horizon colour of an HDRI. */
function analyzeHdri(tex: THREE.DataTexture): { sun: THREE.Vector3; horizon: THREE.Color } {
  const { data, width: w, height: h } = tex.image as { data: ArrayLike<number>; width: number; height: number };
  const half = tex.type === THREE.HalfFloatType;
  let best = -1;
  let bestX = 0;
  let bestY = 0;
  const stride = 2;
  for (let y = 0; y < h / 2; y += stride) {
    // upper hemisphere only
    for (let x = 0; x < w; x += stride) {
      const [r, g, b] = hdrPixel(data, y * w + x, half);
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (lum > best) [best, bestX, bestY] = [lum, x, y];
    }
  }
  const horizon = new THREE.Color(0, 0, 0);
  const rowStart = Math.floor(h * 0.49);
  const rowEnd = Math.floor(h * 0.5);
  let count = 0;
  for (let y = rowStart; y < rowEnd; y++) {
    for (let x = 0; x < w; x += 4) {
      const [r, g, b] = hdrPixel(data, y * w + x, half);
      horizon.r += r;
      horizon.g += g;
      horizon.b += b;
      count++;
    }
  }
  horizon.multiplyScalar(1 / Math.max(count, 1));
  return { sun: equirectDir(bestX, bestY, w, h), horizon };
}

function fallbackSunDir(): THREE.Vector3 {
  const el = THREE.MathUtils.degToRad(ENVIRONMENT.fallbackSunElevationDeg);
  const az = THREE.MathUtils.degToRad(ENVIRONMENT.fallbackSunAzimuthDeg);
  return new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
}

export class Environment {
  readonly sun = new THREE.DirectionalLight(ENVIRONMENT.sunColor, ENVIRONMENT.sunIntensity);
  source: EnvironmentSource = 'procedural-sky';
  private sunDir = fallbackSunDir();
  private range = 35;
  private readonly basisRight = new THREE.Vector3();
  private readonly basisUp = new THREE.Vector3();
  private readonly snapped = new THREE.Vector3();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
  ) {
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun, this.sun.target);
    scene.fog = new THREE.FogExp2(ENVIRONMENT.fogColor, ENVIRONMENT.fogDensity);
  }

  /** Loads the HDRI if present, otherwise builds a procedural sky. Never throws. */
  async load(): Promise<void> {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    try {
      const tex = await new HDRLoader().loadAsync(ASSETS.hdri);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      const { sun, horizon } = analyzeHdri(tex);
      this.scene.background = tex;
      this.scene.environment = pmrem.fromEquirectangular(tex).texture;
      (this.scene.fog as THREE.FogExp2).color.copy(horizon);
      this.sunDir = ENVIRONMENT.sunDirection ? new THREE.Vector3().copy(ENVIRONMENT.sunDirection).normalize() : sun;
      this.source = 'hdri';
    } catch (err) {
      console.warn(`[assets] HDRI not found at /${ASSETS.hdri} — using a procedural sky. See docs/ASSETS.md.`, err);
      this.sunDir = ENVIRONMENT.sunDirection ? new THREE.Vector3().copy(ENVIRONMENT.sunDirection).normalize() : fallbackSunDir();
      // Render three's Sky once into an environment map and use it for both the background
      // and reflections. Sky's raw output is very bright (its example runs at exposure 0.5),
      // so it's dimmed via background/environment intensity.
      const envScene = new THREE.Scene();
      const sky = new Sky();
      sky.scale.setScalar(1000);
      const u = sky.material.uniforms;
      u['turbidity']!.value = 3;
      u['rayleigh']!.value = 1.2;
      u['mieCoefficient']!.value = 0.004;
      u['mieDirectionalG']!.value = 0.8;
      u['sunPosition']!.value.copy(this.sunDir);
      envScene.add(sky);
      const env = pmrem.fromScene(envScene).texture;
      this.scene.background = env;
      this.scene.environment = env;
      this.scene.backgroundIntensity = ENVIRONMENT.fallbackSkyIntensity;
      this.source = 'procedural-sky';
    }
    this.scene.environmentIntensity =
      ENVIRONMENT.envIntensity * (this.source === 'hdri' ? 1 : ENVIRONMENT.fallbackSkyIntensity);
    pmrem.dispose();

    // Basis perpendicular to the sun, used to snap the shadow camera to whole texels.
    const ref = Math.abs(this.sunDir.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    this.basisRight.crossVectors(ref, this.sunDir).normalize();
    this.basisUp.crossVectors(this.sunDir, this.basisRight).normalize();
  }

  applyQuality(q: QualitySettings): void {
    const s = this.sun.shadow;
    this.renderer.shadowMap.enabled = q.shadows;
    this.sun.castShadow = q.shadows;
    this.range = q.shadowRange;
    if (s.mapSize.x !== q.shadowMapSize) {
      s.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      s.map?.dispose();
      (s as { map: THREE.WebGLRenderTarget | null }).map = null;
    }
    s.radius = q.shadowRadius;
    Object.assign(s.camera, { left: -this.range, right: this.range, top: this.range, bottom: -this.range, near: 1, far: 400 });
    s.camera.updateProjectionMatrix();
    // Materials compiled with/without shadows need recompiling.
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m) for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
    });
  }

  /** Keeps the shadow box centred on the player, snapped to texels to avoid shimmering. */
  follow(target: THREE.Vector3): void {
    const texel = (this.range * 2) / this.sun.shadow.mapSize.x;
    const r = Math.round(target.dot(this.basisRight) / texel) * texel;
    const u = Math.round(target.dot(this.basisUp) / texel) * texel;
    const d = target.dot(this.sunDir);
    this.snapped
      .copy(this.basisRight)
      .multiplyScalar(r)
      .addScaledVector(this.basisUp, u)
      .addScaledVector(this.sunDir, d);
    this.sun.target.position.copy(this.snapped);
    this.sun.position.copy(this.snapped).addScaledVector(this.sunDir, 150);
  }
}
