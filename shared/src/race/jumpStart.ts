import { RACE } from '../tuning.ts';

interface Point {
  x: number;
  z: number;
}

/**
 * Spots jump starts from reported positions, between the first light and lights out.
 * - A car is judged only once it has reported a position on its own grid slot (a client still
 *   loading the track reports from elsewhere); that position is its reference.
 * - Moving more than RACE.jumpStartDistance from it is a jump start, reported once per car.
 * - A car pushed by a jump-starter (one already judged, within RACE.jumpStartContact) is not to
 *   blame: its reference moves with it.
 */
export class JumpStartJudge {
  private readonly refs = new Map<number, Point>();
  private readonly last = new Map<number, Point>();
  private readonly judged = new Set<number>();

  constructor(
    private readonly lightsAt: number,
    private readonly startsAt: number,
    /** Each entrant's grid slot. */
    private readonly slots: ReadonlyMap<number, Point>,
  ) {}

  /** Feed a reported position (server receive time). True exactly once, when this car jumps the start. */
  onState(id: number, x: number, z: number, ts: number): boolean {
    const slot = this.slots.get(id);
    if (!slot) return false;
    this.last.set(id, { x, z });
    if (this.judged.has(id) || ts < this.lightsAt || ts >= this.startsAt) return false;
    const ref = this.refs.get(id);
    if (!ref) {
      if (Math.hypot(x - slot.x, z - slot.z) <= RACE.jumpStartSlotRadius) this.refs.set(id, { x, z });
      return false;
    }
    if (Math.hypot(x - ref.x, z - ref.z) <= RACE.jumpStartDistance) return false;
    for (const other of this.judged) {
      const p = this.last.get(other);
      if (p && Math.hypot(x - p.x, z - p.z) <= RACE.jumpStartContact) {
        this.refs.set(id, { x, z });
        return false;
      }
    }
    this.judged.add(id);
    return true;
  }
}
