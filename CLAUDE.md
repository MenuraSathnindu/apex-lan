# CLAUDE.md — apex-lan

Browser-based 3D multiplayer racing game for LAN play. Host runs the Node server on their laptop;
friends on the same Wi-Fi open `http://<host-lan-ip>:3000`. No client installs.

**Full design: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).** Read it before starting a new
phase. If a decision changes, update that doc in the same change.

## Current phase

> Phases 0–2, multiplayer (client-authoritative, replaces 3–4) and Phase 5 done. **Phase 7 audio & polish done
> (2026-10-18)**: Web Audio engine with a sound gearbox, tyre screech, scrape, wind, impacts, countdown beeps;
> skid marks, tyre smoke, sparks; speedometer/gear/minimap HUD; pause menu (volumes, quality, key bindings,
> camera); Medium profiled to hold 60 fps on the host's Intel UHD iGPU. Most of Phase 6 done.
> **Next: Phase 8 — robustness** (binary codec, quantization, 2nd track). Phase 6 leftovers: visual body roll,
> real tree models. Update this line when a phase's exit criteria are met.

## Stack
- TypeScript everywhere (strict). npm workspaces monorepo.
- `client/` — Vite + Three.js + `postprocessing` + `n8ao` (types shimmed in `client/src/types/n8ao.d.ts`)
- `server/` — Node 22 + `ws`
- `shared/` — `@apex/shared`: protocol types, codec, constants, tuning, vehicle/track/lap logic. Owns the `@dimforge/rapier3d-compat` dependency (pinned exactly), so client and server always run the same Rapier build.

## Commands (run from repo root)
| Command | What it does |
|---|---|
| `npm install` | install all workspaces |
| `npm run dev` | server (`tsx watch`, :3000) + Vite (:5173 on 0.0.0.0, proxies `/ws` → :3000). In dev, friends join the **:5173** URL |
| `npm run build` | build client to `client/dist`, bundle server with esbuild to `server/dist` |
| `npm run host` | **how to host a game:** `build` then `start`. Prints the LAN URLs + a terminal QR code. Hosting/firewall guide: [`HOSTING.md`](HOSTING.md) |
| `npm start` | production: server on :3000 serves `client/dist` + `/ws` — **this is what friends join** (no rebuild) |
| `npm run typecheck` | `tsc --noEmit` across all workspaces |
| `npm test` | Vitest (shared + server) |
| `npm run handling` | headless driving scenarios → 0–100, braking, cornering g, drift angle, rollover checks for the current tuning |
| `npm run bots -- 7 [ws-url]` | fake players that join, wait on the grid and lap the track during races (default `ws://localhost:3000/ws`). Fill an 8-player room on your own |
| `npm run assets` | downloads the optional HDRI / textures / car GLB into `client/public/` (git-ignored). See `docs/ASSETS.md` |

Run `npm run typecheck` and `npm test` before calling any task done. After touching car tuning or vehicle code, also run `npm run handling`.

## Architecture rules (non-negotiable)
1. **Trust model: each client is authoritative for its own car** (LAN among friends; chosen by the user on 2026-10-17, replacing the original server-authoritative plan). Clients simulate locally and send `CarState` (pose, velocity, wheels, brake flag) at `STATE_SEND_RATE` (30 Hz). **The server owns the room**: players, host, slots, colours, race phase, rejoin. It validates (`isValidCarState`) and relays states; it never simulates cars. Don't "fix" this back to server authority unless asked.
2. **Fixed timestep 60 Hz** for client physics (`TICK_RATE` in `shared/constants.ts`). Never step physics with variable dt.
3. **Server relays at `SNAPSHOT_RATE` (30 Hz)**, only states that changed, each stamped with the server receive time `ts`.
4. **Remote cars = snapshot interpolation** at `serverClock − INTERP_DELAY_MS` (100 ms), with ≤150 ms velocity extrapolation, hidden after `REMOTE_STALE_MS`. Each is a **kinematic** Rapier body in the local world (group `REMOTE_PROXY`) so your car bumps into it. Collisions are asymmetric by design: a remote car is immovable on your screen.
5. **Simulation code lives in `/shared`** (vehicle, tuning, track colliders, `packCarState`), so every client simulates identically and the server could take over later.
6. **Race results are server-authoritative even though cars aren't.** The server runs `RaceTracker` (`shared/src/race/`) on the relayed positions: a lap counts only if every checkpoint gate was crossed in order by plausible movement (no jump faster than `RACE.maxPlausibleSpeed`), and only after GO. Clients display the server's standings; they never report laps.
7. **Only `shared/src/physics/rapier.ts` imports Rapier.** Everything else imports from there. Rapier version is pinned exactly (no `^`) in `shared/package.json`.
8. **`/shared` is pure TS:** no DOM, no Node APIs, no Three.js. Renderer-agnostic geometry is produced as plain arrays and turned into Three meshes in `client/src/render`.
9. **All wire messages** are defined in `shared/src/protocol/messages.ts` as discriminated unions on `t`, and go through `codec.ts`. No ad-hoc `JSON.stringify` on sockets.
10. Simulation never reads wall-clock time or `Math.random()` without a seed — use tick counts.

