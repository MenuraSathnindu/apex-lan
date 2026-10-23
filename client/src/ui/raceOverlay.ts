import { RACE, litLights } from '@apex/shared';
import type { Session } from '../game/session.ts';
import type { ServerClock } from '../net/clock.ts';

/**
 * Start sequence and the host's "End race" button. Races: five red lights, one per second, then
 * lights out = GO. Qualifying: "3, 2, 1, GO!".
 */
export function createRaceOverlay(
  root: HTMLElement,
  session: Session,
  clock: ServerClock,
  onEndRace: () => void,
  /** Called when a light comes on ("1".."5"), a countdown number appears, or at "GO!" (for the beep). */
  onCount: (text: string) => void = () => {},
) {
  root.innerHTML = `<div class="race-count"></div>
    <div class="race-lights" hidden>${'<div class="race-lamp"><i></i><i></i></div>'.repeat(RACE.lights.count)}</div>
    <button type="button" class="race-end" hidden>End race</button>`;
  const countEl = root.querySelector<HTMLElement>('.race-count')!;
  const lightsEl = root.querySelector<HTMLElement>('.race-lights')!;
  const lamps = [...root.querySelectorAll<HTMLElement>('.race-lamp')];
  const endBtn = root.querySelector<HTMLButtonElement>('.race-end')!;
  endBtn.addEventListener('click', () => onEndRace());
  let lastText = '';
  let lastLit = -1;

  return {
    /** Lights lit right now (for the 3D gantry): 0 outside a race start. */
    lit: 0,
    /** Call every frame. */
    update() {
      const { phase, startsAt, raceId } = session.race;
      const lights = session.race.session.kind !== 'qualifying';
      const now = clock.now();
      let text = '';
      let lit = 0;
      if (lights) {
        lit = phase === 'countdown' ? litLights(now, startsAt, raceId) : 0;
        // Shown from the first light until a moment after lights out.
        const show = (phase === 'countdown' && lit > 0) || (phase === 'racing' && now - startsAt < 1000) || (phase === 'countdown' && now >= startsAt);
        lightsEl.hidden = !show;
        if (lit !== lastLit) {
          lamps.forEach((l, i) => l.classList.toggle('on', i < lit));
          if (lit > lastLit && lit > 0) onCount(String(lit));
          if (lit === 0 && lastLit === RACE.lights.count) onCount('GO!');
          lastLit = lit;
        }
      } else {
        lightsEl.hidden = true;
        lastLit = -1;
        if (phase === 'countdown') text = String(Math.max(1, Math.ceil((startsAt - now) / 1000)));
        else if (phase === 'racing' && now - startsAt < 1000) text = 'GO!';
      }
      this.lit = lit;
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
