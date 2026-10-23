import * as THREE from 'three';
import {
  APEX_PARK,
  TRACKS,
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
  fitTyres,
  lapBudgetLeft,
  lightsStartAt,
  nearestSample,
  pitZoneAt,
  newErsLap,
  packCarState,
  parseTrackFile,
  readWheelStates,
  refillErs,
  removeTrackColliders,
  resetVehicle,
  stepVehicle,
  trackIndexEntry,
  vehicleSpeed,
  type CarInput,
  type BuiltTrack,
  type CarState,
  type Compound,
  type S2C,
  type TrackIndexEntry,
  type PitZone,
  type WheelState,
} from '@apex/shared';
import { AudioSystem } from './audio/audioSystem.ts';
import { CarVoice } from './audio/carVoice.ts';
import { startLoop } from './core/loop.ts';
import { FrameProfiler } from './core/profiler.ts';
import { LocalCarFx } from './game/localCarFx.ts';
import { RaceController } from './game/raceController.ts';
import { RemoteCars } from './game/remoteCars.ts';
import { AccountClient } from './game/accountClient.ts';
import { Spectator } from './game/spectator.ts';
import { PitStop } from './game/pitStop.ts';
import { Broadcast } from './game/broadcast.ts';
import { createReplayBadge } from './ui/replayBadge.ts';
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
import { createTrackSelect } from './ui/trackSelect.ts';
import { createProfileScreen } from './ui/profileScreen.ts';
import { createChampionshipHub } from './ui/championship/hub.ts';
import { createFinale } from './ui/championship/finale.ts';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const loading = createLoadingScreen($('#loading'));

// --- Session + networking. Connect right away; messages that arrive while assets load
// update the session and are applied once the world exists.
const session = new Session();
// Player profile login, remembered in this browser; presented to the room in `hello`.
const account = new AccountClient();
session.loginToken = () => account.token;
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
const myLivery = () => session.livery;
// Start on the built-in track; the room tells us which one it's on and we switch.
let track: BuiltTrack = buildTrack(APEX_PARK);
world = createWorld();
let trackColliders = addTrackColliders(world, track);
const car = createVehicle(world, track.spawnGrid[0]!);

// --- Graphics + assets (each asset falls back to a procedural version if missing).
const gfx = new Graphics($('#game'));
const quality = new QualityManager();
const [firstTrackView, carFactory, audio] = await Promise.all([
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
let trackView = firstTrackView;
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
  nameTags.setPhotosVisible(s.showPhotos);
});

// --- Tracks: the built-in ones plus everything generated into /tracks (index.json).
let trackList: TrackIndexEntry[] = Object.values(TRACKS).map(trackIndexEntry);
void fetch('/tracks/index.json')
  .then((r) => (r.ok && !(r.headers.get('content-type') ?? '').includes('text/html') ? r.json() : []))
  .then((list: TrackIndexEntry[]) => {
    trackList = [...Object.values(TRACKS).map(trackIndexEntry), ...list];
    lobby.update();
  })
  .catch(() => console.warn('[tracks] no generated tracks (client/public/tracks/index.json) — only the built-in one.'));
const trackSelect = createTrackSelect($('#track-select'), (trackId) => socket.send({ t: 'setTrack', trackId }));
const trackLoading = $('#track-loading');
const finale = createFinale($('#finale'));
const hub = createChampionshipHub($('#championship'), {
  session,
  send: (msg) => socket.send(msg),
  tracks: () => trackList,
  showFinale: (view) => finale.show(view),
});
// Short messages from the server (refused actions).
const noticeEl = $('#notice');
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
const showNotices = () => {
  const text = session.notices.splice(0).at(-1);
  if (!text) return;
  noticeEl.textContent = text;
  noticeEl.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (noticeEl.hidden = true), 4000);
};
const profiles = createProfileScreen($('#profiles'), {
  account,
  me: () => session.account,
  currentLivery: () => session.livery,
  trackName: (id) => {
    const t = trackList.find((e) => e.id === id);
    return t ? `${t.name}, ${t.country}` : id;
  },
  // Tell the room who we are now; it answers with an 'auth' message (handled in applyRoom).
  onLogin: () => socket.send({ t: 'auth', token: account.token }),
  onLogout: () => socket.send({ t: 'auth', token: null }),
});