## Conventions
- **Units:** metres, seconds, kilograms, radians. **Y up. Car forward = +Z** (glTF convention), so chassis left = +X. Wheel order everywhere: FL, FR, RL, RR.
- **Steering sign:** `CarInput.steer` +1 = right. Rapier wheel steering angle + = left, so `vehicle.ts` negates it.
- **All tuning** lives in `shared/src/tuning.ts`: car handling + surfaces (`CAR`), `CAMERA`, `INPUT`, graphics (`ASSETS`, `ENVIRONMENT`, `CAR_MODEL` incl. LOD, `QUALITY` presets, `AUTO_QUALITY`, `POST`), `RACE`, the sound/HUD gearbox (`DRIVETRAIN`), effects (`FX`), `AUDIO` and `HUD`. Engine/net constants (tick rate, ports, interp delay) live in `shared/src/constants.ts`. No magic numbers in logic.
- Car visuals go through `CarModel` (`client/src/render/carView.ts`): `{ body, wheels[4], brakeLights?, glass? }` with wheels centred, axle along X. `gltfCarModel.ts` fits any GLB to the physics car (wheelbase scale, wheel alignment, material swap by name); `boxCarModel.ts` is the fallback.
- **Every asset is optional.** Missing files → procedural fallback + a `[assets]` console warning. Keep it that way: the game must run straight after `git clone && npm install`.
- Tracks are pure data (`shared/src/track/tracks.ts`) → `buildTrack()` → mesh data for the client and colliders for physics. Validate new layouts with `track.test.ts` (corner radius, self-separation).
- Race rules/tuning: `RACE` in `tuning.ts` (laps, checkpoint spacing, finish grace, respawn timers). Checkpoints are invisible gates every ~100 m (`buildCheckpoints`), gate 0 = start line; cars start behind it, so lap 1 includes the run from the grid.
- Client race helpers (`client/src/game/raceController.ts`): wrong-way, auto-respawn (stuck on grass / past barriers / flipped) and R = respawn at the last checkpoint, using the server's `nextGate` as the truth.
- Sound & effects read the sim through `shared/src/physics/vehicleFx.ts` (tyre slip, chassis contacts) and `drivetrain.ts` (gear/rpm), gathered per tick by `client/src/game/localCarFx.ts`. They never change the simulation; the gearbox doesn't affect handling.
- Audio: everything goes through `AudioSystem` (buses: engine / effects / ui → master → limiter). Sounds are procedural (`audio/synth.ts`); files in `client/public/sounds/` are optional overrides (`AUDIO.files`). Per-car loops live in `CarVoice`.
- Effects (`render/effects/`) are pooled, single-draw-call systems with fixed buffers. Keep it that way (no per-particle objects); budgets scale with `QUALITY.particles`.
- Player preferences (volumes, camera, key bindings, FPS counter) go through `SettingsStore` (`game/userSettings.ts`, `localStorage` `apex.settings`, sanitized on load). Graphics quality keeps its own key (`apex.graphics`). Driving keys come from `input/bindings.ts`; never hard-code key codes elsewhere.
- Surfaces: tag colliders with `tagSurface(world, collider, 'asphalt' | 'curb' | 'grass')`. `stepVehicle` scales grip/drag per wheel from `CAR.surfaces`.
- Colour pipeline: renderer uses `NoToneMapping`; ACES Filmic happens in the post chain (`render/post.ts`), output sRGB. Don't set `renderer.toneMapping`.
- Files: `camelCase.ts`; types/interfaces `PascalCase`; constants `SCREAMING_SNAKE_CASE`.
- Prefer plain functions + data objects over class hierarchies; classes are fine for stateful systems (e.g. `Simulation`, `Room`, `CarView`).
- Three.js: dispose geometries/materials/textures when removing objects. Reuse temp `Vector3`/`Quaternion` objects in hot loops — no per-frame allocations in the render or physics loop.
- Client UI is plain HTML/CSS overlay in `client/src/ui` (no UI framework unless agreed).
- Assets: `client/public/{hdri,textures,models}/` (git-ignored, fetched by `npm run assets`); only CC0/CC-BY; record source + licence in `client/public/CREDITS.md` and `docs/ASSETS.md`.
- Tests: Vitest, colocated as `*.test.ts`. Test shared logic (codec round-trips, interpolation sampling, lap logic, ring buffer) and a headless server sim ("car drives forward and stays upright").
- Commits: small, one concern each, message prefixed with phase, e.g. `p1: add handbrake drift`.

