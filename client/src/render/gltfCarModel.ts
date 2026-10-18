import * as THREE from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CAR_MODEL, type CarSpec } from '@apex/shared';
import type { CarModel } from './carView.ts';

const box = new THREE.Box3();

function centerOf(o: THREE.Object3D): THREE.Vector3 {
  return box.setFromObject(o).getCenter(new THREE.Vector3());
}

type MaterialRole = keyof typeof CAR_MODEL.materials;

function roleOf(material: THREE.Material): MaterialRole | null {
  const name = material.name.toLowerCase();
  for (const role of Object.keys(CAR_MODEL.materials) as MaterialRole[]) {
    if (CAR_MODEL.materials[role].some((needle) => name.includes(needle))) return role;
  }
  return null;
}

/**
 * Loads a car GLB (Draco supported) and fits it to the physics car:
 *  - rotates it to face +Z, scales it so its wheelbase matches the physics wheelbase,
 *    and moves it so its wheels line up with the physics wheels at rest;
 *  - detaches the four wheel nodes into centred wrappers (CarModel contract);
 *  - swaps in physically based paint / glass / light materials by material name.
 * Loads the file once; the returned factory clones it per car (each with its own paint).
 * Throws if the file is missing or the wheel nodes can't be found.
 */
export async function loadGltfCarFactory(url: string, spec: CarSpec): Promise<CarFactory> {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('draco/'); // copied from three by the Vite plugin, works offline
  loader.setDRACOLoader(draco);
  const gltf = await loader.loadAsync(url);
  draco.dispose();
  const source = gltf.scene;
  // Build one up front so a broken file fails here (and the caller can fall back).
  const first = buildCar(source.clone(true), spec, 0xffffff);
  let firstUsed = false;
  return (paint) => {
    if (!firstUsed) {
      firstUsed = true;
      first.setPaint(paint);
      return first.model;
    }
    // Clones share geometry; buildCar gives each car its own materials.
    return buildCar(source.clone(true), spec, paint).model;
  };
}

/** Creates a car model in a given paint colour. */
export type CarFactory = (paint: THREE.ColorRepresentation) => CarModel;

function buildCar(model: THREE.Object3D, spec: CarSpec, paint: THREE.ColorRepresentation) {
  const fit = new THREE.Group();
  fit.rotation.y = CAR_MODEL.yawOffset;
  fit.add(model);
  const body = new THREE.Group();
  body.add(fit);
  body.updateMatrixWorld(true);

  const wheelNodes = CAR_MODEL.wheelNodes.map((name) => model.getObjectByName(name));
  if (wheelNodes.some((n) => !n)) {
    const names: string[] = [];
    model.traverse((o) => o.name && names.push(o.name));
    throw new Error(`Car model is missing wheel nodes ${CAR_MODEL.wheelNodes.join(', ')}. Nodes in file: ${names.join(', ')}`);
  }
  const wheels = wheelNodes as THREE.Object3D[];

  // Scale so the model's wheelbase equals the physics wheelbase.
  const w = spec.wheels;
  let centers = wheels.map(centerOf);
  const modelWheelbase = (centers[0]!.z + centers[1]!.z) / 2 - (centers[2]!.z + centers[3]!.z) / 2;
  if (modelWheelbase <= 0) throw new Error('Car model front wheels are behind the rear ones — check CAR_MODEL.yawOffset.');
  fit.scale.setScalar((w.frontZ - w.rearZ) / modelWheelbase);
  body.updateMatrixWorld(true);

  // Move so the wheel centroid sits where the physics wheels are at rest.
  centers = wheels.map(centerOf);
  const centroid = centers.reduce((a, c) => a.add(c), new THREE.Vector3()).multiplyScalar(1 / 4);
  const restSag = 9.81 / (4 * w.suspensionStiffness);
  const target = new THREE.Vector3(0, w.connectionY - (w.suspensionRestLength - restSag), (w.frontZ + w.rearZ) / 2);
  fit.position.add(target.sub(centroid));
  body.updateMatrixWorld(true);

  // Detach each wheel into a wrapper centred on the wheel, keeping its orientation/scale.
  const wrappers = wheels.map((node) => {
    const wrapper = new THREE.Group();
    wrapper.position.copy(centerOf(node));
    body.add(wrapper);
    body.updateMatrixWorld(true);
    wrapper.attach(node);
    body.remove(wrapper);
    wrapper.position.set(0, 0, 0);
    return wrapper;
  });

  // Materials.
  const paints: THREE.MeshPhysicalMaterial[] = [];
  const brakeLights: THREE.MeshStandardMaterial[] = [];
  const glass: THREE.MeshPhysicalMaterial[] = [];
  const cache = new Map<THREE.Material, THREE.Material>();
  const replace = (src: THREE.Material): THREE.Material => {
    const cached = cache.get(src);
    if (cached) return cached;
    let out: THREE.Material = src;
    switch (roleOf(src)) {
      case 'paint': {
        const p = CAR_MODEL.paint;
        const m = new THREE.MeshPhysicalMaterial({
          color: paint,
          metalness: p.metalness,
          roughness: p.roughness,
          clearcoat: p.clearcoat,
          clearcoatRoughness: p.clearcoatRoughness,
        });
        paints.push(m);
        out = m;
        break;
      }
      case 'glass': {
        const g = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.25, roughness: 0, transmission: 1, thickness: 0.05 });
        glass.push(g);
        out = g;
        break;
      }
      case 'brakeLights': {
        const m = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1010, emissiveIntensity: CAR_MODEL.brakeLightIdle });
        brakeLights.push(m);
        out = m;
        break;
      }
      case 'headlights':
        out = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e0, emissiveIntensity: CAR_MODEL.headlightIntensity });
        break;
    }
    out.name = src.name;
    cache.set(src, out);
    return out;
  };
  const detail: THREE.Object3D[] = [];
  const noShadow = new Set<THREE.Object3D>();
  const all = [body, ...wrappers];
  for (const root of all) {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(replace) : replace(mesh.material);
      if (CAR_MODEL.detailMeshes.test(mesh.name)) {
        detail.push(mesh);
        noShadow.add(mesh);
      } else if (CAR_MODEL.noShadowMeshes.test(mesh.name)) noShadow.add(mesh);
    });
  }

  const result: CarModel = {
    body,
    wheels: [wrappers[0]!, wrappers[1]!, wrappers[2]!, wrappers[3]!],
    brakeLights,
    glass,
    paint: paints,
    detail,
    noShadow,
  };
  return { model: result, setPaint: (c: THREE.ColorRepresentation) => paints.forEach((m) => m.color.set(c)) };
}
