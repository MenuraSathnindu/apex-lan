import { AUTO_QUALITY, QUALITY, type QualityLevel } from '@apex/shared';

export type QualityMode = 'auto' | QualityLevel;
export type QualitySettings = (typeof QUALITY)[QualityLevel];

const STORAGE_KEY = 'apex.graphics';
const LEVELS: QualityLevel[] = ['low', 'medium', 'high'];

function loadMode(): QualityMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'auto' || v === 'low' || v === 'medium' || v === 'high') return v;
  } catch {
    // Storage blocked (private mode etc.) — fall through to auto.
  }
  return 'auto';
}

function saveMode(mode: QualityMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Not fatal: the choice just won't persist.
  }
}

/**
 * Holds the graphics level. In auto mode it starts at High, measures average FPS after
 * a warm-up, and steps down until FPS is acceptable (never steps back up on its own).
 */
export class QualityManager {
  mode: QualityMode = loadMode();
  level: QualityLevel = this.mode === 'auto' ? 'high' : this.mode;
  /** True once auto mode has settled (or immediately for a fixed level). */
  settled = this.mode !== 'auto';
  /** Last measured average FPS (for the settings panel). */
  fps = 0;

  private listeners: ((level: QualityLevel, s: QualitySettings) => void)[] = [];
  private elapsed = 0;
  private frames = 0;
  private sampleTime = 0;
  private fpsWindow = { t: 0, n: 0 };

  get settings(): QualitySettings {
    return QUALITY[this.level];
  }

  onChange(fn: (level: QualityLevel, s: QualitySettings) => void): void {
    this.listeners.push(fn);
  }

  setMode(mode: QualityMode): void {
    this.mode = mode;
    saveMode(mode);
    this.restartAuto();
    this.setLevel(mode === 'auto' ? 'high' : mode);
  }

  /** Call every rendered frame. */
  frame(dt: number): void {
    this.fpsWindow.t += dt;
    this.fpsWindow.n++;
    if (this.fpsWindow.t >= 0.5) {
      this.fps = this.fpsWindow.n / this.fpsWindow.t;
      this.fpsWindow = { t: 0, n: 0 };
    }

    if (this.settled) return;
    this.elapsed += dt;
    if (this.elapsed < AUTO_QUALITY.warmupSeconds) return;
    this.frames++;
    this.sampleTime += dt;
    if (this.sampleTime < AUTO_QUALITY.sampleSeconds) return;

    const avg = this.frames / this.sampleTime;
    const idx = LEVELS.indexOf(this.level);
    if (avg < AUTO_QUALITY.minFps && idx > 0) {
      console.info(`[graphics] ${avg.toFixed(0)} fps on ${this.level} → trying ${LEVELS[idx - 1]}`);
      this.restartAuto();
      this.setLevel(LEVELS[idx - 1]!);
    } else {
      console.info(`[graphics] auto-selected ${this.level} (${avg.toFixed(0)} fps)`);
      this.settled = true;
    }
  }

  private restartAuto() {
    this.settled = this.mode !== 'auto';
    this.elapsed = 0;
    this.frames = 0;
    this.sampleTime = 0;
  }

  private setLevel(level: QualityLevel) {
    this.level = level;
    for (const fn of this.listeners) fn(level, QUALITY[level]);
  }
}
