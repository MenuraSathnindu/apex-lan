import { describe, expect, it } from 'vitest';
import { defaultSettings, sanitizeSettings } from './userSettings.ts';

describe('user settings', () => {
  it('falls back to defaults for junk', () => {
    expect(sanitizeSettings('nope')).toEqual(defaultSettings());
    expect(sanitizeSettings({ audio: { master: 'loud' } }).audio.master).toBe(defaultSettings().audio.master);
  });

  it('clamps values and keeps valid ones', () => {
    const s = sanitizeSettings({
      audio: { master: 3, engine: -1, muted: true },
      camera: { mode: 'hood', distance: 9, fovOffset: -50, speedFov: false },
      showFps: true,
    });
    expect(s.audio.master).toBe(1);
    expect(s.audio.engine).toBe(0);
    expect(s.audio.muted).toBe(true);
    expect(s.camera).toEqual({ mode: 'hood', distance: 1.6, fovOffset: -10, speedFov: false });
    expect(s.showFps).toBe(true);
  });

  it('rejects unknown camera modes', () => {
    expect(sanitizeSettings({ camera: { mode: 'drone' } }).camera.mode).toBe('chase');
  });
});
