import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../constants.ts';
import { CAR } from '../tuning.ts';
import { createTyres, fitTyres, stepTyres, tyreGrip, wearGripFactor } from './tyres.ts';

/** Drives `km` at 60 m/s with a constant load of `g`. */
const drive = (t: ReturnType<typeof createTyres>, km: number, g: number) => {
  const ticks = Math.round((km * 1000) / 60 / FIXED_DT);
  for (let i = 0; i < ticks; i++) stepTyres(t, CAR, 60, g, FIXED_DT);
};

describe('tyres', () => {
  it('softs grip most and wear fastest, hards the opposite', () => {
    const grip = (c: 'soft' | 'medium' | 'hard') => tyreGrip(createTyres(c), CAR);
    expect(grip('soft')).toBeGreaterThan(grip('medium'));
    expect(grip('medium')).toBeGreaterThan(grip('hard'));

    const worn = (c: 'soft' | 'medium' | 'hard') => {
      const t = createTyres(c);
      drive(t, 3, 1.5);
      return t.wear;
    };
    expect(worn('soft')).toBeGreaterThan(worn('medium') * 1.5);
    expect(worn('medium')).toBeGreaterThan(worn('hard') * 1.5);
  });

  it('wears faster under load and caps at 1', () => {
    const easy = createTyres();
    const hard = createTyres();
    drive(easy, 2, 0.5);
    drive(hard, 2, 3);
    expect(hard.wear).toBeGreaterThan(easy.wear * 2);
    const long = createTyres('soft');
    drive(long, 200, 3);
    expect(long.wear).toBe(1);
  });

  it('a medium loses roughly 5-12 % per 1.2 km lap at racing pace', () => {
    const t = createTyres();
    drive(t, 1.2, 1.8);
    expect(t.wear).toBeGreaterThan(0.05);
    expect(t.wear).toBeLessThan(0.12);
  });

  it('grip fades slowly then drops past the cliff', () => {
    const early = 1 - wearGripFactor(0.3, CAR);
    const late = wearGripFactor(0.7, CAR) - wearGripFactor(1, CAR);
    expect(early).toBeLessThan(0.05);
    expect(late).toBeGreaterThan(0.2);
    // A dead soft is slower than a fresh hard.
    expect(CAR.tyres.compounds.soft.grip * wearGripFactor(1, CAR)).toBeLessThan(CAR.tyres.compounds.hard.grip);
  });

  it('the race setting scales wear, and "off" stops it', () => {
    const off = createTyres();
    fitTyres(off, CAR, 'soft', 'off');
    drive(off, 5, 2);
    expect(off.wear).toBe(0);
    const normal = createTyres();
    const high = createTyres();
    fitTyres(normal, CAR, 'medium', 'normal');
    fitTyres(high, CAR, 'medium', 'high');
    drive(normal, 1, 2);
    drive(high, 1, 2);
    expect(high.wear).toBeCloseTo(normal.wear * CAR.tyres.wearSettings.high, 5);
  });

  it('fitting a new set resets wear', () => {
    const t = createTyres();
    drive(t, 3, 2);
    fitTyres(t, CAR, 'hard', 'normal');
    expect(t).toMatchObject({ compound: 'hard', wear: 0, wearScale: 1 });
  });
});