/** The track the room wants; the one we have may still be loading. */
let wantedTrack = track.def.id;
/** The season as last seen, to spot the moment it finishes (loading an old finished one doesn't replay the finale). */
let lastSeason: { id: number; status: string } | null = null;
async function switchTrack(id: string) {
  wantedTrack = id;
  if (id === track.def.id) return;
  const entry = trackList.find((t) => t.id === id);
  trackLoading.textContent = `Loading ${entry ? `${entry.name}, ${entry.country}` : id}…`;
  trackLoading.hidden = false;
  try {
    const def = TRACKS[id] ?? parseTrackFile(await (await fetch(`/tracks/${encodeURIComponent(id)}.json`)).json());
    if (wantedTrack !== id) return;
    const next = buildTrack(def);
    const view = await TrackView.create(next);
    if (wantedTrack !== id) {
      view.dispose();
      return;
    }
    removeTrackColliders(world!, trackColliders);
    trackColliders = addTrackColliders(world!, next);
    trackView.dispose();
    gfx.scene.add(view.group);
    track = next;
    trackView = view;
    applyQuality();
    hud.setTrack(next);
    raceController.setTrack(next, buildCheckpoints(next));
    effects.clear();
    pending = { kind: 'grid' };
    if (import.meta.env.DEV) Object.assign((window as unknown as { __apex: object }).__apex, { track, trackView });
  } catch (err) {
    console.warn(`[tracks] could not load track ${id}`, err);
  } finally {
    if (wantedTrack === id) trackLoading.hidden = true;
  }
}

// --- Room / race flow.
const lobby = createLobby($('#lobby'), session, {
  onProfile(name, color, livery, tyre) {
    socket.send(session.setProfile(name, color, livery, tyre));
  },
  onStart() {
    socket.send({ t: 'start' });
  },
  onLaps(laps) {
    socket.send({ t: 'setLaps', laps });
  },
  onTyreWear(wear) {
    socket.send({ t: 'setTyreWear', wear });
  },
  onChooseTrack() {
    trackSelect.show(trackList, session.race.trackId);
  },
  onAccount() {
    profiles.showAccount();
  },
  onHallOfFame() {
    profiles.showHallOfFame(session.race.trackId);
  },
  onShowProfile(id) {
    profiles.showProfile(id);
  },
  onChampionship() {
    hub.show();
  },
}, () => trackList);
const raceOverlay = createRaceOverlay(
  $('#race'),
  session,
  clock,
  () => socket.send({ t: 'endRace' }),
  (text) => (text === 'GO!' ? audio.beep(1046, 0.55) : audio.beep(523, 0.2)),
);
/** Where our car starts this session: grid slot, or a pit box in qualifying. */
const gridPose = () => {
  const places = session.race.session.kind === 'qualifying' ? track.pitBoxes : track.spawnGrid;
  return places[session.me?.gridSlot ?? session.me?.slot ?? 0] ?? places[0]!;
};
/** Not in this session (guest, or not entered in the championship): watch instead of drive. */
const spectating = () => session.joined && session.me?.entrant === false && session.race.phase !== 'lobby';
const spectator = new Spectator();
const raceController = new RaceController(track, buildCheckpoints(track), car, session, gridPose);
/** Pit lane state of our car (zone this tick, and the stop under way). */
const pit = { zone: 'none' as PitZone, stop: new PitStop(), hint: -1 };
// TV direction: replays (and, after the race, the podium).
const broadcast = new Broadcast(session, clock, remoteCars, carView, createReplayBadge($('#replay'), () => broadcast.stop()), spectating);
quality.onChange((level) => (broadcast.recording = level !== 'low'));
broadcast.recording = quality.level !== 'low';
/** Whose timing the HUD shows: our car, or the one we're watching (set every frame). */
let focusId = 0;
const raceHud = createRaceHud($('#racehud'), session, clock, raceController, pit, {
  focusId: () => focusId || session.myId,
  sectors: () => track.def.sectors.length || 1,
  car: (id) => (id === session.myId ? { tw: car.tyres.wearScale > 0 ? car.tyres.wear : undefined, pl: pit.zone === 'none' ? 0 : 1 } : remoteCars.latest(id)),
  teamColour: (id) => {
    const champ = session.champ;
    const profileId = session.players.find((p) => p.id === id)?.profileId;
    if (!champ || !session.race.session.round || !profileId) return null;
    const teamId = champ.entries.find((e) => e.profile.id === profileId)?.teamId;
    return champ.teams.find((t) => t.id === teamId)?.primary ?? null;
  },
});
const results = createResults(
  $('#results'),
  session,
  () => socket.send({ t: 'endRace' }),
  () => hub.show('drivers'),
);

