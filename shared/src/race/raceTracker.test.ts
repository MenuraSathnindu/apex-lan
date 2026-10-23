import { describe, expect, it } from 'vitest';
import { buildTrack } from '../track/track.ts';
import { APEX_PARK } from '../track/tracks.ts';
import { RACE } from '../tuning.ts';
import { buildCheckpoints, crossesGate } from './checkpoints.ts';
import { RaceTracker, classifiedTime } from './raceTracker.ts';

const track = buildTrack(APEX_PARK);
const gates = buildCheckpoints(track);
const START = 10_000;
const DT = 1000 / 30;

/** Drives a car along the centreline at `speed` m/s, feeding the tracker at 30 Hz. */
function drive(tracker: RaceTracker, id: number, fromS: number, metres: number, speed: number, t0: number) {
  const { samples, length } = track;
  const step = samples[1]!.s;
  const events = [];
  let t = t0;
  for (let d = 0; d <= metres; d += (speed * DT) / 1000) {
    const s = (((fromS + d) % length) + length) % length;
    const smp = samples[Math.floor(s / step) % samples.length]!;
    events.push(...tracker.onState(id, smp.x, smp.z, t));
    t += DT;
  }
  return { events, t };
}

/** Distance along the track of the start line, and a grid spot 20 m behind it. */
const startS = track.samples[track.startIndex]!.s;
const gridS = startS - 20;

describe('checkpoints', () => {
  it('builds ~100 m gates with gate 0 on the start line', () => {
    expect(gates.length).toBe(Math.round(track.length / RACE.checkpointSpacing));
    const s = track.samples[track.startIndex]!;
    expect(gates[0]!.x).toBeCloseTo(s.x);
    expect(gates[0]!.z).toBeCloseTo(s.z);
  });

  it('detects forward crossings only', () => {
    const g = gates[3]!;
    const behind = [g.x - g.tx * 2, g.z - g.tz * 2] as const;
    const ahead = [g.x + g.tx * 2, g.z + g.tz * 2] as const;
    expect(crossesGate(g, ...behind, ...ahead)).toBe(true);
    expect(crossesGate(g, ...ahead, ...behind)).toBe(false);
    // Passing far outside the gate (beyond the barriers) doesn't count.
    const off = g.halfWidth + 5;
    expect(crossesGate(g, behind[0] + g.nx * off, behind[1] + g.nz * off, ahead[0] + g.nx * off, ahead[1] + g.nz * off)).toBe(false);
  });
});

