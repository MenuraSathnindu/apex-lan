import { describe, expect, it } from 'vitest';
import type { CarState } from '@apex/shared';
import { SnapshotBuffer, emptyPose } from './interpolation.ts';
import { ServerClock } from './clock.ts';

const state = (z: number, yaw = 0, vz = 0): CarState => ({
  p: [0, 0, z],
  q: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
  v: [0, 0, vz],
  wh: new Array(12).fill(z),
  b: 0,
});

describe('SnapshotBuffer', () => {
  it('interpolates position, rotation and wheels between snapshots', () => {
    const buf = new SnapshotBuffer();
    buf.push(1000, state(0, 0));
    buf.push(1100, state(10, Math.PI / 2));
    const out = emptyPose();
    expect(buf.sample(1050, out)).toBe(true);
    expect(out.p[2]).toBeCloseTo(5);
    expect(out.wh[0]).toBeCloseTo(5);
    // Halfway yaw = 45°.
    expect(2 * Math.atan2(out.q[1], out.q[3])).toBeCloseTo(Math.PI / 4);
  });

  it('takes the short way round for rotations', () => {
    const buf = new SnapshotBuffer();
    const a = state(0, 0);
    const b = state(0, 0.2);
    b.q = b.q.map((x) => -x) as CarState['q']; // same rotation, opposite sign
    buf.push(0, a);
    buf.push(100, b);
    const out = emptyPose();
    buf.sample(50, out);
    expect(Math.abs(2 * Math.atan2(out.q[1], out.q[3]))).toBeCloseTo(0.1, 3);
  });

  it('extrapolates briefly with velocity, then holds', () => {
    const buf = new SnapshotBuffer();
    buf.push(0, state(0, 0, 10));
    buf.push(100, state(1, 0, 10));
    const out = emptyPose();
    buf.sample(200, out);
    expect(out.p[2]).toBeCloseTo(2); // +100 ms at 10 m/s
    buf.sample(5000, out);
    expect(out.p[2]).toBeCloseTo(2.5); // capped at 150 ms
  });

  it('ignores duplicates and out-of-order snapshots', () => {
    const buf = new SnapshotBuffer();
    buf.push(100, state(1));
    buf.push(100, state(99));
    buf.push(50, state(99));
    expect(buf.size).toBe(1);
  });

  it('returns false when empty', () => {
    expect(new SnapshotBuffer().sample(0, emptyPose())).toBe(false);
  });
});

describe('ServerClock', () => {
  it('estimates offset from pongs, preferring low-RTT samples', () => {
    const clock = new ServerClock();
    // Server is 5000 ms ahead. Clean samples: rtt 10.
    for (let i = 0; i < 5; i++) clock.onPong(i * 1000, i * 1000 + 5 + 5000, i * 1000 + 10);
    // A noisy, slow sample shouldn't move it.
    clock.onPong(9000, 9000 + 300 + 5000, 9000 + 400);
    expect(clock.now(20_000)).toBeCloseTo(25_000, 0);
  });
});
