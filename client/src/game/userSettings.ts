import { AUDIO } from '@apex/shared';
import type { Volumes } from '../audio/audioSystem.ts';
import { sanitizeBindings, type Bindings } from '../input/bindings.ts';
import { CAMERA_MODES, type CameraMode } from '../render/cameraRig.ts';

/** Per-player preferences from the pause menu, kept in localStorage (graphics quality has its own key). */
export interface UserSettings {
  audio: Volumes;
  camera: {
    mode: CameraMode;
    /** Chase camera distance/height multiplier. */
    distance: number;
    /** Added to every camera's field of view (degrees). */
    fovOffset: number;
    /** Widen the FOV with speed (chase cam). */
    speedFov: boolean;
  };
  showFps: boolean;
  bindings: Bindings;
}

export const CAMERA_LIMITS = { distance: [0.7, 1.6], fovOffset: [-10, 15] } as const;

const STORAGE_KEY = 'apex.settings';

export function defaultSettings(): UserSettings {
  return {
    audio: { ...AUDIO.defaults, muted: false },
    camera: { mode: 'chase', distance: 1, fovOffset: 0, speedFov: true },
    showFps: false,
    bindings: sanitizeBindings(null),
  };
}

const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

/** Merges stored JSON over the defaults, clamping every value. */
export function sanitizeSettings(raw: unknown): UserSettings {
  const d = defaultSettings();
  if (typeof raw !== 'object' || raw === null) return d;
  const r = raw as { audio?: Record<string, unknown>; camera?: Record<string, unknown>; showFps?: unknown; bindings?: unknown };
  const a = r.audio ?? {};
  const c = r.camera ?? {};
  return {
    audio: {
      master: num(a.master, 0, 1, d.audio.master),
      engine: num(a.engine, 0, 1, d.audio.engine),
      effects: num(a.effects, 0, 1, d.audio.effects),
      ui: num(a.ui, 0, 1, d.audio.ui),
      muted: a.muted === true,
    },
    camera: {
      mode: CAMERA_MODES.includes(c.mode as CameraMode) ? (c.mode as CameraMode) : d.camera.mode,
      distance: num(c.distance, ...CAMERA_LIMITS.distance, d.camera.distance),
      fovOffset: num(c.fovOffset, ...CAMERA_LIMITS.fovOffset, d.camera.fovOffset),
      speedFov: c.speedFov !== false,
    },
    showFps: r.showFps === true,
    bindings: sanitizeBindings(r.bindings),
  };
}

/** Holds the settings, saves on every change and notifies listeners. */
export class SettingsStore {
  value: UserSettings;
  private readonly listeners: ((s: UserSettings) => void)[] = [];

  constructor() {
    let raw: unknown = null;
    try {
      raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    } catch {
      // Blocked storage or bad JSON: start from defaults.
    }
    this.value = sanitizeSettings(raw);
  }

  /** Registers a listener and calls it once with the current value. */
  subscribe(fn: (s: UserSettings) => void): void {
    this.listeners.push(fn);
    fn(this.value);
  }

  update(change: (s: UserSettings) => void): void {
    change(this.value);
    this.value = sanitizeSettings(this.value);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.value));
    } catch {
      // Not fatal: the change just won't persist.
    }
    for (const fn of this.listeners) fn(this.value);
  }
}
