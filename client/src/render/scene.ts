import * as THREE from 'three';

/** Phase 0 test scene: ground plane + spinning cube. */
export function createScene(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87a9c9);
  scene.fog = new THREE.Fog(0x87a9c9, 40, 160);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
  camera.position.set(6, 4, 8);
  camera.lookAt(0, 0.5, 0);

  scene.add(new THREE.HemisphereLight(0xdfefff, 0x3a3226, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  sun.position.set(10, 15, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15 });
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: 0x4d5a45, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 1.5, 1.5),
    new THREE.MeshStandardMaterial({ color: 0xd7263d, roughness: 0.35, metalness: 0.1 }),
  );
  cube.position.y = 1.2;
  cube.castShadow = true;
  scene.add(cube);

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
    render(dt: number) {
      cube.rotation.x += dt * 0.6;
      cube.rotation.y += dt * 0.9;
      renderer.render(scene, camera);
    },
  };
}
