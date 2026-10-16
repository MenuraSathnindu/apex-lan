import * as THREE from 'three';
import {
  APEX_PARK,
  ASSETS,
  CAR,
  CAR_MODEL,
  FIXED_DT,
  addTrackColliders,
  buildTrack,
  createVehicle,
  createWorld,
  initRapier,
  readWheelStates,
  stepVehicle,
  vehicleSpeed,
  type CarInput,
  type WheelState,
} from '@apex/shared';
import { startLoop } from './core/loop.ts';
import { createInputController } from './input/inputController.ts';
import { connect } from './net/socket.ts';
import { createBoxCarModel } from './render/boxCarModel.ts';
import { CameraRig } from './render/cameraRig.ts';
import { CarView, type CarModel } from './render/carView.ts';
import { loadGltfCarModel } from './render/gltfCarModel.ts';
import { Graphics } from './render/graphics.ts';
import { QualityManager } from './render/quality.ts';
import { TrackView } from './render/trackView.ts';
import { createHud } from './ui/hud.ts';
import { createLoadingScreen } from './ui/loading.ts';
import { createNetStatus, type ConnState } from './ui/netStatus.ts';
import { createSettings } from './ui/settings.ts';

const loading = createLoadingScreen(document.querySelector<HTMLElement>('#loading')!);

// --- Networking status (gameplay is still local until phase 3).
const status = createNetStatus(document.querySelector<HTMLElement>('#net-status')!);
let connState: ConnState = 'connecting';
let playerCount = 0;
let rttMs: number | null = null;
const refreshStatus = () => status.update(connState, playerCount, rttMs);
connect({
  onOpen() {
    connState = 'connected';
    refreshStatus();
  },
  onClose() {
    connState = 'disconnected';
    rttMs = null;
    refreshStatus();
  },
  onMessage(msg) {
    switch (msg.t) {
      case 'welcome':
        playerCount = msg.playerCount;
        break;
      case 'playerCount':
        playerCount = msg.count;
        break;
      case 'pong':
        rttMs = performance.now() - msg.clientTime;
        break;
      case 'full':
        console.warn('server is full');
        break;
    }
    refreshStatus();
  },
});

// --- Physics.
await initRapier();
const track = buildTrack(APEX_PARK);
const world = createWorld();
addTrackColliders(world, track);
const car = createVehicle(world, track.spawnGrid[0]!);

// --- Graphics + assets (each asset falls back to a procedural version if missing).
const gfx = new Graphics(document.querySelector<HTMLCanvasElement>('#game')!);
const quality = new QualityManager();
const [trackView, carModel] = await Promise.all([
  TrackView.create(track),
  loadGltfCarModel(ASSETS.car, CAR, CAR_MODEL.paint.color).catch((err: unknown): CarModel => {
    console.warn(`[assets] Car model not loaded from /${ASSETS.car} — using the placeholder box car. See docs/ASSETS.md.`, err);
    return createBoxCarModel(CAR, CAR_MODEL.paint.color);
  }),
  gfx.environment.load(),
]);
gfx.scene.add(trackView.group);
const carView = new CarView(carModel);
gfx.scene.add(carView.root);

const applyQuality = () => {
  gfx.applyQuality(quality.level, quality.settings);
  trackView.applyQuality(quality.settings);
  carView.setGlassTransmission(quality.settings.glassTransmission);
};
quality.onChange(applyQuality);
applyQuality();

const cameraRig = new CameraRig(gfx.camera);
const hud = createHud(document.querySelector<HTMLElement>('#hud')!);
createSettings(document.querySelector<HTMLElement>('#settings')!, quality);
const input = createInputController();

// Chassis pose at the previous and current tick; frames render in between.
const prevPos = new THREE.Vector3();
const currPos = new THREE.Vector3();
const prevQuat = new THREE.Quaternion();
const currQuat = new THREE.Quaternion();
const renderPos = new THREE.Vector3();
const renderQuat = new THREE.Quaternion();
const wheels: WheelState[] = [];
let lastInput: CarInput | null = null;

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
  // Debug handle for poking at the scene from the browser console.
  Object.assign(window, { __apex: { gfx, car, track, quality, cameraRig, carView, trackView } });
}

startLoop({
  step() {
    prevPos.copy(currPos);
    prevQuat.copy(currQuat);
    lastInput = input.sample();
    stepVehicle(car, lastInput, FIXED_DT);
    world.step();
    capturePose();
  },
  render(alpha, frameDt) {
    renderPos.lerpVectors(prevPos, currPos, alpha);
    renderQuat.slerpQuaternions(prevQuat, currQuat, alpha);
    readWheelStates(car, wheels);
    carView.update(renderPos, renderQuat, wheels);

    const speed = vehicleSpeed(car);
    carView.setBraking(!!lastInput && ((lastInput.brake > 0 && speed > 0.5) || lastInput.handbrake));

    if (input.consumeCameraCycle()) cameraRig.cycle();
    cameraRig.update(frameDt, renderPos, renderQuat, speed);
    gfx.environment.follow(renderPos);
    hud.update(speed, cameraRig.mode, input.gamepadConnected);
    quality.frame(frameDt);
    gfx.render(frameDt);
  },
});
