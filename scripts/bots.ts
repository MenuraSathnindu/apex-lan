// Fake players for testing multiplayer alone. They join like real clients, wait on the
// grid in the lobby and drive laps along the racing line once the host starts a race.
//
//   npm run bots              → 3 bots against ws://localhost:3000/ws
//   npm run bots -- 7         → 7 bots (fills an 8-player room with you)
//   npm run bots -- 7 ws://192.168.1.23:3000/ws
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import {
  APEX_PARK,
  CAR,
  CAR_COLORS,
  STATE_SEND_RATE,
  TRACK_HEIGHTS,
  buildTrack,
  decodeS2C,
  encode,
  type C2S,
  type CarState,
  type RacePhase,
  type BuiltTrack,
  type TrackSample,
} from '../shared/src/index.ts';
import { trackCatalog } from '../server/src/tracks/catalog.ts';

const count = Number(process.argv[2] ?? 3);
const url = process.argv[3] ?? 'ws://localhost:3000/ws';
// Bots follow whichever track the room is on (same files the server reads).
const catalog = trackCatalog(resolve(dirname(fileURLToPath(import.meta.url)), '../client/public/tracks'));
const built = new Map<string, BuiltTrack>();
function trackFor(id: string): BuiltTrack {
  let t = built.get(id);
  if (!t) {
    t = buildTrack(catalog.get(id) ?? APEX_PARK);
    built.set(id, t);
  }
  return t;
}
const wheelbase = CAR.wheels.frontZ - CAR.wheels.rearZ;
// Wheel centre height in chassis space at rest, and the chassis height that puts the tyres on the road.
const wheelY = CAR.wheels.connectionY - (CAR.wheels.suspensionRestLength - 9.81 / (4 * CAR.wheels.suspensionStiffness));
const chassisY = TRACK_HEIGHTS.road + CAR.wheels.radius - wheelY;

function sampleAt(track: BuiltTrack, s: number): TrackSample & { i: number } {
  const { samples } = track;
  const step = samples[1]!.s;
  const len = track.length;
  const wrapped = ((s % len) + len) % len;
  const i = Math.floor(wrapped / step) % samples.length;
  const a = samples[i]!;
  const b = samples[(i + 1) % samples.length]!;
  const k = (wrapped - a.s) / step;
  return { ...a, x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, i };
}

function startBot(n: number) {
  const ws = new WebSocket(url);
  const send = (m: C2S) => ws.readyState === ws.OPEN && ws.send(encode(m));
  let myId = 0;
  let phase: RacePhase = 'lobby';
  let track = trackFor(APEX_PARK.id);
  let slot = 0;
  let s = 0;
  let lateral = 0;
  let spin = 0;
  // Each bot has its own pace, some faster in corners than others.
  const topSpeed = 30 + Math.random() * 12;
  const cornerSpeed = 14 + Math.random() * 6;
  let speed = 0;

  const toGrid = () => {
    const g = track.spawnGrid[slot]!;
    const { samples } = track;
    // Find the grid spot's distance along the track and its lateral offset.
    let best = 0;
    let bestD = Infinity;
    samples.forEach((smp, i) => {
      const d = (smp.x - g.position.x) ** 2 + (smp.z - g.position.z) ** 2;
      if (d < bestD) [bestD, best] = [d, i];
    });
    const smp = samples[best]!;
    s = smp.s;
    lateral = (g.position.x - smp.x) * smp.nx + (g.position.z - smp.z) * smp.nz;
    speed = 0;
  };

  ws.on('open', () => send({ t: 'hello', sessionId: null, name: `Bot ${n}`, color: n % CAR_COLORS.length }));
  ws.on('message', (data) => {
    const msg = decodeS2C(data.toString());
    if (msg.t === 'welcome') {
      myId = msg.playerId;
      slot = msg.players.find((p) => p.id === myId)!.slot;
      phase = msg.race.phase;
      track = trackFor(msg.race.trackId);
      toGrid();
      console.log(`Bot ${n} joined as #${myId} in slot ${slot + 1}`);
    }
    if (msg.t === 'race') {
      track = trackFor(msg.race.trackId);
      if (msg.race.phase !== 'racing') toGrid();
      phase = msg.race.phase;
    }
    if (msg.t === 'full') console.log(`Bot ${n}: room full`);
  });
  ws.on('close', () => {
    console.log(`Bot ${n} disconnected`);
    clearInterval(timer);
  });
  ws.on('error', (e) => console.log(`Bot ${n}: ${e.message}`));

  const dt = 1 / STATE_SEND_RATE;
  const ping = setInterval(() => send({ t: 'ping', clientTime: Date.now() }), 1000);
  const timer = setInterval(() => {
    if (!myId) return;
    // Look ahead for corners and slow down for them.
    let ahead = 0;
    for (let d = 10; d <= 60; d += 10) ahead = Math.max(ahead, Math.abs(sampleAt(track, s + d).curvature));
    const target = phase === 'racing' ? (ahead > 1 / 60 ? cornerSpeed : topSpeed) : 0;
    speed += Math.sign(target - speed) * Math.min(Math.abs(target - speed), (target > speed ? 6 : 12) * dt);
    s += speed * dt;
    if (phase === 'racing') lateral *= 0.995; // drift back toward the racing line
    spin += (speed * dt) / CAR.wheels.radius;

    const here = sampleAt(track, s);
    const yaw = Math.atan2(here.tx, here.tz);
    const steer = Math.atan(here.curvature * wheelbase);
    const y = wheelY;
    const state: CarState = {
      p: [here.x + here.nx * lateral, chassisY, here.z + here.nz * lateral],
      q: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
      v: [here.tx * speed, 0, here.tz * speed],
      wh: [steer, spin, y, steer, spin, y, 0, spin, y, 0, spin, y].map((x) => Math.round(x * 1000) / 1000),
      b: target < speed - 1 ? 1 : 0,
    };
    send({ t: 'state', s: state });
  }, dt * 1000);
  ws.on('close', () => clearInterval(ping));
}

console.log(`Starting ${count} bot(s) → ${url}`);
for (let i = 1; i <= count; i++) setTimeout(() => startBot(i), i * 150);