describe('RaceTracker', () => {
  it('counts laps and lap times when every gate is passed in order', () => {
    const tracker = new RaceTracker(track, gates, [1], START, 2);
    const { events } = drive(tracker, 1, gridS, 20 + track.length * 2 + 5, 30, START);
    expect(events.map((e) => e.lap)).toEqual([1, 2]);
    // Lap 1 includes the 20 m from the grid; lap 2 is exactly one track length.
    expect(events[0]!.time / 1000).toBeCloseTo((track.length + 20) / 30, 0);
    expect(events[1]!.time / 1000).toBeCloseTo(track.length / 30, 0);
    expect(events[1]!.finished).toBe(true);
    const [row] = tracker.standings();
    expect(row).toMatchObject({ id: 1, pos: 1, laps: 2 });
    expect(row!.finishTime).toBeGreaterThan(0);
  });

  it('ignores everything before GO', () => {
    const tracker = new RaceTracker(track, gates, [1], START, 1);
    const { events } = drive(tracker, 1, gridS, track.length + 30, 30, START - 60_000);
    expect(events).toEqual([]);
  });

  it('does not count a lap when a section is skipped by teleporting', () => {
    const tracker = new RaceTracker(track, gates, [1], START, 1);
    let { t } = drive(tracker, 1, gridS, 150, 30, START); // past gates 0 and 1
    // Teleport to just before the finish line, then cross it.
    const r = drive(tracker, 1, startS - 10, 20, 30, t + DT);
    expect(r.events).toEqual([]);
    expect(tracker.standings()[0]!.laps).toBe(0);
  });

  it('does not count a lap driven backwards', () => {
    const tracker = new RaceTracker(track, gates, [1], START, 1);
    const { events } = drive(tracker, 1, startS + 5, -(track.length + 10), -30, START);
    expect(events).toEqual([]);
  });

  it('ranks by progress, then by finish time', () => {
    const tracker = new RaceTracker(track, gates, [1, 2, 3], START, 1);
    drive(tracker, 1, gridS, 400, 30, START);
    drive(tracker, 2, gridS, 600, 30, START);
    drive(tracker, 3, gridS, 200, 30, START);
    expect(tracker.standings().map((s) => s.id)).toEqual([2, 1, 3]);

    // Car 3 finishes first, car 1 second: finishers rank above everyone else.
    const d3 = drive(tracker, 3, gridS + 200, track.length, 40, START + 10_000);
    const d1 = drive(tracker, 1, gridS + 400, track.length, 30, START + 20_000);
    expect(d3.events.at(-1)!.finished).toBe(true);
    expect(d1.events.at(-1)!.finished).toBe(true);
    expect(tracker.standings().map((s) => s.id)).toEqual([3, 1, 2]);
  });

  it('ends after the grace period, or when everyone connected has finished', () => {
    const tracker = new RaceTracker(track, gates, [1, 2], START, 1);
    const { t } = drive(tracker, 1, gridS, track.length + 30, 40, START);
    expect(tracker.isOver(t, new Set([1, 2]))).toBe(false);
    expect(tracker.isOver(t, new Set([1]))).toBe(true); // 2 disconnected
    expect(tracker.isOver(t + RACE.finishGraceMs, new Set([1, 2]))).toBe(true);
    tracker.finalize();
    expect(tracker.standings().find((s) => s.id === 2)!.dnf).toBe(true);
  });

  it('ignores non-participants (late joiners)', () => {
    const tracker = new RaceTracker(track, gates, [1], START, 1);
    expect(drive(tracker, 99, gridS, track.length + 30, 30, START).events).toEqual([]);
    expect(tracker.standings().map((s) => s.id)).toEqual([1]);
  });
});

describe('lap validity', () => {
  it('a respawn jump makes the lap invalid but it still counts', () => {
    const tracker = new RaceTracker(track, gates, [1], START, 2);
    // Half a lap, then a respawn: 80 m back in one tick, then carry on to the line.
    const first = drive(tracker, 1, gridS, 20 + track.length / 2, 30, START);
    const backS = gridS + 20 + track.length / 2 - 80;
    const after = drive(tracker, 1, backS, track.length / 2 + 120, 30, first.t + 34);
    const events = [...first.events, ...after.events];
    expect(events).toHaveLength(1);
    expect(events[0]!.valid).toBe(false);
    expect(tracker.lapsOf(1)[0]!.valid).toBe(false);
    const row = tracker.standings()[0]!;
    expect(row.laps).toBe(1);
    expect(row.bestLap).toBeNull();
    expect(tracker.fastestLap()).toBeNull();
  });

  it('clean laps are valid', () => {
    const tracker = new RaceTracker(track, gates, [1], START, 2);
    const { events } = drive(tracker, 1, gridS, 20 + track.length * 2 + 5, 30, START);
    expect(events.map((e) => e.valid)).toEqual([true, true]);
  });
});

describe('sector times', () => {
  it('splits each lap into the sectors of the track and keeps every lap', () => {
    const tracker = new RaceTracker(track, gates, [1], START, 2);
    const { events } = drive(tracker, 1, gridS, 20 + track.length * 2 + 5, 30, START);
    expect(events).toHaveLength(2);
    for (const e of events) {
      expect(e.sectors).toHaveLength(3);
      expect(e.sectors!.reduce((a, b) => a + b, 0)).toBeCloseTo(e.time, -2);
      expect(e.sectors!.every((s) => s > 0)).toBe(true);
    }
    expect(tracker.lapsOf(1).map((l) => l.lap)).toEqual([1, 2]);
    expect(tracker.fastestLap()).toEqual({ id: 1, time: Math.min(...events.map((e) => e.time)) });
  });
});

