# Open-wheel upgrade — plan (phases 8–14)

Written 2026-10-23. Companion to `ARCHITECTURE.md` (phases 0–7 are described there). When a
decision below changes, update this file in the same change.

Goal: apex-lan becomes an open-wheel racing game inspired by the 2026 single-seater rules, with
real-world circuits, persistent player profiles and a championship mode — still hosted from one
laptop on a LAN, still zero installs for friends, now open source.

## 0. Ground rules

### Trademark rule (applies to code, UI, docs, asset names, asset *contents*, git history going forward)
No trademarked names or marks of any real series, team, driver, sponsor, governing body or
manufacturer: no series name or its abbreviations, no governing-body name, no real team, driver,
car-model or sponsor names, no logos, liveries, fonts or wordmarks traced from real ones.
- Tracks are named by city/country ("Monza, Italy"). Corner/sector names that are place names are
  fine; official event titles and circuit logos are not.
- Teams, drivers and liveries are **fictional**. Player names are user-entered text, so they are
  the player's own responsibility, but we ship no real names as defaults or in sample data.
- Regulation *concepts* (active aero, energy recovery, an overtake boost) are fine; use our own
  words for UI ("Corner / Straight aero", "Boost") unless the term is plainly generic. The two
  aero modes are called `corner` (Z-mode: high downforce) and `straight` (X-mode: low drag) in code.
- Enforced by `npm run lint:marks` (`scripts/checkMarks.mjs`, banned-term list lives in that
  script, scans tracked text files and `client/public/CREDITS.md`). Runs in `npm test` and CI.

### Things to keep from the current architecture
Client-authoritative cars, server-owned room and race results, 60 Hz fixed step, Rapier only via
`shared/src/physics/rapier.ts`, pure-TS `/shared`, every asset optional (procedural fallback),
all numbers in tuning. New gameplay state must be tick-deterministic (no wall clock, no
`Math.random()`).

## 1. Refactor first (do in phase 8, before any feature)

Findings from reading the current code. Items marked ⛔ block a feature; the rest reduce risk.

