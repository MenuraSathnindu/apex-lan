import type * as THREE from 'three';
import { AUDIO, DRIVETRAIN, FX } from '@apex/shared';
import type { AudioSystem } from './audioSystem.ts';

export interface VoiceParams {
  rpm: number;
  /** Effective throttle 0..1 (after shift cuts). */
  load: number;
  /** Largest tyre slip (m/s). */
  slip: number;
  /** Sliding speed along a barrier (m/s), 0 if not scraping. */
  scrape: number;
  /** |speed| m/s, for wind. */
  speed: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * All the looping sounds of one car: engine (pitch = rpm), tyre screech, barrier scrape,
 * and (own car only) wind. Remote cars are positional; your own car plays "in your head".
 */
export class CarVoice {
  private readonly engine: AudioBufferSourceNode;
  private readonly engineFilter: BiquadFilterNode;
  private readonly engineGain: GainNode;
  private readonly skid: AudioBufferSourceNode;
  private readonly skidGain: GainNode;
  private readonly scrape: AudioBufferSourceNode;
  private readonly scrapeGain: GainNode;
  private readonly wind?: { gain: GainNode; filter: BiquadFilterNode };
  private readonly panners: PannerNode[] = [];
  private readonly sources: AudioBufferSourceNode[] = [];
  private readonly level: number;
  private silent = false;

  constructor(
    private readonly audio: AudioSystem,
    readonly positional: boolean,
  ) {
    const { ctx, bank } = audio;
    this.level = positional ? AUDIO.remote.gain : 1;
    const out = (bus: 'engine' | 'effects') => {
      if (!positional) return audio.bus(bus);
      const p = audio.panner(audio.bus(bus));
      this.panners.push(p);
      return p;
    };
    const engineOut = out('engine');
    const fxOut = out('effects');
    // Random offsets so several cars don't play in phase.
    const offset = Math.random() * 2;

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 0.9;
    this.engineFilter.connect(this.engineGain).connect(engineOut);
    this.engine = audio.loop(bank.engine, this.engineFilter, offset);

    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    this.skidGain.connect(fxOut);
    this.skid = audio.loop(bank.skid, this.skidGain, offset);

    this.scrapeGain = ctx.createGain();
    this.scrapeGain.gain.value = 0;
    this.scrapeGain.connect(fxOut);
    this.scrape = audio.loop(bank.scrape, this.scrapeGain, offset);
    this.sources.push(this.engine, this.skid, this.scrape);

    if (!positional) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 400;
      filter.connect(gain).connect(fxOut);
      this.sources.push(audio.loop(bank.noise, filter, offset));
      this.wind = { gain, filter };
    }
  }

  update(p: VoiceParams, position?: THREE.Vector3): void {
    const a = this.audio;
    const e = AUDIO.engine;
    const rpmT = clamp01((p.rpm - DRIVETRAIN.idleRpm) / (DRIVETRAIN.redlineRpm - DRIVETRAIN.idleRpm));
    a.ramp(this.engine.playbackRate, p.rpm / a.bank.engineRpm);
    a.ramp(this.engineFilter.frequency, e.cutoffClosed + (e.cutoffOpen - e.cutoffClosed) * p.load + p.rpm * e.cutoffPerRpm);
    a.ramp(this.engineGain.gain, this.level * (e.minGain + (e.maxGain - e.minGain) * (0.55 * p.load + 0.45 * rpmT)));

    const slipT = clamp01((p.slip - FX.skidMinSlip) / (FX.skidFullSlip - FX.skidMinSlip));
    const s = AUDIO.skid;
    a.ramp(this.skidGain.gain, this.level * s.maxGain * slipT ** 1.3);
    a.ramp(this.skid.playbackRate, s.minRate + (s.maxRate - s.minRate) * slipT);

    const scrapeT = p.scrape > FX.scrapeMinSpeed ? clamp01(p.scrape / 20) : 0;
    a.ramp(this.scrapeGain.gain, this.level * AUDIO.scrape.maxGain * Math.sqrt(scrapeT));
    a.ramp(this.scrape.playbackRate, 0.8 + 0.5 * scrapeT);

    if (this.wind) {
      const w = p.speed / 60;
      a.ramp(this.wind.gain.gain, AUDIO.wind.gainAt60ms * w * w);
      a.ramp(this.wind.filter.frequency, 300 + p.speed * 25);
    }
    if (position) for (const pn of this.panners) a.setPannerPosition(pn, position);
    this.silent = false;
  }

  /** Exhaust pop (on upshifts at high load). */
  pop(position?: THREE.Vector3): void {
    let dest: AudioNode = this.audio.bus('engine');
    if (this.positional && position) {
      const p = this.audio.panner(dest);
      this.audio.setPannerPosition(p, position);
      dest = p;
      setTimeout(() => p.disconnect(), 500);
    }
    this.audio.oneShot(this.audio.bank.pop, dest, 0.35 * this.level, 0.9 + Math.random() * 0.25);
  }

  /**
   * Paddle shift: the gearbox clack, plus a throttle-blip crackle on downshifts.
   * Remote cars play it at their position.
   */
  shift(up: boolean, position?: THREE.Vector3): void {
    const s = AUDIO.shift;
    let dest: AudioNode = this.audio.bus('effects');
    if (this.positional && position) {
      const p = this.audio.panner(dest);
      this.audio.setPannerPosition(p, position);
      dest = p;
      setTimeout(() => p.disconnect(), 500);
    }
    this.audio.oneShot(this.audio.bank.shift, dest, s.clickGain * this.level, up ? 1 : 0.85);
    if (!up) this.audio.oneShot(this.audio.bank.pop, dest, s.blipGain * this.level, 1.3 + Math.random() * 0.2);
  }

  /** Fade everything out (car hidden / stale). */
  silence(): void {
    if (this.silent) return;
    this.silent = true;
    for (const g of [this.engineGain, this.skidGain, this.scrapeGain, this.wind?.gain]) if (g) this.audio.ramp(g.gain, 0);
  }

  dispose(): void {
    for (const s of this.sources) {
      s.stop();
      s.disconnect();
    }
    for (const p of this.panners) p.disconnect();
    this.engineGain.disconnect();
    this.skidGain.disconnect();
    this.scrapeGain.disconnect();
    this.wind?.gain.disconnect();
  }
}
