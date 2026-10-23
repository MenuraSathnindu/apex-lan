import * as THREE from 'three';
import {
  CAR,
  CAR_COLORS,
  CAR_MODEL,
  INTERP_DELAY_MS,
  REMOTE_STALE_MS,
  RAPIER,
  interactionGroups,
  GROUP,
  createDrivetrain,
  stepDrivetrain,
  surfaceOf,
  wheelConnection,
  WHEEL_RAY_GROUPS,
  type CarSnapshot,
  type PlayerInfo,
  type RigidBody,
  type WheelState,
  type World,
} from '@apex/shared';
import type { AudioSystem } from '../audio/audioSystem.ts';
import { CarVoice } from '../audio/carVoice.ts';
import { emptyPose, SnapshotBuffer, type Pose } from '../net/interpolation.ts';
import type { ServerClock } from '../net/clock.ts';
import type { CarFactory } from '../render/gltfCarModel.ts';
import { CarView } from '../render/carView.ts';
import type { NameTags } from '../ui/nameTags.ts';

/** Remote proxies are solid to our car, but our wheels never ray-cast onto them. */
const PROXY_GROUPS = interactionGroups(GROUP.REMOTE_PROXY, GROUP.CAR);
const TAG_HEIGHT = 1.5;
const tagPos = new THREE.Vector3();
const DETAIL_DIST_SQ = CAR_MODEL.detailDistance ** 2;
const side = new THREE.Vector3();
const fwd = new THREE.Vector3();
const DOWN = { x: 0, y: -1, z: 0 };

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

class RemoteCar {
  readonly buffer = new SnapshotBuffer();
  readonly pose = emptyPose();
  readonly wheels: WheelState[] = [0, 1, 2, 3].map((i) => ({
    position: { ...wheelConnection(CAR, i) },
    steer: 0,
    spin: 0,
    inContact: true,
  }));
  readonly pos = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  /** Livery last applied to the model (JSON), to repaint only on change. */
  livery = '';
  /** Grid colour index (minimap, name tag). */
  color = -1;
  active = false;
  /** Sound + effects state, estimated from the interpolated motion. */
  readonly drivetrain = createDrivetrain();
  voice: CarVoice | null = null;
  speed = 0;
  /** Sideways sliding speed of the body (m/s) — stands in for tyre slip. */
  slip = 0;
  onGrass = false;
  private surfaceTimer = 0;

  constructor(
    readonly id: number,
    readonly view: CarView,
    readonly body: RigidBody,
  ) {}

  /** Derives speed, a throttle guess, gear/rpm and slip from the interpolated pose. */
  updateMotion(world: World, dt: number) {
    const v = this.pose.v;
    fwd.set(0, 0, 1).applyQuaternion(this.quat);
    side.set(1, 0, 0).applyQuaternion(this.quat);
    const speed = v[0] * fwd.x + v[1] * fwd.y + v[2] * fwd.z;
    const accel = dt > 0 ? (speed - this.speed) / dt : 0;
    this.speed = speed;
    const throttle = accel > 0.8 ? 1 : accel > -0.5 && Math.abs(speed) > 1 ? 0.3 : 0;
    const gear = this.drivetrain.gear;
    stepDrivetrain(this.drivetrain, speed, throttle, accel < -4, dt);
    if (this.drivetrain.shifted && gear > 0 && this.drivetrain.gear > 0) this.voice?.shift(this.drivetrain.gear > gear, this.pos);
    this.slip = Math.abs(v[0] * side.x + v[1] * side.y + v[2] * side.z);
    // What's under the car (a few times a second is plenty).
    if ((this.surfaceTimer -= dt) <= 0) {
      this.surfaceTimer = 0.2;
      const hit = world.castRay(new RAPIER.Ray({ x: this.pos.x, y: this.pos.y + 0.5, z: this.pos.z }, DOWN), 3, true, undefined, WHEEL_RAY_GROUPS);
      this.onGrass = !!hit && surfaceOf(world, hit.collider) === 'grass';
    }
  }

  /** Samples the buffer at server time t. False if we have nothing recent. */
  sample(t: number, serverNow: number): boolean {
    if (serverNow - this.buffer.latestTs > REMOTE_STALE_MS) return false;
    return this.buffer.sample(t, this.pose);
  }

  applyPose(p: Pose) {
    this.pos.set(p.p[0], p.p[1], p.p[2]);
    this.quat.set(p.q[0], p.q[1], p.q[2], p.q[3]);
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i]!;
      w.steer = p.wh[i * 3]!;
      w.spin = p.wh[i * 3 + 1]!;
      w.position.y = p.wh[i * 3 + 2]!;
    }
  }
}

/**
 * Other players' cars: interpolated ~100 ms behind real time from relayed snapshots,
 * each backed by a kinematic body in our local physics world so we can bump into it.
 */
export class RemoteCars {
  private readonly cars = new Map<number, RemoteCar>();
  private glassTransmission = false;

