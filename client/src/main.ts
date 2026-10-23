import * as THREE from 'three';
import {
  APEX_PARK,
  ASSETS,
  CAR,
  FX,
  FIXED_DT,
  NEUTRAL_INPUT,
  STATE_SEND_RATE,
  TICK_RATE,
  addTrackColliders,
  buildCheckpoints,
  buildTrack,
  createVehicle,
  createWorld,
  gearLabel,
  initRapier,
  newErsLap,
  packCarState,
  presetLivery,
  readWheelStates,
  refillErs,
  resetVehicle,
  stepVehicle,
  vehicleSpeed,
  type CarInput,
  type CarState,
  type S2C,
  type WheelState,
} from '@apex/shared';
import { AudioSystem } from './audio/audioSystem.ts';
import { CarVoice } from './audio/carVoice.ts';
import { startLoop } from './core/loop.ts';
import { FrameProfiler } from './core/profiler.ts';
import { LocalCarFx } from './game/localCarFx.ts';
import { RaceController } from './game/raceController.ts';
import { RemoteCars } from './game/remoteCars.ts';
import { Session } from './game/session.ts';
import { SettingsStore } from './game/userSettings.ts';
import { createInputController } from './input/inputController.ts';
import { ServerClock } from './net/clock.ts';
import { connect } from './net/socket.ts';
import { CameraRig } from './render/cameraRig.ts';
import { CarView } from './render/carView.ts';
import { Effects } from './render/effects/effects.ts';
import { loadGltfCarFactory, type CarFactory } from './render/gltfCarModel.ts';
import { openWheelCarFactory } from './render/openWheelCarModel.ts';
import { Graphics } from './render/graphics.ts';
import { QualityManager } from './render/quality.ts';
import { TrackView } from './render/trackView.ts';
import { createHud } from './ui/hud.ts';
import { createLoadingScreen } from './ui/loading.ts';
import { createLobby } from './ui/lobby.ts';
import { NameTags } from './ui/nameTags.ts';
import { createNetStatus } from './ui/netStatus.ts';
import { createRaceHud } from './ui/raceHud.ts';
import { createRaceOverlay } from './ui/raceOverlay.ts';
import { createResults } from './ui/results.ts';
import { createFpsCounter } from './ui/fpsCounter.ts';
import { createMenu } from './ui/menu.ts';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const loading = createLoadingScreen($('#loading'));

// --- Session + networking. Connect right away; messages that arrive while assets load
// update the session and are applied once the world exists.
const session = new Session();
const clock = new ServerClock();
const status = createNetStatus($('#net-status'));
let world: ReturnType<typeof createWorld> | null = null;
// Room messages that arrive before the world exists are queued and replayed after loading.
const queued: [S2C, number][] = [];
let onRoomChange: (msg: S2C, prevRaceId: number) => void = (msg, prev) => queued.push([msg, prev]);
let onSnapshot: (msg: Extract<S2C, { t: 'snapshot' }>) => void = () => {};

const refreshStatus = () =>
  status.update(session.connected ? 'connected' : 'disconnected', session.players.filter((p) => p.connected).length, clock.rttMs);

const socket = connect({
  onOpen() {
    session.connected = true;
    clock.reset();
    socket.send(session.hello());
    refreshStatus();
  },
  onClose() {
    session.onDisconnect();
    refreshStatus();
  },
  onMessage(msg) {
    if (msg.t === 'pong') {
      clock.onPong(msg.clientTime, msg.serverTime);
      refreshStatus();
      return;
    }
    if (msg.t === 'snapshot') {
      onSnapshot(msg);
      return;
    }
    const prevRaceId = session.race.raceId;
    if (session.handle(msg)) {
      onRoomChange(msg, prevRaceId);
      refreshStatus();
    }
  },
});

// --- Physics.
await initRapier();
/** Our paint scheme: the server's copy once we have joined, else what we last chose. */
function myLivery() {
  return presetLivery(session.me?.color ?? session.profile.color);
}
const track = buildTrack(APEX_PARK);
world = createWorld();
addTrackColliders(world, track);
const car = createVehicle(world, track.spawnGrid[0]!);

// --- Graphics + assets (each asset falls back to a procedural version if missing).
const gfx = new Graphics($('#game'));
const quality = new QualityManager();
const [trackView, carFactory, audio] = await Promise.all([
  TrackView.create(track),
  loadGltfCarFactory(ASSETS.car, CAR, myLivery()).catch((err: unknown): CarFactory => {
    console.warn(`[assets] Car model not loaded from /${ASSETS.car} — using the built-in open-wheel car. See docs/OPENWHEEL_MODEL.md.`, err);
    return openWheelCarFactory(CAR);
  }),
  AudioSystem.create(),
  gfx.environment.load(),
]);
const voice = new CarVoice(audio, false);
const localFx = new LocalCarFx();
gfx.scene.add(trackView.group);
const carView = new CarView(carFactory(myLivery()));
gfx.scene.add(carView.root);
const effects = new Effects(gfx.scene);
const nameTags = new NameTags($('#tags'));
const remoteCars = new RemoteCars(world, gfx.scene, carFactory, nameTags, clock, audio);

