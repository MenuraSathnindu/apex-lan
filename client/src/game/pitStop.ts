import { CAR, type Compound, type PitZone } from '@apex/shared';

const COMPOUNDS: readonly Compound[] = ['soft', 'medium', 'hard'];

/**
 * Our car's pit stop: stopping in the box zone while racing starts it; the car is held for
 * CAR.pit.stopSeconds while steering left/right picks the compound; then new tyres go on.
 * Another stop needs the car to leave the box first.
 */
export class PitStop {
  state: 'idle' | 'stopping' | 'done' = 'idle';
  choice: Compound = 'medium';
  /** 0..1 through the stop. */
  progress = 0;
  private elapsed = 0;
  private lastSteer = 0;

  get holding(): boolean {
    return this.state === 'stopping';
  }

  /** Call every physics tick. Returns the compound to fit when a stop completes, else null. */
  step(zone: PitZone, speed: number, racing: boolean, steer: number, current: Compound, dt: number): Compound | null {
    const dir = steer > 0.5 ? 1 : steer < -0.5 ? -1 : 0;
    const edge = dir !== this.lastSteer ? dir : 0;
    this.lastSteer = dir;
    if (!racing) {
      this.state = 'idle';
      this.progress = 0;
      return null;
    }
    switch (this.state) {
      case 'idle':
        if (zone === 'box' && Math.abs(speed) < CAR.pit.stopSpeed) {
          this.state = 'stopping';
          this.choice = current;
          this.elapsed = 0;
          this.progress = 0;
        }
        return null;
      case 'stopping': {
        if (edge) {
          const i = Math.max(0, Math.min(COMPOUNDS.length - 1, COMPOUNDS.indexOf(this.choice) + edge));
          this.choice = COMPOUNDS[i]!;
        }
        this.elapsed += dt;
        this.progress = Math.min(1, this.elapsed / CAR.pit.stopSeconds);
        if (this.elapsed < CAR.pit.stopSeconds) return null;
        this.state = 'done';
        return this.choice;
      }
      case 'done':
        if (zone !== 'box') this.state = 'idle';
        return null;
    }
  }
}
