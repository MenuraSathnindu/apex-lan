import * as THREE from 'three';
import { FX, type Standing } from '@apex/shared';
import type { CarView } from '../render/carView.ts';
import type { ServerClock } from '../net/clock.ts';
import type { createReplayBadge } from '../ui/replayBadge.ts';
import type { RemoteCars } from './remoteCars.ts';
import { ReplayRecorder, newPose, overtakesInTop, type ReplayCarPose, type ReplayClip } from './replay.ts';
import { ReplayPlayer } from './replayPlayer.ts';
import type { Session } from './session.ts';

const ownPose = newPose();

/**
 * TV-style direction: records every car's recent poses, cuts clips around crashes and overtakes at
 * the front, and plays them back (live for spectators). While it plays, it owns the camera and the
 * car models.
 */
export class Broadcast {
  readonly recorder = new ReplayRecorder();
  readonly player = new ReplayPlayer();
  /** Recording on/off (off on Low quality). */
  recording = true;
  private readonly entries: ReplayCarPose[] = Array.from({ length: 8 }, () => ({ id: 0, pos: new THREE.Vector3(), quat: new THREE.Quaternion() }));
  private lastStandings: Standing[] | null = null;
  private order: number[] = [];

  constructor(
    private readonly session: Session,
    private readonly clock: ServerClock,
    private readonly remoteCars: RemoteCars,
    private readonly ownView: CarView,
    private readonly badge: ReturnType<typeof createReplayBadge>,
    private readonly spectating: () => boolean,
  ) {}

  /** A new session starts: forget the old one's clips. */
  reset(): void {
    this.stop();
    this.recorder.clear();
    this.order = [];
    this.lastStandings = null;
  }

  /** Our car hit something this hard (m/s): worth a replay if hard enough. */
  onImpact(dv: number): void {
    if (dv >= FX.replay.impactDv && this.session.race.phase === 'racing') this.recorder.requestClip(this.clock.now(), this.session.myId, 'crash');
  }

  play(clip: ReplayClip, label: string): void {
    this.player.start(clip);
    this.badge.show(label);
  }

  stop(): void {
    this.player.stop();
    this.remoteCars.setOverride(null);
    this.badge.hide();
  }

  /** Text for a clip's badge. */
  label(clip: ReplayClip): string {
    const who = this.session.playerName(clip.subject);
    return clip.kind === 'crash' ? `${who} — contact` : `${who} — overtake`;
  }

  /**
   * Every rendered frame, after our car model has been placed. `own` is our car's pose (null when
   * spectating). Returns true while a replay owns the camera.
   */
  frame(dt: number, own: { pos: THREE.Vector3; quat: THREE.Quaternion } | null, camera: THREE.PerspectiveCamera): boolean {
    const now = this.clock.now();
    const racing = this.session.race.phase === 'racing';

    if (racing && this.recording && !this.player.playing) {
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

    // Overtakes at the front (standings arrive at 5 Hz).
    if (this.session.standings !== this.lastStandings) {
      this.lastStandings = this.session.standings;
      const order = this.session.standings.map((s) => s.id);
      if (racing && this.session.race.session.kind !== 'qualifying') for (const id of overtakesInTop(this.order, order)) this.recorder.requestClip(now, id, 'overtake');
      this.order = order;
    }

    // Spectators get the replays live.
    const ready = this.recorder.poll(now);
    if (ready.length && racing && this.spectating() && !this.player.playing) this.play(ready.at(-1)!, this.label(ready.at(-1)!));

    if (!this.player.playing) return false;
    this.player.advance(dt);
    if (!this.player.playing) {
      this.stop();
      return false;
    }
    this.applyPoses();
    this.player.applyCamera(camera);
    return true;
  }

  /** Where a remote car is in the replay (made once: no per-frame closures). */
  private readonly replayPose = (id: number, out: { pos: THREE.Vector3; quat: THREE.Quaternion }): boolean => {
    const p = this.player.pose(id, ownPose);
    if (!p) return false;
    out.pos.set(p.pos.x, p.pos.y, p.pos.z);
    out.quat.set(p.quat.x, p.quat.y, p.quat.z, p.quat.w);
    return true;
  };

  /** Places every car model at its replay pose. */
  private applyPoses(): void {
    this.remoteCars.setOverride(this.replayPose);
    const mine = this.player.pose(this.session.myId, ownPose);
    this.ownView.root.visible = !!mine;
    if (mine) {
      this.ownView.root.position.set(mine.pos.x, mine.pos.y, mine.pos.z);
      this.ownView.root.quaternion.set(mine.quat.x, mine.quat.y, mine.quat.z, mine.quat.w);
    }
  }
}
