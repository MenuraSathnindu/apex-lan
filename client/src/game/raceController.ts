import {
  RACE,
  boundaryAt,
  distanceFromStart,
  inZone,
  nearestSample,
  resetVehicle,
  respawnPose,
  vehicleSpeed,
  type BuiltTrack,
  type Gate,
  type SpawnPose,
  type Vehicle,
} from '@apex/shared';
import type { Session } from './session.ts';

export type RespawnReason = 'manual' | 'stuck' | 'off-track' | 'flipped';

/**
 * Client-side race helpers for our own car: wrong-way detection and respawning at the
 * last checkpoint. Lap counting itself is the server's job (RaceTracker); we use the
 * server's `nextGate` for where to respawn.
 */
export class RaceController {
  wrongWay = false;
  /** Set when we respawn; the HUD shows a short notice. */
  lastRespawn: { reason: RespawnReason; at: number } | null = null;

  private hint = -1;
  private wrongWayTime = 0;
  private stuckTime = 0;
  private offTrackTime = 0;
  private flippedTime = 0;

  constructor(
    private track: BuiltTrack,
    private gates: Gate[],
    private readonly car: Vehicle,
    private readonly session: Session,
    private readonly gridPose: () => SpawnPose,
  ) {}

  /** Switch to another track (between races). */
  setTrack(track: BuiltTrack, gates: Gate[]): void {
    this.track = track;
    this.gates = gates;
    this.hint = -1;
    this.reset();
  }

  reset(): void {
    this.wrongWay = false;
    this.wrongWayTime = this.stuckTime = this.offTrackTime = this.flippedTime = 0;
  }

  /** Where to respawn: just past the last checkpoint we passed (or the grid before the first). */
  respawnPoint(): SpawnPose {
    const st = this.session.myStanding;
    if (!st || (st.laps === 0 && st.nextGate <= 1)) return this.gridPose();
    const n = this.gates.length;
    return respawnPose(this.gates[(st.nextGate - 1 + n) % n]!);
  }

  respawn(reason: RespawnReason): void {
    resetVehicle(this.car, this.respawnPoint());
    this.reset();
    this.lastRespawn = { reason, at: performance.now() };
  }

  /** Distance along the lap from the start line (m), updated by `locate()`. */
  distance = 0;

  /**
   * Finds where the car is on the track and tells the sim whether it is inside a straight-mode
   * zone (wings may open). Call every physics tick, before `stepVehicle`.
   */
  locate(): void {
    const p = this.car.body.translation();
    this.hint = nearestSample(this.track, p.x, p.z, this.hint);
    this.distance = distanceFromStart(this.track, this.hint);
    this.car.inAeroZone = inZone(this.track.def.aeroZones, this.distance);
  }

  /** Call every physics tick while racing. */
  step(dt: number): void {
    const body = this.car.body;
    const p = body.translation();
    const v = body.linvel();
    const q = body.rotation();
    const smp = this.track.samples[this.hint]!;

    // Wrong way: heading against the track direction while moving.
    const fx = 2 * (q.x * q.z + q.w * q.y);
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const heading = fx * smp.tx + fz * smp.tz;
    const along = v.x * smp.tx + v.z * smp.tz;
    const backwards = (heading < -0.3 && Math.abs(vehicleSpeed(this.car)) > 3) || along < -4;
    this.wrongWayTime = backwards ? this.wrongWayTime + dt : 0;
    this.wrongWay = this.wrongWayTime > RACE.wrongWaySeconds;

    // Stuck on the grass.
    const onGrass = this.car.surfaces.every((s) => s === 'grass' || s === 'gravel');
    const slow = Math.abs(vehicleSpeed(this.car)) < RACE.stuckSpeed;
    this.stuckTime = onGrass && slow ? this.stuckTime + dt : 0;
    if (this.stuckTime > RACE.stuckOnGrassSeconds) return this.respawn('stuck');

    // Escaped the circuit (over a barrier) or fell off the world.
    const dist = Math.hypot(p.x - smp.x, p.z - smp.z);
    this.offTrackTime = dist > boundaryAt(this.track, this.hint) + 2 || p.y < -5 ? this.offTrackTime + dt : 0;
    if (this.offTrackTime > 1) return this.respawn('off-track');

    // On its roof or side.
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    this.flippedTime = upY < 0.3 ? this.flippedTime + dt : 0;
    if (this.flippedTime > RACE.flippedSeconds) return this.respawn('flipped');
  }
}
