import { CHAMPIONSHIP, PRESET_2026, RACE, type QualifyingFormat, type SeasonDraft, type TrackIndexEntry } from '@apex/shared';
import { esc } from '../avatar.ts';

export interface EditorDeps {
  tracks: () => TrackIndexEntry[];
  onCreate: (draft: SeasonDraft) => void;
  onCancel: () => void;
}

/**
 * New-season form (host): name, calendar (preset or custom: add, reorder, remove, sprint per
 * round), laps, qualifying format, fastest-lap point, tyre wear. The server validates again.
 */
export function renderSeasonEditor(root: HTMLElement, deps: EditorDeps): void {
  let rounds: { trackId: string; sprint: boolean }[] = PRESET_2026.rounds.map((r) => ({ ...r }));
  const name = (id: string) => {
    const t = deps.tracks().find((e) => e.id === id);
    return t ? `${t.name}, ${t.country}` : id;
  };

  root.innerHTML = `
    <form class="ch-editor" autocomplete="off">
      <div class="pf-row">
        <label>Season name <input name="name" maxlength="${CHAMPIONSHIP.nameMax}" required value="Season ${new Date().getFullYear()}" /></label>
        <label>Laps per race <input name="laps" type="number" min="${RACE.minLaps}" max="${RACE.maxLaps}" value="5" required /></label>
      </div>
      <fieldset class="ch-quali"><legend>Qualifying</legend>
        ${CHAMPIONSHIP.qualiMinutes.map((m) => `<label><input type="radio" name="quali" value="timed-${m}" ${m === CHAMPIONSHIP.qualiDefaultMinutes ? 'checked' : ''}/> Timed, ${m} min</label>`).join('')}
        <label><input type="radio" name="quali" value="oneShot" /> One-shot lap</label>
      </fieldset>
      <div class="ch-checks">
        <label><input type="checkbox" name="fastestLap" /> +1 point for the fastest lap (top 10 finishers)</label>
        <label><input type="checkbox" name="tyreWear" checked /> Tyre wear</label>
      </div>
      <div class="ch-calendar-head">
        <h3>Calendar <span class="ch-count"></span></h3>
        <button type="button" class="ch-preset">${esc(PRESET_2026.label)}</button>
        <button type="button" class="ch-clear">Clear</button>
      </div>
      <ol class="ch-rounds"></ol>
      <div class="ch-add">
        <select class="ch-add-track"></select>
        <button type="button" class="ch-add-btn">Add round</button>
      </div>
      <p class="pf-error" role="alert"></p>
      <div class="ch-actions">
        <button type="button" class="ch-cancel">Cancel</button>
        <button type="submit" class="pf-primary">Create season</button>
      </div>
    </form>`;
  const form = root.querySelector<HTMLFormElement>('.ch-editor')!;
  const list = root.querySelector<HTMLElement>('.ch-rounds')!;
  const count = root.querySelector<HTMLElement>('.ch-count')!;
  const error = root.querySelector<HTMLElement>('.pf-error')!;
  const addSelect = root.querySelector<HTMLSelectElement>('.ch-add-track')!;
  addSelect.innerHTML = deps
    .tracks()
    .map((t) => `<option value="${esc(t.id)}">${esc(t.name)}, ${esc(t.country)}</option>`)
    .join('');

  const draw = () => {
    count.textContent = `(${rounds.length} rounds, ${rounds.filter((r) => r.sprint).length} sprints)`;
    list.innerHTML = rounds
      .map(
        (r, i) => `<li data-i="${i}">
          <span class="ch-track">${esc(name(r.trackId))}</span>
          <label class="ch-sprint"><input type="checkbox" ${r.sprint ? 'checked' : ''} /> Sprint</label>
          <button type="button" data-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
          <button type="button" data-move="1" ${i === rounds.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
          <button type="button" data-remove aria-label="Remove">✕</button></li>`,
      )
      .join('');
  };
  list.addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    const i = Number(el.closest<HTMLElement>('li')?.dataset.i);
    if (!Number.isInteger(i)) return;
    if (el.dataset.move) {
      const j = i + Number(el.dataset.move);
      [rounds[i], rounds[j]] = [rounds[j]!, rounds[i]!];
    } else if (el.hasAttribute('data-remove')) rounds.splice(i, 1);
    else return;
    draw();
  });
  list.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    const i = Number(el.closest<HTMLElement>('li')?.dataset.i);
    if (Number.isInteger(i)) rounds[i]!.sprint = el.checked;
  });
  root.querySelector('.ch-preset')!.addEventListener('click', () => {
    rounds = PRESET_2026.rounds.map((r) => ({ ...r }));
    draw();
  });
  root.querySelector('.ch-clear')!.addEventListener('click', () => {
    rounds = [];
    draw();
  });
  root.querySelector('.ch-add-btn')!.addEventListener('click', () => {
    if (rounds.length >= CHAMPIONSHIP.maxRounds) return void (error.textContent = `A season has at most ${CHAMPIONSHIP.maxRounds} rounds.`);
    rounds.push({ trackId: addSelect.value, sprint: false });
    draw();
  });
  root.querySelector('.ch-cancel')!.addEventListener('click', () => deps.onCancel());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(form);
    if (!rounds.length) return void (error.textContent = 'Add at least one round.');
    const q = String(f.get('quali'));
    const qualifying: QualifyingFormat = q === 'oneShot' ? { mode: 'oneShot' } : { mode: 'timed', minutes: Number(q.split('-')[1]) as 5 | 8 | 12 };
    deps.onCreate({
      name: String(f.get('name')).trim(),
      settings: { laps: Number(f.get('laps')), qualifying, fastestLapPoint: f.get('fastestLap') === 'on', tyreWear: f.get('tyreWear') === 'on' },
      rounds,
    });
  });
  draw();
}
