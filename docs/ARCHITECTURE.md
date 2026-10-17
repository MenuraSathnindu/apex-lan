# apex-lan — Architecture

A browser-based 3D multiplayer racing game. One laptop runs the server; friends on the same
Wi-Fi open `http://<host-lan-ip>:3000` and play. Nothing to install on the client side.

---

## 1. High-level shape

```
 ┌──────────────── Host laptop ────────────────┐         ┌──── Friend's browser ────┐
 │  Node server (:3000)                        │         │  Vite-built client       │
 │   ├─ HTTP: serves client/dist (static)      │◄──HTTP──┤  Three.js renderer       │
 │   ├─ WS  /ws: game protocol                 │◄══WS═══►│  Rapier: own car (auth.) │
 │   └─ Room: players, host, race phase;       │         │  Remote cars: interp. +  │
 │        relays car states @ 30 Hz            │         │  kinematic proxies       │
 └─────────────────────────────────────────────┘
```

- **One port, one process.** In production mode the server serves the static client *and*
  the WebSocket on `/ws`, so friends only need one URL.
- **Clients own their cars; the server owns the room** (see §3). Each client simulates its
  own car and reports its state; the server relays states and runs lobby/race logic.
- **Shared simulation code.** Vehicle, tuning, track geometry/colliders and protocol helpers
  live in `/shared`, so every client simulates identically (and a server sim stays possible).

---

## 2. Folder structure

```
apex-lan/
├─ package.json              # npm workspaces root: ["client", "server", "shared"]
├─ tsconfig.base.json        # strict TS settings shared by all packages
├─ CLAUDE.md
├─ docs/
│  └─ ARCHITECTURE.md
├─ shared/                   # @apex/shared — pure TS, no DOM, no Node APIs
│  ├─ package.json           # "exports": { ".": "./src/index.ts" }  (consumed as source)
│  └─ src/
│     ├─ index.ts
│     ├─ constants.ts        # TICK_RATE, SNAPSHOT_RATE, MAX_PLAYERS, INTERP_DELAY_MS ...
│     ├─ tuning.ts           # ALL gameplay tuning: CAR (handling), CAMERA, INPUT
│     ├─ input.ts            # CarInput (what clients send each tick)
│     ├─ protocol/
│     │  ├─ messages.ts      # discriminated-union message types (C2S / S2C)
│     │  └─ codec.ts         # encode/decode (JSON first, binary later — same API)
│     ├─ physics/
│     │  ├─ rapier.ts        # single place that imports & inits rapier3d-compat
│     │  ├─ vehicle.ts       # createVehicle / stepVehicle / resetVehicle / readWheelStates
│     │  ├─ handlingMetrics.ts # headless scenarios → numbers (tests + `npm run handling`)
│     │  ├─ collisionGroups.ts
│     │  └─ world.ts         # createWorld(), addStaticBoxes()
│     ├─ track/
│     │  ├─ testGround.ts    # phase 1 playground (used by vehicle tests)
│     │  ├─ spline.ts        # centripetal Catmull-Rom, even arc-length samples (pos, tangent, normal, curvature)
│     │  ├─ track.ts         # TrackDef → BuiltTrack: road/curb/line/barrier mesh data, barrier segments, spawn grid
│     │  ├─ tracks.ts        # concrete track definitions (APEX_PARK)
│     │  └─ validate.ts      # min corner radius / self-separation checks (used by tests)
│     ├─ race/
│     │  ├─ checkpoints.ts   # gates every ~100 m, crossesGate(), respawnPose(), nearestSample()
│     │  └─ raceTracker.ts   # authoritative laps/times/standings from positions (+ test)
│     └─ util/
│        ├─ math.ts          # quat/vec helpers, lerp, slerp, angle wrap
│        └─ ringBuffer.ts
├─ server/                   # @apex/server — Node + ws
│  ├─ package.json
│  └─ src/
│     ├─ main.ts             # HTTP static + WS → Room, 30 Hz update, WS heartbeat
│     ├─ net/staticFiles.ts
│     ├─ game/
│     │  ├─ room.ts          # the room: players, host, slots/colours, race phase, rejoin, relay
│     │  └─ room.test.ts
│     └─ util/lanAddress.ts
├─ scripts/
│  ├─ handling-report.ts     # `npm run handling`
│  ├─ download-assets.mjs    # `npm run assets`
│  └─ bots.ts                # `npm run bots -- N`
└─ client/                   # @apex/client — Vite + Three.js (Rapier via @apex/shared)
   ├─ package.json
   ├─ vite.config.ts         # server.host = true, proxy /ws -> :3000
   ├─ index.html
   ├─ public/                # hdri/ textures/ models/ (git-ignored, `npm run assets`), draco/ (auto), CREDITS.md
   └─ src/
      ├─ main.ts             # bootstrap: init Rapier, renderer, connect, start loop
      ├─ core/
      │  └─ loop.ts          # fixed-step physics accumulator + rAF render
      ├─ net/
      │  ├─ socket.ts        # WS wrapper, reconnect, ping burst
      │  ├─ clock.ts         # ServerClock (offset from low-RTT pongs)
      │  └─ interpolation.ts # SnapshotBuffer: lerp/slerp/extrapolate (+ test)
      ├─ game/
      │  ├─ session.ts       # identity (sessionStorage), profile (localStorage), room state
      │  ├─ remoteCars.ts    # remote cars: buffer + kinematic proxy + model + name tag
      │  └─ raceController.ts # wrong-way, auto-respawn at last checkpoint, manual respawn
      ├─ input/
      │  ├─ keyboard.ts
      │  ├─ gamepad.ts
      │  └─ inputController.ts # keyboard + gamepad -> shared CarInput
      ├─ render/
      │  ├─ graphics.ts      # renderer + scene + camera + resize; applies quality presets
      │  ├─ environment.ts   # HDRI (or procedural Sky) → PMREM, sun detection, follow-shadow, fog
      │  ├─ post.ts          # postprocessing: N8AO → bloom + ACES + vignette → SMAA
      │  ├─ quality.ts       # QualityManager: Low/Medium/High, persisted, FPS auto-pick
      │  ├─ textures.ts      # PBR texture sets with procedural fallbacks
      │  ├─ carView.ts       # CarModel contract + CarView (places wheels from sim, brake lights)
      │  ├─ gltfCarModel.ts  # GLB (Draco) → CarModel, auto-fitted to the physics car
      │  ├─ boxCarModel.ts   # placeholder CarModel (fallback)
      │  ├─ trackView.ts     # meshes from shared track mesh data + materials
      │  ├─ scenery.ts       # instanced trees, tyre walls, billboards, grandstand, gantry
      │  ├─ cameraRig.ts     # chase (lag, speed-based FOV) + hood cameras
      │  └─ effects/         # (later) skid marks, tire smoke, sparks
      ├─ audio/              # WebAudio engine/tire/impact sounds
      ├─ types/n8ao.d.ts     # n8ao ships no types
      └─ ui/                 # HTML/CSS overlay: HUD, settings, loading, lobby, countdown, race HUD, results, name tags
```

