# Broadcast Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make races look like a TV broadcast: start lights, jump starts, penalties, track limits, timing tower, sectors, pit stops, chequered flag, podium and replays.

**Architecture:** Rules live as pure functions/classes in `shared/src/race/` and are wired into
`RaceTracker` and `Room` on the server: penalties, gaps, sector events, track limits and jump
starts. The client adds HTML overlays (lights, tower, sector bar, steward banners), a pit-stop
state machine, a replay recorder/player and a podium scene that reuses existing car views.

**Tech Stack:** TypeScript, Vitest, Rapier (shared physics), Three.js, plain DOM.

**Spec:** `docs/superpowers/specs/2026-10-23-broadcast-design.md`

## Global Constraints

- No trademarked names (no real series, teams, drivers or liveries) anywhere: see the trademark rule in CLAUDE.md.
- All tuning goes in `shared/src/tuning.ts` (`RACE.lights`, `RACE.jumpStartDistance`,
  `RACE.penaltyMs`, `RACE.trackLimits`, `CAR.pit`, `FX.replay*`, `HUD.*`); no magic numbers in
  logic.
- `/shared` is pure TS (no DOM, Node, Three). Wire messages are only in `messages.ts`, via the
  codec.
- No per-frame allocations in render/physics loops. No new full-screen passes. Overlays are
  DOM, and the tower is rebuilt ≤ 5 Hz.
- Commits: one concern each, prefix `p13:`, ending with the Co-Authored-By line.
- `npm run typecheck` and `npm test` green after each task. Run `npm run handling` after the
  limiter task.

## Review Focus

1. A car rejoining mid-countdown, or arriving late at its grid slot, must not get a false jump
   start (the reference is taken at the first light, not from the lobby pose).
2. Pit-lane driving must never count as a track-limit excursion. Tracks without a pit lane must
   not crash the zone code.
3. A penalised finisher can drop behind a later, unpenalised finisher. Results, the database and
   championship points must all use the same penalised order.
4. Gaps for racers who haven't crossed a gate yet, or who disconnected, must be null and not
   NaN.
5. The replay/podium must restore all car views and the camera when it ends, including when the
   phase goes back to the lobby mid-replay.

---

### Task 1: Start-light timing (shared) + server countdown length

**Files:** Create `shared/src/race/startLights.ts`, `shared/src/race/startLights.test.ts`; modify `shared/src/tuning.ts` (RACE.lights), `shared/src/index.ts`, `server/src/game/room.ts` (runSession uses `countdownMs`).

**Interfaces — Produces:**
- `lightsHoldMs(raceId: number): number`: deterministic, in [holdMinMs, holdMaxMs].
- `countdownMs(kind: SessionKind, raceId: number): number`.
- `lightsStartAt(startsAt: number, raceId: number): number`: server time of the first light.
- `litLights(now: number, startsAt: number, raceId: number): number`: 0..5.
- `RACE.lights = { leadMs: 1500, intervalMs: 1000, count: 5, holdMinMs: 1000, holdMaxMs: 3000 }`.

- [ ] Tests:
  - `hold is deterministic and within 1-3 s` (raceIds 1..200);
  - `countdown is lead + 5 lights + hold for races, COUNTDOWN_MS for qualifying`;
  - `lights come on one per second and go out at startsAt` (litLights at first light −1 → 0,
    first light → 1, +4 s → 5, startsAt − 1 → 5, startsAt → 0).
- [ ] Room test (`sessions.room.test.ts` style): `quick race countdown lasts the light sequence`:
  after start, `race.startsAt − now === countdownMs('free', raceId)`.
- [ ] Implement; run tests; commit `p13: start-light timing`.

### Task 2: Penalties in RaceTracker + steward events + penalised classification

**Files:** modify `shared/src/race/raceTracker.ts` (+test), `shared/src/protocol/messages.ts`, `server/src/game/room.ts`, `client/src/game/session.ts` (store steward events), `client/src/ui/results.ts` (penalised time).

**Interfaces — Produces:**
- `RaceTracker.addPenalty(id, ms): void`, `RaceTracker.invalidateLap(id): void`.
- `Standing.penaltyMs: number`.
- `classifiedTime(s: Standing): number | null` (finishTime + penaltyMs).
- `StewardEvent { id: number; kind: 'warning' | 'penalty' | 'lapDeleted'; reason: 'jumpStart' | 'trackLimits'; strikes: number; penaltyMs: number }`.
- `S2C { t: 'steward'; e: StewardEvent }`.
- `Session.stewardEvents: StewardEvent[]`.
- `Room.penalize(id, reason, strikes)` (private) broadcasts and records.

- [ ] Tests:
  - `penalty reorders finishers by penalised time` (A finishes first with +5 s, B 2 s later → B P1);
  - `invalidateLap makes the current lap invalid`;
  - `standings carry penaltyMs`.
