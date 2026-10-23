/**
 * Which car a spectator's camera follows: the leader by default, or a car picked with the camera
 * key (cycles through the visible cars). Falls back to the leader if the picked car disappears.
 */
export class Spectator {
  private picked: number | null = null;
  private last: number | null = null;

  /** Follow a specific car (null = the leader). */
  follow(id: number | null): void {
    this.picked = id;
  }

  /** Next visible car after the current one, wrapping. */
  cycle(visible: readonly number[]): void {
    if (!visible.length) return;
    const sorted = [...visible].sort((a, b) => a - b);
    const at = this.last === null ? -1 : sorted.indexOf(this.last);
    this.picked = sorted[(at + 1) % sorted.length]!;
  }

  /** The car to show now. */
  target(visible: readonly number[], leaderId: number | null): number | null {
    let id: number | null = this.picked !== null && visible.includes(this.picked) ? this.picked : null;
    if (id === null) id = leaderId !== null && visible.includes(leaderId) ? leaderId : ([...visible].sort((a, b) => a - b)[0] ?? null);
    this.last = id;
    return id;
  }
}
