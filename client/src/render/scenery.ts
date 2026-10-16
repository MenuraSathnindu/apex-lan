import * as THREE from 'three';
import { distanceToCenterline, type BuiltTrack } from '@apex/shared';
import { canvasTexture } from './textures.ts';

/** Small deterministic RNG so every client builds identical scenery. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TREE_COUNT = 1400;
const dummy = new THREE.Object3D();
const color = new THREE.Color();

/**
 * Instanced trees, tyre walls, billboards, a grandstand and the start gantry.
 * Instances are shuffled at creation so drawing the first N gives an even spread
 * (that's how the quality density works).
 */
export class Scenery {
  readonly group = new THREE.Group();
  private readonly instanced: { mesh: THREE.InstancedMesh; total: number }[] = [];

  constructor(private readonly track: BuiltTrack) {
    const rand = mulberry32(7);
    this.buildTrees(rand);
    this.buildTyreWalls();
    this.buildBillboards(rand);
    this.buildGrandstandAndGantry();
  }

  setDensity(density: number): void {
    for (const { mesh, total } of this.instanced) mesh.count = Math.max(1, Math.floor(total * density));
  }

  private barrierOffset() {
    const d = this.track.def;
    return d.roadWidth / 2 + d.curbWidth + d.runoff + d.barrierThickness;
  }

  private addInstanced(geo: THREE.BufferGeometry, mat: THREE.Material, matrices: THREE.Matrix4[], colors?: THREE.Color[]) {
    const mesh = new THREE.InstancedMesh(geo, mat, matrices.length);
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    if (colors) colors.forEach((c, i) => mesh.setColorAt(i, c));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // instances span the whole map
    this.group.add(mesh);
    this.instanced.push({ mesh, total: matrices.length });
    return mesh;
  }