const applyQuality = () => {
  gfx.applyQuality(quality.level, quality.settings);
  trackView.applyQuality(quality.settings);
  carView.setGlassTransmission(quality.settings.glassTransmission);
  remoteCars.setGlassTransmission(quality.settings.glassTransmission);
  effects.applyQuality(quality.settings);
};
quality.onChange(applyQuality);
applyQuality();

const cameraRig = new CameraRig(gfx.camera);
const hud = createHud($('#hud'), track);
const input = createInputController();
const profiler = new FrameProfiler(gfx.renderer.getContext() as WebGL2RenderingContext);
const fpsCounter = createFpsCounter(document.body, profiler);
const settings = new SettingsStore();
const menu = createMenu($('#menu'), settings, quality, (open) => input.setEnabled(!open));
settings.subscribe((s) => {
  audio.setVolumes(s.audio);
  input.setBindings(s.bindings);
  input.setAeroAuto(s.aeroAuto);
  hud.setBindings(s.bindings);
  cameraRig.options = s.camera;
  cameraRig.setMode(s.camera.mode);
  fpsCounter.show(s.showFps);
});

// --- Room / race flow.
const lobby = createLobby($('#lobby'), session, {
  onProfile(name, color) {
    socket.send(session.setProfile(name, color));
  },
  onStart() {
    socket.send({ t: 'start' });
  },
  onLaps(laps) {
    socket.send({ t: 'setLaps', laps });
  },
});
const raceOverlay = createRaceOverlay(
  $('#race'),
  session,
  clock,
  () => socket.send({ t: 'endRace' }),
  (text) => (text === 'GO!' ? audio.beep(1046, 0.55) : audio.beep(523, 0.2)),
);
const gridPose = () => track.spawnGrid[session.me?.slot ?? 0] ?? track.spawnGrid[0]!;
const raceController = new RaceController(track, buildCheckpoints(track), car, session, gridPose);
const raceHud = createRaceHud($('#racehud'), session, clock, raceController);
const results = createResults($('#results'), session, () => socket.send({ t: 'endRace' }));

/** Race we're currently driving in (0 = none yet). Lets a quick reconnect keep our car where it is. */
let localRaceId = 0;
let pending: { kind: 'grid' } | { kind: 'resume'; s: CarState } | null = null;

const placeOnGrid = () => {
  resetVehicle(car, gridPose());
  refillErs(car.ers, car.spec);
  raceController.reset();
};

const applyRoom = (msg: S2C, prevRaceId: number) => {
  if (msg.t === 'welcome') {
    const sameRace = msg.race.phase !== 'lobby' && msg.race.raceId === localRaceId;
    if (sameRace) {
      // Brief disconnect mid-race: our local car is the truth, keep driving.
    } else if (msg.resume) pending = { kind: 'resume', s: msg.resume };
    else pending = { kind: 'grid' };
    localRaceId = msg.race.raceId;
  }
  if (msg.t === 'race') {
    if (msg.race.phase === 'countdown' && msg.race.raceId !== prevRaceId) {
      pending = { kind: 'grid' };
      session.lastDetection = null;
      effects.clear();
    }
    if (msg.race.phase === 'lobby') pending = { kind: 'grid' };
    localRaceId = msg.race.raceId;
  }
  if (session.me) carView.setLivery(myLivery());
  remoteCars.syncRoster(session.players, session.myId);
  lobby.update();
};
onRoomChange = applyRoom;
onSnapshot = (msg) => remoteCars.onSnapshot(msg.cars, session.myId);
for (const [msg, prev] of queued.splice(0)) applyRoom(msg, prev);
lobby.update();

// --- Own car: interpolated between physics ticks for rendering.
const prevPos = new THREE.Vector3();
const currPos = new THREE.Vector3();
const prevQuat = new THREE.Quaternion();
const currQuat = new THREE.Quaternion();
const renderPos = new THREE.Vector3();
const renderQuat = new THREE.Quaternion();
const wheels: WheelState[] = [];
const fwdTmp = new THREE.Vector3();
const hudMe = { x: 0, z: 0, yaw: 0, color: 0 };
const HOLD: CarInput = { ...NEUTRAL_INPUT, handbrake: true };
let lastInput: CarInput = HOLD;
let tick = 0;
const SEND_EVERY = Math.max(1, Math.round(TICK_RATE / STATE_SEND_RATE));

const capturePose = () => {
  const t = car.body.translation();
  const r = car.body.rotation();
  currPos.set(t.x, t.y, t.z);
  currQuat.set(r.x, r.y, r.z, r.w);
};
capturePose();
prevPos.copy(currPos);
prevQuat.copy(currQuat);

// Compile all shaders up front so the first frames don't stutter.
await gfx.renderer.compileAsync(gfx.scene, gfx.camera);
loading.hide();

