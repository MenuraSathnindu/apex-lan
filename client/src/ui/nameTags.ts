import * as THREE from 'three';

const MAX_DISTANCE = 220;
const projected = new THREE.Vector3();

/** HTML name labels that float above cars (crisp text, unaffected by post-processing). */
export class NameTags {
  private readonly tags = new Map<number, { el: HTMLElement; name: HTMLElement; dot: HTMLElement }>();

  constructor(private readonly root: HTMLElement) {}

  set(id: number, name: string, color: string, status = ''): void {
    let tag = this.tags.get(id);
    if (!tag) {
      const el = document.createElement('div');
      el.className = 'name-tag';
      const dot = document.createElement('span');
      dot.className = 'name-tag-dot';
      const label = document.createElement('span');
      el.append(dot, label);
      this.root.append(el);
      tag = { el, name: label, dot };
      this.tags.set(id, tag);
    }
    const text = status ? `${name} · ${status}` : name;
    if (tag.name.textContent !== text) tag.name.textContent = text;
    tag.dot.style.background = color;
  }

  remove(id: number): void {
    this.tags.get(id)?.el.remove();
    this.tags.delete(id);
  }

  /** Positions a tag over a world point; hides it when off-screen, behind or far away. */
  place(id: number, world: THREE.Vector3, camera: THREE.PerspectiveCamera, visible: boolean): void {
    const tag = this.tags.get(id);
    if (!tag) return;
    const dist = camera.position.distanceTo(world);
    projected.copy(world).project(camera);
    const onScreen = projected.z < 1 && Math.abs(projected.x) < 1.1 && Math.abs(projected.y) < 1.1;
    if (!visible || !onScreen || dist > MAX_DISTANCE) {
      tag.el.style.display = 'none';
      return;
    }
    const x = (projected.x * 0.5 + 0.5) * this.root.clientWidth;
    const y = (-projected.y * 0.5 + 0.5) * this.root.clientHeight;
    tag.el.style.display = '';
    tag.el.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    tag.el.style.opacity = String(Math.min(1, 1.4 - dist / MAX_DISTANCE));
  }
}
