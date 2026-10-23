import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TRACK_STYLE, boundaryAt, clearanceFrom, type BuiltTrack, type Placement } from '@apex/shared';
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
const BLOCK_COUNT = 260;
const dummy = new THREE.Object3D();
const color = new THREE.Color();

/** Rotation about Y that maps local +Z along the track and local +X away from it. */
function placementYaw(p: Placement): number {
  const yaw = Math.atan2(p.tx, p.tz);
  // Local +X after that yaw is the track's left normal (tz, -tx); flip if "away" is to the right.
  return p.ox * p.tz - p.oz * p.tx >= 0 ? yaw : yaw + Math.PI;
}

/**
 * Instanced trees (or city blocks on street circuits), tyre stacks, billboards, grandstands,
 * the pit building and the start gantry. Instances are shuffled at creation so drawing the
 * first N gives an even spread (that's how the quality density works).
 */
export class Scenery {
  readonly group = new THREE.Group();
  private readonly instanced: { mesh: THREE.InstancedMesh; total: number; scalable: boolean }[] = [];

  constructor(private readonly track: BuiltTrack) {
    const rand = mulberry32(7);
    if (track.def.street) this.buildBlocks(rand);
    else this.buildTrees(rand);
    if (!track.def.street) this.buildTyreStacks();
    this.buildBillboards(rand);
    this.buildGrandstands();
    this.buildPitBuilding();
    this.buildGantry();
  }

  setDensity(density: number): void {
    for (const { mesh, total, scalable } of this.instanced) mesh.count = scalable ? Math.max(1, Math.floor(total * density)) : total;
  }

  private addInstanced(geo: THREE.BufferGeometry, mat: THREE.Material, matrices: THREE.Matrix4[], colors?: THREE.Color[], scalable = true) {
    const mesh = new THREE.InstancedMesh(geo, mat, matrices.length);
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    if (colors) colors.forEach((c, i) => mesh.setColorAt(i, c));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // instances span the whole map
    this.group.add(mesh);
    this.instanced.push({ mesh, total: matrices.length, scalable });
    return mesh;
  }

  /** A random spot `min..min+spread` m beyond the boundary, clear of every part of the track. */
  private randomSpot(rand: () => number, min: number, spread: number): [number, number] | null {
    const { samples } = this.track;
    const i = Math.floor(rand() * samples.length);
    const smp = samples[i]!;
    const side = rand() < 0.5 ? 1 : -1;
    const dist = boundaryAt(this.track, i) + min + rand() ** 1.6 * spread;
    const x = smp.x + smp.nx * side * dist + (rand() - 0.5) * 10;
    const z = smp.z + smp.nz * side * dist + (rand() - 0.5) * 10;
    return clearanceFrom(this.track, x, z) < min ? null : [x, z];
  }

