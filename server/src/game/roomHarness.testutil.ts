import { APEX_PARK, buildTrack, type CarState, type S2C } from '@apex/shared';
import { Room, type Connection, type RoomOptions } from './room.ts';

/** Test harness for Room: fake connections, a fake clock, and cars that drive along the centreline. */
export class FakeConn implements Connection {
  inbox: S2C[] = [];
  send(msg: S2C) {
    this.inbox.push(msg);
  }
  close() {}
  last<T extends S2C['t']>(t: T): Extract<S2C, { t: T }> {
    const m = [...this.inbox].reverse().find((x) => x.t === t);
    if (!m) throw new Error(`no ${t} message`);
    return m as Extract<S2C, { t: T }>;
  }
}

export const track = buildTrack(APEX_PARK);
const step = track.samples[1]!.s;
const DT = 1000 / 30;

export function setup(opts: RoomOptions = {}) {
  let time = 1_000_000;
  const room = new Room({ ...opts, now: () => time });
  const conns: FakeConn[] = [];
  const join = (name: string, sessionId: string | null = null) => {
    const c = new FakeConn();
    room.handle(c, { t: 'hello', sessionId, name, color: conns.length });
    conns.push(c);
    return c;
  };
  const idOf = (c: FakeConn) => c.last('welcome').playerId;
  /** Advances time by ms, keeping everyone alive. */
  const wait = (ms: number) => {
    for (let t = 0; t < ms; t += 500) {
      time += Math.min(500, ms - t);
      for (const c of conns) room.handle(c, { t: 'ping', clientTime: 0 });
      room.update();
    }
  };
  /** One car drives `metres` along the centreline from distance `fromS` at `speed`, 30 states/s. */
  const drive = (c: FakeConn, fromS: number, metres: number, speed = 40) => {
    for (let d = 0; d <= metres; d += (speed * DT) / 1000) {
      const s = (((fromS + d) % track.length) + track.length) % track.length;
      const smp = track.samples[Math.floor(s / step) % track.samples.length]!;
      time += DT;
      const state: CarState = { p: [smp.x, 0.7, smp.z], q: [0, 0, 0, 1], v: [smp.tx * speed, 0, smp.tz * speed], wh: new Array(12).fill(0), b: 0 };
      room.handle(c, { t: 'state', s: state });
      for (const o of conns) if (o !== c) room.handle(o, { t: 'ping', clientTime: 0 });
      room.update();
    }
  };
  /** Stops a car (speed 0) so it doesn't count as "on a lap". */
  const park = (c: FakeConn) => room.handle(c, { t: 'state', s: { p: [0, 0.7, 0], q: [0, 0, 0, 1], v: [0, 0, 0], wh: new Array(12).fill(0), b: 0 } });
  /** Waits until the session's countdown (lights) is over. */
  const go = () => wait(Math.max(0, (conns[0]?.last('race').race.startsAt ?? time) - time) + 50);
  /** Several cars at once: each moves along the centreline at its speed (0 = parked where it is). */
  const together = (cars: { c: FakeConn; s: number; speed: number }[], seconds: number) => {
    for (let t = 0; t < seconds * 1000; t += DT) {
      time += DT;
      for (const car of cars) {
        car.s += (car.speed * DT) / 1000;
        const s = ((car.s % track.length) + track.length) % track.length;
        const smp = track.samples[Math.floor(s / step) % track.samples.length]!;
        room.handle(car.c, { t: 'state', s: { p: [smp.x, 0.7, smp.z], q: [0, 0, 0, 1], v: [smp.tx * car.speed, 0, smp.tz * car.speed], wh: new Array(12).fill(0), b: 0 } });
      }
      room.update();
    }
  };
  return { room, join, idOf, wait, drive, park, go, together, now: () => time, conns, send: (c: FakeConn, s: CarState) => room.handle(c, { t: 'state', s }), setTime: (t: number) => (time = t) };
}

