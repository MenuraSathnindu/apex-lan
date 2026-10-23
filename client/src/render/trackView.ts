import * as THREE from 'three';
import { ASSETS, GROUND_MARGIN, trackBounds, type BarrierKind, type BuiltTrack, type MeshData } from '@apex/shared';
import type { QualitySettings } from './quality.ts';
import { Scenery } from './scenery.ts';
import { FALLBACK, canvasTexture, loadPbrSet, setRepeat, type PbrSet } from './textures.ts';

function toGeometry(m: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(m.positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(m.uvs, 2));
  g.setIndex(m.indices);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Layered flat surfaces: polygon offset keeps them from z-fighting at a distance. */
function layer<T extends THREE.MeshStandardMaterial>(mat: T, level: number): T {
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -level;
  mat.polygonOffsetUnits = -level * 2;
  return mat;
}

const curbTexture = () =>
  canvasTexture([16, 64], (g, w, h) => {
    g.fillStyle = '#c4161c';
    g.fillRect(0, 0, w, h / 2);
    g.fillStyle = '#f2f2f2';
    g.fillRect(0, h / 2, w, h / 2);
  });

const checkerTexture = () =>
  canvasTexture([256, 64], (g, w, h) => {
    const cols = 16;
    const rows = 4;
    for (let x = 0; x < cols; x++) {
      for (let y = 0; y < rows; y++) {
        g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
        g.fillRect((x * w) / cols, (y * h) / rows, w / cols + 1, h / rows + 1);
      }
    }
  });

/** Seeded speckle shared by the procedural textures. */
const speckle = (g: CanvasRenderingContext2D, w: number, h: number, pick: (r: number) => [number, number, number]) => {
  const img = g.createImageData(w, h);
  let seed = 99;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < w * h; i++) img.data.set([...pick(rand()), 255], i * 4);
  g.putImageData(img, 0, 0);
};

/** Concrete wall (v 0..1) with a red/white painted top band, plus the wall top (v 1..2). */
const concreteTexture = () =>
  canvasTexture([256, 256], (g, w, h) => {
    speckle(g, w, h, (r) => {
      const n = 175 + (r - 0.5) * 30;
      return [n, n, n - 4];
    });
    // Canvas y=0 is the top; texture v=1 (wall top edge) maps to canvas y = h/2.
    for (let x = 0; x < 8; x++) {
      g.fillStyle = x % 2 ? '#f0f0f0' : '#c4161c';
      g.fillRect((x * w) / 8, h / 2, w / 8 + 1, h * 0.12);
    }
  });

/** Steel guard rail: two pressed rails on dark posts (v 0..1 face), plain steel top (v 1..2). */
const armcoTexture = () =>
  canvasTexture([256, 256], (g, w, h) => {
    g.fillStyle = '#9ea4ab';
    g.fillRect(0, 0, w, h / 2); // top
    g.fillStyle = '#2b2e33';
    g.fillRect(0, h / 2, w, h / 2); // face background (posts / shadow)
    for (const [y0, y1] of [
      [0.52, 0.66],
      [0.7, 0.84],
    ] as const) {
      const grad = g.createLinearGradient(0, y0 * h, 0, y1 * h);
      grad.addColorStop(0, '#d8dde2');
      grad.addColorStop(0.5, '#8d949b');
      grad.addColorStop(1, '#c6ccd2');
      g.fillStyle = grad;
      g.fillRect(0, y0 * h, w, (y1 - y0) * h);
    }
    for (let x = 0; x < 2; x++) {
      g.fillStyle = '#4a4f55';
      g.fillRect((x * w) / 2 + w * 0.22, h * 0.5, w * 0.05, h * 0.5);
    }
  });

const gravelTexture = () =>
  canvasTexture([256, 256], (g, w, h) =>
    speckle(g, w, h, (r) => {
      const n = (r - 0.5) * 70;
      return [188 + n, 170 + n, 138 + n];
    }),
  );

const BARRIER_TEXTURES: Record<BarrierKind, () => THREE.Texture> = { concrete: concreteTexture, armco: armcoTexture };

/** Metres of road / grass per texture repeat (the meshes carry UVs in metres). */
const GRAVEL_TILE = 3;

let textureSets: Promise<{ asphalt: PbrSet; grass: PbrSet }> | null = null;
/** Loaded once and shared by every track. */
function sharedTextures() {
  return (textureSets ??= Promise.all([
    loadPbrSet(ASSETS.asphalt, FALLBACK.asphalt, 'Asphalt'),
    loadPbrSet(ASSETS.grass, FALLBACK.grass, 'Grass'),
  ]).then(([asphalt, grass]) => ({ asphalt, grass })));
}

