# apex-lan — Architecture

A browser-based 3D multiplayer racing game. One laptop runs the server; friends on the same
Wi-Fi open `http://<host-lan-ip>:3000` and play. Nothing to install on the client side.

---

## 1. High-level shape

```
 ┌──────────────── Host laptop ────────────────┐         ┌──── Friend's browser ────┐
 │  Node server (:3000)                        │         │  Vite-built client       │
 │   ├─ HTTP: serves client/dist (static)      │◄──HTTP──┤  Three.js renderer       │
 │   ├─ WS  /ws: game protocol                 │◄══WS═══►│  Rapier (own-car predict)│
 │   └─ Authoritative sim: Rapier @ 60 Hz      │         │  Interp. of remote cars  │
 │        broadcasts snapshots @ 30 Hz         │         └──────────────────────────┘
 └─────────────────────────────────────────────┘
```

- **One port, one process.** In production mode the server serves the static client *and*
  the WebSocket on `/ws`, so friends only need one URL.
- **Server is authoritative.** It runs the full physics world (all cars + track). Clients send
  *inputs*, never positions.
- **Shared simulation code.** The vehicle setup, track collider generation and constants live in
  `/shared` and are imported by both client and server, so prediction runs the *same* code the
  server runs.

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
│     │  ├─ testGround.ts    # phase 1 playground (ground, ramps, bumps, blocks)
│     │  ├─ trackDef.ts      # control points, width, banking, checkpoints, spawn grid
│     │  ├─ spline.ts        # Catmull-Rom centerline sampling (pos, tangent, normal)
│     │  ├─ trackGeometry.ts # builds vertex/index arrays (road, barriers) — renderer-agnostic
│     │  └─ tracks/          # concrete track definitions
│     ├─ race/
│     │  └─ lapLogic.ts      # checkpoint progression, lap counting, race position
│     └─ util/
│        ├─ math.ts          # quat/vec helpers, lerp, slerp, angle wrap
│        └─ ringBuffer.ts
├─ server/                   # @apex/server — Node + ws
│  ├─ package.json
│  └─ src/
│     ├─ main.ts             # HTTP static + WS upgrade, prints LAN URLs on boot
│     ├─ net/
│     │  ├─ connection.ts    # per-socket wrapper: decode, rate-limit, ping
│     │  └─ broadcaster.ts   # builds & sends snapshots at SNAPSHOT_RATE
│     ├─ game/
│     │  ├─ room.ts          # single room: players, state machine (lobby/countdown/race/results)
│     │  ├─ simulation.ts    # Rapier world, fixed 60 Hz loop, input queue per player
│     │  └─ player.ts
│     └─ util/lanAddress.ts
├─ scripts/
│  └─ handling-report.ts     # `npm run handling`
└─ client/                   # @apex/client — Vite + Three.js (Rapier via @apex/shared)
   ├─ package.json
   ├─ vite.config.ts         # server.host = true, proxy /ws -> :3000
   ├─ index.html
   ├─ public/assets/         # compressed glTF (Draco/Meshopt), KTX2 textures, HDRI
   └─ src/
      ├─ main.ts             # bootstrap: init Rapier, renderer, connect, start loop
      ├─ core/
      │  ├─ loop.ts          # fixed-step physics accumulator + rAF render
      │  └─ clock.ts         # server-time estimate (ping/offset smoothing)
      ├─ net/
      │  ├─ socket.ts        # WS wrapper, reconnect, codec
      │  ├─ prediction.ts    # input history, reconciliation, replay
      │  └─ interpolation.ts # snapshot buffer + sampling for remote cars
      ├─ input/
      │  ├─ keyboard.ts
      │  ├─ gamepad.ts
      │  └─ inputController.ts # keyboard + gamepad -> shared CarInput
      ├─ render/
      │  ├─ scene.ts         # renderer, lights, ground, static boxes (phase 1; split into
      │  │                   #   renderer.ts / environment.ts in phase 6: HDRI, quality presets)
      │  ├─ post.ts          # postprocessing composer (SMAA, bloom, AO)
      │  ├─ carView.ts       # CarModel {body, wheels[4]} + CarView (places wheels from sim)
      │  ├─ boxCarModel.ts   # placeholder CarModel; a gltfCarModel.ts will produce the same shape
      │  ├─ trackView.ts     # meshes from shared trackGeometry + materials
      │  ├─ cameraRig.ts     # chase (lag, speed-based FOV) + hood cameras
      │  └─ effects/         # skid marks, tire smoke, sparks
      ├─ audio/              # WebAudio engine/tire/impact sounds
      ├─ ui/                 # HTML/CSS overlay: lobby, HUD, results, net-debug panel
      └─ assets/loader.ts    # GLTFLoader + DRACO/KTX2/Meshopt, preloading with progress