if (import.meta.env.DEV) {
  // Debug handle for poking at the game from the browser console (and automated tests).
  Object.assign(window, { __apex: { gfx, car, track, quality, cameraRig, carView, trackView, session, remoteCars, clock, raceController, audio, localFx, effects, profiler } });
}

startLoop({
  step() {
    profiler.beginStep();
    if (pending) {
      if (pending.kind === 'grid') placeOnGrid();
      else {
        const { p, q, v } = pending.s;
        car.body.setTranslation({ x: p[0], y: p[1] + 0.2, z: p[2] }, true);
        car.body.setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }, true);
        car.body.setLinvel({ x: v[0], y: v[1], z: v[2] }, true);
      }
      pending = null;
    }

    prevPos.copy(currPos);
    prevQuat.copy(currQuat);
    // Input is locked in the lobby and until GO (judged on the server clock, so it unlocks
    // exactly at zero even if the 'racing' message is a few ms late). Results = cool-down lap.
    const { phase, startsAt } = session.race;
    const racing = phase === 'racing' || (phase === 'countdown' && clock.now() >= startsAt);
    const sampled = input.sample();
    lastInput = racing || phase === 'results' ? sampled : HOLD;
    if (racing && lastInput.reset) {
      // During a race, R puts you back at the last checkpoint instead of resetting in place.
      raceController.respawn('manual');
      lastInput = { ...lastInput, reset: false };
    }
    // Overtake detection point: our ERS lap restarts, overtake mode is switched on or off.
    for (const d of session.detections.splice(0)) {
      if (d.id !== session.myId) continue;
      newErsLap(car.ers);
      car.ers.overtake = d.overtake;
      session.lastDetection = d;
    }
    raceController.locate();
    stepVehicle(car, lastInput, FIXED_DT);
    remoteCars.stepPhysics();
    world!.step();
    if (racing) raceController.step(FIXED_DT);
    localFx.step(car, lastInput, FIXED_DT);
    effects.localTick(localFx, car, FIXED_DT);
    capturePose();

    if (session.joined && ++tick % SEND_EVERY === 0) {
      const braking = (lastInput.brake > 0 && vehicleSpeed(car) > 0.5) || lastInput.handbrake;
      socket.send({ t: 'state', s: packCarState(car, braking) });
    }
    profiler.endStep();
  },
  render(alpha, frameDt) {
    renderPos.lerpVectors(prevPos, currPos, alpha);
    renderQuat.slerpQuaternions(prevQuat, currQuat, alpha);
    readWheelStates(car, wheels);
    carView.update(renderPos, renderQuat, wheels);
    carView.setWingOpen(car.aero.blend);

    const speed = vehicleSpeed(car);
    carView.setBraking((lastInput.brake > 0 && speed > 0.5) || (lastInput.handbrake && session.race.phase === 'racing'));

    if (input.consumeMenuToggle()) menu.toggle();
    if (input.consumeCameraCycle()) {
      const mode = cameraRig.cycle();
      settings.update((s) => (s.camera.mode = mode));
    }
    cameraRig.update(frameDt, renderPos, renderQuat, speed);
    remoteCars.render(gfx.camera, frameDt);
    for (const rc of remoteCars.visible()) effects.remoteFrame(rc, frameDt);
    audio.updateListener(gfx.camera);
    const gearbox = localFx.drivetrain;
    voice.update({ rpm: gearbox.rpm, load: gearbox.load, slip: localFx.screechSlip, scrape: localFx.scrape, speed: Math.abs(speed) });
    for (; localFx.upshifts > 0; localFx.upshifts--) voice.pop();
    for (const hit of localFx.impacts.splice(0)) {
      audio.impact((hit.dv - FX.impactMinDv) / (FX.impactFullDv - FX.impactMinDv) + 0.15);
      effects.impact(hit, car);
    }
    gfx.environment.follow(renderPos);
    fwdTmp.set(0, 0, 1).applyQuaternion(renderQuat);
    hudMe.x = renderPos.x;
    hudMe.z = renderPos.z;
    hudMe.yaw = Math.atan2(fwdTmp.x, fwdTmp.z);
    hudMe.color = session.me?.color ?? session.profile.color;
    hud.update({
      dt: frameDt,
      speedMs: speed,
      rpm: gearbox.rpm,
      gear: gearLabel(gearbox.gear),
      camera: cameraRig.mode,
      gamepad: input.gamepadConnected,
      me: hudMe,
      others: remoteCars.visible(),
    });
    lobby.show(session.race.phase === 'lobby' || session.full);
    raceOverlay.update();
    raceHud.update();
    results.update();
    quality.frame(frameDt);
    fpsCounter.frame(frameDt);
    effects.update(frameDt, gfx.camera, gfx.renderer.domElement.height);
    profiler.beginRender();
    gfx.render(frameDt);
    profiler.endRender(frameDt);
  },
});
