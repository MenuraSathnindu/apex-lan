import * as THREE from 'three';
import { CAR_MODEL, LIVERY, presetLivery, type CarSpec, type Livery } from '@apex/shared';
import type { CarModel } from './carView.ts';
import { applyTopDownUv, LiveryTexture } from './liveryTexture.ts';

/**
 * Procedural open-wheel car, built from primitives and sized from the physics spec. It is the
 * fallback when client/public/models/openwheel.glb is missing, and it follows the same contract
 * as the GLB (separate spinning wheels, hinged wing flaps, livery canvas on the bodywork), so it
 * doubles as a reference for what the real model has to provide.
 */

/** Top-down UV bounds covering the whole car (m, chassis space). */
const BOUNDS = { xMin: -1.0, xMax: 1.0, zMin: -2.9, zMax: 2.9 };

interface Loft {
  z0: number;
  z1: number;
  /** Half width / half height / centre (x, y) at the rear (0) and front (1) end. */
  hw0: number;
  hh0: number;
  x0?: number;
  y0: number;
  hw1: number;
  hh1: number;
  x1?: number;
  y1: number;
}

/** A box whose cross-section changes between its rear and front ends (flat-shaded). */
function loft(l: Loft): THREE.BufferGeometry {
  const c = (z: number, hw: number, hh: number, x: number, y: number): THREE.Vector3[] => [
    new THREE.Vector3(x - hw, y - hh, z),
    new THREE.Vector3(x + hw, y - hh, z),
    new THREE.Vector3(x + hw, y + hh, z),
    new THREE.Vector3(x - hw, y + hh, z),
  ];
  const r = c(l.z0, l.hw0, l.hh0, l.x0 ?? 0, l.y0);
  const f = c(l.z1, l.hw1, l.hh1, l.x1 ?? 0, l.y1);
  const centre = new THREE.Vector3();
  for (const v of [...r, ...f]) centre.add(v);
  centre.multiplyScalar(1 / 8);

  const pos: number[] = [];
  const quad = (a: THREE.Vector3, b: THREE.Vector3, cc: THREE.Vector3, d: THREE.Vector3) => {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(cc, a));
    const mid = new THREE.Vector3().add(a).add(b).add(cc).add(d).multiplyScalar(0.25).sub(centre);
    const tri = n.dot(mid) >= 0 ? [a, b, cc, a, cc, d] : [a, cc, b, a, d, cc];
    for (const v of tri) pos.push(v.x, v.y, v.z);
  };
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quad(r[i]!, r[j]!, f[j]!, f[i]!);
  }
  quad(r[0]!, r[1]!, r[2]!, r[3]!);
  quad(f[0]!, f[1]!, f[2]!, f[3]!);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export function createOpenWheelCarModel(spec: CarSpec, livery: Livery): CarModel {
  const body = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const track = new LiveryTexture(livery);

  const paintMat = new THREE.MeshPhysicalMaterial({ map: track.texture, ...LIVERY.finish });
  const carbonMat = new THREE.MeshStandardMaterial({ color: LIVERY.carbon, roughness: 0.45, metalness: 0.3 });
  const accentMat = new THREE.MeshStandardMaterial({ color: livery.accent, roughness: 0.4, metalness: 0.2 });
  const helmetMat = new THREE.MeshPhysicalMaterial({ color: livery.secondary, roughness: 0.25, clearcoat: 1 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1010, emissiveIntensity: CAR_MODEL.brakeLightIdle });

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = body) => {
    geometries.push(geo);
    const m = new THREE.Mesh(geo, mat);
    parent.add(m);
    return m;
  };
  const painted = (l: Loft) => {
    const geo = loft(l);
    applyTopDownUv(geo, BOUNDS);
    return add(geo, paintMat);
  };
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, parent?: THREE.Object3D) => {
    const m = add(new THREE.BoxGeometry(w, h, d), mat, parent);
    m.position.set(x, y, z);
    return m;
  };

  const groundY = spec.wheels.connectionY - (spec.wheels.suspensionRestLength - 9.81 / (4 * spec.wheels.suspensionStiffness)) - spec.wheels.radius;
  const floorY = groundY + 0.06;

  // Bodywork (livery texture).
  painted({ z0: -0.55, z1: 1.25, hw0: 0.3, hh0: 0.24, y0: 0, hw1: 0.22, hh1: 0.17, y1: -0.06 }); // monocoque
  painted({ z0: 1.25, z1: 2.55, hw0: 0.22, hh0: 0.17, y0: -0.06, hw1: 0.08, hh1: 0.07, y1: -0.15 }); // nose
  for (const s of [1, -1]) {
    painted({ z0: -1.15, z1: 0.2, hw0: 0.17, hh0: 0.2, x0: s * 0.46, y0: -0.1, hw1: 0.2, hh1: 0.17, x1: s * 0.46, y1: -0.1 }); // sidepod
  }
  painted({ z0: -2.3, z1: -0.5, hw0: 0.06, hh0: 0.1, y0: 0.05, hw1: 0.2, hh1: 0.18, y1: 0.28 }); // engine cover
  painted({ z0: -0.62, z1: -0.2, hw0: 0.1, hh0: 0.12, y0: 0.4, hw1: 0.12, hh1: 0.14, y1: 0.42 }); // air intake

  // Floor and cockpit.
  box(1.1, 0.04, 3.3, 0, floorY, -0.55, carbonMat);
  const helmet = add(new THREE.SphereGeometry(0.13, 20, 14), helmetMat);
  helmet.position.set(0, 0.27, -0.1);
  const halo = add(new THREE.TorusGeometry(0.3, 0.02, 8, 24, Math.PI), carbonMat);
  halo.position.set(0, 0.17, -0.05);
  // Centre pillar from the top of the hoop down to the front of the cockpit.
  const pillar = box(0.04, 0.04, 0.57, 0, 0.335, 0.2, carbonMat);
  pillar.rotation.x = 0.49;

  // Front wing: fixed main plane + a flap that turns about its leading edge.
  box(1.9, 0.025, 0.2, 0, floorY + 0.02, 2.75, carbonMat);
  const frontFlap = new THREE.Group();
  frontFlap.position.set(0, floorY + 0.07, 2.66);
  body.add(frontFlap);
  box(1.84, 0.02, 0.17, 0, 0, -0.085, accentMat, frontFlap);
  for (const s of [1, -1]) box(0.025, 0.17, 0.5, s * 0.96, floorY + 0.07, 2.62, accentMat);

  // Rear wing: pillar, main plane, hinged flap, endplates.
  box(0.07, 0.4, 0.2, 0, 0.3, -2.3, carbonMat);
  box(0.9, 0.025, 0.3, 0, 0.62, -2.55, carbonMat);
  const rearFlap = new THREE.Group();
  rearFlap.position.set(0, 0.72, -2.46);
  body.add(rearFlap);
  box(0.9, 0.025, 0.27, 0, 0, -0.135, accentMat, rearFlap);
  for (const s of [1, -1]) box(0.025, 0.45, 0.62, s * 0.46, 0.6, -2.6, accentMat);
  box(0.3, 0.07, 0.03, 0, 0.12, -2.31, tailMat); // rain / brake light

  // Wheels: tyre, sidewall marking, rim with a dark spoke (so the spin is visible), axle stub.
  const r = spec.wheels.radius;
  const width = spec.wheels.halfWidth * 2;
  const tyreMarkMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.6 });
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.92 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x8e939c, roughness: 0.35, metalness: 0.9 });
  const spokeMat = new THREE.MeshStandardMaterial({ color: 0x1c1d21, roughness: 0.7 });
  const tyreGeo = new THREE.CylinderGeometry(r, r, width, 28).rotateZ(Math.PI / 2);
  const markGeo = new THREE.TorusGeometry(r * 0.8, r * 0.035, 6, 36).rotateY(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(r * 0.58, r * 0.58, width + 0.01, 20).rotateZ(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(width + 0.02, r * 1.0, 0.06);
  const axleGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.35, 8).rotateZ(Math.PI / 2);
  geometries.push(tyreGeo, markGeo, rimGeo, spokeGeo, axleGeo);
  const wheel = (inward: number) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(tyreGeo, tyreMat), new THREE.Mesh(rimGeo, rimMat), new THREE.Mesh(spokeGeo, spokeMat));
    for (const side of [1, -1]) {
      const mark = new THREE.Mesh(markGeo, tyreMarkMat);
      mark.position.x = side * (width / 2 - 0.004);
      g.add(mark);
    }
    const axle = new THREE.Mesh(axleGeo, carbonMat);
    axle.position.x = inward * (width / 2 + 0.17);
    g.add(axle);
    return g;
  };

  const setLivery = (l: Livery) => {
    track.paint(l);
    accentMat.color.set(l.accent);
    helmetMat.color.set(l.secondary);
  };

  const detail = [helmet, halo, pillar];
  const noShadow = new Set<THREE.Object3D>([helmet, halo, pillar]);
  return {
    body,
    // Left wheels (FL, RL) are at +X, so their axle stubs point towards -X.
    wheels: [wheel(-1), wheel(1), wheel(-1), wheel(1)],
    brakeLights: [tailMat],
    tyreMarkings: [tyreMarkMat],
    wings: { rear: [rearFlap], front: [frontFlap] },
    setLivery,
    detail,
    noShadow,
    dispose() {
      track.dispose();
      for (const g of geometries) g.dispose();
    },
  };
}

/** Factory for the procedural car (same shape as the GLB factory). */
export function openWheelCarFactory(spec: CarSpec) {
  return (livery: Livery = presetLivery(0)) => createOpenWheelCarModel(spec, livery);
}