**Why consume `/shared` as TypeScript source:** no separate build step or watch process for
shared. Vite compiles it for the client; `tsx` runs it on the server in dev; `esbuild` bundles
it into the server build for prod.

---

## 3. Networking model

> **Changed 2026-10-17 (user decision):** the original plan was server-authoritative physics
> with client prediction and reconciliation. For a LAN game among friends, the game now uses a
> **client-authoritative relay**. Each player's own car feels instant with no reconciliation, and
> the server stays tiny. The trade-offs are that cheating is possible (irrelevant among friends)
> and car-to-car contact is asymmetric. Physics still lives in `/shared`, so moving to server
> authority later remains possible.

### 3.1 Roles
- **Client:** simulates its own car with Rapier at 60 Hz, sends `CarState` at 30 Hz, and
  renders everyone else from relayed snapshots.
- **Server (`server/src/game/room.ts`):** one `Room`, independent of sockets and unit-tested.
  It owns players (id, name, colour, grid slot), the host, the race phase and rejoin. It
  validates and relays car states and never simulates.

### 3.2 Transport & rates
- WebSocket (`ws`), JSON through `codec.ts` (binary later, same API).
- Client → server `state` every 2nd physics tick (30 Hz). Server → clients `snapshot` at 30 Hz
  with only the states that changed, each stamped `ts` = server receive time.
- Ping/pong once per second (a 5-ping burst on connect) feeds the client's `ServerClock`: the
  median offset of the lowest-RTT samples. Measured on LAN, two clients agree to within 1 ms.
- Server WebSocket ping frames every 2 s. The browser answers them without JavaScript, so
  background tabs (timers throttled to ~1/min) still count as alive.

