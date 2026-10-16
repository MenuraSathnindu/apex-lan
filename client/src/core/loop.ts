import { FIXED_DT } from '@apex/shared';

/** Max physics steps per frame; beyond this we drop time rather than spiral. */
const MAX_STEPS_PER_FRAME = 5;
/** Ignore frame gaps longer than this (tab was hidden, debugger pause...). */
const MAX_FRAME_TIME = 0.25;

export interface LoopHandlers {
  /** One fixed physics tick of FIXED_DT seconds. */
  step(): void;
  /** Render a frame. `alpha` ∈ [0,1) is how far we are between the last two ticks. */
  render(alpha: number, frameDt: number): void;
}

/** Fixed-timestep physics decoupled from requestAnimationFrame rendering. */
export function startLoop(handlers: LoopHandlers): void {
  let accumulator = 0;
  let last = performance.now();

  const frame = (now: number) => {
    const frameDt = Math.min((now - last) / 1000, MAX_FRAME_TIME);
    last = now;
    accumulator += frameDt;

    let steps = 0;
    while (accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      handlers.step();
      accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;

    handlers.render(accumulator / FIXED_DT, frameDt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