  private buildTrees(rand: () => number) {
    type Tree = { x: number; z: number; s: number; conifer: boolean; tint: number };
    const trees: Tree[] = [];
    let attempts = 0;
    while (trees.length < TREE_COUNT && attempts++ < TREE_COUNT * 6) {
      const spot = this.randomSpot(rand, 6, 140);
      if (spot) trees.push({ x: spot[0], z: spot[1], s: 0.75 + rand() * 0.7, conifer: rand() < 0.45, tint: rand() });
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

  /** Street circuits: blocks of buildings close behind the walls instead of trees. */
  private buildBlocks(rand: () => number) {
    const matrices: THREE.Matrix4[] = [];
    const colors: THREE.Color[] = [];
    let attempts = 0;
    while (matrices.length < BLOCK_COUNT && attempts++ < BLOCK_COUNT * 8) {
      const spot = this.randomSpot(rand, 8, 90);
      if (!spot) continue;
      const w = 10 + rand() * 18;
      const d = 10 + rand() * 18;
      const h = 8 + rand() ** 2 * 40;
      dummy.position.set(spot[0], h / 2, spot[1]);
      dummy.rotation.set(0, rand() * Math.PI, 0);
      dummy.scale.set(w, h, d);
      dummy.updateMatrix();
      matrices.push(dummy.matrix.clone());
      colors.push(color.setHSL(0.08 + rand() * 0.06, 0.15 + rand() * 0.2, 0.55 + rand() * 0.25).clone());
    }
    if (matrices.length) this.addInstanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.9 }), matrices, colors);
  }

  /** Stacks of tyres in front of the barrier on the outside of tight corners. */
  private buildTyreStacks() {
    const { samples, barrierLeft, barrierRight } = this.track;
    const geo = new THREE.TorusGeometry(0.3, 0.12, 6, 12).rotateX(Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
    const matrices: THREE.Matrix4[] = [];
    for (let i = 0; i < samples.length; i++) {
      const smp = samples[i]!;
      if (Math.abs(smp.curvature) < 1 / 60) continue;
      const side = smp.curvature > 0 ? -1 : 1; // outside of the corner
      const barrier = side > 0 ? barrierLeft[i]! : barrierRight[i]!;
      if (Number.isNaN(barrier)) continue;
      const off = side * (barrier - 0.45);
      for (let level = 0; level < 4; level++) {
        dummy.position.set(smp.x + smp.nx * off, 0.12 + level * 0.24, smp.z + smp.nz * off);
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
    const { samples, barrierLeft, barrierRight } = this.track;
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
    // Each panel is a separate mesh sharing geometry with a different uv window.
    const matrices: THREE.Matrix4[][] = [[], [], [], []];
    for (let i = 0; i < samples.length; i += 9) {
      const smp = samples[i]!;
      if (Math.abs(smp.curvature) > 1 / 200) continue;
      for (const side of [1, -1]) {
        const barrier = side > 0 ? barrierLeft[i]! : barrierRight[i]!;
        if (Number.isNaN(barrier)) continue;
        const off = barrier + 3;
        const x = smp.x + smp.nx * side * off;
        const z = smp.z + smp.nz * side * off;
        if (clearanceFrom(this.track, x, z) < 1.5) continue;
        dummy.position.set(x, 1.6, z);
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
  }

  /** Grandstands: one merged stand geometry, instanced at every placement the track found. */
  private buildGrandstands() {
    const stands = this.track.grandstands;
    if (!stands.length) return;
    const G = TRACK_STYLE.grandstand;
    const rows = 8;
    const rowDepth = G.depth / (rows + 1);
    // Local frame: +Z along the track, +X away from it; rows rise away from the track.
    const seatParts: THREE.BufferGeometry[] = [];
    const concreteParts: THREE.BufferGeometry[] = [];
    for (let r = 0; r < rows; r++) {
      const h = 0.6 * (1 + r * 2);
      (r % 2 ? concreteParts : seatParts).push(new THREE.BoxGeometry(rowDepth, h, G.length).translate(-G.depth / 2 + rowDepth * (r + 0.5), h / 2, 0));
    }
    concreteParts.push(new THREE.BoxGeometry(G.depth, 0.25, G.length + 2).translate(0, 7.4, 0));
    for (const z of [-G.length / 2, 0, G.length / 2]) concreteParts.push(new THREE.BoxGeometry(0.4, 7.4, 0.4).translate(G.depth / 2 - 0.5, 3.7, z));
    const matrices = stands.map((p) => {
      dummy.position.set(p.x, 0, p.z);
      dummy.rotation.set(0, placementYaw(p), 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      return dummy.matrix.clone();
    });
    this.addInstanced(mergeGeometries(seatParts)!, new THREE.MeshStandardMaterial({ color: 0x2b59c3, roughness: 0.7 }), matrices, undefined, false);
    this.addInstanced(mergeGeometries(concreteParts)!, new THREE.MeshStandardMaterial({ color: 0x9a9da3, roughness: 0.9 }), matrices, undefined, false);
  }

  /** Pit building behind the pit lane, with instanced garage doors facing the lane. */
  private buildPitBuilding() {
    const p = this.track.pitBuilding;
    if (!p) return;
    const P = TRACK_STYLE.pit;
    const yaw = placementYaw(p);
    const building = new THREE.Mesh(
      new THREE.BoxGeometry(p.depth, P.buildingHeight, p.length).translate(0, P.buildingHeight / 2, 0),
      new THREE.MeshStandardMaterial({ color: 0xdedfe2, roughness: 0.8 }),
    );
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(p.depth + 4, 0.4, p.length + 2).translate(-2, P.buildingHeight + 0.2, 0),
      new THREE.MeshStandardMaterial({ color: 0x30343a, roughness: 0.6 }),
    );
    const block = new THREE.Group();
    block.add(building, roof);
    block.position.set(p.x, 0, p.z);
    block.rotation.y = yaw;
    block.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    this.group.add(block);

    // Garage doors along the lane side (local -X face).
    const count = Math.max(1, Math.floor(p.length / P.garageSpacing));
    const doorGeo = new THREE.BoxGeometry(0.2, 4.2, P.garageSpacing - 2);
    const matrices: THREE.Matrix4[] = [];
    const along = new THREE.Vector3(p.tx, 0, p.tz);
    const away = new THREE.Vector3(p.ox, 0, p.oz);
    for (let k = 0; k < count; k++) {
      const t = (k + 0.5) / count - 0.5;
      const pos = new THREE.Vector3(p.x, 2.1, p.z).addScaledVector(along, t * p.length).addScaledVector(away, -p.depth / 2 - 0.1);
      dummy.position.copy(pos);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      matrices.push(dummy.matrix.clone());
    }
    this.addInstanced(doorGeo, new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.5, metalness: 0.4 }), matrices, undefined, false);
  }

  /** Start/finish gantry spanning the road. */
  private buildGantry() {
    const smp = this.track.samples[0]!;
    const gantry = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0x30343a, metalness: 0.6, roughness: 0.4 });
    const left = smp.wl + TRACK_STYLE.curbWidth + 2;
    const right = smp.wr + TRACK_STYLE.curbWidth + 2;
    for (const x of [left, -right]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), steel);
      post.position.set(x, 3.5, 0);
      gantry.add(post);
    }
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(left + right, 1.2, 0.6),
      new THREE.MeshStandardMaterial({
        map: canvasTexture([512, 64], (g, w, h) => {
          for (let x = 0; x < 32; x++) {
            for (let y = 0; y < 4; y++) {
              g.fillStyle = (x + y) % 2 ? '#111' : '#eee';
              g.fillRect((x * w) / 32, (y * h) / 4, w / 32 + 1, h / 4 + 1);
            }
          }
        }),
        roughness: 0.5,
      }),
    );
    beam.position.set((left - right) / 2, 6.6, 0);
    gantry.add(beam);
    gantry.position.set(smp.x, this.track.lift[0]!, smp.z);
    gantry.rotation.y = Math.atan2(smp.tx, smp.tz);
    gantry.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    this.group.add(gantry);
  }
}
