import * as THREE from 'three';
import { AUDIO } from '@apex/shared';
import { engineBuffer, impactBuffer, noiseBuffer, popBuffer, scrapeBuffer, screechBuffer } from './synth.ts';

export type Bus = 'engine' | 'effects' | 'ui';
export interface Volumes {
  master: number;
  engine: number;
  effects: number;
  ui: number;
  muted: boolean;
}

export interface SoundBank {
  engine: AudioBuffer;
  /** rpm the engine buffer was recorded/generated at. */
  engineRpm: number;
  skid: AudioBuffer;
  scrape: AudioBuffer;
  noise: AudioBuffer;
  impacts: AudioBuffer[];
  pop: AudioBuffer;
}

/** rpm of the procedural engine loop. */
const SYNTH_ENGINE_RPM = 1500;

async function loadFile(ctx: AudioContext, path: string): Promise<AudioBuffer | null> {
  try {
    const res = await fetch(`/${path}`);
    // Vite answers missing public files with index.html, so check the type too.
    if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) return null;
    return await ctx.decodeAudioData(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Owns the AudioContext and the mixer: master (with a limiter) ← engine / effects / ui buses.
 * Browsers only start audio after a user gesture, so the context is resumed on the first
 * key press or click. Suspended while the tab is hidden (the game loop stops there too).
 */
export class AudioSystem {
  readonly ctx: AudioContext;
  readonly bank: SoundBank;
  private readonly master: GainNode;
  private readonly buses: Record<Bus, GainNode>;
  private readonly fwd = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private unlocked = false;

  private constructor(ctx: AudioContext, bank: SoundBank) {
    this.ctx = ctx;
    this.bank = bank;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    limiter.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(limiter);
    const bus = () => {
      const g = ctx.createGain();
      g.connect(this.master);
      return g;
    };
    this.buses = { engine: bus(), effects: bus(), ui: bus() };

    const unlock = () => {
      if (document.visibilityState === 'visible') void ctx.resume();
      this.unlocked = true;
    };
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void ctx.suspend();
      else if (this.unlocked) void ctx.resume();
    });
  }

  static async create(): Promise<AudioSystem> {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    const f = AUDIO.files;
    const [engine, skid, impact, scrape] = await Promise.all([f.engine, f.skid, f.impact, f.scrape].map((p) => loadFile(ctx, p)));
    const found = [engine, skid, impact, scrape].filter(Boolean).length;
    if (found < 4) console.info(`[assets] ${found}/4 sound files in /sounds — using procedural placeholders for the rest. See docs/ASSETS.md.`);
    const bank: SoundBank = {
      engine: engine ?? engineBuffer(ctx, SYNTH_ENGINE_RPM),
      engineRpm: engine ? f.engineFileRpm : SYNTH_ENGINE_RPM,
      skid: skid ?? screechBuffer(ctx),
      scrape: scrape ?? scrapeBuffer(ctx),
      noise: noiseBuffer(ctx),
      impacts: impact ? [impact] : [0, 1, 2].map((i) => impactBuffer(ctx, i)),
      pop: popBuffer(ctx),
    };
    return new AudioSystem(ctx, bank);
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  /** Destination node for a bus. */
  bus(name: Bus): AudioNode {
    return this.buses[name];
  }

  setVolumes(v: Volumes): void {
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(v.muted ? 0 : v.master, t, 0.03);
    this.buses.engine.gain.setTargetAtTime(v.engine, t, 0.03);
    this.buses.effects.gain.setTargetAtTime(v.effects, t, 0.03);
    this.buses.ui.gain.setTargetAtTime(v.ui, t, 0.03);
  }

  /** Smoothly moves an AudioParam (no zipper noise). */
  ramp(param: AudioParam, value: number): void {
    param.setTargetAtTime(value, this.ctx.currentTime, AUDIO.smoothing);
  }

  /** A looping source, started immediately. */
  loop(buffer: AudioBuffer, dest: AudioNode, offset = 0): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(dest);
    src.start(0, offset % buffer.duration);
    return src;
  }

  /** Fire-and-forget one-shot. */
  oneShot(buffer: AudioBuffer, dest: AudioNode, gain: number, rate = 1): void {
    if (this.ctx.state !== 'running') return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(dest);
    src.start();
  }

  /** A positional output for sounds at a point in the world (remote cars, impacts). */
  panner(dest: AudioNode): PannerNode {
    const r = AUDIO.remote;
    const p = this.ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = r.refDistance;
    p.rolloffFactor = r.rolloff;
    p.maxDistance = r.maxDistance;
    p.connect(dest);
    return p;
  }

  setPannerPosition(p: PannerNode, pos: THREE.Vector3): void {
    const t = this.ctx.currentTime;
    if (p.positionX) {
      p.positionX.setTargetAtTime(pos.x, t, 0.02);
      p.positionY.setTargetAtTime(pos.y, t, 0.02);
      p.positionZ.setTargetAtTime(pos.z, t, 0.02);
    } else p.setPosition(pos.x, pos.y, pos.z);
  }

  /** Call every frame with the camera so positional sounds pan correctly. */
  updateListener(camera: THREE.Camera): void {
    const l = this.ctx.listener;
    const p = camera.position;
    this.fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setValueAtTime(p.x, t);
      l.positionY.setValueAtTime(p.y, t);
      l.positionZ.setValueAtTime(p.z, t);
      l.forwardX.setValueAtTime(this.fwd.x, t);
      l.forwardY.setValueAtTime(this.fwd.y, t);
      l.forwardZ.setValueAtTime(this.fwd.z, t);
      l.upX.setValueAtTime(this.up.x, t);
      l.upY.setValueAtTime(this.up.y, t);
      l.upZ.setValueAtTime(this.up.z, t);
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(this.fwd.x, this.fwd.y, this.fwd.z, this.up.x, this.up.y, this.up.z);
    }
  }

  /** Collision thud; `strength` 0..1. Positional if `at` is given. */
  impact(strength: number, at?: THREE.Vector3): void {
    if (strength <= 0 || this.ctx.state !== 'running') return;
    const buf = this.bank.impacts[Math.floor(Math.random() * this.bank.impacts.length)]!;
    let dest: AudioNode = this.buses.effects;
    if (at) {
      const p = this.panner(dest);
      this.setPannerPosition(p, at);
      dest = p;
      setTimeout(() => p.disconnect(), 1500);
    }
    this.oneShot(buf, dest, AUDIO.impact.maxGain * Math.min(1, strength) ** 0.7, 0.85 + Math.random() * 0.3 - strength * 0.15);
  }

  /** Countdown / UI beep. */
  beep(freq: number, duration: number, gain = 0.35): void {
    if (this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.setValueAtTime(gain, t + duration - 0.04);
    g.gain.linearRampToValueAtTime(0, t + duration);
    const lp = this.ctx.createBiquadFilter();
    lp.frequency.value = 2500;
    osc.connect(lp).connect(g).connect(this.buses.ui);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }
}
