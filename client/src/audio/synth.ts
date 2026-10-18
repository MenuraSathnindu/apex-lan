/**
 * Procedural placeholder sounds, rendered once into AudioBuffers at startup (~100 ms).
 * Real recordings in client/public/sounds/ replace them (see AUDIO.files in tuning.ts).
 */

/** Small seeded PRNG so every client generates identical sounds. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** RBJ band-pass biquad, applied in place. */
function bandpass(data: Float32Array, sr: number, freq: number, q: number): Float32Array {
  const out = new Float32Array(data.length);
  const w0 = (2 * Math.PI * freq) / sr;
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const b2 = -alpha / a0;
  const a1 = (-2 * Math.cos(w0)) / a0;
  const a2 = (1 - alpha) / a0;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i]!;
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y;
    [x2, x1, y2, y1] = [x1, x, y1, y];
  }
  return out;
}

function onePoleLowpass(data: Float32Array, sr: number, cutoff: number) {
  const k = 1 - Math.exp((-2 * Math.PI * cutoff) / sr);
  let y = 0;
  for (let i = 0; i < data.length; i++) data[i] = y += (data[i]! - y) * k;
}

function removeDc(data: Float32Array) {
  let mean = 0;
  for (const v of data) mean += v;
  mean /= data.length;
  for (let i = 0; i < data.length; i++) data[i]! -= mean;
}

function normalize(data: Float32Array, peak = 0.9) {
  let max = 0;
  for (const v of data) max = Math.max(max, Math.abs(v));
  if (max > 0) for (let i = 0; i < data.length; i++) data[i]! *= peak / max;
}

/** Crossfades the tail into the head so the buffer loops without a click. Returns the shortened data. */
function makeLoop(data: Float32Array, fade: number): Float32Array {
  const n = data.length - fade;
  const out = data.slice(0, n);
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    out[i] = data[i]! * t + data[n + i]! * (1 - t);
  }
  return out;
}

function toBuffer(ctx: BaseAudioContext, data: Float32Array): AudioBuffer {
  const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
  buf.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
  return buf;
}

/**
 * V8 engine loop at `baseRpm`, on load. Built from individual exhaust pulses (8 per
 * 720° of crank, slightly uneven like a cross-plane V8), so playing it faster raises
 * the firing frequency the way a real engine does. Loops seamlessly: pulses wrap around.
 */
export function engineBuffer(ctx: BaseAudioContext, baseRpm: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const rand = rng(7);
  const cycleSec = 120 / baseRpm;
  const cycles = 8;
  const len = Math.round(cycleSec * cycles * sr);
  const data = new Float32Array(len);
  const amp = [1, 0.78, 0.93, 0.7, 0.97, 0.74, 0.88, 0.82];
  const at = [0, 0.118, 0.25, 0.372, 0.5, 0.614, 0.75, 0.866];
  const firing = cycleSec / 8;
  const tau = firing * 0.32;
  const resonance = 190; // exhaust "body" (Hz at base rpm)
  const pulseLen = Math.round(firing * 1.6 * sr);
  for (let c = 0; c < cycles; c++) {
    for (let k = 0; k < 8; k++) {
      const start = Math.round((c + at[k]! + (rand() - 0.5) * 0.01) * cycleSec * sr);
      const a = amp[k]! * (0.88 + rand() * 0.24);
      const phase = rand() * Math.PI * 2;
      for (let i = 0; i < pulseLen; i++) {
        const t = i / sr;
        const env = Math.exp(-t / tau) * (1 - Math.exp(-t / (tau * 0.06)));
        const tone = Math.sin(2 * Math.PI * resonance * t + phase) * 0.7 + Math.sin(2 * Math.PI * resonance * 2.07 * t) * 0.22;
        const s = env * a * (tone + (rand() * 2 - 1) * 0.45);
        data[(start + i) % len]! += s;
      }
    }
  }
  // Crank-rate rumble underneath.
  for (let i = 0; i < len; i++) data[i]! += Math.sin((2 * Math.PI * i * cycles) / len) * 0.12 + Math.sin((4 * Math.PI * i * cycles) / len) * 0.1;
  onePoleLowpass(data, sr, 2600);
  removeDc(data);
  normalize(data);
  return toBuffer(ctx, data);
}