```

**Why consume `/shared` as TypeScript source:** no separate build step or watch process for
shared. Vite compiles it for the client; `tsx` runs it on the server in dev; `esbuild` bundles
it into the server build for prod.

---

## 3. Networking model

### 3.1 Transport
- **WebSocket (`ws`)** over TCP. On a LAN, loss and head-of-line blocking are negligible.
  Disable Nagle (`socket.setNoDelay(true)`) on the server side.
- **Codec abstraction** from day one (`encode(msg) → ArrayBuffer | string`). Start with JSON for
  debuggability; switch the hot messages (`input`, `snapshot`) to a compact binary layout
  (`DataView`, quantized floats) in the optimization phase without touching game code.

### 3.2 Rates & time
| Thing | Rate | Notes |
|---|---|---|
| Physics tick (server & client) | **60 Hz** fixed (`dt = 1/60`) | accumulator loop, never variable dt |
| Client → server input | every client tick (60 Hz) | tiny message; tagged with `seq` |
| Server → client snapshot | **30 Hz** (every 2nd tick) | all cars + race state |
| Remote-car interpolation delay | **~100 ms** (≈3 snapshots) | tunable; LAN can go lower (66 ms) |
| Ping | 1 Hz | RTT + server clock offset estimate |

All server state is stamped with a **tick number**. The client keeps a smoothed estimate of
`serverTime ≈ localTime + offset` from ping/pong (`offset` = median of last N samples).

### 3.3 Messages (shared/protocol/messages.ts)
```ts
// Client → Server
type C2S =
  | { t: 'join'; name: string; color: number }
  | { t: 'input'; seq: number; throttle: number; brake: number; steer: number; handbrake: boolean; reset: boolean }
  | { t: 'ready'; ready: boolean }
  | { t: 'ping'; clientTime: number };

// Server → Client
type S2C =
  | { t: 'welcome'; playerId: number; tick: number; trackId: string; roster: PlayerInfo[] }
  | { t: 'roster'; players: PlayerInfo[] }
  | { t: 'snapshot'; tick: number; ackSeq: number; cars: CarState[]; race: RaceState }
  | { t: 'event'; e: RaceEvent }          // countdown, lap, finish, collision...
  | { t: 'pong'; clientTime: number; serverTime: number };

