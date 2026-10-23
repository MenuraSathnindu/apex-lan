import * as THREE from 'three';
import { LIVERY, type Livery } from '@apex/shared';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** Black or white, whichever reads better on `color` (relative luminance). */
export function contrastColor(color: number): string {
  const lin = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const lum = 0.2126 * lin((color >> 16) & 255) + 0.7152 * lin((color >> 8) & 255) + 0.0722 * lin(color & 255);
  return lum > 0.35 ? '#111111' : '#ffffff';
}

/**
 * The body paint of one car, drawn on a canvas and used as a texture. The layout is in
 * `LIVERY` (tuning.ts); UVs are a top-down projection of the car, so a stripe at v 0.5 runs down
 * the middle of the engine cover and the nose.
 */
export class LiveryTexture {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  private readonly g: CanvasRenderingContext2D;

  constructor(livery: Livery) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = LIVERY.texture.width;
    this.canvas.height = LIVERY.texture.height;
    this.g = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.paint(livery);
  }

  paint(l: Livery): void {
    const { g } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    // v = 1 is the top row of the canvas (the car's left side).
    const rect = (r: { u0: number; u1: number; v0: number; v1: number }) =>
      g.fillRect(r.u0 * W, (1 - r.v1) * H, (r.u1 - r.u0) * W, (r.v1 - r.v0) * H);

    g.fillStyle = hex(l.primary);
    g.fillRect(0, 0, W, H);
    g.fillStyle = hex(l.secondary);
    LIVERY.stripes.forEach(rect);
    g.fillStyle = hex(l.accent);
    LIVERY.pinstripes.forEach(rect);

    const label = String(l.number);
    for (const n of LIVERY.numbers) {
      const d = n.size * H;
      g.save();
      g.translate(n.u * W, (1 - n.v) * H);
      // The canvas has the nose to the right; rotate so the digits stand upright for a viewer
      // behind the car (up = towards the nose) and read left to right across it.
      g.rotate(Math.PI / 2);
      g.fillStyle = hex(l.secondary);
      g.beginPath();
      g.arc(0, 0, d / 2, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = d * 0.07;
      g.strokeStyle = hex(l.accent);
      g.stroke();
      g.fillStyle = contrastColor(l.secondary);
      g.font = `800 ${d * (label.length > 1 ? 0.5 : 0.62)}px "Arial Black", Arial, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(label, 0, d * 0.03);
      g.restore();
    }
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}

/** Writes top-down UVs (u along the car, v across it) for every vertex, from the given bounds. */
export function applyTopDownUv(
  geometry: THREE.BufferGeometry,
  bounds: { xMin: number; xMax: number; zMin: number; zMax: number },
  matrix?: THREE.Matrix4,
): void {
  const pos = geometry.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    if (matrix) p.applyMatrix4(matrix);
    uv[i * 2] = (p.z - bounds.zMin) / (bounds.zMax - bounds.zMin);
    uv[i * 2 + 1] = (p.x - bounds.xMin) / (bounds.xMax - bounds.xMin);
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