### 3.3 Messages (`shared/protocol/messages.ts`)
```
C2S: hello{sessionId,name,color} · profile{name,color} · state{s: CarState} · start · endRace · ping
S2C: welcome{playerId,sessionId,hostId,players,race,resume} · roster{hostId,players}
     · race{phase,raceId,startsAt} · snapshot{cars: (CarState & {id, ts})[]} · pong · full
CarState = { p[3], q[4], v[3], wh[12] (steer, spin, wheelY ×4), b (braking) } — rounded
```

### 3.4 Remote cars (`client/src/game/remoteCars.ts`)
- Per player: a `SnapshotBuffer` (1 s history), a cloned car model in their colour, an HTML
  name tag, and a **kinematic-position-based** Rapier body (chassis box, group `REMOTE_PROXY`).
- Each physics tick the proxy is moved with `setNextKinematic*` to the pose at
  `serverNow − 100 ms` (lerp/slerp; ≤150 ms velocity extrapolation if data runs out). Rapier
  derives its velocity, so your car bounces off it realistically.
- Each frame the model and tag are placed at the same interpolated pose. No update for
  1.5 s → the car is hidden and its collider disabled.
- **Asymmetric contact:** on your screen a remote car can't be pushed. If you ram someone,
  you bounce on your screen and they get shoved on theirs.

### 3.5 Room & race flow
- Join: `hello` → `welcome`. You get the lowest free grid slot and your colour (or the first
  free one); the room holds `MAX_PLAYERS` (8), and a 9th connection gets `full`.
- Lobby (`client/src/ui/lobby.ts`): name, colour (taken colours disabled), player list with
  host/you badges. Only the host sees **Start**.
- `start` → `countdown` (3 s, `startsAt` on the server clock; everyone resets to their grid
  slot and is held) → `racing`. The host can **End race** → `lobby` (back to the grid).
- **Disconnects:** close event, or no messages/pongs for 5 s → marked away; the slot, name and
  colour are held for 30 s.
- **Rejoin:** the client keeps the server-issued `sessionId` in `sessionStorage`, so a reload
  or Wi-Fi blip comes back as the same player. Mid-race it resumes at its last reported state;
  if the local car is already in that race (a quick blip), it keeps driving. A duplicated tab
  (same session, original still live) becomes a new player.
- **Host** = earliest-joined connected player. It passes on during a disconnect and returns
  on rejoin.

### 3.6 Race logic (`shared/src/race/`, run by the server)
- On `start` the server snapshots the connected players as participants and creates a
  `RaceTracker(track, gates, participants, startsAt, laps)`. Late joiners can drive but aren't
  ranked.
- Every relayed state goes into `tracker.onState(id, x, z, serverTs)`. A racer must cross
  `nextGate`; crossing gate 0 after all the others completes a lap, which records the lap time
  and best lap and broadcasts a `lap` event. Movement faster than `RACE.maxPlausibleSpeed` (a
  teleport, a respawn or a forged position) never crosses anything, and nothing counts before
  `startsAt`. So skipping track sections, cutting across the infield, driving backwards or
  hopping over the line can't produce a lap.
- Standings: finishers by finish time, then everyone else by progress
  (`laps × gates + gates passed + fraction to the next gate`, from the nearest centreline
  sample). Broadcast at 5 Hz.
- When the first car finishes, `finishDeadline = now + 30 s`. Results come at the deadline or
  as soon as every connected participant has finished. Unfinished racers become **DNF**, the
  phase becomes `results` (podium + table), and the host's **Race again** returns to the lobby.
