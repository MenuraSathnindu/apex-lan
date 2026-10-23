import { CHAMPIONSHIP, RACE } from '../tuning.ts';
import type { QualifyingFormat } from '../race/sessions.ts';
import type { SeasonDraft } from './types.ts';

const ROUNDS_2026: [string, boolean][] = [
  ['melbourne', false],
  ['shanghai', true],
  ['suzuka', false],
  ['sakhir', false],
  ['jeddah', false],
  ['miami', true],
  ['montreal', true],
  ['monaco', false],
  ['barcelona', false],
  ['spielberg', false],
  ['silverstone', true],
  ['spa', false],
  ['budapest', false],
  ['zandvoort', true],
  ['monza', false],
  ['madrid', false],
  ['baku', false],
  ['singapore', true],
  ['austin', false],
  ['mexico-city', false],
  ['sao-paulo', false],
  ['las-vegas', false],
  ['lusail', false],
  ['yas-island', false],
];

/** The real 2026 calendar, as far as our circuits go (place names only — trademark rule). */
export const PRESET_2026 = {
  label: 'Real 2026-style calendar',
  rounds: ROUNDS_2026.map(([trackId, sprint]) => ({ trackId, sprint })),
} as const;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function sanitizeQualifying(raw: unknown): QualifyingFormat | null {
  if (!isObj(raw)) return null;
  if (raw.mode === 'oneShot') return { mode: 'oneShot' };
  if (raw.mode === 'timed' && (CHAMPIONSHIP.qualiMinutes as readonly unknown[]).includes(raw.minutes)) {
    return { mode: 'timed', minutes: raw.minutes as 5 | 8 | 12 };
  }
  return null;
}

/** Validates an untrusted season draft; returns the cleaned draft or the reason it was refused. */
export function sanitizeSeasonDraft(raw: unknown, knownTrack: (id: string) => boolean): SeasonDraft | string {
  if (!isObj(raw)) return 'not a season';
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name || name.length > CHAMPIONSHIP.nameMax) return `name must be 1–${CHAMPIONSHIP.nameMax} characters`;
  const s = raw.settings;
  if (!isObj(s)) return 'settings missing';
  const laps = s.laps;
  if (typeof laps !== 'number' || !Number.isInteger(laps) || laps < RACE.minLaps || laps > RACE.maxLaps) return `laps must be ${RACE.minLaps}–${RACE.maxLaps}`;
  const qualifying = sanitizeQualifying(s.qualifying);
  if (!qualifying) return 'qualifying must be timed (5, 8 or 12 min) or one-shot';
  const rounds = raw.rounds;
  if (!Array.isArray(rounds) || rounds.length < 1 || rounds.length > CHAMPIONSHIP.maxRounds) return `a season has 1–${CHAMPIONSHIP.maxRounds} rounds`;
  const clean: SeasonDraft['rounds'] = [];
  for (const r of rounds) {
    if (!isObj(r) || typeof r.trackId !== 'string' || !knownTrack(r.trackId)) return 'unknown track in the calendar';
    clean.push({ trackId: r.trackId, sprint: r.sprint === true });
  }
  return { name, settings: { laps, qualifying, fastestLapPoint: s.fastestLapPoint === true, tyreWear: s.tyreWear !== false }, rounds: clean };
}
