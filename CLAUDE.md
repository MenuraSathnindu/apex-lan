# CLAUDE.md — apex-lan

Browser-based 3D multiplayer racing game for LAN play. Host runs the Node server on their laptop;
friends on the same Wi-Fi open `http://<host-lan-ip>:3000`. No client installs.

**Full design: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).** Read it before starting a new
phase. If a decision changes, update that doc in the same change.

## Current phase

> **Phase 0 — Scaffold: done.** **Phase 1 — Offline driving: done** (collider debug wireframe deferred).
> **Pulled forward on request:** the Phase 2 *track* (spline circuit, colliders, surfaces, spawn grid) and most of
> **Phase 6 visuals** (HDRI, GLB car, PBR track, post FX, instanced scenery, quality presets + auto-pick).
> **Next: finish Phase 2** — checkpoints/lap counting/timing, respawn at last checkpoint, lap HUD. Then Phase 3.
> Phase 6 leftovers: visual body roll, skid marks/smoke, real tree models. Update this line when a phase's exit criteria are met.

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
| `npm start` | production: server on :3000 serves `client/dist` + `/ws` — **this is what friends join** |
| `npm run typecheck` | `tsc --noEmit` across all workspaces |
| `npm test` | Vitest (shared + server) |
| `npm run handling` | headless driving scenarios → 0–100, braking, cornering g, drift angle, rollover checks for the current tuning |
| `npm run assets` | downloads the optional HDRI / textures / car GLB into `client/public/` (git-ignored). See `docs/ASSETS.md` |

Run `npm run typecheck` and `npm test` before calling any task done. After touching car tuning or vehicle code, also run `npm run handling`.

## Architecture rules (non-negotiable)
1. **Server is authoritative.** Clients send *inputs* only (`throttle/brake/steer/handbrake/reset` + `seq`), never positions.
2. **Fixed timestep 60 Hz** for physics on both sides (`TICK_RATE` in `shared/constants.ts`). Never step physics with variable dt.
3. **Snapshots at 30 Hz**, stamped with server tick and per-client `ackSeq`.
4. **Own car = client-side prediction** + reconciliation (replay un-acked inputs, smooth visual error). **Remote cars = interpolation** at `serverTime − INTERP_DELAY_MS` (~100 ms). See ARCHITECTURE §3.5–3.6.
5. **Simulation code lives in `/shared`** (vehicle setup, car specs, track collider generation, lap logic) so client prediction runs the exact code the server runs. Client and server must never have their own copies of physics logic.
6. **Only `shared/src/physics/rapier.ts` imports Rapier.** Everything else imports from there. Rapier version is pinned exactly (no `^`) in `shared/package.json`.
7. **`/shared` is pure TS:** no DOM, no Node APIs, no Three.js. Renderer-agnostic geometry is produced as plain arrays and turned into Three meshes in `client/src/render`.
8. **All wire messages** are defined in `shared/src/protocol/messages.ts` as discriminated unions on `t`, and go through `codec.ts`. No ad-hoc `JSON.stringify` on sockets.
9. Simulation never reads wall-clock time or `Math.random()` without a seed — use tick counts.

## Conventions
- **Units:** metres, seconds, kilograms, radians. **Y up. Car forward = +Z** (glTF convention), so chassis left = +X. Wheel order everywhere: FL, FR, RL, RR.
- **Steering sign:** `CarInput.steer` +1 = right. Rapier wheel steering angle + = left, so `vehicle.ts` negates it.
- **All tuning** lives in `shared/src/tuning.ts`: car handling + surfaces (`CAR`), `CAMERA`, `INPUT`, and graphics (`ASSETS`, `ENVIRONMENT`, `CAR_MODEL`, `QUALITY` presets, `AUTO_QUALITY`, `POST`). Engine/net constants (tick rate, ports, interp delay) live in `shared/src/constants.ts`. No magic numbers in logic.
- Car visuals go through `CarModel` (`client/src/render/carView.ts`): `{ body, wheels[4], brakeLights?, glass? }` with wheels centred, axle along X. `gltfCarModel.ts` fits any GLB to the physics car (wheelbase scale, wheel alignment, material swap by name); `boxCarModel.ts` is the fallback.
- **Every asset is optional.** Missing files → procedural fallback + a `[assets]` console warning. Keep it that way: the game must run straight after `git clone && npm install`.
- Tracks are pure data (`shared/src/track/tracks.ts`) → `buildTrack()` → mesh data for the client and colliders for physics. Validate new layouts with `track.test.ts` (corner radius, self-separation).
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
2. **Track & laps** — spline track in `/shared`, colliders + meshes, checkpoints, laps, respawn, HUD
3. **Networking v1** — authoritative server sim, snapshots, remote interpolation (no prediction yet)
4. **Prediction & reconciliation** — local world, replay, error smoothing, clock sync, net-debug overlay + fake latency
5. **Race flow** — lobby, ready, countdown, positions, results
6. **Visual realism** — HDRI IBL, glTF cars, shadows, post FX, PBR road, scenery, effects, quality presets
7. **Audio & polish** — engine/tire audio, HUD/minimap, settings, camera modes
8. **Optimization & robustness** — binary codec, quantization, reconnect, perf, 2nd track

Work one phase at a time. Don't pull later-phase work (e.g. visuals) forward unless asked; do leave seams for it.

## Gotchas
- **Windows firewall** must allow Node on *Private* networks or friends can't connect. The server prints LAN URLs on boot.
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
- Windows: launch tsx scripts via `node node_modules/tsx/dist/cli.mjs` (as `npm run handling` does). `npx tsx` with JSON args in Git Bash hung.
