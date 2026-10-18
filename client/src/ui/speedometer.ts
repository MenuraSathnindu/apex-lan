import { DRIVETRAIN, HUD } from '@apex/shared';

const START = Math.PI * 0.75; // 7:30 o'clock
const SWEEP = Math.PI * 1.5;

/**
 * Rev counter dial + digital speed + gear. The dial is a small canvas redrawn only when
 * the needle moves visibly; text only touches the DOM when it changes.
 */
export function createSpeedometer(root: HTMLElement) {
  root.innerHTML = `
    <canvas class="spd-dial"></canvas>
    <div class="spd-centre">
      <div class="spd-gear">N</div>
      <div class="spd-value">0</div>
      <div class="spd-unit">km/h</div>
    </div>`;
  const canvas = root.querySelector<HTMLCanvasElement>('.spd-dial')!;
  const gearEl = root.querySelector<HTMLElement>('.spd-gear')!;
  const valueEl = root.querySelector<HTMLElement>('.spd-value')!;
  const g = canvas.getContext('2d')!;
  let size = 0;
  const last = { rpm: -1, speed: -1, gear: '' };

  const resize = () => {
    const css = canvas.clientWidth || 200;
    size = Math.round(css * Math.min(window.devicePixelRatio, 2));
    canvas.width = canvas.height = size;
    last.rpm = -1;
  };
  window.addEventListener('resize', resize);
  resize();

  const angle = (rpm: number) => START + SWEEP * Math.min(1, Math.max(0, rpm / HUD.tachoMaxRpm));

  const draw = (rpm: number) => {
    const c = size / 2;
    const r = size * 0.44;
    g.clearRect(0, 0, size, size);
    const bg = g.createRadialGradient(c, c, r * 0.2, c, c, r * 1.12);
    bg.addColorStop(0, 'rgba(0,0,0,0.5)');
    bg.addColorStop(1, 'rgba(0,0,0,0.15)');
    g.fillStyle = bg;
    g.beginPath();
    g.arc(c, c, r * 1.12, 0, Math.PI * 2);
    g.fill();
    g.lineCap = 'round';
    // Track + red zone.
    g.lineWidth = size * 0.045;
    g.strokeStyle = 'rgba(255,255,255,0.14)';
    g.beginPath();
    g.arc(c, c, r, START, START + SWEEP);
    g.stroke();
    g.strokeStyle = 'rgba(230,40,60,0.75)';
    g.beginPath();
    g.arc(c, c, r, angle(DRIVETRAIN.redlineRpm - 500), START + SWEEP);
    g.stroke();
    // Fill up to current rpm.
    const hot = rpm > DRIVETRAIN.upshiftRpm - 400;
    g.strokeStyle = hot ? '#ff4d5e' : '#ffffff';
    g.beginPath();
    g.arc(c, c, r, START, angle(rpm));
    g.stroke();
    // Ticks every 1000 rpm + numbers.
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.font = `600 ${Math.round(size * 0.075)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let k = 0; k <= HUD.tachoMaxRpm / 1000; k++) {
      const a = angle(k * 1000);
      const [cos, sin] = [Math.cos(a), Math.sin(a)];
      g.lineWidth = size * 0.012;
      g.strokeStyle = 'rgba(255,255,255,0.6)';
      g.beginPath();
      g.moveTo(c + cos * r * 0.84, c + sin * r * 0.84);
      g.lineTo(c + cos * r * 0.92, c + sin * r * 0.92);
      g.stroke();
      g.fillText(String(k), c + cos * r * 0.72, c + sin * r * 0.72);
    }
    // Needle.
    const a = angle(rpm);
    g.lineWidth = size * 0.02;
    g.strokeStyle = '#ff4d5e';
    g.beginPath();
    g.moveTo(c + Math.cos(a) * r * 0.25, c + Math.sin(a) * r * 0.25);
    g.lineTo(c + Math.cos(a) * r * 1.02, c + Math.sin(a) * r * 1.02);
    g.stroke();
  };

  return {
    update(speedMs: number, rpm: number, gear: string) {
      const speed = Math.round(Math.abs(speedMs) * 3.6);
      if (Math.abs(rpm - last.rpm) > 20) {
        draw(rpm);
        last.rpm = rpm;
      }
      if (speed !== last.speed) valueEl.textContent = String(speed);
      if (gear !== last.gear) {
        gearEl.textContent = gear;
        gearEl.classList.toggle('rev', gear === 'R');
      }
      last.speed = speed;
      last.gear = gear;
    },
  };
}
