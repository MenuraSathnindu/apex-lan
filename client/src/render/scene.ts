import * as THREE from 'three';
import type { StaticBox } from '@apex/shared';

const SKY = 0x9fbad6;
const SHADOW_RANGE = 35;
const SUN_OFFSET = new THREE.Vector3(30, 50, 20);

/** Checkerboard-ish asphalt grid so speed and direction are readable on flat ground. */
function gridTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#4a4f55';
  g.fillRect(0, 0, size, size);
  g.fillStyle = '#454a50';
  g.fillRect(0, 0, size / 2, size / 2);
  g.fillRect(size / 2, size / 2, size / 2, size / 2);
  g.strokeStyle = '#6b7178';
  g.lineWidth = 3;
  g.strokeRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

const BOX_COLORS: Record<Exclude<StaticBox['kind'], 'ground'>, number> = {
  ramp: 0x8a8f96,
  bump: 0xe0b020,
  block: 0xd9622b,
};

export function createScene(canvas: HTMLCanvasElement, boxes: readonly StaticBox[]) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 80, 400);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);

  scene.add(new THREE.HemisphereLight(0xdfefff, 0x3a3226, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -SHADOW_RANGE,
    right: SHADOW_RANGE,
    top: SHADOW_RANGE,
    bottom: -SHADOW_RANGE,
    near: 1,
    far: 150,
  });
  sun.shadow.bias = -0.0005;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  for (const b of boxes) {
    if (b.kind === 'ground') {
      const tex = gridTexture();
      tex.repeat.set(b.halfExtents.x / 4, b.halfExtents.z / 4); // 8 m tiles
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(b.halfExtents.x * 2, b.halfExtents.z * 2).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }),
      );
      ground.position.set(b.position.x, b.position.y + b.halfExtents.y, b.position.z);
      ground.receiveShadow = true;
      scene.add(ground);
      continue;
    }
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(b.halfExtents.x * 2, b.halfExtents.y * 2, b.halfExtents.z * 2),
      new THREE.MeshStandardMaterial({ color: BOX_COLORS[b.kind], roughness: 0.8 }),
    );
    mesh.position.set(b.position.x, b.position.y, b.position.z);
    mesh.quaternion.set(b.rotation.x, b.rotation.y, b.rotation.z, b.rotation.w);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }

  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  return {
    scene,
    camera,
    /** Keeps the shadow map centred on the player so it stays sharp everywhere. */
    focusShadows(target: THREE.Vector3) {
      sun.target.position.copy(target);
      sun.position.copy(target).add(SUN_OFFSET);
    },
    render() {
      renderer.render(scene, camera);
    },
  };
}
