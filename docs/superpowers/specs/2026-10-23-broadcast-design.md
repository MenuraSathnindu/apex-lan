# Phase 13 — Broadcast presentation: design

Approved by the owner on 2026-10-23 ("approved, build it"), from the in-chat design. Decisions
the owner did not state explicitly are marked *(assumption)*.

## Goal

Races should look and feel like a TV broadcast: start lights, a live timing tower, coloured
sector times, pit stops, track-limit stewarding, replays, a chequered flag and a podium. Same
trust model as before. Clients drive their own cars. The server owns the room, laps, standings
and now penalties. No new full-screen GPU passes: Medium must stay at 60 fps.

## 1. Start lights and jump starts

- **Which sessions:** sprint, race and quick-race (`free`) starts use lights. Qualifying keeps
  the 3-2-1 countdown (`COUNTDOWN_MS`).
- **Sequence:** after `RACE.lights.leadMs` (1500 ms, cars settle on the grid), five red lights
  come on one every `RACE.lights.intervalMs` (1000 ms).
- **Hold:** all five then stay lit for a hold of 1000–3000 ms, derived from `raceId` by a pure
  function, so every client and the server agree with no extra message. Lights out = `startsAt`
  = GO.
- **Pure functions** (`shared/src/race/startLights.ts`):
  - `lightsHoldMs(raceId)`;
  - `countdownMs(kind, raceId)`: lead + 5 × interval + hold, or `COUNTDOWN_MS` for qualifying;
  - `litLights(now, startsAt, raceId)`: 0..5 lit, 0 again after lights out.
- **HUD:** five big red lamps at the top centre, replacing the numbers, with a beep per light and
  a higher one at lights out. Qualifying keeps "3, 2, 1, GO!".
- **3D:** the start gantry gets a row of five lamps that light in step (emissive material swap,
  no lights or passes).
- **Input during the lights (race kinds):**
  - From the first light, driving input is live, so a jump start is possible *(assumption)*.
  - While the throttle is not pressed, the brakes are held, so cars don't creep.
  - Before the first light the car is held as today.
- **Jump-start check (server):**
  - At the first light the server takes each entrant's latest position as their reference.
    The first state received at or after the first light counts, if none had arrived yet.
  - If an entrant is seen more than `RACE.jumpStartDistance` (1.5 m) from that reference
    before `startsAt`, it is a jump start: one +5 s penalty (`RACE.penaltyMs`) per race,
    announced to everyone.

## 2. Penalties and stewarding

- **Where they live:** penalties are time added to the finish, held per racer in `RaceTracker`
  (`addPenalty(id, ms)`). `Standing` gains `penaltyMs`.
- **What the penalty changes:**
  - Finished racers are ordered by `finishTime + penaltyMs`.
  - Session classification, the results database (`totalMs`) and championship points use the
    penalised order.
  - Running racers are still ordered by progress.
- **New message:** `S2C { t: 'steward'; e: StewardEvent }`, where
  `StewardEvent = { id, kind: 'warning' | 'penalty' | 'lapDeleted', reason: 'jumpStart' | 'trackLimits', strikes, penaltyMs }`.
  Everyone gets it; the HUD shows a toast, plus a big banner for your own car.

## 3. Track limits

- **Pure module:** `shared/src/race/trackLimits.ts`.
  - `outsideLimits(track, sample, x, z)`: the car's centre is more than
    `RACE.trackLimits.margin` (1 m) beyond the road edge + kerb width on its side, and not
    inside the pit lane.
  - `TrackLimits` counts excursions per racer. An excursion starts when a racer is outside
    while faster than `RACE.trackLimits.minSpeed` (15 m/s), and ends once they are back inside.
    One excursion = one strike.
- **Races (free, sprint, race):**
  - Strikes 1 and 2 are warnings.
  - Every 3rd strike (3, 6, …) is +5 s.
  - Each strike is announced as a steward event.
- **Qualifying** *(assumption)*: an excursion deletes the current lap (it completes but is
  invalid, like a respawn), with a `lapDeleted` event. There are no strikes.
- **Track data:** `BuiltTrack` exposes `pitLaneCentre: Float32Array` (lateral lane centre per
  sample, NaN outside the pit zone). The track limits and the pit lane share it.

## 4. Timing tower

