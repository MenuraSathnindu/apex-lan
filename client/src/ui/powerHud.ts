/** What the power-unit panel shows, gathered from the local car every frame. */
export interface PowerFrame {
  /** Battery 0..1 and how much of this lap's deploy budget is left 0..1. */
  charge: number;
  budget: number;
  deploying: boolean;
  harvesting: boolean;
  /** Wing opening 0..1 and whether the car is inside a straight-mode zone. */
  aeroBlend: number;
  inZone: boolean;
  overtake: boolean;
  /** Gap to the car ahead at the last detection point (s), if any. */
  gap: number | null;
}

/**
 * Power-unit panel above the speedometer: battery %, deploy/harvest state, lap budget,
 * wing mode (CORNER / STRAIGHT) and the OVERTAKE AVAILABLE indicator.
 */
export function createPowerHud(root: HTMLElement) {
  root.innerHTML = `
    <div class="pw-overtake" hidden>OVERTAKE AVAILABLE<span class="pw-gap"></span></div>
    <div class="pw-row">
      <span class="pw-aero" data-mode="corner">CORNER</span>
      <span class="pw-zone" hidden>STRAIGHT ZONE <b class="pw-aero-key"></b></span>
    </div>
    <div class="pw-battery" title="Battery">
      <div class="pw-fill"></div>
      <span class="pw-label"><span class="pw-pct">0</span>%</span>
      <span class="pw-state"></span>
    </div>
    <div class="pw-budget" title="Energy you may still deploy this lap"><div class="pw-budget-fill"></div></div>
    <div class="pw-hint">Boost <b class="pw-boost-key"></b></div>`;
  const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const overtake = $('.pw-overtake');
  const gapEl = $('.pw-gap');
  const aero = $('.pw-aero');
  const zone = $('.pw-zone');
  const battery = $('.pw-battery');
  const fill = $('.pw-fill');
  const pct = $('.pw-pct');
  const state = $('.pw-state');
  const budget = $('.pw-budget-fill');
  const last = { pct: -1, budget: -1, state: '', mode: '', zone: false, overtake: false, gap: '' };

  return {
    setKeys(aeroKey: string, boostKey: string) {
      $('.pw-aero-key').textContent = aeroKey;
      $('.pw-boost-key').textContent = boostKey;
    },

    /** Only touches the DOM when something visible changed. */
    update(f: PowerFrame) {
      const p = Math.round(f.charge * 100);
      if (p !== last.pct) {
        pct.textContent = String(p);
        fill.style.transform = `scaleX(${f.charge})`;
        battery.classList.toggle('low', p < 15);
        last.pct = p;
      }
      const b = Math.round(f.budget * 100);
      if (b !== last.budget) {
        budget.style.transform = `scaleX(${f.budget})`;
        last.budget = b;
      }
      const s = f.deploying ? 'deploy' : f.harvesting ? 'harvest' : '';
      if (s !== last.state) {
        battery.dataset.state = s;
        state.textContent = f.deploying ? '▲ BOOST' : f.harvesting ? '▼ CHARGE' : '';
        last.state = s;
      }
      const mode = f.aeroBlend > 0.5 ? 'straight' : 'corner';
      if (mode !== last.mode) {
        aero.dataset.mode = mode;
        aero.textContent = mode === 'straight' ? 'STRAIGHT' : 'CORNER';
        last.mode = mode;
      }
      // Prompt only while the wings could open but are closed.
      const showZone = f.inZone && mode === 'corner';
      if (showZone !== last.zone) {
        zone.hidden = !showZone;
        last.zone = showZone;
      }
      if (f.overtake !== last.overtake) {
        overtake.hidden = !f.overtake;
        last.overtake = f.overtake;
      }
      const gap = f.overtake && f.gap !== null ? ` +${f.gap.toFixed(2)}s` : '';
      if (gap !== last.gap) {
        gapEl.textContent = gap;
        last.gap = gap;
      }
    },
  };
}
