import * as THREE from 'three';
import type { PlayerInfo } from '@apex/shared';
import { avatarHtml } from './avatar.ts';

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const projected = new THREE.Vector3();

/** Photo cards floating above the podium cars, and the "Results" button. */
export function createPodiumCards(root: HTMLElement, onResults: () => void) {
  root.innerHTML = `<div class="pc-title"></div><div class="pc-cards"></div><button type="button" class="pc-results">Results ▶ <small>Enter</small></button>`;
  const title = root.querySelector<HTMLElement>('.pc-title')!;
  const holder = root.querySelector<HTMLElement>('.pc-cards')!;
  const button = root.querySelector<HTMLButtonElement>('.pc-results')!;
  button.addEventListener('click', () => onResults());
  addEventListener('keydown', (e) => {
    if (!root.hidden && !button.hidden && e.code === 'Enter') {
      e.preventDefault();
      onResults();
    }
  });
  let key = '';
  let cards: HTMLElement[] = [];

  return {
    /** Shows cards for the top three (null = empty step). */
    show(heading: string, top: (PlayerInfo | null)[]) {
      root.hidden = false;
      const k = heading + JSON.stringify(top.map((p) => p && [p.id, p.name, p.tag, p.photo]));
      if (k === key) return;
      key = k;
      title.textContent = heading;
      holder.innerHTML = top
        .map((p, i) =>
          p
            ? `<div class="pc-card p${i + 1}">${avatarHtml({ photo: p.photo, tag: p.tag, color: p.livery.primary }, i === 0 ? 88 : 72, 'pc-avatar')}
                <div class="pc-pos">P${i + 1}</div><div class="pc-name">${esc(p.name)}</div></div>`
            : '<div class="pc-card empty"></div>',
        )
        .join('');
      cards = [...holder.querySelectorAll<HTMLElement>('.pc-card')];
    },
    /** Moves each card over its car (world position) every frame. */
    place(i: number, world: THREE.Vector3, camera: THREE.Camera) {
      const card = cards[i];
      if (!card) return;
      projected.copy(world).project(camera);
      const visible = projected.z < 1;
      card.style.display = visible ? '' : 'none';
      card.style.transform = `translate(-50%, -100%) translate(${((projected.x + 1) / 2) * innerWidth}px, ${((1 - projected.y) / 2) * innerHeight}px)`;
    },
    /** The results button disappears once the table is up. */
    setResultsShown(shown: boolean) {
      button.hidden = shown;
    },
    hide() {
      root.hidden = true;
      key = '';
    },
  };
}