describe('overtake detection point', () => {
  const toDetection = 20 + (APEX_PARK.detectionPoint ?? 0) + 30;
  const run = (offsetMs: number) => {
    const tracker = new RaceTracker(track, gates, [1, 2], START, 3);
    drive(tracker, 1, gridS, toDetection, 40, START);
    drive(tracker, 2, gridS, toDetection, 40, START + offsetMs);
    return tracker.takeDetections();
  };

  it('announces each crossing; the first car has nobody ahead', () => {
    const [first, second] = run(600);
    expect(first).toMatchObject({ id: 1, gap: null, overtake: false });
    expect(second!.id).toBe(2);
  });

  it('unlocks overtake mode when the car ahead is within the gap, and not when further back', () => {
    const near = run(600)[1]!;
    expect(near.gap).toBeCloseTo(0.6, 1);
    expect(near.overtake).toBe(true);
    const far = run(1800)[1]!;
    expect(far.gap).toBeCloseTo(1.8, 1);
    expect(far.overtake).toBe(false);
  });

  it('ignores crossings before GO and teleports', () => {
    const tracker = new RaceTracker(track, gates, [1], START, 3);
    drive(tracker, 1, gridS, toDetection, 40, START - 60_000);
    expect(tracker.takeDetections()).toEqual([]);
  });

  it('compares like with like: the second crossing of a lead car does not count as "ahead" for a lap-down car', () => {
    const tracker = new RaceTracker(track, gates, [1, 2], START, 5);
    // Car 1 completes a full extra lap while car 2 is still on its first.
    drive(tracker, 1, gridS, toDetection + track.length, 40, START);
    drive(tracker, 2, gridS, toDetection, 40, START + 200);
    const events = tracker.takeDetections();
    const car2 = events.find((e) => e.id === 2)!;
    // Car 2's first crossing compares with car 1's FIRST crossing (0.2 s ahead), not its second.
    expect(car2.gap).toBeCloseTo(0.2, 1);
  });
});


describe('RaceTracker penalties', () => {
  it('penalty reorders finishers by penalised time', () => {
    const tracker = new RaceTracker(track, gates, [1, 2], START, 1);
    drive(tracker, 1, gridS, 20 + track.length + 5, 30, START);
    // Ben runs the same lap 2 s later.
    drive(tracker, 2, gridS, 20 + track.length + 5, 30, START + 2000);
    expect(tracker.standings().map((s) => s.id)).toEqual([1, 2]);
    tracker.addPenalty(1, RACE.penaltyMs);
    const rows = tracker.standings();
    expect(rows.map((s) => s.id)).toEqual([2, 1]);
    expect(rows.find((s) => s.id === 1)!.penaltyMs).toBe(RACE.penaltyMs);
    expect(classifiedTime(rows[1]!)).toBe(rows[1]!.finishTime! + RACE.penaltyMs);
  });

  it('standings carry penaltyMs (0 without penalties)', () => {
    const tracker = new RaceTracker(track, gates, [1], START, 1);
    expect(tracker.standings()[0]!.penaltyMs).toBe(0);
    tracker.addPenalty(1, 5000);
    tracker.addPenalty(1, 5000);
    expect(tracker.standings()[0]!.penaltyMs).toBe(10_000);
  });

  it('invalidateLap makes the current lap invalid', () => {
    const tracker = new RaceTracker(track, gates, [1], START, 3);
    const first = drive(tracker, 1, gridS, 20 + 300, 30, START);
    tracker.invalidateLap(1);
    const { events } = drive(tracker, 1, gridS + 320, track.length - 300 + 5, 30, first.t);
    expect(events).toHaveLength(1);
    expect(events[0]!.valid).toBe(false);
    expect(tracker.standings()[0]!.bestLap).toBeNull();
  });
});