- Client-side (`raceController.ts`): input is locked until the server clock passes
  `startsAt`; a wrong-way warning after 1.2 s heading against the track; auto-respawn at the
  last passed checkpoint (from the server's `nextGate`) when stuck on grass for 3 s, beyond the
  barriers, below the world, or flipped for 2 s; R respawns manually during a race.

### 3.7 Testing
- `server/src/game/room.test.ts`: join/full/colours/names, rejoin and grace expiry, duplicate
  tabs, host handover and return, start/countdown/end, relay, malformed input, dead
  connections, heartbeat, lap setting, a full race to results, fake-lap rejection.
- `shared/src/race/raceTracker.test.ts`: gates, lap counting and times, nothing before GO,
  teleport shortcuts and backwards laps rejected, ranking, finish grace and DNF, late joiners.
- `client/src/net/interpolation.test.ts`: buffer sampling, slerp, extrapolation, clock.
- `npm run bots -- N`: N fake players that lap the racing line; fills a room for load tests.
  They don't avoid anyone, so they shove a stationary car off the grid.
- Manual: two browser **windows** side by side (a background tab stops rendering).

### 3.8 LAN hosting specifics
- HTTP + WS on `0.0.0.0:3000`. On boot the server prints every non-internal IPv4:
  `Join at: http://192.168.1.23:3000`.
- **Windows firewall:** first run prompts to allow Node — tick *Private networks*. Document this
  in the README; it is the #1 "friends can't connect" cause.
- `rapier3d-compat` ships WASM inlined as base64 → no special MIME / COOP/COEP headers needed,
  plain HTTP over LAN works (no secure-context requirement for WebGL/WebSocket/WebAudio).
- Browsers only expose the Gamepad API to secure contexts (https / localhost). The host on
  `localhost` gets gamepad support; friends on `http://<lan-ip>` get keyboard. Fix later with a
  self-signed https option if needed.

---

## 4. Physics approach

### 4.1 Rapier setup
- `@dimforge/rapier3d-compat`, **exact version pinned** as a dependency of `@apex/shared`, so
  client and server always load the same WASM ⇒ near-identical results ⇒ fewer reconciliations.
- `shared/physics/rapier.ts` is the only file that imports Rapier; it exposes `initRapier()`
  (awaits `RAPIER.init()`) and re-exports the module.
- Gravity `(0, -9.81, 0)`, fixed `dt = 1/60`, world integration parameters set once in
  `createWorld()`.

### 4.2 Coordinate conventions (must stay consistent)
- **Y up, metres, seconds, kilograms, radians.**
- **Car forward = +Z in chassis local space** (matches glTF's +Z-forward convention), right = −X.
- Vehicle controller: up axis 1, forward axis 2, set explicitly — Rapier's default forward
  axis is X. In v0.21 these are property setters: `controller.indexUpAxis = 1;
  controller.setIndexForwardAxis = 2;` (yes, the setter is really named that).
- Steering: Rapier's positive wheel angle turns **left**; `CarInput.steer` +1 means right, so
  `stepVehicle` negates it. Wheel rotation is positive when rolling forward.

### 4.3 Vehicle (shared/physics/vehicle.ts)
- **Chassis:** dynamic rigid body + cuboid collider (1.8 × 0.6 × 4.3 m), 1200 kg, explicit
  mass properties (`ColliderDesc.setMassProperties`) with a **lowered centre of mass** and
  scaled box inertia. Small angular damping.
- **Controller:** `world.createVehicleController(chassis)`; four `addWheel(connectionCs,
  directionCs=(0,-1,0), axleCs=(-1,0,0), suspensionRestLength, radius)`.
- **Units learned from Rapier v0.21:** suspension stiffness/damping are per unit of chassis
  mass (sag ≈ 9.81 / (4·k)); engine force is newtons; brake is impulse per tick;
  `frictionSlip` behaves like tyre μ (1.5 ≈ 1.3 g cornering).
- **All tunables** in `shared/src/tuning.ts` (`CAR`). `npm run handling` prints 0–100, top
  speed, braking distance, cornering g, drift angle/recovery and rollover checks; Vitest asserts
  they stay in sane ranges.
- **Drivetrain (arcade-sim):**
  - Rear-wheel drive by default; drive force = `min(maxForce, power / speed)` (a constant-power
    curve, no gearbox yet — a gearbox/RPM model for engine audio comes in phase 7).
  - Brakes on all wheels, front-biased. Brake pedal reverses when (nearly) stopped.
  - Handbrake: rear brake + rear grip (`sideFrictionStiffness`, `frictionSlip`) drops while
    held, then eases back over `gripRecoveryTime`.
  - **Speed-sensitive steering:** max steer angle shrinks with speed; the wheel angle is
    rate-limited toward the target so keyboard input isn't twitchy.
- **Stability assist (ESC-like):** Rapier's Bullet-style sliding friction never lets a slide
  self-recover. While the handbrake is *not* held, `stepVehicle` removes yaw rate in excess of
  the bicycle-model target (`v·tan(δ)/wheelbase`, capped at the grip limit `μg/v`). It never
  adds yaw. `CAR.assist.yawStability = 0` gives raw physics.
- **Extra forces** each tick as one-shot impulses (not `addForce`, which persists): drag
  (`∝ v²`), rolling resistance (`∝ v`), downforce (`∝ v²`).
- **Order per tick:** `stepVehicle()` (input → steering/drive/brakes → aero → `updateVehicle`
  → assist) for every car, then `world.step()`.
- **Body roll:** the raycast vehicle produces almost none whatever the centre of mass. Visual
  roll/pitch from lateral/longitudinal acceleration will be added in the renderer (phase 6).
- **Reset/respawn:** phase 1 resets upright in place (lifted, heading kept), zero velocities;
  auto-reset if upside-down/on its side > 3 s. Phase 2 changes it to the last checkpoint.

### 4.4 Track physics
- Track geometry is generated **deterministically from a `TrackDef`** in `/shared`, so server and
  client build identical colliders from the same data, with no collider assets to keep in sync.
- Layers (flat circuit): grass ground cuboid top at y = 0, road `trimesh` at +2 cm, curbs `trimesh`
  at +3.5 cm. Wheel rays hit the highest surface. Barriers are a chain of cuboids (4 m segments,
  slightly overlapping); the car body has CCD so it can't tunnel through them.
- **Surfaces:** Rapier's vehicle ignores collider friction, so colliders are tagged
  (`tagSurface`) and `stepVehicle` reads each wheel's ground collider: `CAR.surfaces` scales
  `frictionSlip` and adds rolling drag (grass = 55% grip + heavy drag).
- Checkpoints are **geometry, not physics sensors**, so the server can evaluate them without
  a physics world: `buildCheckpoints()` places a gate (a line across the full width up to the
  barriers) every ~100 m, gate 0 on the start line. `crossesGate()` checks that the segment
  between two consecutive positions crosses the line in the driving direction. See §3.8.

### 4.5 Collision groups
`TRACK`, `CAR`, `REMOTE_PROXY` (client only). Wheel raycasts only hit `TRACK` (filter via
`updateVehicle`'s filter groups) so wheels never "drive on" another car's roof.

---

## 5. Rendering pipeline

### 5.1 Renderer
- `THREE.WebGLRenderer` (`antialias: false`, AA done in post), `outputColorSpace = SRGB`,
  physically based light units (three's default since r155). `renderer.toneMapping` stays
  `NoToneMapping`: the post chain renders into HalfFloat buffers and applies **ACES Filmic** in
  its effect pass, so tone mapping happens once, after bloom.
- Pixel ratio capped by quality preset (`min(devicePixelRatio, 1.0/1.25/2.0)`).
- Render loop decoupled from physics: `requestAnimationFrame` renders interpolated state;
  own car is rendered at `lerp(prevPhysicsState, currPhysicsState, alpha)` from the fixed-step
  accumulator, plus the reconciliation visual offset.

### 5.2 Lighting & environment ("realistic look" comes mostly from here)
- **HDRI image-based lighting:** 2k `.hdr` from Poly Haven (CC0), loaded with `HDRLoader`,
  → `PMREMGenerator` → `scene.environment` (car-paint reflections matter most) and
  `scene.background`. On load the HDRI is scanned: the **brightest pixel gives the sun
  direction** (so shadows match the sky) and the horizon row gives the **fog colour**.
- **No HDRI file →** three's `Sky` shader baked to a PMREM, used for background + environment,
  dimmed with `backgroundIntensity`/`environmentIntensity` (Sky's raw output is very bright).
- **Sun:** one `DirectionalLight`; its shadow camera **follows the player** (±25–40 m depending
  on preset), snapped to whole shadow texels so edges don't shimmer while driving. Soft edges
  via `PCFShadowMap` + `shadow.radius` (r186 removed `PCFSoftShadowMap`). Cascaded shadow maps
  were skipped: one follow-shadow covers what the player sees up close, and CSM needs every
  material patched.
- `FogExp2` for aerial perspective.

### 5.3 Materials & assets
All assets are optional with procedural fallbacks; see `docs/ASSETS.md` and `npm run assets`.
- **Car:** any GLB (Draco OK; the decoder is served locally from `public/draco/`).
  `gltfCarModel.ts` rotates it to +Z, scales it to the physics wheelbase, aligns its wheel
  centroid with the physics wheels at rest, detaches the 4 wheel nodes into centred wrappers,
  and swaps materials by name: paint → `MeshPhysicalMaterial` (metalness 1, roughness 0.45,
  clearcoat 1), glass → `MeshPhysicalMaterial` with `transmission` (High) or plain transparency,
  headlights/brake lights → emissive (brake lights brighten while braking and bloom).
- **Track:** asphalt PBR (albedo/normal GL/roughness), grass PBR (tinted), red/white curbs on
  corners (canvas texture), painted edge lines, chequered start line, concrete barriers with
  a painted top band. Flat layers use `polygonOffset` against z-fighting.
- **Scenery:** `InstancedMesh` trees (two kinds, per-instance colour), tyre walls on corner
  exits, billboards on straights, plus a grandstand and start gantry. Placement is seeded
  (identical on every client) and kept outside the barriers.
- **Effects (later):** skid marks, tyre smoke, sparks.

### 5.4 Post-processing
`postprocessing` (pmndrs) `EffectComposer` with HalfFloat buffers:
`RenderPass → N8AOPostPass (High only, half-res) → EffectPass(Bloom, ACES ToneMapping,
Vignette) → EffectPass(SMAA)`. The chain is rebuilt when the quality level changes.

### 5.5 Camera
Chase camera with critically-damped spring toward a target behind & above the car, look-ahead
along velocity, speed-based FOV (60° → 75°), slight shake on high speed / impacts.
Alternate cameras: bumper, hood. Orbit camera in lobby.

### 5.6 Quality presets
`low | medium | high` (`QUALITY` in `tuning.ts`), chosen in the settings panel (Esc / ⚙) and
saved in `localStorage`. **Auto** (default) starts at High, skips 1.5 s of warm-up, averages
FPS over 2.5 s and steps down while it's below 50. It never steps back up on its own.

| | Low | Medium | High |
|---|---|---|---|
| Pixel ratio cap | 1.0 | 1.25 | 2.0 |
| Shadows | off | 2048, radius 3, ±35 m | 2048, radius 4, ±40 m |
| AO / Bloom | — / — | — / bloom | N8AO (half-res) / bloom |
| Glass | transparent | transparent | transmission |
| Scenery density | 30% | 65% | 100% |
| Texture anisotropy | 2 | 4 | 8 |

Measured on the host laptop's GPU (headless, 720p): AO plus a 4096 shadow map was the
expensive combination, so High uses 2048 + half-res AO.

---

## 6. Build phases

Each phase ends with a **playable/demoable** state and explicit exit criteria.

| # | Phase | Exit criteria |
|---|---|---|
| **0** | **Scaffold** — workspaces, strict TS, Vite client, Node server serving `client/dist` + `/ws`, LAN URL print, ping/pong, Vitest | A phone on the Wi-Fi opens `http://<ip>:3000` and shows a spinning cube + live RTT |
| **1** | **Offline driving** — Rapier init, vehicle on flat ground, keyboard + gamepad, chase camera, fixed-step loop, debug wireframe of colliders | Car accelerates, brakes, steers, drifts with handbrake, doesn't roll over in normal turns |
| **2** | **Track & laps** ✅ — spline track in `/shared`, colliders + meshes, checkpoint gates, server-validated laps, respawn at last checkpoint, race HUD | Complete timed laps; shortcuts don't count; respawn works |
| **3** | ~~**Networking v1**~~ → **client-authoritative relay** (done 2026-10-17): Room on server, 30 Hz state relay, snapshot interpolation, kinematic remote proxies, name tags, rejoin, bots | 2+ windows see each other drive smoothly and can bump; reload mid-race resumes; 8 players |
| **4** | ~~**Prediction & reconciliation**~~ — not needed under the client-authoritative model | — |
| **5** | **Race flow** ✅ — lobby (name/colour/laps), countdown with input lock, grid start, live positions, finish grace, results podium, race again | Full race with friends start → results without reloading |
| **6** | **Visual realism** — HDRI IBL, glTF cars with paint/clearcoat, shadows, post FX, PBR road, scenery, skid marks/smoke, quality presets | Looks "realistic-ish"; ≥60 fps on host laptop at Medium |
| **7** | **Audio & polish** — engine (RPM-pitched loops), tire squeal, impacts, HUD/minimap, settings menu, camera modes | Feels like a game |
| **8** | **Optimization & robustness** — binary codec, snapshot quantization, reconnect, tab-hidden handling, perf profiling, 2nd track | 8 players stable for a full race; bandwidth per client < 50 KB/s |

---

## 7. Key risks & mitigations
- **Handling feel** is the biggest unknown → Phase 1 is single-player on purpose; keep all
  tunables in `shared/src/tuning.ts`, measure with `npm run handling`, and (later) add a
  live-tweak debug panel (`lil-gui`).
- **Prediction artifacts from car contacts** → remote proxies in local world + visual
  smoothing; LAN latency keeps it small.
- **Weak friend laptops** → quality presets + capped pixel ratio from Phase 6.
- **Asset licences** → only CC0/CC-BY, recorded in `CREDITS.md`.
- **Rapier API drift** → pin exact version; all Rapier calls go through `/shared/physics`.