- [ ] Room: SessionOutcome totalMs and recordResults totalMs use `classifiedTime`.
- [ ] Results table shows the penalised gap and a "+5s" tag.
- [ ] Commit `p13: time penalties and steward events`.

### Task 3: Jump-start detection

**Files:** Create `shared/src/race/jumpStart.ts` (+test); modify `RACE` (`jumpStartDistance: 1.5`, `penaltyMs: 5000`), `server/src/game/room.ts`.

**Interfaces — Produces:** `class JumpStartJudge { constructor(lightsAt: number, startsAt: number, ids: readonly number[]); onState(id, x, z, ts): boolean /* true exactly once when id jumps */ }`.

- [ ] Tests:
  - `no reference before the first light: moving then is fine`;
  - `moving 1.5 m+ after the first light and before lights out is a jump start, reported once`;
  - `moving after lights out is fine`;
  - `the reference is the first state at/after the first light`.
- [ ] Room tests:
  - `a car that rolls before lights out gets +5 s and a steward penalty`;
  - `a car that waits gets nothing`.

  Only sessions of kind free/sprint/race get a judge.
- [ ] Commit `p13: jump-start detection`.

### Task 4: Track limits

**Files:** Create `shared/src/race/trackLimits.ts` (+test); modify `shared/src/track/track.ts` (expose `pitLaneCentre`), `RACE.trackLimits = { margin: 1, minSpeed: 15, strikesPerPenalty: 3 }`, `server/src/game/room.ts`.

**Interfaces — Produces:**
- `outsideLimits(track: BuiltTrack, i: number, x: number, z: number): boolean`.
- `class TrackLimits { constructor(track); onState(id, x, z, speed): boolean /* true when a new excursion starts */ }`.
- `BuiltTrack.pitLaneCentre: Float32Array`.

- [ ] Tests (on `APEX_PARK`):
  - `centre of the road is inside`;
  - `2 m past the kerb is outside`;
  - `the pit lane is not outside`;
  - `one excursion = one strike even over many states`;
  - `slow excursions do not count`;
  - `a new strike after coming back`.
- [ ] Room tests:
  - `third track-limits strike in a race gives +5 s (warnings before)`;
  - `a qualifying excursion deletes the lap` (the lap completes invalid).
- [ ] Commit `p13: track limits`.

### Task 5: Gaps from gate times

**Files:** modify `shared/src/race/raceTracker.ts` (+test).

**Interfaces — Produces:** `Standing.gap: number | null` (ms behind leader; null for the leader / no common gate), `Standing.lapsDown: number`.

- [ ] Tests:
  - `gap is the time behind the leader at the last common gate`;
  - `lapped cars report lapsDown`;
  - `gap is null before any gate`;
  - `finished gaps use penalised finish times`.
- [ ] Commit `p13: gaps to the leader`.

### Task 6: Sector events + SectorBoard

**Files:** modify `raceTracker.ts` (emit `SectorEvent`, `takeSectors()`), `messages.ts` (`S2C sector`), `room.ts` (broadcast); create `shared/src/race/timing.ts` (+test); `client/src/game/session.ts` (queue).

**Interfaces — Produces:**
- `SectorEvent { id; lap; sector; time; elapsed; valid }`.
- `class SectorBoard { reset(); add(e: SectorEvent): { colour: 'purple' | 'green' | 'yellow' | null; delta: number | null }; colours(id, lap): ('purple' | 'green' | 'yellow' | null)[] }`.

- [ ] Tracker tests:
  - `crossing a sector line emits a sector event`;
  - `the last sector comes with the lap`;
  - `no sector event after a missed split`.
- [ ] Board tests:
  - `first valid sector is purple`;
  - `slower but own best is green`;
  - `slower than own best is yellow`;
  - `invalid laps are uncoloured and set no bests`;
  - `delta against the best lap's cumulative split`.
- [ ] Commit `p13: live sector times`.

### Task 7: Pit lane zone, limiter, pit-stop message

**Files:**
- Create `shared/src/race/pitLane.ts` (+test).
- Modify `shared/src/physics/vehicle.ts` (`speedLimit`) + `vehicle.test.ts`.
- `CAR.pit = { speedLimit: 80 / 3.6, stopSeconds: 2.5, stopSpeed: 1 }`.
- `shared/src/protocol/carState.ts` (`tw`, `pl` + validation) and `messages.ts` (`C2S pitStop`).
- `room.ts`.

**Interfaces — Produces:**
- `pitZoneAt(track, i, x, z): 'none' | 'lane' | 'box'`.
- `Vehicle.speedLimit: number`.
- `packCarState(v, braking, inPit = false)` sets `tw` and `pl`.
- `C2S { t: 'pitStop'; tyre: Compound }`.

- [ ] Tests:
  - `pit lane centre is lane, mid lane is box, track is none, no pit lane → none`;
  - `limiter holds the car near 80 km/h at full throttle` (headless, from 0 for 15 s: speed ≤ limit + 1);
  - `a car entering at 150 km/h slows to the limit within 3 s`;
  - `isValidCarState accepts tw/pl and rejects bad ones`.