interface CarState {
  id: number;
  p: [number, number, number];          // chassis position
  q: [number, number, number, number];  // chassis rotation
  v: [number, number, number];          // linear velocity
  w: [number, number, number];          // angular velocity
  wheels: { steer: number; spin: number; susp: number }[]; // visual-only
}
```
`ackSeq` is per-recipient: the last input `seq` the server applied for *that* client.

### 3.4 Server loop
1. Each tick, for every player pop the next queued input (keep the last one if the queue is
   empty — "input repeat"); cap the queue (e.g. 8) to stop speed-hacking/backlog.
2. `applyInput` → `vehicle.updateVehicle(dt)` for each car → `world.step()`.
3. Run lap/checkpoint logic.
4. Every 2nd tick, broadcast a snapshot (with per-client `ackSeq`).

### 3.5 Own car: client-side prediction + reconciliation
The client runs its **own local Rapier world** containing: the static track collider, the
player's car (dynamic, full vehicle controller), and every remote car as a
**kinematic-position-based** body placed at its interpolated pose (so you predictively bump into
them).

Per client tick:
1. Sample input → assign `seq` → store `{seq, input}` in a ring buffer → send to server.
2. Apply the input to the local car and step the local world.

On each snapshot:
1. Drop buffered inputs with `seq <= ackSeq`.
2. Compare server's own-car state with the locally predicted state *for `ackSeq`*
   (keep a ring buffer of predicted states keyed by `seq`).
3. If the error is below a threshold (e.g. 5 cm / 1°): do nothing.
4. Otherwise: **set the car's body to the server state, replay all un-acked inputs** (stepping
   only the local world — cheap, since it holds one dynamic body), then hide the pop with a
   **visual offset** that decays to zero over ~100 ms (the render mesh is offset from the
   physics body; physics itself snaps).
5. Very large error (> 3 m, e.g. respawn/teleport): hard snap, no smoothing.

On a LAN the RTT is a few ms, so replays are short (1–3 ticks) and corrections are rare —
they mostly come from car-vs-car contacts, which the server resolves authoritatively.

### 3.6 Remote cars: snapshot interpolation
- Keep a buffer of the last ~1 s of snapshots per car.
- Render time = `estimatedServerTime − INTERP_DELAY`.
- Find the two snapshots bracketing render time; **lerp position, slerp rotation**. Velocity in
  the snapshot allows Hermite interpolation later if motion looks steppy.
- If the buffer runs dry, extrapolate with velocity for up to ~150 ms, then freeze.

### 3.7 Room / session
- One room per server, up to 8 players. State machine:
  `lobby → countdown → racing → results → lobby`.
- Join with name + paint colour; host-side has no special UI (any player can press "ready";
  race starts when all ready, or ≥1 ready + 10 s timer).
- On disconnect the car is removed; reconnects within 30 s keep the slot (later phase).

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
- Track geometry is generated **deterministically from `trackDef`** in `/shared`, so server and
  client build identical colliders from the same data — no collider assets to keep in sync.
- Road surface → `trimesh` collider; barriers → trimesh or a chain of cuboids; ground plane →
  large cuboid. Run-off surfaces (grass) get lower friction via collider friction values.
- Checkpoints are sensor-free: progress is computed by projecting the car onto the spline
  (`lapLogic.ts`), which also yields race position (lap × length + distance along spline).

### 4.5 Collision groups
`TRACK`, `CAR`, `REMOTE_PROXY` (client only). Wheel raycasts only hit `TRACK` (filter via
`updateVehicle`'s filter groups) so wheels never "drive on" another car's roof.

---

## 5. Rendering pipeline

### 5.1 Renderer
- `THREE.WebGLRenderer` (`antialias: false` — AA done in post), `outputColorSpace = SRGB`,
  `toneMapping = AgX` (or ACES Filmic), physically-correct lighting (Three default since r155).
- Pixel ratio capped by quality preset (`min(devicePixelRatio, 1.0/1.5/2.0)`).
- Render loop decoupled from physics: `requestAnimationFrame` renders interpolated state;
  own car is rendered at `lerp(prevPhysicsState, currPhysicsState, alpha)` from the fixed-step
  accumulator, plus the reconciliation visual offset.

### 5.2 Lighting & environment ("realistic look" comes mostly from here)
- **HDRI image-based lighting:** 2k `.hdr`/`.exr` from Poly Haven (CC0) → `PMREMGenerator` →
  `scene.environment` (reflections on car paint matter more than anything else) and as the
  visible sky (`scene.background`, or a cheaper blurred version).
- **Sun:** one `DirectionalLight` aligned with the HDRI sun; shadow camera **follows the
  player's car** with a tight frustum (≈80 m), 2048² map, `PCFSoftShadowMap`. Cascaded shadow
  maps (three `CSM` addon) only on High preset.
- Exponential height fog for depth.

### 5.3 Materials & assets
- **Cars:** glTF 2.0 (CC0/CC-BY sources, licences tracked in `client/public/assets/CREDITS.md`),
  compressed with `gltf-transform` (Meshopt or Draco geometry, KTX2/Basis textures).
  Paint = `MeshPhysicalMaterial` with `clearcoat`; colour swapped per player. Separate wheel
  nodes so we can spin/steer them from `wheels[]`. Emissive brake lights.
- **Track:** road mesh from `shared/track/trackGeometry` with tiling asphalt PBR textures
  (albedo/normal/roughness), painted kerbs, line markings via a second UV channel or decal
  strip. Scenery (trees, grandstands, cones) via `InstancedMesh`.
- **Effects:** skid marks (ring-buffer ribbon mesh written at wheel contact points when slip
  is high), tire smoke (GPU-cheap sprite particles), sparks on hard impacts.

### 5.4 Post-processing
`postprocessing` (pmndrs) `EffectComposer`: **N8AO / SSAO → Bloom (subtle) → SMAA →
tone mapping**. Optional on High: motion blur / depth-of-field in replays only.

### 5.5 Camera
Chase camera with critically-damped spring toward a target behind & above the car, look-ahead
along velocity, speed-based FOV (60° → 75°), slight shake on high speed / impacts.
Alternate cameras: bumper, hood. Orbit camera in lobby.

### 5.6 Quality presets
`low | medium | high`, auto-picked from a short FPS probe and user-overridable in settings:

| | Low | Medium | High |
|---|---|---|---|
| Pixel ratio cap | 1.0 | 1.5 | 2.0 |
| Shadows | off / 1024 | 2048 single | CSM |
| AO / Bloom | off | bloom | AO + bloom |
| Scenery density | 25% | 60% | 100% |

---

## 6. Build phases

Each phase ends with a **playable/demoable** state and explicit exit criteria.

| # | Phase | Exit criteria |
|---|---|---|
| **0** | **Scaffold** — workspaces, strict TS, Vite client, Node server serving `client/dist` + `/ws`, LAN URL print, ping/pong, Vitest | A phone on the Wi-Fi opens `http://<ip>:3000` and shows a spinning cube + live RTT |
| **1** | **Offline driving** — Rapier init, vehicle on flat ground, keyboard + gamepad, chase camera, fixed-step loop, debug wireframe of colliders | Car accelerates, brakes, steers, drifts with handbrake, doesn't roll over in normal turns |
| **2** | **Track & laps (single player)** — spline track gen in `/shared`, road/barrier colliders + meshes, spawn grid, checkpoint/lap logic, respawn, basic HUD (speed, lap, time) | Complete timed laps on one closed circuit; respawn works |
| **3** | **Networking v1** — server-authoritative sim, join/leave, input messages, 30 Hz snapshots, remote-car interpolation; own car simply follows server state | 2+ browsers see each other drive smoothly; car-car collisions happen on server |
| **4** | **Prediction & reconciliation** — local world, input ring buffer, replay, visual error smoothing, clock sync, net-debug overlay (RTT, corrections/s, buffer depth) + artificial latency/jitter toggle | Own car feels instant even with 100 ms simulated latency; corrections invisible on real LAN |
| **5** | **Race flow** — lobby (name/colour/ready), countdown, grid start, positions, finish, results, back to lobby | Full race with friends start → results without reloading |
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
