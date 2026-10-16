import * as THREE from 'three';
import {
  CAR,
  addStaticBoxes,
  createTestGround,
  createVehicle,
  createWorld,
  initRapier,
  readWheelStates,
  stepVehicle,
  vehicleSpeed,
  FIXED_DT,
  type WheelState,
} from '@apex/shared';
import { startLoop } from './core/loop.ts';
import { createInputController } from './input/inputController.ts';
import { connect } from './net/socket.ts';
import { createBoxCarModel } from './render/boxCarModel.ts';
import { CameraRig } from './render/cameraRig.ts';
import { CarView } from './render/carView.ts';
import { createScene } from './render/scene.ts';
import { createHud } from './ui/hud.ts';
import { createNetStatus, type ConnState } from './ui/netStatus.ts';

const SPAWN = { position: { x: 0, y: 1.2, z: 0 }, yaw: 0 };

// --- Networking status (gameplay is still local in phase 1).
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
const world = createWorld();
const boxes = createTestGround();
addStaticBoxes(world, boxes);
const car = createVehicle(world, SPAWN);

// --- Rendering.
const view = createScene(document.querySelector<HTMLCanvasElement>('#game')!, boxes);
const carView = new CarView(createBoxCarModel(CAR, 0xd7263d));
view.scene.add(carView.root);
const cameraRig = new CameraRig(view.camera);
const hud = createHud(document.querySelector<HTMLElement>('#hud')!);
const input = createInputController();

// Chassis pose at the previous and current tick; frames render in between.
const prevPos = new THREE.Vector3();
const currPos = new THREE.Vector3();
const prevQuat = new THREE.Quaternion();
const currQuat = new THREE.Quaternion();
const renderPos = new THREE.Vector3();
const renderQuat = new THREE.Quaternion();
const wheels: WheelState[] = [];

const capturePose = () => {
  const t = car.body.translation();
  const r = car.body.rotation();
  currPos.set(t.x, t.y, t.z);
  currQuat.set(r.x, r.y, r.z, r.w);
};
capturePose();
prevPos.copy(currPos);
prevQuat.copy(currQuat);

startLoop({
  step() {
    prevPos.copy(currPos);
    prevQuat.copy(currQuat);
    stepVehicle(car, input.sample(), FIXED_DT);
    world.step();
    capturePose();
  },
  render(alpha, frameDt) {
    renderPos.lerpVectors(prevPos, currPos, alpha);
    renderQuat.slerpQuaternions(prevQuat, currQuat, alpha);
    readWheelStates(car, wheels);
    carView.update(renderPos, renderQuat, wheels);

    if (input.consumeCameraCycle()) cameraRig.cycle();
    const speed = vehicleSpeed(car);
    cameraRig.update(frameDt, renderPos, renderQuat, speed);
    view.focusShadows(renderPos);
    hud.update(speed, cameraRig.mode, input.gamepadConnected);
    view.render();
  },
});