- [ ] Room tests:
  - `pitStop during racing changes the tyre and broadcasts the roster`;
  - `pitStop in the lobby or with a bad compound is ignored`.
- [ ] `npm run handling` unchanged.
- [ ] Commit `p13: pit lane limiter and pit stops`.

### Task 8: Client pit-stop controller

**Files:** create `client/src/game/pitStop.ts` (+test); wire into `client/src/main.ts`, HUD text in `raceHud.ts`.

**Interfaces — Produces:** `class PitStop { state: 'idle' | 'stopping' | 'done'; choice: Compound; step(zone, speed, racing, steerEdge: -1 | 0 | 1, dt): Compound | null /* compound to fit when the stop completes */; holding: boolean; progress: number }`.

- [ ] Tests:
  - `stopping in the box starts a stop and holds the car`;
  - `completes after 2.5 s with the chosen compound`;
  - `steer edges cycle the compound`;
  - `no new stop until leaving the box`;
  - `no stop when not racing`.
- [ ] Wire:
  - `car.speedLimit` in the lane;
  - HOLD input while holding;
  - `fitTyres` + `pitStop` message;
  - HUD "PIT LIMITER" / stop panel.
- [ ] Commit `p13: pit stops on the client`.

### Task 9: Start lights on the client

**Files:** rewrite `client/src/ui/raceOverlay.ts`; modify `client/src/render/scenery.ts` (gantry lamps, `setLights(n)`), `trackView.ts` (expose), `main.ts` (input during lights), CSS.

- [ ] Overlay:
  - race kinds show 5 lamps from `litLights`, a beep per new light, and a high beep at lights out;
  - qualifying keeps the numbers.
- [ ] Input: for race kinds after the first light, sampled input is live; throttle 0 ⇒ brake 1.
- [ ] Commit `p13: start lights`.

### Task 10: Timing tower, sector bar, steward banners, chequered flag

**Files:**
- Create `client/src/ui/timingTower.ts`, with a pure `towerRows(...)` tested in `timingTower.test.ts`.
- Modify `raceHud.ts` (replace ranking; sector bar + delta popup; steward toasts; chequered flag; cool-down), `session.ts` (sector queue, last detection per id), `remoteCars.ts` (`latest(id)` → last `CarSnapshot`), `style.css`.

**Interfaces — Produces:** `towerRows(standings, players, info: { teamColour(id): number | null; car(id): { tw?: number; pl?: 0 | 1 } | null; overtake(id): boolean }, mode: 'leader' | 'interval', qualifying: boolean): TowerRow[]` with `{ id, pos, tag, photo, colour, gapText, tyre, wear, overtake, badges: string[] }`.

- [ ] Tests:
  - `leader shows LEADER/lap, others +s.sss`;
  - `interval mode is the gap to the car ahead`;
  - `lapped shows +1 LAP`;
  - `badges PIT, +5s, FIN, OUT`;
  - `qualifying shows best lap and gap to pole`.
- [ ] Commit `p13: timing tower and sector HUD`.

### Task 11: Replay recorder and player

**Files:**
- Create `client/src/game/replay.ts` (+test; pure `ReplayRecorder`), `client/src/game/replayPlayer.ts` (poses views + camera).
- Modify `remoteCars.ts` (`setOverride(fn | null)`), `main.ts` (spectator auto-replay), `FX.replayImpactDv`, `HUD` constants.

**Interfaces — Produces:**
- `class ReplayRecorder { record(t, cars: Iterable<{ id; pos: Vec3Like; quat: QuatLike }>); requestClip(t, subject: number, kind: 'crash' | 'overtake'); poll(t): ReplayClip[]; clips: ReplayClip[]; clear() }`.
- `ReplayClip { subject; kind; at; frames: { t; cars: Map<id, [x, y, z, qx, qy, qz, qw]> }[] }`.

- [ ] Tests:
  - `keeps only the last 10 s`;
  - `a clip covers t-7..t+3 and is ready 3 s later`;
  - `requests within 5 s merge`;
  - `at most 4 clips`.
- [ ] Commit `p13: replays`.

### Task 12: Podium scene and post-race highlights

**Files:**
- Create `client/src/render/podium.ts` (podium mesh, placement), `client/src/game/postRace.ts` (director: highlights → orbit → results).
- Modify `results.ts` (hidden until the director says so), `main.ts`, CSS, `HUD.podiumMs`.

- [ ] Pure `podiumPlacement(track)` tested: beside the start line, on the non-pit side, outside the boundary.
- [ ] Commit `p13: podium and highlights`.

### Task 13: Docs + browser check

- [ ] CLAUDE.md phase line + conventions.
- [ ] ARCHITECTURE wire messages.
- [ ] OPEN_WHEEL_PLAN p13 status.
- [ ] Headless Edge screenshots of lights / tower / podium.
- [ ] Commit `p13: docs`.