- **Placement:** left side; the lap/position panel moves to the right.
- **Rows (8 max):**
  - position;
  - team-colour bar (the championship team's primary colour, else the livery primary);
  - photo (avatar);
  - 3-letter tag;
  - gap;
  - tyre icon (compound letter in its colour, plus a wear ring);
  - ⚡ while overtake mode is available to that car (their last detection event);
  - badges: PIT, +5s (total penalty), FIN, OUT (disconnected).
- **Gaps (server):**
  - `RaceTracker` records when each racer crossed each gate, by gate count since the start.
  - `Standing.gap` = ms behind the leader at the last gate both have passed.
    `Standing.lapsDown` = how many full laps behind.
  - Finished racers: gap = difference in penalised finish time.
- **Display:** "+1 LAP" when lapped. The tower alternates gap-to-leader and interval to the car
  ahead every 10 s *(assumption)*, with a header that names the mode. Qualifying shows best lap
  and gap to pole instead.
- **Wire additions** to `CarState` (optional fields, validated):
  - `tw` = tyre wear 0..1 (2 decimals);
  - `pl` = 1 while in the pit lane.

  The tower reads them from the latest relayed snapshot per car.
- **Updates:** the tower is rebuilt at most 5 Hz.

## 5. Sectors and lap delta

- **Server:** `RaceTracker` emits a `SectorEvent { id, lap, sector, time, elapsed, valid }` each
  time a racer completes a sector (the last sector completes with the lap). It is sent as
  `S2C { t: 'sector'; e }`. A sector whose start split was missed (respawn) is not sent.
- **Client:** a pure `SectorBoard` (`shared/src/race/timing.ts`) keeps the session best per
  sector, each driver's best per sector, and each driver's best-lap splits (cumulative elapsed
  at each sector line).
  - **Colour per event:** purple = session best (ties count), green = personal best, yellow
    otherwise. Invalid laps are not coloured and don't set bests.
  - **Delta:** current elapsed − elapsed at the same line on the driver's best lap (null without
    a best lap).
- **HUD:**
  - a 3-segment bar under the lap panel, for your car or the followed car when spectating;
  - a popup at each sector line, e.g. "S2 −0.234", green when faster and red/yellow when slower.

## 6. Pit lane and pit stops

- **Zone:** `pitZoneAt(track, sample, x, z)` → `'none' | 'lane' | 'box'`.
  - `lane` = within the lane's half-width of the lane centre.
  - `box` = the middle third of the full-width part of the lane.
- **Limiter (shared physics):**
  - `Vehicle.speedLimit` (m/s, Infinity by default).
  - When the car's speed is above the limit, `stepVehicle` cuts the drive force and brakes the
    car down toward the limit.
  - The client sets the limit to `CAR.pit.speedLimit` (80 km/h) while in the lane. The HUD shows
    "PIT LIMITER".
- **Pit stop (client, `client/src/game/pitStop.ts`, a pure state machine):**
  1. In the box zone, during racing, below 1 m/s: the stop starts.
  2. The car is held for `CAR.pit.stopSeconds` (2.5 s).
  3. Steer left/right picks the compound (no new key bindings). The default is the current
     compound.
  4. At the end, `fitTyres` puts on the new set, and `C2S { t: 'pitStop'; tyre }` tells the room.
  5. Leaving the box zone re-arms the next stop.
- **Server:** during `racing`, accepts `pitStop` from an entrant with a valid compound, sets
  their `tyre` and broadcasts the roster (others' tyre colour and tower icon follow).
- **Not included:** no mandatory stop, and no pit stops on tracks without a pit lane.

## 7. Chequered flag, cool-down and podium

- **Chequered flag:** when the leader finishes (`finishDeadline` set), a chequered-flag banner
  shows for 4 s.
- **Cool-down:** finished drivers keep driving. The HUD says "Cool-down lap".
- **Podium (results phase of free / sprint / race, at least one finisher):**
  - `client/src/render/podium.ts` builds a three-step podium beside the start line (on the
    non-pit side, past the barrier).
  - The top-3 cars' views are posed on it. Above each, an HTML card shows the avatar photo,
    position and tag, projected like name tags.
  - An orbiting camera circles the podium.
  - Driving input is held while the podium shows.
  - The results table appears after `HUD.podiumMs` (8 s) or on Enter / click "Results".
    Qualifying goes straight to the table.

## 8. Replays (optional part)

- **Recorder (`client/src/game/replay.ts`, pure):** a ring buffer of the last 10 s at 30 Hz.
  Each frame stores the server-clock time and, per visible car, `id`, position and quaternion.
  It is fed from the render loop: our car plus visible remote cars.
- **Clips:**
  - An event at time t (our impact above `FX.replayImpactDv`, 6 m/s; or a position change
    among the top 3 in the standings) asks for a clip of [t − 7 s, t + 3 s].
  - The clip is copied out 3 s later. At most 4 clips are kept, and repeats within 5 s are
    merged.
- **Playback (`ReplayPlayer`):**
  - poses the existing car views from the clip (cars not in a frame are hidden);
  - uses a trackside camera: a fixed point 12 m beside and 4 m above the subject's position at
    the event, looking at the subject;
  - shows a "REPLAY" badge with a Skip button and the Enter key.
- **Who sees replays:** live auto-replays play only for spectators *(assumption)*, because
  drivers would lose control. Drivers see the clips as post-race highlights before the podium
  orbit, at most 3 clips.
- **Quality:** recording is off on Low quality *(assumption: "if performance allows")*.

## Testing

- **Unit tests (Vitest) for the pure parts:**
  - light timing;
  - jump-start rule;
  - penalties in standings;
  - track-limit strikes;
  - gate gaps;
  - sector events;
  - `SectorBoard` colours/deltas;
  - pit zone;
  - the speed limiter (headless Rapier);
  - pit-stop state machine;
  - replay ring buffer and clips;
  - `CarState` validation of `tw`/`pl`.
- **Room tests:** jump start, track-limit warnings → penalty, qualifying lap deletion, a pit stop
  changing the tyre, and penalised classification.
- **Browser check:** headless Edge screenshots of the lights, tower and podium.
