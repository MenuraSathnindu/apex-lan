const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** "REPLAY" corner badge with what is being shown, and a Skip button (or Enter). */
export function createReplayBadge(root: HTMLElement, onSkip: () => void) {
  root.innerHTML = `<span class="rp-live">REPLAY</span><span class="rp-what"></span><button type="button" class="rp-skip">Skip ▶ <small>Enter</small></button>`;
  root.hidden = true;
  const what = root.querySelector<HTMLElement>('.rp-what')!;
  root.querySelector<HTMLButtonElement>('.rp-skip')!.addEventListener('click', () => onSkip());
  addEventListener('keydown', (e) => {
    if (!root.hidden && e.code === 'Enter') {
      e.preventDefault();
      onSkip();
    }
  });
  return {
    show(text: string) {
      what.innerHTML = esc(text);
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
    },
  };
}