/** Everything drawn for one track: ground, road surfaces, barriers and scenery. */
export class TrackView {
  readonly group = new THREE.Group();
  private asphalt!: PbrSet;
  private grass!: PbrSet;
  private readonly scenery: Scenery;
  /** Textures this view created (the shared PBR sets are not ours to dispose). */
  private readonly ownTextures: THREE.Texture[] = [];

  private constructor(private readonly track: BuiltTrack) {
    this.scenery = new Scenery(track);
    this.group.add(this.scenery.group);
  }

  /** Lights the first `n` lamps of the start gantry. */
  setStartLights(n: number): void {
    this.scenery.setStartLights(n);
  }

  static async create(track: BuiltTrack): Promise<TrackView> {
    const view = new TrackView(track);
    ({ asphalt: view.asphalt, grass: view.grass } = await sharedTextures());
    view.build();
    return view;
  }

  private own<T extends THREE.Texture>(t: T): T {
    this.ownTextures.push(t);
    return t;
  }

  private build() {
    const { track } = this;

    // Grass ground covering the same area as the physics ground, UVs in metres.
    const b = trackBounds(track);
    const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) + GROUND_MARGIN * 2;
    const grassGeo = new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2);
    const uv = grassGeo.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * size, uv.getY(i) * size);
    const grass = new THREE.Mesh(
      grassGeo,
      new THREE.MeshStandardMaterial({
        map: this.grass.map,
        normalMap: this.grass.normalMap,
        roughnessMap: this.grass.roughnessMap,
        color: this.grass.fromFiles ? ASSETS.grass.tint : 0xffffff,
        roughness: 1,
        normalScale: new THREE.Vector2(0.6, 0.6),
      }),
    );
    grass.position.set(b.cx, 0, b.cz);
    grass.receiveShadow = true;

    const asphalt = (color: number, level: number) =>
      layer(
        new THREE.MeshStandardMaterial({
          map: this.asphalt.map,
          normalMap: this.asphalt.normalMap,
          roughnessMap: this.asphalt.roughnessMap,
          roughness: 1,
          color,
        }),
        level,
      );
    const surface = (mesh: MeshData, mat: THREE.Material) => {
      const m = new THREE.Mesh(toGeometry(mesh), mat);
      m.receiveShadow = true;
      return m;
    };

    const gravelTex = this.own(gravelTexture());
    gravelTex.repeat.set(1 / GRAVEL_TILE, 1 / GRAVEL_TILE);
    const parts: THREE.Object3D[] = [
      grass,
      surface(track.gravel, layer(new THREE.MeshStandardMaterial({ map: gravelTex, roughness: 1 }), 1)),
      surface(track.apron, asphalt(0xb4b4b4, 1)),
      surface(track.pitLane, asphalt(0xc4c4c4, 1)),
      surface(track.road, asphalt(0xd8d8d8, 2)),
      surface(track.curbs, layer(new THREE.MeshStandardMaterial({ map: this.own(curbTexture()), roughness: 0.55 }), 3)),
      surface(track.lines, layer(new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 }), 4)),
      surface(track.startLine, layer(new THREE.MeshStandardMaterial({ map: this.own(checkerTexture()), roughness: 0.5 }), 5)),
    ];

    for (const { kind, mesh } of track.barrierMeshes) {
      if (!mesh.indices.length) continue;
      const tex = this.own(BARRIER_TEXTURES[kind]());
      tex.repeat.set(1, 0.5); // texture covers v 0..2 (wall face + top)
      const m = new THREE.Mesh(
        toGeometry(mesh),
        new THREE.MeshStandardMaterial({
          map: tex,
          roughness: kind === 'armco' ? 0.45 : 0.85,
          metalness: kind === 'armco' ? 0.5 : 0,
          side: THREE.DoubleSide,
        }),
      );
      m.castShadow = m.receiveShadow = true;
      parts.push(m);
    }
    this.group.add(...parts);
  }

  applyQuality(q: QualitySettings): void {
    setRepeat(this.asphalt, 1 / ASSETS.asphalt.tileSize, 1 / ASSETS.asphalt.tileSize, q.anisotropy);
    setRepeat(this.grass, 1 / ASSETS.grass.tileSize, 1 / ASSETS.grass.tileSize, q.anisotropy);
    this.scenery.setDensity(q.sceneryDensity);
  }

  /** Frees everything this track created (shared textures stay loaded for the next track). */
  dispose(): void {
    this.group.removeFromParent();
    const shared = new Set<THREE.Texture | null>([this.asphalt.map, this.asphalt.normalMap, this.asphalt.roughnessMap, this.grass.map, this.grass.normalMap, this.grass.roughnessMap]);
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const map = (m as THREE.MeshStandardMaterial).map;
        if (map && !shared.has(map) && !this.ownTextures.includes(map)) map.dispose();
        m.dispose();
      }
    });
    for (const t of this.ownTextures) t.dispose();
    this.scenery.dispose();
  }
}
