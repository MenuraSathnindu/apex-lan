import { describe, expect, it } from 'vitest';
import { FX } from '@apex/shared';
import { ReplayRecorder, overtakesInTop, poseAt } from './replay.ts';

const R = FX.replay;
const STEP = 1000 / R.hz;

/** Records cars 1 and 2 driving along +Z from t0 to t1 (ms). */
function feed(rec: ReplayRecorder, t0: number, t1: number) {
  for (let t = t0; t <= t1; t += STEP) {
    rec.record(t, [
      { id: 1, pos: { x: 0, y: 0.5, z: t / 100 }, quat: { x: 0, y: 0, z: 0, w: 1 } },
      { id: 2, pos: { x: 3, y: 0.5, z: t / 100 - 5 }, quat: { x: 0, y: 0, z: 0, w: 1 } },
    ]);
  }
}

describe('ReplayRecorder', () => {
  it('keeps only the last windowMs (12 s)', () => {
    const rec = new ReplayRecorder();
    feed(rec, 0, 15_000);
    const span = rec.span();
    expect(span!.from).toBeGreaterThanOrEqual(15_000 - R.windowMs - STEP);
    expect(span!.to).toBeGreaterThan(15_000 - STEP);
  });

  it('records at most at the replay rate', () => {
    const rec = new ReplayRecorder();
    for (let t = 0; t < 1000; t += 5) rec.record(t, [{ id: 1, pos: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 } }]);
    expect(rec.frameCount).toBeLessThanOrEqual(R.hz + 1);
  });

  it('a clip covers t-7..t+3 and is ready 3 s later', () => {
    const rec = new ReplayRecorder();
    feed(rec, 0, 12_000);
    rec.requestClip(12_000, 1, 'crash');
    feed(rec, 12_000 + STEP, 14_900);
    expect(rec.poll(14_900)).toEqual([]);
    feed(rec, 14_900 + STEP, 15_100);
    const [clip] = rec.poll(15_100);
    expect(clip).toMatchObject({ subject: 1, kind: 'crash', at: 12_000 });
    expect(clip!.frames[0]!.t).toBeGreaterThanOrEqual(12_000 - R.beforeMs);
    expect(clip!.frames[0]!.t).toBeLessThan(12_000 - R.beforeMs + 2 * STEP);
    expect(clip!.frames.at(-1)!.t).toBeLessThanOrEqual(12_000 + R.afterMs);
    expect(rec.clips).toHaveLength(1);
  });

  it('requests within 5 s merge', () => {
    const rec = new ReplayRecorder();
    feed(rec, 0, 10_000);
    rec.requestClip(10_000, 1, 'crash');
    rec.requestClip(12_000, 2, 'overtake');
    feed(rec, 10_000, 20_000);
    expect(rec.poll(20_000)).toHaveLength(1);
  });

  it('at most 4 clips, the newest kept', () => {
    const rec = new ReplayRecorder();
    for (let k = 0; k < 6; k++) {
      const t = k * 10_000;
      feed(rec, t, t + 10_000);
      rec.requestClip(t + 5000, 1, 'crash');
      feed(rec, t + 10_000, t + 10_000);
      rec.poll(t + 10_000);
    }
    expect(rec.clips).toHaveLength(R.maxClips);
    expect(rec.clips.at(-1)!.at).toBe(55_000);
  });

  it('poses interpolate between frames; a car missing from the clip has no pose', () => {
    const rec = new ReplayRecorder();
    feed(rec, 0, 10_000);
    rec.requestClip(7_000, 1, 'crash');
    feed(rec, 10_000, 10_100);
    const [clip] = rec.poll(10_100);
    const p = poseAt(clip!, 5_000 + STEP / 2, 1)!;
    expect(p.pos.z).toBeCloseTo((5_000 + STEP / 2) / 100, 1);
    expect(poseAt(clip!, 5_000, 9)).toBeNull();
  });
});

describe('overtakesInTop', () => {
  it('finds cars that gained a place inside the top 3', () => {
    expect(overtakesInTop([1, 2, 3, 4], [2, 1, 3, 4])).toEqual([2]);
    expect(overtakesInTop([1, 2, 3, 4], [1, 2, 4, 3])).toEqual([4]);
    expect(overtakesInTop([1, 2, 3, 4, 5], [1, 2, 3, 5, 4])).toEqual([]);
    expect(overtakesInTop([], [1, 2])).toEqual([]);
  });
});