## Build phases (details & exit criteria in ARCHITECTURE §6)
0. **Scaffold** — workspaces, Vite, server serving dist + `/ws`, LAN URL print, ping/pong, Vitest
1. **Offline driving** — Rapier vehicle on flat ground, input, chase camera, fixed-step loop
2. **Track & laps** ✅ — spline track, colliders + meshes, checkpoint gates, server-validated laps, respawn, race HUD
3. ~~Networking v1~~ / 4. ~~Prediction~~ — **replaced** by the client-authoritative relay (done).
5. **Race flow** ✅ — lobby, laps setting, host start, countdown (input locked until GO), live positions, finish grace, results podium, race again
6. **Visual realism** (mostly ✅) — HDRI IBL, glTF cars + LOD, shadows, post FX, PBR road, scenery, skid marks/smoke/sparks, quality presets. Left: body roll, tree models
7. **Audio & polish** ✅ — engine/tyre/impact audio, speedometer/gear/minimap HUD, pause menu (audio, graphics, key bindings, camera)
8. **Optimization & robustness** — binary codec, quantization, reconnect, perf, 2nd track

Work one phase at a time. Don't pull later-phase work (e.g. visuals) forward unless asked; do leave seams for it.

## Gotchas
- **Windows firewall** must allow TCP 3000 (or Node) on the active network profile or friends can't connect; see `HOSTING.md` (netsh rule, Public vs Private, block rules beat allow rules). The server prints LAN URLs (Wi-Fi first) and a QR code (`server/src/util/qr.ts`, `uqr`) on boot; `APEX_QR=0` hides it.
- Static files (`server/src/net/staticFiles.ts`): unknown paths without an extension → `index.html`; missing files *with* an extension → 404 (optional assets fail fast); only Vite's hashed `/assets/` are cached immutable, everything else `no-cache` so replaced models/sounds show up.
- Vite dev server needs `host: '0.0.0.0'` to be reachable from other devices.
- `client/vite.config.ts` imports `@apex/shared` (raw TS), so Vite runs with `--configLoader runner`. Keep that flag on dev/build/preview.
- The server esbuild bundle must **include** `@apex/shared` (only `ws` is external) — Node can't run the shared `.ts` source at runtime.
- The codec works on strings. Server converts frames with `data.toString()`; binary frames come with the phase 8 codec.
- The host laptop has VPN/VM adapters (Cloudflare WARP, Hyper-V). The server labels each printed URL with its adapter name; share the **Wi-Fi** one.
- `rapier3d-compat` requires `await initRapier()` before use (both sides).
- Per tick: `stepVehicle()` (applies input + `updateVehicle`) for every car, **then** `world.step()`.
- Rapier vehicle quirks (v0.21): axis indices are *property setters*, and the forward one is literally named `setIndexForwardAxis` (`controller.setIndexForwardAxis = 2`). The default forward axis is X — always set it. Suspension stiffness/damping are per unit of mass (sag ≈ 9.81/(4·k)); engine force is in newtons; `frictionSlip` ≈ tyre μ.
- Rapier's raycast vehicle has ~no body roll and Bullet-style sliding friction, so slides don't self-recover. That's why `stepVehicle` has a stability assist (`CAR.assist`). Visual body roll is a phase 6 renderer job.
- Use one-shot `applyImpulse`, never `addForce`, for per-tick forces (aero): `addForce` persists across steps.
- Plain `http://` on LAN is not a secure context: browsers hide gamepads there. Gamepad works for the host on `localhost`; friends get keyboard unless we add https later.
- three r186 removed `PCFSoftShadowMap` (it falls back with a warning). Use `PCFShadowMap` + `shadow.radius`.
- three r186: use `HDRLoader` (not `RGBELoader`). three's `package.json` isn't in its `exports`, so resolve files like `three/examples/jsm/...` directly.
- The Draco decoder is copied into `client/public/draco/` by a Vite plugin in the **`config` hook**. In `buildStart` it was too late: Vite answered those files with `index.html`.
- three's `Sky` shader is very bright (its example uses exposure 0.5), and the postprocessing ACES effect ignores exposure. The fallback sky is baked to a PMREM and dimmed via `backgroundIntensity` / `environmentIntensity`.
- Flat track layers (grass 0, road +2 cm, curbs, paint) use `polygonOffset` against z-fighting at distance; camera near plane is 0.15.
- Headless Edge with SwiftShader runs at ~4 fps, so auto quality always picks Low there. For real numbers use `--use-angle=d3d11 --enable-gpu`. The dev build exposes `window.__apex` (gfx, car, quality, carView...) for poking from the console.
- **Multiplayer testing:** use two separate browser *windows* side by side, not two tabs in one window: background tabs pause `requestAnimationFrame`, so that car stops sending. Tabs on one machine share `localStorage` (the name/colour profile) but not `sessionStorage` (the rejoin session id), so each tab is its own player. `window.__apex.remoteCars.debug()` shows buffer age/positions.
- Hidden tabs throttle JS timers to ~1/min, so liveness comes from **server WebSocket ping frames** (answered by the browser itself → `Room.touch`), not just JS pings.
- Host = earliest-joined *connected* player, so host passes on during a disconnect and comes back on rejoin. Rejoin = same `sessionId` within `REJOIN_GRACE_MS` (30 s); a duplicate tab (same session, original still live) gets a new identity.
- Vite dev answered some module requests with **408**: Node's 60 s `headersTimeout` killed browser pre-connected sockets during slow loads. `vite.config.ts` raises it (dev only; prod serves a single bundle).
- Name tags project with `camera.updateMatrixWorld()` first. three only updates camera matrices inside `render()`, so without it tags trail the car at speed.
- **Perf target: Medium ≥ 60 fps on the host laptop (Intel UHD iGPU).** It is GPU-bound; CPU per frame is ~2 ms. Before adding anything per-pixel or a full-screen pass to Medium, measure it with menu → Show FPS counter (GPU time via `EXT_disjoint_timer_query_webgl2`). Known costs at 1080p: each extra full-screen post pass ~2 ms, 2048 vs 1024 shadow map ~3 ms, bloom ~2–3 ms. That's why Low/Medium merge FXAA into the tone-mapping pass and only High runs SMAA.
- Headless perf runs: with vsync, headless Edge ticks frames at 144 Hz, so frame times come in multiples of 6.9 ms (13.8 ms = "two ticks", not a stall). `--disable-gpu-vsync --disable-frame-rate-limit` uncaps fps but queues frames (huge p99), so use average fps / GPU ms from it, not percentiles.
- Bot scripts in perf tests: a killed bot's slot stays reserved for `REJOIN_GRACE_MS` (30 s), so back-to-back 8-player runs see "room full". Wait 35 s between runs. Killing `node tsx …` can leave the child running; kill by command line.
- Browsers start the `AudioContext` suspended until a key press or click; `AudioSystem` resumes it then. Vite answers a missing public file with `index.html` (200), so sound loading checks the content type.
- Windows: launch tsx scripts via `node node_modules/tsx/dist/cli.mjs` (as `npm run handling` does). `npx tsx` with JSON args in Git Bash hung.