/** Tyre screech: noise through narrow resonances with a flutter. */
export function screechBuffer(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const rand = rng(11);
  const fade = Math.round(0.15 * sr);
  const len = Math.round(1.6 * sr) + fade;
  const noise = new Float32Array(len);
  for (let i = 0; i < len; i++) noise[i] = rand() * 2 - 1;
  const a = bandpass(noise, sr, 1050, 14);
  const b = bandpass(noise, sr, 1620, 11);
  const c = bandpass(noise, sr, 2480, 8);
  const data = new Float32Array(len);
  let flutter = 1;
  let target = 1;
  for (let i = 0; i < len; i++) {
    if (i % 1400 === 0) target = 0.6 + rand() * 0.5;
    flutter += (target - flutter) * 0.002;
    data[i] = (a[i]! * 1.0 + b[i]! * 0.8 + c[i]! * 0.45) * flutter;
  }
  normalize(data);
  return toBuffer(ctx, makeLoop(data, fade));
}

/** Grinding metal for scraping along a barrier. */
export function scrapeBuffer(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const rand = rng(23);
  const fade = Math.round(0.1 * sr);
  const len = Math.round(1.2 * sr) + fade;
  const noise = new Float32Array(len);
  for (let i = 0; i < len; i++) noise[i] = rand() * 2 - 1;
  const hi = bandpass(noise, sr, 3200, 1.6);
  const mid = bandpass(noise, sr, 720, 4);
  const data = new Float32Array(len);
  let grind = 0.5;
  for (let i = 0; i < len; i++) {
    if (i % 700 === 0) grind = 0.25 + rand() * 0.75;
    data[i] = (hi[i]! * 0.8 + mid[i]! * 0.6) * grind;
  }
  normalize(data, 0.8);
  return toBuffer(ctx, makeLoop(data, fade));
}

/** Looping white noise; filtered in real time (wind). */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const rand = rng(31);
  const data = new Float32Array(Math.round(2 * ctx.sampleRate));
  for (let i = 0; i < data.length; i++) data[i] = rand() * 2 - 1;
  return toBuffer(ctx, data);
}

/** A collision thud: low body thump + crunch noise + a few metallic partials. */
export function impactBuffer(ctx: BaseAudioContext, seed: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const rand = rng(100 + seed);
  const len = Math.round(0.7 * sr);
  const data = new Float32Array(len);
  const partials = [380 + rand() * 80, 1040 + rand() * 150, 2150 + rand() * 200, 3300 + rand() * 300];
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const f = 45 + 70 * Math.exp(-t / 0.05);
    phase += (2 * Math.PI * f) / sr;
    let s = Math.sin(phase) * Math.exp(-t / 0.13) * 1.0;
    s += (rand() * 2 - 1) * Math.exp(-t / 0.035) * 0.8;
    for (let k = 0; k < partials.length; k++) s += Math.sin(2 * Math.PI * partials[k]! * t) * Math.exp(-t / (0.22 - k * 0.04)) * 0.12;
    data[i] = s;
  }
  onePoleLowpass(data, sr, 5000);
  normalize(data);
  return toBuffer(ctx, data);
}

/** Exhaust pop on upshifts. */
export function popBuffer(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const rand = rng(41);
  const len = Math.round(0.09 * sr);
  const noise = new Float32Array(len);
  for (let i = 0; i < len; i++) noise[i] = (rand() * 2 - 1) * Math.exp(-i / sr / 0.012);
  const data = bandpass(noise, sr, 850, 1.2);
  normalize(data);
  return toBuffer(ctx, data);
}
