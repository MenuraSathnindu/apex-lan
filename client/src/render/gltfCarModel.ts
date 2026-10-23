import * as THREE from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CAR_MODEL, LIVERY, type CarSpec, type Livery } from '@apex/shared';
import type { CarModel } from './carView.ts';
import { applyTopDownUv, LiveryTexture } from './liveryTexture.ts';

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

/** Creates a car model with a given paint scheme. */
export type CarFactory = (livery: Livery) => CarModel;

/**
 * Loads the open-wheel car GLB (Draco supported) and fits it to the physics car:
 *  - rotates it to face +Z, scales it so its wheelbase matches the physics wheelbase,
 *    and moves it so its wheels line up with the physics wheels at rest;
 *  - detaches the four wheel nodes into centred wrappers (CarModel contract);
 *  - finds the hinged wing flaps;
 *  - swaps in materials by name: the livery canvas on the bodywork, accent colour, glass,
 *    brake light, tyre-compound marking.
 * Loads the file once; the returned factory clones it per car (each with its own livery).
 * Throws if the file is missing or the wheel nodes can't be found.
 */
export async function loadGltfCarFactory(url: string, spec: CarSpec, initial: Livery): Promise<CarFactory> {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('draco/'); // copied from three by the Vite plugin, works offline
  loader.setDRACOLoader(draco);
  const gltf = await loader.loadAsync(url);
  draco.dispose();
  const source = gltf.scene;
  // Build one up front so a broken file fails here (and the caller can fall back).
  const first = buildCar(source.clone(true), spec, initial);
  let firstUsed = false;
  return (livery) => {
    if (!firstUsed) {
      firstUsed = true;
      first.setLivery?.(livery);
      return first;
    }
    // Clones share geometry; buildCar gives each car its own materials and textures.
    return buildCar(source.clone(true), spec, livery);
  };
}

function buildCar(model: THREE.Object3D, spec: CarSpec, livery: Livery): CarModel {
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

  // Wing flaps: they stay in the body; CarView turns them about their local X.
  const findAll = (names: string[]) => names.map((n) => model.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o);
  const wings = { rear: findAll(CAR_MODEL.wingNodes.rear), front: findAll(CAR_MODEL.wingNodes.front) };
  if (!wings.rear.length) console.warn(`[assets] Car model has no wing flap node (${CAR_MODEL.wingNodes.rear.join(' / ')}): the rear wing won't animate.`);

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
  const liveryTexture = new LiveryTexture(livery);
  const liveryMats: THREE.MeshPhysicalMaterial[] = [];
  const accentMats: THREE.MeshStandardMaterial[] = [];
  const tyreMarkings: THREE.MeshStandardMaterial[] = [];
  const brakeLights: THREE.MeshStandardMaterial[] = [];
  const glass: THREE.MeshPhysicalMaterial[] = [];
  const cache = new Map<THREE.Material, THREE.Material>();
  const replace = (src: THREE.Material): THREE.Material => {
    const cached = cache.get(src);
    if (cached) return cached;
    let out: THREE.Material = src;
    switch (roleOf(src)) {
      case 'livery': {
        const m = new THREE.MeshPhysicalMaterial({ map: liveryTexture.texture, ...LIVERY.finish });
        liveryMats.push(m);
        out = m;
        break;
      }
      case 'accent': {
        const m = new THREE.MeshStandardMaterial({ color: livery.accent, roughness: 0.4, metalness: 0.2 });
        accentMats.push(m);
        out = m;
        break;
      }
      case 'tyreMarking': {
        const m = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.6 });
        tyreMarkings.push(m);
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
    }
    out.name = src.name;
    cache.set(src, out);
    return out;
  };
  const detail: THREE.Object3D[] = [];
  const noShadow = new Set<THREE.Object3D>();
  const liveryMeshes: THREE.Mesh[] = [];
  for (const root of [body, ...wrappers]) {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(replace) : replace(mesh.material);
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (mats.some((m) => liveryMats.includes(m as THREE.MeshPhysicalMaterial))) liveryMeshes.push(mesh);
      if (CAR_MODEL.detailMeshes.test(mesh.name)) {
        detail.push(mesh);
        noShadow.add(mesh);
      } else if (CAR_MODEL.noShadowMeshes.test(mesh.name) || mats.some((m) => CAR_MODEL.noShadowMeshes.test(m.name))) noShadow.add(mesh);
    });
  }

  // Top-down UVs for the livery: one projection over the whole painted body.
  if (liveryMeshes.length === 0) {
    console.warn(`[assets] Car model has no material named like "${CAR_MODEL.materials.livery.join('" / "')}": no livery will show.`);
  } else if (CAR_MODEL.generateLiveryUv) {
    body.updateMatrixWorld(true);
    const all = new THREE.Box3();
    for (const m of liveryMeshes) all.union(box.setFromObject(m));
    const bounds = { xMin: all.min.x, xMax: all.max.x, zMin: all.min.z, zMax: all.max.z };
    for (const m of liveryMeshes) {
      // Geometry is shared between clones, and the projection is the same for every clone.
      if (m.geometry.userData.liveryUv) continue;
      applyTopDownUv(m.geometry, bounds, m.matrixWorld);
      m.geometry.userData.liveryUv = true;
    }
  }

  return {
    body,
    wheels: [wrappers[0]!, wrappers[1]!, wrappers[2]!, wrappers[3]!],
    brakeLights,
    glass,
    tyreMarkings,
    wings,
    detail,
    noShadow,
    setLivery(l) {
      liveryTexture.paint(l);
      for (const m of accentMats) m.color.set(l.accent);
    },
    dispose() {
      liveryTexture.dispose();
    },
  };
}
