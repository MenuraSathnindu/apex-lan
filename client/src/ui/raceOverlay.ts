import type { Session } from '../game/session.ts';
import type { ServerClock } from '../net/clock.ts';

/** Countdown numbers, "GO!", and the host's "End race" button. */
export function createRaceOverlay(
  root: HTMLElement,
  session: Session,
  clock: ServerClock,
  onEndRace: () => void,
  /** Called when a new countdown number / "GO!" appears (for the beep). */
  onCount: (text: string) => void = () => {},
) {
  root.innerHTML = `<div class="race-count"></div>
    <button type="button" class="race-end" hidden>End race</button>`;
  const countEl = root.querySelector<HTMLElement>('.race-count')!;
  const endBtn = root.querySelector<HTMLButtonElement>('.race-end')!;
  endBtn.addEventListener('click', () => onEndRace());
  let lastText = '';

  return {
    /** Call every frame. */
    update() {
      const { phase, startsAt } = session.race;
      let text = '';
      if (phase === 'countdown') {
        text = String(Math.max(1, Math.ceil((startsAt - clock.now()) / 1000)));
      } else if (phase === 'racing' && clock.now() - startsAt < 1000) {
        text = 'GO!';
      }
      if (text !== lastText) {
        countEl.textContent = text;
        // Restart the pop animation on each new number.
        countEl.classList.remove('pop');
        void countEl.offsetWidth;
        if (text) {
          countEl.classList.add('pop');
          onCount(text);
        }
        lastText = text;
      }
      endBtn.hidden = !(session.isHost && (phase === 'countdown' || phase === 'racing'));
    },
  };
}
