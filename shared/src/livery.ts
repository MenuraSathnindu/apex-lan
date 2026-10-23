import { CAR_COLORS } from './constants.ts';
import { LIVERY } from './tuning.ts';

/** A car's paint scheme: three colours (0xRRGGBB) and the race number. */
export interface Livery {
  primary: number;
  secondary: number;
  accent: number;
  number: number;
}

/** Fictional preset schemes, one per grid colour. Players start from the one for their colour. */
export const LIVERY_PRESETS: readonly Livery[] = [
  { primary: CAR_COLORS[0], secondary: 0xf4f1ea, accent: 0x1a1a1a, number: 1 },
  { primary: CAR_COLORS[1], secondary: 0xf2c200, accent: 0xffffff, number: 2 },
  { primary: CAR_COLORS[2], secondary: 0x1a1a1a, accent: 0xc8102e, number: 3 },
  { primary: CAR_COLORS[3], secondary: 0xf4f1ea, accent: 0xf2c200, number: 4 },
  { primary: CAR_COLORS[4], secondary: 0x1a1a1a, accent: 0xf4f1ea, number: 5 },
  { primary: CAR_COLORS[5], secondary: 0xf0f0f0, accent: 0xff6a13, number: 6 },
  { primary: CAR_COLORS[6], secondary: 0x1e5bd8, accent: 0xc8102e, number: 7 },
  { primary: CAR_COLORS[7], secondary: 0xc8102e, accent: 0xf4f1ea, number: 8 },
];

/** The preset for a grid colour index. */
export function presetLivery(color: number): Livery {
  const p = LIVERY_PRESETS[((color % LIVERY_PRESETS.length) + LIVERY_PRESETS.length) % LIVERY_PRESETS.length]!;
  return { ...p };
}

const isColor = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffff;

/** Validates an untrusted livery (from the wire or storage); bad fields fall back to `fallback`. */
export function sanitizeLivery(raw: unknown, fallback: Livery): Livery {
  if (typeof raw !== 'object' || raw === null) return { ...fallback };
  const r = raw as Record<string, unknown>;
  const num = r.number;
  return {
    primary: isColor(r.primary) ? r.primary : fallback.primary,
    secondary: isColor(r.secondary) ? r.secondary : fallback.secondary,
    accent: isColor(r.accent) ? r.accent : fallback.accent,
    number: typeof num === 'number' && Number.isInteger(num) && num >= 0 && num <= LIVERY.numberMax ? num : fallback.number,
  };
}

