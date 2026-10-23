import { RACE } from '../tuning.ts';

/**
 * Spots jump starts from reported positions. Each car's reference is its first reported position
 * once the first light is on (by then every client has put its car on the grid); moving more than
 * RACE.jumpStartDistance from it before lights out is a jump start, reported once per car.
 */
export class JumpStartJudge {
  private readonly refs = new Map<number, { x: number; z: number } | null>();
  private readonly judged = new Set<number>();

  constructor(
    private readonly lightsAt: number,
    private readonly startsAt: number,
    ids: readonly number[],
  ) {
    for (const id of ids) this.refs.set(id, null);
  }

  /** Feed a reported position (server receive time). True exactly once, when this car jumps the start. */
  onState(id: number, x: number, z: number, ts: number): boolean {
    if (!this.refs.has(id) || this.judged.has(id) || ts < this.lightsAt || ts >= this.startsAt) return false;
    const ref = this.refs.get(id);
    if (!ref) {
      this.refs.set(id, { x, z });
      return false;
    }
    if (Math.hypot(x - ref.x, z - ref.z) <= RACE.jumpStartDistance) return false;
    this.judged.add(id);
    return true;
  }
}
