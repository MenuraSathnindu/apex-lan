import * as THREE from 'three';
import { FX, HUD, type Standing } from '@apex/shared';
import type { CarView } from '../render/carView.ts';
import type { PodiumView } from '../render/podium.ts';
import type { ServerClock } from '../net/clock.ts';
import type { createPodiumCards } from '../ui/podiumCards.ts';
import type { createReplayBadge } from '../ui/replayBadge.ts';
import type { RemoteCars } from './remoteCars.ts';
import { ReplayRecorder, newPose, overtakesInTop, type ReplayCarPose, type ReplayClip } from './replay.ts';
import { ReplayPlayer } from './replayPlayer.ts';
import type { Session } from './session.ts';

const tmpPose = newPose();
const slotPos = new THREE.Vector3();
const slotQuat = new THREE.Quaternion();
const centre = new THREE.Vector3();
const cardPos = new THREE.Vector3();
/** Orbit around the podium: radius, height above it, swing (rad) and seconds per swing. */
const ORBIT = { radius: 17, height: 4.5, swing: 0.9, period: 14 };
/** Card height above the car on the podium (m). */
const CARD_UP = 2.4;

/**
 * TV-style direction. During a race: records every car's recent poses and cuts clips around
 * crashes and overtakes at the front (spectators see them live). After a race: the highlights,
 * then the podium with the top three cars and their photos, then the results table. While it
 * shows something it owns the camera and the car models.
 */
export class Broadcast {
  readonly recorder = new ReplayRecorder();
  readonly player = new ReplayPlayer();
  /** Recording on/off (off on Low quality). */
  recording = true;
  /** Our car's height above the road at rest (measured on the grid), for posing it on the podium. */
  restHeight = 0.45;
  /** The results table may show (after the podium, or right away for qualifying). */
  resultsReady = true;
  private post: 'off' | 'highlights' | 'podium' | 'done' = 'off';
  private queue: ReplayClip[] = [];
  private podiumAt = 0;
  private top: number[] = [];
  private readonly entries: ReplayCarPose[] = Array.from({ length: 8 }, () => ({ id: 0, pos: new THREE.Vector3(), quat: new THREE.Quaternion() }));
  private lastStandings: Standing[] | null = null;
  private order: number[] = [];

  constructor(
    private readonly session: Session,
    private readonly clock: ServerClock,
    private readonly remoteCars: RemoteCars,
    private readonly ownView: CarView,
    private readonly podium: PodiumView,
    private readonly badge: ReturnType<typeof createReplayBadge>,
    private readonly cards: ReturnType<typeof createPodiumCards>,
    private readonly spectating: () => boolean,
  ) {}

  /** Driving input is held while the post-race scene runs. */
  get holdInput(): boolean {
    return this.post === 'highlights' || this.post === 'podium';
  }

  /** A new session starts: forget the old one's clips and scenes. */
  reset(): void {
    this.endPost();
    this.stop();
    this.recorder.clear();
    this.order = [];
    this.lastStandings = null;
  }

  /** Our car hit something this hard (m/s): worth a replay if hard enough. */
  onImpact(dv: number): void {
    if (dv >= FX.replay.impactDv && this.session.race.phase === 'racing') this.recorder.requestClip(this.clock.now(), this.session.myId, 'crash');
  }

  play(clip: ReplayClip): void {
    this.player.start(clip);
    const who = this.session.playerName(clip.subject);
    this.badge.show(clip.kind === 'crash' ? `${who} — contact` : `${who} — overtake`);
  }

  stop(): void {
    this.player.stop();
    this.remoteCars.setOverride(null);
    this.badge.hide();
  }

  /** Skip button / Enter: the next highlight, or from the podium to the results. */
  skip(): void {
    if (this.post === 'podium') this.resultsReady = true;
    else this.stop();
  }

  /**
   * Every rendered frame, after our car model has been placed. `own` is our car's pose (null when
   * spectating). Returns true while a replay or the podium owns the camera.
   */
  frame(dt: number, own: { pos: THREE.Vector3; quat: THREE.Quaternion } | null, camera: THREE.PerspectiveCamera): boolean {
    const now = this.clock.now();
    const phase = this.session.race.phase;
    const racing = phase === 'racing';

    if (racing && this.recording && !this.player.playing) this.record(now, own);

    // Overtakes at the front (standings arrive at 5 Hz).
    if (this.session.standings !== this.lastStandings) {
      this.lastStandings = this.session.standings;
      const order = this.session.standings.map((s) => s.id);
      if (racing && this.session.race.session.kind !== 'qualifying') for (const id of overtakesInTop(this.order, order)) this.recorder.requestClip(now, id, 'overtake');
      this.order = order;
    }

    // Spectators get the replays live.
    const ready = this.recorder.poll(now);
    if (ready.length && racing && this.spectating() && !this.player.playing) this.play(ready.at(-1)!);

    // After the race: highlights → podium → results.
    if (phase === 'results' && this.post === 'off') this.beginPost();
    else if (phase !== 'results' && this.post !== 'off') this.endPost();

    if (this.post === 'highlights' && !this.player.playing) this.nextHighlight();
    if (this.player.playing) {
      this.player.advance(dt);
      if (!this.player.playing) {
        this.stop();
        if (this.post === 'highlights') this.nextHighlight();
      }
      if (this.player.playing) {
        this.remoteCars.setOverride(this.replayPose);
        this.poseOwn(this.player.pose(this.session.myId, tmpPose));
        this.player.applyCamera(camera);
        return true;
      }
    }
    if (this.post === 'podium') {
      this.showPodium(camera);
      return true;
    }
    return false;
  }

