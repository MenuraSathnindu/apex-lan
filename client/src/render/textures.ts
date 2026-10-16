import * as THREE from 'three';

export interface PbrSet {
  map: THREE.Texture;
  normalMap: THREE.Texture | null;
  roughnessMap: THREE.Texture | null;
  /** False when the real files were missing and procedural fallbacks are used. */
  fromFiles: boolean;
}

const loader = new THREE.TextureLoader();

async function tryLoad(url: string, srgb: boolean): Promise<THREE.Texture | null> {
  try {
    const tex = await loader.loadAsync(url);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    return tex;
  } catch {
    return null;
  }
}

/** Canvas texture helper for procedural materials. */
export function canvasTexture(size: [number, number], draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, srgb = true) {
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = size;
  draw(canvas.getContext('2d')!, canvas.width, canvas.height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return tex;
}

/** Deterministic value noise speckle — enough to stop flat colours looking like plastic. */
function speckle(g: CanvasRenderingContext2D, w: number, h: number, base: [number, number, number], amount: number) {
  const img = g.createImageData(w, h);
  let seed = 1234567;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < w * h; i++) {
    const n = (rand() - 0.5) * amount;
    img.data[i * 4] = base[0] + n;
    img.data[i * 4 + 1] = base[1] + n;
    img.data[i * 4 + 2] = base[2] + n;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

export const FALLBACK = {
  asphalt: () => canvasTexture([256, 256], (g, w, h) => speckle(g, w, h, [62, 64, 68], 26)),
  grass: () => canvasTexture([256, 256], (g, w, h) => speckle(g, w, h, [78, 112, 52], 34)),
};

/** Loads an albedo/normal/roughness set; any missing file falls back gracefully. */
export async function loadPbrSet(
  paths: { map: string; normalMap: string; roughnessMap: string },
  fallback: () => THREE.Texture,
  label: string,
): Promise<PbrSet> {
  const [map, normalMap, roughnessMap] = await Promise.all([
    tryLoad(paths.map, true),
    tryLoad(paths.normalMap, false),
    tryLoad(paths.roughnessMap, false),
  ]);
  if (!map) console.warn(`[assets] ${label} texture not found at /${paths.map} — using a procedural fallback. See docs/ASSETS.md.`);
  return { map: map ?? fallback(), normalMap, roughnessMap, fromFiles: !!map };
}

export function setRepeat(set: PbrSet, x: number, y: number, anisotropy: number) {
  for (const t of [set.map, set.normalMap, set.roughnessMap]) {
    if (!t) continue;
    t.repeat.set(x, y);
    t.anisotropy = anisotropy;
    t.needsUpdate = true;
  }
}