  constructor(
    private readonly world: World,
    private readonly scene: THREE.Scene,
    private readonly factory: CarFactory,
    private readonly tags: NameTags,
    private readonly clock: ServerClock,
    private readonly audio: AudioSystem | null = null,
  ) {}

  get count(): number {
    return this.cars.size;
  }

  /** Creates/updates/removes cars to match the roster (everyone except us). */
  syncRoster(players: PlayerInfo[], myId: number): void {
    const keep = new Set<number>();
    for (const p of players) {
      if (p.id === myId) continue;
      keep.add(p.id);
      let car = this.cars.get(p.id);
      if (!car) {
        const view = new CarView(this.factory(p.livery));
        this.scene.add(view.root);
        view.root.visible = false;
        view.setGlassTransmission(this.glassTransmission);
        const h = CAR.chassis.halfExtents;
        const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -100, 0));
        this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(h.x, h.y, h.z).setCollisionGroups(PROXY_GROUPS).setFriction(0.3).setRestitution(0.1),
          body,
        );
        body.setEnabled(false);
        car = new RemoteCar(p.id, view, body);
        if (this.audio) car.voice = new CarVoice(this.audio, true);
        this.cars.set(p.id, car);
      }
      const livery = JSON.stringify(p.livery);
      if (car.livery !== livery) {
        car.view.setLivery(p.livery);
        car.livery = livery;
      }
      car.color = p.color;
      this.tags.set(p.id, p.name, hex(CAR_COLORS[p.color] ?? 0xffffff), p.connected ? '' : 'reconnecting…');
    }
    for (const [id, car] of this.cars) {
      if (keep.has(id)) continue;
      car.view.dispose();
      car.voice?.dispose();
      this.world.removeRigidBody(car.body);
      this.tags.remove(id);
      this.cars.delete(id);
    }
  }

  onSnapshot(cars: CarSnapshot[], myId: number): void {
    for (const c of cars) {
      if (c.id === myId) continue;
      this.cars.get(c.id)?.buffer.push(c.ts, c);
    }
  }

  /** Before each physics step: move the kinematic proxies to their interpolated poses. */
  stepPhysics(): void {
    const now = this.clock.now();
    for (const car of this.cars.values()) {
      const ok = car.sample(now - INTERP_DELAY_MS, now);
      if (ok !== car.active) {
        car.body.setEnabled(ok);
        car.active = ok;
        if (ok) {
          // Teleport, don't sweep, when (re)appearing.
          car.body.setTranslation({ x: car.pose.p[0], y: car.pose.p[1], z: car.pose.p[2] }, true);
          car.body.setRotation({ x: car.pose.q[0], y: car.pose.q[1], z: car.pose.q[2], w: car.pose.q[3] }, true);
        }
      }
      if (!ok) continue;
      car.body.setNextKinematicTranslation({ x: car.pose.p[0], y: car.pose.p[1], z: car.pose.p[2] });
      car.body.setNextKinematicRotation({ x: car.pose.q[0], y: car.pose.q[1], z: car.pose.q[2], w: car.pose.q[3] });
    }
  }

  /** Every frame: place models and name tags at the interpolated pose. */
  render(camera: THREE.PerspectiveCamera, dt: number): void {
    const now = this.clock.now();
    // The camera rig just moved the camera; three only refreshes its matrices inside
    // render(), so do it now or tags are projected with last frame's view (visible lag at speed).
    camera.updateMatrixWorld();
    for (const car of this.cars.values()) {
      const ok = car.sample(now - INTERP_DELAY_MS, now);
      car.view.root.visible = ok;
      if (ok) {
        car.applyPose(car.pose);
        car.view.update(car.pos, car.quat, car.wheels);
        car.view.setDetail(car.pos.distanceToSquared(camera.position) < DETAIL_DIST_SQ);
        car.view.setBraking(car.pose.b === 1);
        car.view.setWingOpen(car.pose.a);
        car.updateMotion(this.world, dt);
        car.voice?.update(
          { rpm: car.drivetrain.rpm, load: car.drivetrain.load, slip: car.onGrass ? 0 : car.slip, scrape: 0, speed: Math.abs(car.speed) },
          car.pos,
        );
      } else car.voice?.silence();
      tagPos.copy(car.pos).y += TAG_HEIGHT;
      this.tags.place(car.id, tagPos, camera, ok);
    }
  }

  /** Visible remote cars (for the minimap and effects). */
  *visible(): IterableIterator<RemoteCar> {
    for (const car of this.cars.values()) if (car.view.root.visible) yield car;
  }

  setGlassTransmission(enabled: boolean): void {
    this.glassTransmission = enabled;
    for (const car of this.cars.values()) car.view.setGlassTransmission(enabled);
  }

  /** Debug info for tests / console. */
  debug() {
    const now = this.clock.now();
    return [...this.cars.values()].map((c) => ({
      id: c.id,
      active: c.active,
      p: [...c.pose.p],
      buffered: c.buffer.size,
      /** How old the newest snapshot is on the server clock (ms). */
      ageMs: Math.round(now - c.buffer.latestTs),
    }));
  }
}
