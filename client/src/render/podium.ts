import * as THREE from 'three';
import type { PodiumPlacement } from '../game/podiumPlacement.ts';
import { canvasTexture } from './textures.ts';

/** Step height (m) and sideways offset along the left normal (m) for P1, P2, P3. */
const STEPS = [
  { height: 1.2, side: 0 },
  { height: 0.85, side: 5 },
  { height: 0.6, side: -5 },
] as const;
const STEP_WIDTH = 4.6;
const STEP_DEPTH = 6.5;
const ACCENTS = [0xd4af37, 0xc0c0c0, 0xcd7f32];

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** Three-step podium for the post-race scene (hidden until the race is over). */
export class PodiumView {
  readonly group = new THREE.Group();
  private placement: PodiumPlacement | null = null;
  private readonly textures: THREE.Texture[] = [];

  constructor() {
    this.group.visible = false;
    const body = new THREE.MeshStandardMaterial({ color: 0x1b1e24, roughness: 0.6, metalness: 0.2 });
    STEPS.forEach((step, k) => {
      const tex = canvasTexture([256, 128], (g, w, h) => {
        g.fillStyle = '#1b1e24';
        g.fillRect(0, 0, w, h);
        g.fillStyle = `#${ACCENTS[k]!.toString(16).padStart(6, '0')}`;
        g.fillRect(0, 0, w, 10);
        g.font = 'bold 92px system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(k + 1), w / 2, h / 2 + 6);
      });
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      this.textures.push(tex);
      const front = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 });
      const top = new THREE.MeshStandardMaterial({ color: ACCENTS[k], roughness: 0.35, metalness: 0.6 });
      // Box faces: +x, -x, +y, -y, +z (front, toward the camera), -z.
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(STEP_WIDTH, step.height, STEP_DEPTH), [body, body, top, body, front, body]);
      mesh.position.set(step.side, step.height / 2, 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    });
  }

  /** Stand the podium at a placement (its local +Z = driving direction, +X = left). */
  place(p: PodiumPlacement): void {
    this.placement = p;
    this.group.position.set(p.x, p.y, p.z);
    this.group.quaternion.setFromAxisAngle(Y_AXIS, Math.atan2(p.tx, p.tz));
    this.group.updateMatrixWorld(true);
  }

  /** Where a car on step `pos` (1..3) goes: `restHeight` above the step's top. */
  slot(pos: 1 | 2 | 3, restHeight: number, out: THREE.Vector3): THREE.Vector3 {
    const step = STEPS[pos - 1]!;
    out.set(step.side, step.height + restHeight, 0);
    return this.group.localToWorld(out);
  }

  /** Cars on the podium face the way the track runs (toward the camera's start position). */
  carQuaternion(out: THREE.Quaternion): THREE.Quaternion {
    return out.copy(this.group.quaternion);
  }

  /** The point the orbiting camera circles. */
  centre(out: THREE.Vector3): THREE.Vector3 {
    const p = this.placement;
    return p ? out.set(p.x, p.y + 1.6, p.z) : out.set(0, 0, 0);
  }

  get forward(): { x: number; z: number } {
    return this.placement ? { x: this.placement.tx, z: this.placement.tz } : { x: 0, z: 1 };
  }

  dispose(): void {
    this.group.removeFromParent();
    const mats = new Set<THREE.Material>();
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) mats.add(m);
    });
    for (const m of mats) m.dispose();
    for (const t of this.textures) t.dispose();
  }
}