| # | Where | Problem | Change |
|---|---|---|---|
| R1 ✅ | `scripts/download-assets.mjs`, `client/public/CREDITS.md`, `docs/ASSETS.md`, `tuning.ts:29,53,245,251,263`, `ARCHITECTURE.md:391` | The default car is a real marque's model, named in comments, credits and the download script. Violates the trademark rule and the car isn't open-wheel anyway. | Remove the model + all mentions; rewrite `CAR_MODEL` comments generically; the open-wheel procedural model (phase 9) becomes the default. |
| R2 ⛔ | `tuning.ts` (519 lines, one `CAR` const; `CarSpec = typeof CAR`) | One global car. `CAR` is imported directly by `remoteCars`, `main`, `effects`, `drivetrain`, `handlingMetrics`, `bots`. Open-wheel needs a different spec (and per-team variants later). | Split `tuning.ts` into `tuning/{car,aero,ers,camera,graphics,race,audio,hud,…}.ts` re-exported from `tuning/index.ts`. Add `CAR_SPECS: Record<CarId, CarSpec>`; every consumer takes a `CarSpec` argument (default `DEFAULT_CAR`). `PlayerInfo.car` carries the id. |
| R3 ⛔ | `protocol/messages.ts` `CarState`, `codec.ts` (JSON strings) | 12+ wheel numbers per car per message as JSON. Aero mode, ERS charge and boost flags would add more; the timing tower needs them for *remote* cars too. | Do the planned binary codec + quantization **now** (it was phase 8). Version it: `PROTOCOL_VERSION` in `hello`, server replies `incompatible` instead of mis-parsing. Rule 9 still holds (messages typed in `messages.ts`, all I/O through `codec.ts`). |
| R4 ⛔ | `server/src/main.ts`, `net/staticFiles.ts` | Only GET static files + WS. Profiles need JSON APIs and an upload route. | Add `server/src/http/router.ts` (method+path table, body size limit, JSON helpers) in front of the static handler. |
| R5 ⛔ | `game/room.ts` (338 lines), `RacePhase = lobby\|countdown\|racing\|results`, `RaceState.laps` | One implicit session type, no track id, no session kinds. Championship needs qualifying / sprint / race with different rules and a persistent state machine. | Extract `Session` (kind: `free \| qualifying \| sprint \| race`, trackId, laps/duration, gridRule, pointsTable) from `Room`. `Room` keeps players/host/slots/rejoin; a `SessionRunner` owns phases + `RaceTracker`. Keep the existing phases as the inner state of a session. |
| R6 ⛔ | `raceTracker.ts`, `checkpoints.ts` | Tracks laps and positions only. No sector times, best lap, or per-session classification (qualifying ranks by best lap, not distance). | Add sectors (3 splits at fixed gate indices from `TrackDef`), `bestLap`, `lastLap`, per-gate timestamps; `classify(kind)` strategy. Server stays the only source of results. |
| R7 ⛔ | `TrackDef` (x,z only), `buildTrack` | Flat world (`TRACK_HEIGHTS`, y=0), constant width, no pit lane, 2 m resample, `TRACKS` has one entry, `APEX_PARK` hard-coded in `main.ts`, `room.ts`, `bots.ts`. | `TrackDef` gains `points: [x,z,y?,halfWidth?]`, `sectors`, `pitLane?`, `surfaceZones` (aero straights, detection points). Select by id everywhere (`TRACKS[id]`), `trackId` in session state. Elevation support is its own sub-step (phase 10b). |
| R8 | `client/src/main.ts` (346 lines), `game/session.ts` | Bootstrap monolith; UI is overlays toggled imperatively. Profile page, championship menu, standings and presentation screens would each add more. | Introduce `client/src/ui/screens.ts` (tiny screen stack: title / profile / lobby / championship / race / results) and split `main.ts` into `bootstrap`, `gameLoop`, `screens`. No framework (per CLAUDE.md). |
| R9 | `session.ts`: profile in `localStorage`, identity = per-tab `sessionId` | Persistent profiles need an identity that survives tabs/devices of the same human. | Keep `sessionId` for rejoin; add `profileId` + secret `profileToken` (localStorage). `hello` carries both. `PlayerInfo` gains `profileId` and `photoVersion`. |
| R10 | `input.ts` (`CarInput`), `bindings.ts`, `userSettings.ts` | No actions for aero toggle / boost; bindings sanitised against a fixed action list. | Add `aero` (toggle) and `boost` (hold) actions + gamepad mapping; extend defaults and `sanitize` (old saved settings must still load → merge with defaults, test it). |
| R11 | `vehicle.ts` | `createVehicle` hard-codes one box collider and `WHEEL_COUNT = 4` visuals; aero is an impulse in `stepVehicle`. | Aero/ERS go into new `physics/aero.ts` + `physics/ers.ts` called from `stepVehicle` via `spec`; chassis collider comes from `spec.chassis.shape` (still a cuboid, optional extra wheel guards). Keep `handling` and `vehicle.test` green (add open-wheel scenarios to `handling-report`). |
| R12 | `CAR_COLORS` (8 colours, 1 per slot) | Teams need livery + team assignment, not just paint. | `shared/src/teams.ts` with fictional teams (`id`, `name`, `colors`, `emblem` procedural). Colour index stays for free play. |
| R13 | `room.ts` takes `log` by injection | Persistence will be needed in `Room`/`SessionRunner`. | Same pattern: inject `Store` interfaces (`ProfileStore`, `ChampionshipStore`, `ResultsStore`); tests use in-memory fakes; only `server/src/db/` knows SQLite. |

Do R1–R7 and R13 in **p8**, R8–R10 and R12 right before the feature that needs them (noted per phase).

## 2. Phases