/** Race we're currently driving in (0 = none yet). Lets a quick reconnect keep our car where it is. */
let localRaceId = 0;
let pending: { kind: 'grid' } | { kind: 'resume'; s: CarState } | null = null;

const placeOnGrid = () => {
  resetVehicle(car, gridPose());
  refillErs(car.ers, car.spec);
  fitTyres(car.tyres, car.spec, session.tyre, session.race.tyreWear);
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
      broadcast.reset();
    }
    if (msg.race.phase === 'lobby') pending = { kind: 'grid' };
    localRaceId = msg.race.raceId;
  }
  if (session.me) carView.setLivery(myLivery());
  // In the lobby the car shows the compound you picked; during a race, the set you started on.
  if (session.race.phase === 'lobby') car.tyres.compound = session.tyre;
  carView.setTyreColor(CAR.tyres.compounds[car.tyres.compound].color);
  if (msg.t === 'auth') {
    // A token the host no longer knows (e.g. its database was reset): forget it.
    if (!msg.ok && account.token && msg.reason?.startsWith('unknown')) account.forget();
    profiles.refresh();
  }
  if (msg.t === 'notice') showNotices();
  // The last race of a season just finished (same season, now finished): celebrate, for everyone.
  if (msg.t === 'champ') {
    const v = msg.view;
    if (v && v.status === 'finished' && lastSeason?.id === v.id && lastSeason.status !== 'finished') finale.show(v);
    lastSeason = v ? { id: v.id, status: v.status } : null;
  }
  if (msg.t === 'champ' || msg.t === 'champList' || msg.t === 'roster') hub.refresh();
  if (msg.t === 'roster' && session.account && session.me?.profileId === session.account.id) {
    // Tag / photo / livery edits come back through the roster: keep our account in step.
    const me = session.me;
    const next = { ...session.account, tag: me.tag, photo: me.photo, livery: me.livery };
    if (JSON.stringify(next) !== JSON.stringify(session.account)) {
      session.account = next;
      profiles.refresh();
    }
  }
  remoteCars.syncRoster(session.players, session.myId);
  if (session.race.trackId !== wantedTrack) void switchTrack(session.race.trackId);
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
const ownCarPose = { pos: renderPos, quat: renderQuat };
const hudPower = { charge: 0, budget: 0, deploying: false, harvesting: false, aeroBlend: 0, inZone: false, overtake: false, gap: null as number | null, compound: 'medium' as Compound, wear: 0, wearOn: true };
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
    // Start lights (races): from the first light you can drive — so you can jump the start. Off
    // the throttle the car is held (brake at a standstill would select reverse).
    const lightsOn = phase === 'countdown' && session.race.session.kind !== 'qualifying' && clock.now() >= lightsStartAt(startsAt, session.race.raceId);
    lastInput = racing || phase === 'results' ? sampled : lightsOn ? (sampled.throttle > 0 ? { ...sampled, reset: false } : HOLD) : HOLD;
    // Pit lane: limiter while in the lane; a stop in the box holds the car while tyres go on.
    if (!spectating()) {
      const p = car.body.translation();
      pit.hint = nearestSample(track, p.x, p.z, pit.hint);
      pit.zone = pitZoneAt(track, pit.hint, p.x, p.z);
      car.speedLimit = pit.zone === 'none' ? Infinity : CAR.pit.speedLimit;
      const fitted = pit.stop.step(pit.zone, vehicleSpeed(car), phase === 'racing', sampled.steer, car.tyres.compound, FIXED_DT);
      if (fitted) {
        fitTyres(car.tyres, car.spec, fitted, session.race.tyreWear);
        carView.setTyreColor(CAR.tyres.compounds[fitted].color);
        socket.send({ t: 'pitStop', tyre: fitted });
      }
      if (pit.stop.holding) lastInput = HOLD;
    }
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
    // Spectators have no car: it's taken out of the world and sends nothing.
    const watching = spectating();
    if (car.body.isEnabled() === watching) car.body.setEnabled(!watching);
    carView.root.visible = !watching;
    if (!watching) {
      raceController.locate();
      stepVehicle(car, lastInput, FIXED_DT);
    }
    remoteCars.stepPhysics();
    world!.step();
    if (!watching) {
      if (racing) raceController.step(FIXED_DT);
      localFx.step(car, lastInput, FIXED_DT);
      effects.localTick(localFx, car, FIXED_DT);
    }
    capturePose();

    if (session.joined && !watching && ++tick % SEND_EVERY === 0) {
      const braking = (lastInput.brake > 0 && vehicleSpeed(car) > 0.5) || lastInput.handbrake;
      socket.send({ t: 'state', s: packCarState(car, braking, pit.zone !== 'none') });
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
    const watching = spectating();
    const visibleIds = watching ? [...remoteCars.visible()].map((c) => c.id) : [];
    if (input.consumeCameraCycle()) {
      if (watching) spectator.cycle(visibleIds);
      else {
        const mode = cameraRig.cycle();
        settings.update((s) => (s.camera.mode = mode));
      }
    }
    const followed = watching ? [...remoteCars.visible()].find((c) => c.id === spectator.target(visibleIds, session.standings[0]?.id ?? null)) : undefined;
    focusId = followed?.id ?? session.myId;
    if (broadcast.frame(frameDt, watching ? null : ownCarPose, gfx.camera)) {
      // A replay owns the camera and the car models this frame.
    } else if (followed) cameraRig.update(frameDt, followed.pos, followed.quat, followed.speed);
    else cameraRig.update(frameDt, renderPos, renderQuat, speed);
    remoteCars.render(gfx.camera, frameDt);
    for (const rc of remoteCars.visible()) effects.remoteFrame(rc, frameDt);
    audio.updateListener(gfx.camera);
    const gearbox = localFx.drivetrain;
    // Our own speedo / power panel mean nothing while watching someone else.
    $('#hud').classList.toggle('spectating', watching);
    if (watching) voice.silence();
    else voice.update({ rpm: gearbox.rpm, load: gearbox.load, slip: localFx.screechSlip, scrape: localFx.scrape, speed: Math.abs(speed) });
    for (; localFx.upshifts > 0; localFx.upshifts--) voice.pop();
    for (const up of localFx.shifts.splice(0)) voice.shift(up);
    for (const hit of localFx.impacts.splice(0)) {
      audio.impact((hit.dv - FX.impactMinDv) / (FX.impactFullDv - FX.impactMinDv) + 0.15);
      effects.impact(hit, car);
      broadcast.onImpact(hit.dv);
    }
    gfx.environment.follow(renderPos);
    fwdTmp.set(0, 0, 1).applyQuaternion(renderQuat);
    hudMe.x = renderPos.x;
    hudMe.z = renderPos.z;
    hudMe.yaw = Math.atan2(fwdTmp.x, fwdTmp.z);
    hudMe.color = session.me?.color ?? session.profile.color;
    const ers = car.ers;
    hudPower.charge = ers.charge / CAR.ers.capacity;
    hudPower.budget = Math.min(1, lapBudgetLeft(ers, CAR) / CAR.ers.lapDeployLimit);
    hudPower.deploying = ers.deploying > 0;
    hudPower.harvesting = ers.harvesting > 0;
    hudPower.aeroBlend = car.aero.blend;
    hudPower.inZone = car.inAeroZone;
    hudPower.overtake = ers.overtake;
    hudPower.gap = session.lastDetection?.gap ?? null;
    hudPower.compound = car.tyres.compound;
    hudPower.wear = car.tyres.wear;
    hudPower.wearOn = car.tyres.wearScale > 0;
    hud.update({
      dt: frameDt,
      speedMs: speed,
      rpm: gearbox.rpm,
      gear: gearLabel(gearbox.gear),
      camera: cameraRig.mode,
      gamepad: input.gamepadConnected,
      me: hudMe,
      others: remoteCars.visible(),
      power: hudPower,
    });
    lobby.show(session.race.phase === 'lobby' || session.full);
    raceOverlay.update();
    trackView.setStartLights(raceOverlay.lit);
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