describe('RaceTracker gaps', () => {
  it('gap is the time behind the leader at the last common gate', () => {
    const tracker = new RaceTracker(track, gates, [1, 2], START, 3);
    drive(tracker, 1, gridS, 20 + 400, 30, START);
    drive(tracker, 2, gridS, 20 + 350, 30, START + 2000);
    const [lead, second] = tracker.standings();
    expect(lead).toMatchObject({ id: 1, gap: null, lapsDown: 0 });
    expect(second!.id).toBe(2);
    expect(Math.abs(second!.gap! - 2000)).toBeLessThan(2 * DT);
  });

  it('lapped cars report lapsDown', () => {
    const tracker = new RaceTracker(track, gates, [1, 2], START, 5);
    drive(tracker, 1, gridS, 20 + track.length + 300, 30, START);
    // Ben crawls 250 m at 10 m/s: at gate 2 he is ~15 s behind where Ann was.
    drive(tracker, 2, gridS, 20 + 250, 10, START);
    const second = tracker.standings()[1]!;
    expect(second.id).toBe(2);
    expect(second.lapsDown).toBe(1);
    expect(second.gap).toBeGreaterThan(10_000);
  });

  it('gap is null before any gate', () => {
    const tracker = new RaceTracker(track, gates, [1, 2], START, 3);
    expect(tracker.standings().map((s) => s.gap)).toEqual([null, null]);
    tracker.onState(2, track.samples[0]!.x, track.samples[0]!.z, START + 10);
    expect(tracker.standings().every((s) => s.gap === null && s.lapsDown === 0)).toBe(true);
  });

  it('finished gaps use penalised finish times', () => {
    const tracker = new RaceTracker(track, gates, [1, 2], START, 1);
    drive(tracker, 1, gridS, 20 + track.length + 5, 30, START);
    drive(tracker, 2, gridS, 20 + track.length + 5, 30, START + 1000);
    tracker.addPenalty(2, 5000);
    const [, second] = tracker.standings();
    expect(Math.abs(second!.gap! - 6000)).toBeLessThan(2 * DT);
  });
});

describe('live sector events', () => {
  it('crossing a sector line emits a sector event', () => {
    const tracker = new RaceTracker(track, gates, [1], START, 2);
    drive(tracker, 1, gridS, 20 + APEX_PARK.sectors[1]! + 20, 30, START);
    const [e, ...rest] = tracker.takeSectors();
    expect(rest).toEqual([]);
    expect(e).toMatchObject({ id: 1, lap: 1, sector: 0, valid: true });
    expect(e!.time).toBe(e!.elapsed);
    expect(e!.time / 1000).toBeCloseTo((20 + APEX_PARK.sectors[1]!) / 30, 0);
    expect(tracker.takeSectors()).toEqual([]);
  });

  it('the last sector comes with the lap', () => {
    const tracker = new RaceTracker(track, gates, [1], START, 2);
    const { events } = drive(tracker, 1, gridS, 20 + track.length + 5, 30, START);
    const sectors = tracker.takeSectors();
    expect(sectors.map((s) => s.sector)).toEqual([0, 1, 2]);
    expect(sectors.map((s) => s.time)).toEqual(events[0]!.sectors);
    expect(sectors[2]!.elapsed).toBe(events[0]!.time);
  });

  it('sectors of an invalidated lap are marked invalid', () => {
    const tracker = new RaceTracker(track, gates, [1], START, 2);
    tracker.invalidateLap(1);
    drive(tracker, 1, gridS, 20 + APEX_PARK.sectors[1]! + 20, 30, START);
    expect(tracker.takeSectors()[0]!.valid).toBe(false);
  });
});

describe('RaceTracker gaps while stopped', () => {
  it('a car that stops falls further behind as the leader drives on', () => {
    const tracker = new RaceTracker(track, gates, [1, 2], START, 3);
    // Ben sets off first and stops after 250 m; Ann drives past him.
    const ben = drive(tracker, 2, gridS, 20 + 250, 30, START);
    const ann = drive(tracker, 1, gridS, 20 + 600, 30, START + 1000);
    const [lead, second] = tracker.standings();
    expect(lead!.id).toBe(1);
    // Ann reached the gate after Ben's last one well after he stopped: never a 0 gap.
    expect(second!.gap).toBeGreaterThan(1000);
    const before = second!.gap!;
    drive(tracker, 1, gridS + 620, 300, 30, ann.t);
    expect(tracker.standings()[1]!.gap!).toBeGreaterThan(before);
    expect(ben.t).toBeLessThan(ann.t);
  });
});