### p8 — Foundations & robustness (replaces the old "Optimization & robustness")
- Refactors R1–R7, R13. Trademark lint + CI skeleton (typecheck, test, build, lint:marks).
- Binary codec + quantization (positions 16-bit relative to track bounds, quaternion smallest-three,
  wheels 8-bit). Budget: < 50 KB/s per client with 8 players *including* the new aero/ERS fields.
- Remaining robustness: tab-hidden handling, reconnect, 2nd track via the new `TrackDef`.
- **Exit:** old game plays identically on the new codec; 8 bots finish a race; `npm run lint:marks`
  is green with the old car model removed; bandwidth measured.

### p9 — Open-wheel car
> **Status 2026-10-23:** done ahead of p8 at the user's request, on top of the existing single
> `CAR` spec (R2's spec registry is still to do). Built: retune, downforce ∝ v², active aero with
> track zones, ERS + server-granted overtake (`detect` message), livery editor (3 colours + number),
> soft/medium/hard tyres with optional wear, paddle-shift sounds, power HUD, procedural car with
> animated wings. Waiting on the user's `openwheel.glb` (`docs/OPENWHEEL_MODEL.md`). R1 (remove the
> real-marque model) is done.

- **Spec** (`CAR_SPECS['open-wheel']`): ~800 kg, 3.6 m wheelbase, wide track, very low CoM, stiff
  suspension, narrow chassis box. Wheels sit outside the body, so remote-proxy colliders need small
  wheel-guard boxes (otherwise cars pass through each other's wheels). No wheel-to-wheel launch /
  damage model in v1 (note in docs as non-goal).
- **Model:** procedural `openWheelCarModel.ts` (monocoque, nose, front/rear wing with *separate
  flap meshes*, halo-like cockpit hoop, 4 exposed wheels) built from primitives/lathes → satisfies
  "every asset optional". Optional GLB override later via `gltfCarModel.ts`. `CarModel` gains
  `aero?: { frontFlap, rearFlap }` for the animation. No real-car references.
- **Active aero** (`shared/src/physics/aero.ts`): two modes. `corner` (Z): high downforce, high
  drag. `straight` (X): low drag, low downforce, reduced cornering grip (the stability assist must
  take downforce into account so a straight-mode car in a corner is *loose*, not undriveable).
  Mode ramps over ~0.3 s (animates the flaps). Player toggles with a key; on tracks with
  `aeroZones` the HUD shows when straight mode is allowed and the sim force-reverts to `corner` on
  braking or when steering > threshold (rule-light version of the real automatic behaviour).
  Applied as one-shot impulses per tick (existing rule).
- **ERS** (`physics/ers.ts`, deterministic, per tick): battery (capacity in MJ, state of charge),
  harvest under braking and partial lift, deploy adds force up to a power cap that tapers with
  speed, per-lap deploy limit. Pure functions of `(ers state, input, speed, dt)`.
- **Boost / "Overtake Mode":** extra deploy + a higher taper speed while active, drains faster.
  *Eligibility is server-decided*: at each detection gate the server (RaceTracker has per-gate
  times) checks the gap to the car ahead (< 1.0 s) and sends `boostArmed` for the next lap
  segment; the client may only use it when armed. Clients are authoritative for the physics, so a
  modified client can cheat the force itself — acceptable on a LAN (rule 1), but the *grant*
  can't be forged into race results.
- **Wire:** `CarState` + `a` (aero mode+progress, 1 byte), `e` (SoC 0–255), `bo` (boost flag).
  Remote cars animate wings from `a`; the timing tower shows SoC/boost from them.
- **Audio/FX:** reuse `DRIVETRAIN` (higher rpm range, 8 gears); add ERS whine, wing-flap click,
  boost whoosh to `AUDIO`; sparks from the plank.
- **HUD:** SoC bar, aero mode indicator, boost availability, deploy meter. Camera tuning for a low car.
- **Exit:** `npm run handling` prints open-wheel numbers inside agreed bands (0–100 km/h ≈ 2.6 s,
  lateral g in corner mode > 3, top speed higher in straight mode); ERS conserves energy in tests
  (harvested ≤ deployed + Δcharge); 8 players race with wings animating on remote cars.

### p10 — Real-track pipeline
> **Status 2026-10-23:** done except elevation (both datasets are 2D). Sources chosen by the user:
> TUMFTM racetrack-database (LGPL-3.0) preferred, Tomislav Bacinger's GeoJSON (MIT) otherwise and
> as the geographic reference. 45 circuits generated, all lapped by the headless autopilot. Notes
> per track: `tools/README.md` / the build report. Generator lives in `tools/`, not `scripts/`.

- **Input:** `tracks/src/<id>.json` = centerline polyline (lat/lon or local x,z metres), optional
  elevation, per-point left/right width, sector split fractions, start index, pit entry/exit.
  Source options, in order of preference — **check each licence before committing data**:
  (a) a permissively/LGPL-licensed racetrack database with centerline + widths,
  (b) OpenStreetMap `highway=raceway` ways (ODbL: attribution required, share-alike applies to
  the derived *database*; ship the generated tracks as a separate data file with attribution in
  CREDITS),
  (c) hand-traced from aerial imagery you have the rights to use. Elevation from a public-domain
  DEM (e.g. SRTM). Never use data scraped from timing/telemetry services or official track maps.
- **Pipeline** (`scripts/buildTrack.ts`, offline, committed output): project to local metres →
  de-noise and resample (centripetal Catmull-Rom, 2 m) → closed-loop fix → curvature check
  (reuse `track/validate.ts` limits) → widths and banking → elevation smoothing (max grade) →
  emit a compact `TrackDef` JSON. `npm run tracks` regenerates; CI checks outputs are up to date.
- **Runtime:** `TrackDef` → `buildTrack` as today, plus: height-aware road mesh and colliders
  (wheels ray-cast to the highest surface, so a heightfield road works; barriers follow the
  profile), pit lane (v1: cosmetic + speed limiter zone), kerbs by curvature, run-off by zone,
  sector gates, detection points, aero zones. Spawn grid for 8 cars in staggered 2×4 rows.
- **Scenery per track:** reuse `scenery.ts` with per-track params (tree density, stands, skyline
  seed). Minimap from the centerline (already works).
- **Content:** ship 3 circuits first (one fast, one technical, one street-like), city/country names.
- **Exit:** every shipped track passes `track.test.ts` (self-separation, min radius, length
  within ±3 % of the published length), is drivable by `bots`, and loads in < 1 s on the host.

### p11 — Player profiles (SQLite on the host)
> **Status 2026-10-23:** done, with the user's choices replacing parts of the plan below:
> `better-sqlite3` (not `node:sqlite`), name + 4-digit PIN login with bcrypt (mandatory PIN), photos
> up to 5 MB processed with `sharp` (not client-side resizing), data in `server/data/`. Poles and
> titles have columns but stay 0 until qualifying / championships exist (p12). See docs/PROFILES.md.

- **Storage:** `node:sqlite` (built into Node ≥ 22.13; the repo runs 22.14 — it still prints an
  experimental warning, so pin `engines.node` and keep the DB behind `server/src/db/` so
  `better-sqlite3` can replace it). One file `data/apex.sqlite` (`APEX_DATA_DIR` overrides;
  git-ignored; WAL mode). Numbered migrations table; never edit an applied migration.
- **Schema (v1):** `profile(id, token_hash, name, color, team_pref, created_at, last_seen)`,
  `photo(profile_id, mime, bytes, version)` (≤ 64 KB BLOB, single-file backup),
  `race_result(id, session_id, profile_id, track_id, kind, position, grid, best_lap_ms,
  total_ms, laps, points, finished_at)` — **career stats are queries over this table**, not
  counters, so they can't drift. `UNIQUE(session_id, profile_id)` makes result ingestion idempotent.
- **Identity:** no passwords (LAN). First visit creates a profile → server returns `profileId` +
  random 128-bit token, client keeps it in localStorage, server stores only a hash. Picking an
  existing profile on a new device needs an optional 4-digit PIN set by the owner. Decide: PIN
  mandatory or optional? (Default: optional.)
- **Photo upload:** the client crops and downsizes to 256×256 WebP/JPEG on a canvas and
  `POST /api/profile/photo` (token in header). Server limits: ≤ 64 KB body, magic-byte check
  for JPEG/PNG/WebP only (**no SVG**), rate limit, stored as-is, served from
  `GET /api/profile/:id/photo?v=<version>` with `X-Content-Type-Options: nosniff` and a
  restrictive CSP. No server-side image library (avoids native dependencies on Windows).
- **Career stats page:** races, wins, podiums, poles, best laps, points, distance, per-track
  bests, recent results. Shown in the profile screen and as the card in the lobby/results.
- **Lobby/results** show photo + name; `PlayerInfo` carries `profileId`, `photoVersion` (clients
  fetch photos lazily, cached by version).
- **Exit:** profiles survive server restart and tab/device changes; a 2 MB image is rejected;
  stats equal a recomputation from raw rows in a test; deleting a profile removes its photo.

### p12 — Championship mode
> **Status 2026-10-23:** done as designed in `docs/superpowers/specs/2026-10-23-championship-design.md`
> (decisions there replace the sketch below: profiles only, late entries allowed, qualifying timed or
> one-shot per season, one qualifying sets both grids, player-made teams of 1–2, real 2026-style preset).

- **Model (`shared/src/championship/`):** `ChampionshipDef` (calendar of rounds; each round:
  trackId + weekend format), fictional `Team`s (4 teams × 2 cars for 8 players; teammates assigned
  in the lobby, host can shuffle), `PointsTable` data (race 25-18-15-12-10-8-6-4, sprint 8-7-…-1
  scaled to the field, optional fastest-lap point — all in `tuning/championship.ts`).
- **Weekend flow** (a `SessionRunner` sequence): Qualifying (timed, e.g. 6–8 min, one lap per
  push, ranked by best lap, drivers released to a free track; grid = result) → Sprint (short,
  grid = qualifying reversed-top-N optional) → Race (grid = qualifying) → Results/standings.
  Weekend format is a setting (`quali+race`, `quali+sprint+race`).
- **Standings:** driver and team tables computed from stored round results (pure function in
  shared, tested) and shown after each session.
- **Save / resume:** server persists `championship(id, def_json, state_json, status)` and
  `championship_entry(champ_id, profile_id, team_id)` after every session end and on host
  command. Resume = host loads a championship; players claim their entry via `profileId` (this
  is why p11 comes first). Missing players' cars are simply absent (no AI in v1); a late joiner
  can be added to a team with free seat. Penalties/DNS are recorded as results with no points.
- **UI:** championship screen (calendar, standings, next round, team/seat assignment), host-only
  controls. Plain HTML overlay screens from R8.
- **Exit:** play a 3-round championship across a server restart; points/standings match a
  hand-computed fixture; a player who reconnects with their profile retakes their seat.

### p13 — Broadcast presentation
> **Done (2026-10-23)**, spec `docs/superpowers/specs/2026-10-23-broadcast-design.md`: five start
> lights (hold 1–3 s from `raceId`) with server-side jump-start detection (+5 s), time penalties in
> the classification, track limits (2 warnings, every 3rd strike +5 s; qualifying deletes the lap),
> left-side timing tower (gap/interval, tyre + wear, overtake, PIT/+5s/FIN/OUT), live sectors
> (purple/green/yellow + delta popup), pit lane 80 km/h limiter and 2.5 s tyre stops, chequered flag +
> cool-down, replays (spectators live, everyone as post-race highlights), 3D podium with photo
> cards. Not done: driver intro cards, onboard camera.
- **Start lights:** five-light gantry (client-rendered over the grid, red lights sequence, random
  hold of 0.2–3.0 s seeded from `raceId` so every client agrees, *then* lights out = GO). Replaces
  the 3-2-1 text beeps; server `startsAt` stays the truth. False-start detection (movement
  before lights out → server-applied time penalty).
- **Timing tower:** left-side list of position, team colour bar, 3-letter tag (from the player
  name), gap/interval, tyre-less (no tyre model), SoC/boost icon, pit/DNF state. Fed by the
  server standings (already 5 Hz) + per-gate times from R6.
- **Sector UI:** three-segment bar with purple/green/yellow colouring against session best /
  personal best; sector toast on crossing; lap delta; mini "last lap / best lap" card.
- **Banners:** driver intro card (photo + name + team), lap counter, position-gain popups, fastest
  lap banner, chequered flag, podium and championship standings screens (reuse `results.ts`).
- **Camera:** TV-style replay/onboard/cockpit/chase cycling is stretch; v1 = chase + onboard.
- All visuals are original (own typography choices, own colours, no copied graphics packages).
- **Perf:** all overlays are DOM/CSS (no extra full-screen pass); timing tower updates ≤ 5 Hz.
  Medium must stay ≥ 60 fps (measure with the FPS counter before merging).
- **Exit:** full weekend looks and reads like a broadcast; no new GPU passes; lights are in sync on
  two machines to within one frame of server time.

### p14 — Open-source readiness
- **Legal:** `LICENSE` for code (pick MIT or Apache-2.0 — decision needed), asset licences in
  `client/public/CREDITS.md`, `docs/ASSETS.md`; `NOTICE`/`DISCLAIMER.md`: *unofficial fan-made
  project, not affiliated with or endorsed by any racing series, team, driver or governing body.*
  Track data attributions (OSM ODbL if used). Run a dependency licence audit
  (`license-checker`) and record it. `npm run assets` may only download CC0/CC-BY files with
  recorded sources.
- **Hygiene:** scan git history and the tree for secrets, personal data (the DB, photos and `data/`
  must be git-ignored; no sample photos of real people), local paths, and trademark terms from
  early commits (history cannot be rewritten without consequences — decide whether to squash into
  a fresh public repo).
- **Docs:** `README.md` (what/screenshots/quick start/hosting), `CONTRIBUTING.md` (phases rule,
  commands, trademark rule, how to add a track/team/car), `CODE_OF_CONDUCT.md`, `SECURITY.md`,
  issue/PR templates, `docs/ADDING_A_TRACK.md`.
- **CI (GitHub Actions):** Windows + Linux matrix: install, typecheck, test, build, lint:marks,
  track regeneration check. Dependabot or Renovate for non-Rapier deps (Rapier stays pinned).
- **Release:** version in `package.json`, changelog, a `npm run host` smoke test, tagged release.
- **Exit:** a stranger can clone, `npm install && npm run host`, and play without reading code;
  CI is green; `lint:marks` and the licence audit are clean.

## 3. Sequencing & dependencies

```
p8 foundations ──► p9 car ──► p10 tracks ──► p11 profiles ──► p12 championship ──► p13 broadcast ──► p14 OSS
       │                                          ▲                  ▲
       └── codec, Session, TrackDef, Store ───────┴──────────────────┘
```
p9 and p10 can swap or overlap (the car can be tested on Apex Park). p11 must precede p12
(save/resume keys on `profileId`). p13's timing tower needs R6 (sector/gate times). Start the
OSS hygiene items (`lint:marks`, CI, LICENSE choice) in p8 rather than leaving them for p14.

## 4. Open decisions (need the owner's call)
1. **Code licence:** MIT vs Apache-2.0 (patent grant) vs AGPL (stops closed hosted forks).
2. **Field size:** 8 players = 4 teams × 2? AI cars are out of scope for v1 — confirm, since 2026-style grids are 22 cars.
3. **PIN on profiles:** mandatory, optional (default) or none.
4. **Track data source** (see p10) — decide before generating anything.
5. **Public repo history:** keep as is, or publish a squashed fresh history.
6. **Name:** "apex-lan" is generic, but check for clashes with existing trademarked game titles before publishing.