  private buildTrees(rand: () => number) {
    const { samples } = this.track;
    const minDist = this.barrierOffset() + 5;
    type Tree = { x: number; z: number; s: number; conifer: boolean; tint: number };
    const trees: Tree[] = [];
    let attempts = 0;
    while (trees.length < TREE_COUNT && attempts++ < TREE_COUNT * 6) {
      // Cluster near the track so they're actually seen: pick a sample, go out sideways.
      const smp = samples[Math.floor(rand() * samples.length)]!;
      const side = rand() < 0.5 ? 1 : -1;
      const dist = minDist + 2 + rand() ** 1.6 * 140;
      const x = smp.x + smp.nx * side * dist + (rand() - 0.5) * 10;
      const z = smp.z + smp.nz * side * dist + (rand() - 0.5) * 10;
      if (distanceToCenterline(this.track, x, z) < minDist) continue;
      trees.push({ x, z, s: 0.75 + rand() * 0.7, conifer: rand() < 0.45, tint: rand() });
    }

    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 1, 6).translate(0, 0.5, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 1 });
    const leafyGeo = new THREE.IcosahedronGeometry(1, 1);
    const coniferGeo = new THREE.ConeGeometry(1, 1, 8).translate(0, 0.5, 0);
    const foliageMat = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true });

    const trunks: THREE.Matrix4[] = [];
    const leafy: THREE.Matrix4[] = [];
    const leafyColors: THREE.Color[] = [];
    const conifers: THREE.Matrix4[] = [];
    const coniferColors: THREE.Color[] = [];
    for (const t of trees) {
      const h = (t.conifer ? 2.2 : 2.6) * t.s;
      dummy.position.set(t.x, 0, t.z);
      dummy.rotation.set(0, t.tint * Math.PI * 2, 0);
      dummy.scale.set(t.s, h, t.s);
      dummy.updateMatrix();
      trunks.push(dummy.matrix.clone());
      if (t.conifer) {
        dummy.position.set(t.x, h * 0.6, t.z);
        dummy.scale.set(2.2 * t.s, 7 * t.s, 2.2 * t.s);
        dummy.updateMatrix();
        conifers.push(dummy.matrix.clone());
        coniferColors.push(color.setHSL(0.3 + t.tint * 0.04, 0.45, 0.16 + t.tint * 0.06).clone());
      } else {
        dummy.position.set(t.x, h + 2.2 * t.s, t.z);
        dummy.scale.set(3.2 * t.s, 2.8 * t.s, 3.2 * t.s);
        dummy.updateMatrix();
        leafy.push(dummy.matrix.clone());
        leafyColors.push(color.setHSL(0.22 + t.tint * 0.08, 0.5, 0.2 + t.tint * 0.08).clone());
      }
    }
    this.addInstanced(trunkGeo, trunkMat, trunks);
    this.addInstanced(leafyGeo, foliageMat, leafy, leafyColors);
    this.addInstanced(coniferGeo, foliageMat.clone(), conifers, coniferColors);
  }

  /** Stacks of tyres just behind the barrier on the outside of corners. */
  private buildTyreWalls() {
    const { samples } = this.track;
    const off = this.barrierOffset() + 0.45;
    const geo = new THREE.TorusGeometry(0.3, 0.12, 6, 12).rotateX(Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
    const matrices: THREE.Matrix4[] = [];
    for (let i = 0; i < samples.length; i += 1) {
      const smp = samples[i]!;
      if (Math.abs(smp.curvature) < 1 / 60) continue;
      const side = smp.curvature > 0 ? -1 : 1; // outside of the corner
      for (let level = 0; level < 5; level++) {
        dummy.position.set(smp.x + smp.nx * side * off, 0.12 + level * 0.24, smp.z + smp.nz * side * off);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        matrices.push(dummy.matrix.clone());
      }
    }
    if (matrices.length) this.addInstanced(geo, mat, matrices);
  }

  /** Billboards behind the barrier along straights. */
  private buildBillboards(rand: () => number) {
    const { samples } = this.track;
    const off = this.barrierOffset() + 3;
    const tex = canvasTexture([512, 128], (g, w, h) => {
      const brands = ['APEX', 'LAN', 'TURBO', 'GRIP'];
      const colors = ['#e63946', '#1d3557', '#f1a208', '#2a9d8f'];
      for (let i = 0; i < 4; i++) {
        g.fillStyle = colors[i]!;
        g.fillRect((i * w) / 4, 0, w / 4, h);
        g.fillStyle = '#fff';
        g.font = 'bold 44px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(brands[i]!, (i + 0.5) * (w / 4), h / 2);
      }
    });
    const boardGeo = new THREE.PlaneGeometry(8, 2);
    // Each instance shows one of the four panels via a per-instance uv offset would need a
    // custom shader; instead use 4 meshes sharing geometry with different uv windows.
    const matrices: THREE.Matrix4[][] = [[], [], [], []];
    for (let i = 0; i < samples.length; i += 9) {
      const smp = samples[i]!;
      if (Math.abs(smp.curvature) > 1 / 200) continue;
      for (const side of [1, -1]) {
        dummy.position.set(smp.x + smp.nx * side * off, 1.6, smp.z + smp.nz * side * off);
        // Face the track.
        dummy.rotation.set(0, Math.atan2(-smp.nx * side, -smp.nz * side), 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        matrices[Math.floor(rand() * 4)]!.push(dummy.matrix.clone());
      }
    }
    matrices.forEach((list, panel) => {
      if (!list.length) return;
      const geo = boardGeo.clone();
      const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
      for (let k = 0; k < uv.count; k++) uv.setX(k, (panel + uv.getX(k)) / 4);
      const panelTex = tex.clone();
      panelTex.needsUpdate = true;
      this.addInstanced(geo, new THREE.MeshStandardMaterial({ map: panelTex, roughness: 0.6, side: THREE.DoubleSide }), list);
    });
    // Posts are part of the board silhouette only; skipped to keep draw calls low.
  }

  private buildGrandstandAndGantry() {
    const { samples, startIndex, def } = this.track;
    const smp = samples[startIndex]!;
    const yaw = Math.atan2(smp.tx, smp.tz);

    // Grandstand on the left of the start straight, behind the barrier, facing the track.
    const stand = new THREE.Group();
    const concrete = new THREE.MeshStandardMaterial({ color: 0x9a9da3, roughness: 0.9 });
    const seats = new THREE.MeshStandardMaterial({ color: 0x2b59c3, roughness: 0.7 });
    const length = 60;
    for (let row = 0; row < 8; row++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, length), row % 2 ? concrete : seats);
      step.position.set(row * 1.2, 0.3 + row * 0.6, 0);
      step.scale.y = 1 + row * 2;
      step.position.y = (0.6 * (1 + row * 2)) / 2;
      stand.add(step);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(11, 0.25, length + 2), concrete);
    roof.position.set(4.5, 7.2, 0);
    stand.add(roof);
    for (const z of [-length / 2, 0, length / 2]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.4, 7.2, 0.4), concrete);
      pillar.position.set(9.5, 3.6, z);
      stand.add(pillar);
    }
    const off = this.barrierOffset() + 3;
    stand.position.set(smp.x + smp.nx * off, 0, smp.z + smp.nz * off);
    stand.rotation.y = yaw;
    stand.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });

    // Start/finish gantry spanning the road.
    const gantry = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0x30343a, metalness: 0.6, roughness: 0.4 });
    const span = def.roadWidth + def.curbWidth * 2 + 4;
    for (const side of [1, -1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), steel);
      post.position.set((side * span) / 2, 3.5, 0);
      gantry.add(post);
    }
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(span, 1.2, 0.6),
      new THREE.MeshStandardMaterial({
        map: canvasTexture([512, 64], (g, w, h) => {
          for (let x = 0; x < 32; x++) for (let y = 0; y < 4; y++) {
            g.fillStyle = (x + y) % 2 ? '#111' : '#eee';
            g.fillRect((x * w) / 32, (y * h) / 4, w / 32 + 1, h / 4 + 1);
          }
        }),
        roughness: 0.5,
      }),
    );
    beam.position.y = 6.6;
    gantry.add(beam);
    gantry.position.set(smp.x, 0, smp.z);
    gantry.rotation.y = yaw;
    gantry.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });

    this.group.add(stand, gantry);
  }
}