  /** Plays the next highlight, or moves on to the podium. */
  private nextHighlight() {
    const next = this.queue.shift();
    if (next) this.play(next);
    else {
      this.post = 'podium';
      this.podiumAt = performance.now();
    }
  }

  private record(now: number, own: { pos: THREE.Vector3; quat: THREE.Quaternion } | null) {
    let n = 0;
    if (own) {
      const e = this.entries[n++]!;
      e.id = this.session.myId;
      (e.pos as THREE.Vector3).copy(own.pos);
      (e.quat as THREE.Quaternion).copy(own.quat);
    }
    for (const rc of this.remoteCars.visible()) {
      if (n >= this.entries.length) break;
      const e = this.entries[n++]!;
      e.id = rc.id;
      (e.pos as THREE.Vector3).copy(rc.pos);
      (e.quat as THREE.Quaternion).copy(rc.quat);
    }
    this.recorder.record(now, this.entries, n);
  }

  /** The race just ended: queue the highlights and pick the podium (races only, with finishers). */
  private beginPost() {
    const finishers = this.session.standings.filter((s) => s.finishTime !== null && !s.dnf);
    if (this.session.race.session.kind === 'qualifying' || !finishers.length) {
      this.post = 'done';
      this.resultsReady = true;
      return;
    }
    this.recorder.poll(Number.POSITIVE_INFINITY);
    this.queue = this.recorder.clips.slice(-HUD.highlightClips);
    this.top = finishers.slice(0, 3).map((s) => s.id);
    this.post = 'highlights';
    this.resultsReady = false;
  }

  private endPost() {
    this.post = 'off';
    this.queue = [];
    this.resultsReady = true;
    this.podium.group.visible = false;
    this.cards.hide();
    this.stop();
  }

  private showPodium(camera: THREE.PerspectiveCamera) {
    const elapsed = performance.now() - this.podiumAt;
    if (elapsed >= HUD.podiumMs) this.resultsReady = true;
    this.podium.group.visible = true;
    this.remoteCars.setOverride(this.podiumPose);
    // Our own car, if we made the podium.
    const mine = this.top.indexOf(this.session.myId);
    if (mine >= 0) {
      this.podium.slot((mine + 1) as 1 | 2 | 3, this.restHeight, slotPos);
      this.podium.carQuaternion(slotQuat);
      this.ownView.root.visible = true;
      this.ownView.root.position.copy(slotPos);
      this.ownView.root.quaternion.copy(slotQuat);
    } else this.ownView.root.visible = false;

    // Slow swing in front of the podium.
    this.podium.centre(centre);
    const f = this.podium.forward;
    const base = Math.atan2(f.x, f.z);
    const a = base + Math.sin((elapsed / 1000 / ORBIT.period) * Math.PI * 2) * ORBIT.swing;
    camera.position.set(centre.x + Math.sin(a) * ORBIT.radius, centre.y + ORBIT.height, centre.z + Math.cos(a) * ORBIT.radius);
    camera.lookAt(centre);
    camera.updateMatrixWorld();

    const heading = this.session.race.session.round ? `Round ${this.session.race.session.round.round} podium` : 'Podium';
    this.cards.show(heading, [0, 1, 2].map((i) => this.session.players.find((p) => p.id === this.top[i]) ?? null));
    this.cards.setResultsShown(this.resultsReady);
    for (let i = 0; i < this.top.length; i++) this.cards.place(i, this.podium.slot((i + 1) as 1 | 2 | 3, this.restHeight + CARD_UP, cardPos), camera);
  }

  /** Where a remote car is in the replay (made once: no per-frame closures). */
  private readonly replayPose = (id: number, out: { pos: THREE.Vector3; quat: THREE.Quaternion }): boolean => {
    const p = this.player.pose(id, tmpPose);
    if (!p) return false;
    out.pos.set(p.pos.x, p.pos.y, p.pos.z);
    out.quat.set(p.quat.x, p.quat.y, p.quat.z, p.quat.w);
    return true;
  };

  /** Remote cars on the podium (everyone else is hidden). */
  private readonly podiumPose = (id: number, out: { pos: THREE.Vector3; quat: THREE.Quaternion }): boolean => {
    const at = this.top.indexOf(id);
    if (at < 0) return false;
    this.podium.slot((at + 1) as 1 | 2 | 3, this.restHeight, out.pos);
    this.podium.carQuaternion(out.quat);
    return true;
  };

  private poseOwn(p: ReturnType<ReplayPlayer['pose']>) {
    this.ownView.root.visible = !!p;
    if (!p) return;
    this.ownView.root.position.set(p.pos.x, p.pos.y, p.pos.z);
    this.ownView.root.quaternion.set(p.quat.x, p.quat.y, p.quat.z, p.quat.w);
  }
}
