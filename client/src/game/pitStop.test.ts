import { describe, expect, it } from 'vitest';
import { CAR } from '@apex/shared';
import { PitStop } from './pitStop.ts';

const DT = 1 / 60;

/** Runs `seconds` of ticks with the same inputs; returns the first compound fitted, if any. */
function hold(p: PitStop, seconds: number, zone: 'none' | 'lane' | 'box', speed = 0, racing = true, steer = 0) {
  let fitted = null;
  for (let t = 0; t < seconds; t += DT) fitted ??= p.step(zone, speed, racing, steer, 'medium', DT);
  return fitted;
}

describe('PitStop', () => {
  it('stopping in the box starts a stop and holds the car', () => {
    const p = new PitStop();
    expect(p.step('box', 0.5, true, 0, 'medium', DT)).toBeNull();
    expect(p.state).toBe('stopping');
    expect(p.holding).toBe(true);
    expect(p.choice).toBe('medium');
  });

  it('does not start while moving or outside the box', () => {
    const p = new PitStop();
    p.step('box', 5, true, 0, 'medium', DT);
    p.step('lane', 0, true, 0, 'medium', DT);
    expect(p.state).toBe('idle');
  });

  it('completes after 2.5 s with the chosen compound', () => {
    const p = new PitStop();
    expect(hold(p, CAR.pit.stopSeconds - 0.1, 'box')).toBeNull();
    expect(p.progress).toBeGreaterThan(0.9);
    expect(hold(p, 0.2, 'box')).toBe('medium');
    expect(p.state).toBe('done');
    expect(p.holding).toBe(false);
  });

  it('steer edges cycle the compound', () => {
    const p = new PitStop();
    p.step('box', 0, true, 0, 'medium', DT);
    p.step('box', 0, true, 1, 'medium', DT);
    p.step('box', 0, true, 1, 'medium', DT); // still held: one step only
    expect(p.choice).toBe('hard');
    p.step('box', 0, true, 0, 'medium', DT);
    p.step('box', 0, true, -1, 'medium', DT);
    p.step('box', 0, true, 0, 'medium', DT);
    p.step('box', 0, true, -1, 'medium', DT);
    expect(p.choice).toBe('soft');
    expect(hold(p, CAR.pit.stopSeconds, 'box')).toBe('soft');
  });

  it('no new stop until leaving the box', () => {
    const p = new PitStop();
    hold(p, CAR.pit.stopSeconds + 0.1, 'box');
    expect(hold(p, 5, 'box')).toBeNull();
    expect(p.state).toBe('done');
    p.step('lane', 10, true, 0, 'medium', DT);
    expect(p.state).toBe('idle');
  });

  it('no stop when not racing, and a stop under way is dropped when racing ends', () => {
    const p = new PitStop();
    p.step('box', 0, false, 0, 'medium', DT);
    expect(p.state).toBe('idle');
    p.step('box', 0, true, 0, 'medium', DT);
    p.step('box', 0, false, 0, 'medium', DT);
    expect(p.state).toBe('idle');
    expect(p.holding).toBe(false);
  });

  it('a new session starts as if the stop were done: a car parked in the box is not stopped', () => {
    const p = new PitStop();
    p.newSession();
    expect(hold(p, 3, 'box')).toBeNull();
    expect(p.holding).toBe(false);
    p.step('lane', 10, true, 0, 'medium', DT);
    expect(p.state).toBe('idle');
  });
});
