import * as THREE from 'three';
import type { CarSpec } from '@apex/shared';
import type { CarModel } from './carView.ts';

/** Placeholder car built from boxes, sized from the physics spec. */
export function createBoxCarModel(spec: CarSpec, paint: THREE.ColorRepresentation): CarModel {
  const h = spec.chassis.halfExtents;
  const body = new THREE.Group();

  const paintMat = new THREE.MeshStandardMaterial({ color: paint, roughness: 0.35, metalness: 0.4 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x1a2430, roughness: 0.1, metalness: 0.6 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.8 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d6, emissiveIntensity: 1.5 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1a1a, emissiveIntensity: 1.2 });

  const box = (w: number, hgt: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, d), mat);
    m.position.set(x, y, z);
    body.add(m);
  };

  // Lower body: a bit narrower and higher-floored than the collision box so the
  // wheels stay visible. Cabin sits on top, slightly rearward.
  const bodyHalfW = spec.wheels.halfTrack - 0.04;
  const floorY = -h.y + 0.16;
  const bodyH = h.y - floorY;
  box(bodyHalfW * 2, bodyH, h.z * 2, paintMat, 0, floorY + bodyH / 2, 0);
  box(bodyHalfW * 1.85, 0.42, h.z * 0.95, glassMat, 0, h.y + 0.21, -0.25);
  box(bodyHalfW * 1.78, 0.06, h.z * 0.8, paintMat, 0, h.y + 0.45, -0.3); // roof
  box(bodyHalfW * 2.04, 0.14, 0.2, darkMat, 0, floorY + 0.07, h.z); // bumpers
  box(bodyHalfW * 2.04, 0.14, 0.2, darkMat, 0, floorY + 0.07, -h.z);
  for (const side of [1, -1]) {
    box(0.34, 0.12, 0.05, headMat, side * (bodyHalfW - 0.26), 0.12, h.z + 0.01);
    box(0.34, 0.1, 0.05, tailMat, side * (bodyHalfW - 0.26), 0.14, -h.z - 0.01);
  }

  const r = spec.wheels.radius;
  const width = spec.wheels.halfWidth * 2;
  const tyreGeo = new THREE.CylinderGeometry(r, r, width, 24).rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(r * 0.62, r * 0.62, width + 0.01, 16).rotateZ(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(width + 0.02, r * 1.1, 0.07);
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.9 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.3, metalness: 0.9 });

  const wheel = () => {
    const g = new THREE.Group();
    // The dark spoke makes wheel rotation visible on the placeholder.
    g.add(new THREE.Mesh(tyreGeo, tyreMat), new THREE.Mesh(rimGeo, rimMat), new THREE.Mesh(spokeGeo, darkMat));
    return g;
  };

  return { body, wheels: [wheel(), wheel(), wheel(), wheel()], brakeLights: [tailMat] };
}
