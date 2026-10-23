import {
  FX,
  createDrivetrain,
  emptyWheelSlips,
  readChassisContacts,
  readWheelSlip,
  stepDrivetrain,
  vehicleSpeed,
  type CarInput,
  type ContactKind,
  type Vehicle,
} from '@apex/shared';

export interface ImpactEvent {
  kind: ContactKind;
  /** Velocity change of the hit (m/s). */
  dv: number;
  point: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
}

const IMPACT_COOLDOWN = 0.15;
const MAX_QUEUED = 8;

/**
 * Per-physics-tick bookkeeping of our own car for sound and effects: gearbox, tyre slip,
 * barrier scraping and impacts. Reads the simulation, never changes it.
 */
export class LocalCarFx {
  readonly drivetrain = createDrivetrain();
  readonly slips = emptyWheelSlips();
  /** Largest slip of a tyre on asphalt/curb (grass doesn't screech). */
  screechSlip = 0;
  /** Sliding speed along a barrier (m/s), 0 when not touching one. */
  scrape = 0;
  /** Where the scrape is happening, and the wall normal (for sparks). */
  readonly scrapePoint = { x: 0, y: 0, z: 0 };
  readonly scrapeNormal = { x: 0, y: 0, z: 0 };
  /** Impacts since the renderer last drained them. */
  readonly impacts: ImpactEvent[] = [];
  /** Upshifts since last drained (exhaust pops). */
  upshifts = 0;
  /** Gear changes since last drained: true = up, false = down (paddle-shift sounds). */
  readonly shifts: boolean[] = [];

  private cooldown = 0;
  private lastDv = 0;
  private lastGear = 0;

  step(car: Vehicle, input: CarInput, dt: number): void {
    const speed = vehicleSpeed(car);
    const reversing = speed < 0.5 && input.brake > 0 && input.throttle === 0;
    stepDrivetrain(this.drivetrain, speed, reversing ? input.brake : input.throttle, input.brake > 0 && speed > 0.5, dt);
    const gear = this.drivetrain.gear;
    if (this.drivetrain.shifted && gear > this.lastGear && gear > 1 && input.throttle > 0.8) this.upshifts++;
    if (this.drivetrain.shifted && this.shifts.length < MAX_QUEUED) this.shifts.push(gear > this.lastGear);
    this.lastGear = gear;

    readWheelSlip(car, input, this.slips);
    let slip = 0;
    for (const w of this.slips) if (w.inContact && w.surface !== 'grass') slip = Math.max(slip, w.slip);
    this.screechSlip = slip;

    this.cooldown -= dt;
    this.scrape = 0;
    const { count, contacts } = readChassisContacts(car);
    for (let i = 0; i < count; i++) {
      const c = contacts[i]!;
      if (c.kind === 'barrier' && c.slideSpeed > this.scrape) {
        this.scrape = c.slideSpeed;
        Object.assign(this.scrapePoint, c.point);
        Object.assign(this.scrapeNormal, c.normal);
      }
      if (c.dv < FX.impactMinDv) continue;
      // One thud per hit (a crash spans a few ticks), unless a harder one follows.
      if (this.cooldown > 0 && c.dv < this.lastDv * 1.5) continue;
      this.cooldown = IMPACT_COOLDOWN;
      this.lastDv = c.dv;
      if (this.impacts.length < MAX_QUEUED) {
        this.impacts.push({ kind: c.kind, dv: c.dv, point: { ...c.point }, normal: { ...c.normal } });
      }
    }
  }
}
