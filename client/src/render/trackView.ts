import * as THREE from 'three';
import { ASSETS, GROUND_MARGIN, trackBounds, type BuiltTrack, type MeshData } from '@apex/shared';
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
function layer(mat: THREE.MeshStandardMaterial, level: number) {
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

/** Concrete wall (v 0..1) with a red/white painted top band, plus the wall top (v 1..2). */
const barrierTexture = () =>
  canvasTexture([256, 256], (g, w, h) => {
    const img = g.createImageData(w, h);
    let seed = 99;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < w * h; i++) {
      const n = 175 + (rand() - 0.5) * 30;
      img.data.set([n, n, n - 4, 255], i * 4);
    }
    g.putImageData(img, 0, 0);
    // Canvas y=0 is the top; texture v=1 (wall top edge) maps to canvas y = h/2.
    for (let x = 0; x < 8; x++) {
      g.fillStyle = x % 2 ? '#f0f0f0' : '#c4161c';
      g.fillRect((x * w) / 8, h / 2, w / 8 + 1, h * 0.12);
    }
  });

export class TrackView {
  readonly group = new THREE.Group();
  private asphalt!: PbrSet;
  private grass!: PbrSet;
  private grassSize = 0;
  private readonly scenery: Scenery;

  private constructor(private readonly track: BuiltTrack) {
    this.scenery = new Scenery(track);
    this.group.add(this.scenery.group);
  }

  static async create(track: BuiltTrack): Promise<TrackView> {
    const view = new TrackView(track);
    [view.asphalt, view.grass] = await Promise.all([
      loadPbrSet(ASSETS.asphalt, FALLBACK.asphalt, 'Asphalt'),
      loadPbrSet(ASSETS.grass, FALLBACK.grass, 'Grass'),
    ]);
    view.build();
    return view;
  }

  private build() {
    const { track } = this;

    // Grass ground covering the same area as the physics ground.
    const b = trackBounds(track);
    this.grassSize = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) + GROUND_MARGIN * 2;
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(this.grassSize, this.grassSize).rotateX(-Math.PI / 2),
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

    // Road: uv is in road-widths, so repeat = width / tile size.
    const road = new THREE.Mesh(
      toGeometry(track.road),
      layer(
        new THREE.MeshStandardMaterial({
          map: this.asphalt.map,
          normalMap: this.asphalt.normalMap,
          roughnessMap: this.asphalt.roughnessMap,
          roughness: 1,
          color: 0xd8d8d8,
        }),
        1,
      ),
    );
    road.receiveShadow = true;

    const curbs = new THREE.Mesh(
      toGeometry(track.curbs),
      layer(new THREE.MeshStandardMaterial({ map: curbTexture(), roughness: 0.55 }), 2),
    );
    curbs.receiveShadow = true;

    const lines = new THREE.Mesh(
      toGeometry(track.lines),
      layer(new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 }), 3),
    );
    lines.receiveShadow = true;

    const startLine = new THREE.Mesh(
      toGeometry(track.startLine),
      layer(new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.5 }), 4),
    );
    startLine.receiveShadow = true;

    const wallTex = barrierTexture();
    wallTex.repeat.set(1, 0.5); // texture covers v 0..2 (wall face + top)
    const barriers = new THREE.Mesh(
      toGeometry(track.barrierWalls),
      new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.85, side: THREE.DoubleSide }),
    );
    barriers.castShadow = barriers.receiveShadow = true;

    this.group.add(grass, road, curbs, lines, startLine, barriers);
  }

  applyQuality(q: QualitySettings): void {
    const roadRepeat = this.track.def.roadWidth / ASSETS.asphalt.tileSize;
    setRepeat(this.asphalt, roadRepeat, roadRepeat, q.anisotropy);
    const grassRepeat = this.grassSize / ASSETS.grass.tileSize;
    setRepeat(this.grass, grassRepeat, grassRepeat, q.anisotropy);
    this.scenery.setDensity(q.sceneryDensity);
  }
}
