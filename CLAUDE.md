# CLAUDE.md — apex-lan

Browser-based 3D multiplayer racing game for LAN play. Host runs the Node server on their laptop;
friends on the same Wi-Fi open `http://<host-lan-ip>:3000`. No client installs.

**Full design: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).** Read it before starting a new
phase. If a decision changes, update that doc in the same change.

## Current phase

> **Phase 0 — Scaffold** (not started). Update this line when a phase's exit criteria are met.

## Stack
- TypeScript everywhere (strict). npm workspaces monorepo.
- `client/` — Vite + Three.js + `@dimforge/rapier3d-compat` + `postprocessing`
- `server/` — Node 22 + `ws` (+ the same Rapier package, for the authoritative sim)
- `shared/` — `@apex/shared`: protocol types, codec, constants, vehicle/track/lap logic

## Commands (run from repo root)
| Command | What it does |
|---|---|
| `npm install` | install all workspaces |
| `npm run dev` | server (`tsx watch`, :3000) + Vite dev server (:5173, `host: true`, proxies `/ws` → :3000) |
| `npm run build` | build client to `client/dist`, bundle server with esbuild to `server/dist` |
| `npm start` | production: server on :3000 serves `client/dist` + `/ws` — **this is what friends join** |
| `npm run typecheck` | `tsc --noEmit` across all workspaces |
| `npm test` | Vitest (shared + server) |

Run `npm run typecheck` and `npm test` before calling any task done.

## Architecture rules (non-negotiable)
1. **Server is authoritative.** Clients send *inputs* only (`throttle/brake/steer/handbrake/reset` + `seq`), never positions.
2. **Fixed timestep 60 Hz** for physics on both sides (`TICK_RATE` in `shared/constants.ts`). Never step physics with variable dt.
3. **Snapshots at 30 Hz**, stamped with server tick and per-client `ackSeq`.
4. **Own car = client-side prediction** + reconciliation (replay un-acked inputs, smooth visual error). **Remote cars = interpolation** at `serverTime − INTERP_DELAY_MS` (~100 ms). See ARCHITECTURE §3.5–3.6.
5. **Simulation code lives in `/shared`** (vehicle setup, car specs, track collider generation, lap logic) so client prediction runs the exact code the server runs. Client and server must never have their own copies of physics logic.
6. **Only `shared/src/physics/rapier.ts` imports Rapier.** Everything else imports from there. Rapier version is pinned exactly (no `^`), identical in client and server.
7. **`/shared` is pure TS:** no DOM, no Node APIs, no Three.js. Renderer-agnostic geometry is produced as plain arrays and turned into Three meshes in `client/src/render`.
8. **All wire messages** are defined in `shared/src/protocol/messages.ts` as discriminated unions on `t`, and go through `codec.ts`. No ad-hoc `JSON.stringify` on sockets.
9. Simulation never reads wall-clock time or `Math.random()` without a seed — use tick counts.

## Conventions
- **Units:** metres, seconds, kilograms, radians. **Y up. Car forward = +Z** (glTF convention). Set Rapier vehicle `indexUpAxis=1`, `indexForwardAxis=2` explicitly.
- All tunables (car handling, net rates, interp delay) are named constants in `shared/constants.ts` or `shared/physics/carSpecs.ts` — no magic numbers in logic.
- Files: `camelCase.ts`; types/interfaces `PascalCase`; constants `SCREAMING_SNAKE_CASE`.
- Prefer plain functions + data objects over class hierarchies; classes are fine for stateful systems (e.g. `Simulation`, `Room`, `CarView`).
- Three.js: dispose geometries/materials/textures when removing objects. Reuse temp `Vector3`/`Quaternion` objects in hot loops — no per-frame allocations in the render or physics loop.
- Client UI is plain HTML/CSS overlay in `client/src/ui` (no UI framework unless agreed).
- Assets: compressed glTF (Meshopt/Draco) + KTX2 in `client/public/assets/`; only CC0/CC-BY; record source + licence in `client/public/assets/CREDITS.md`.
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
- The server esbuild bundle must **include** `@apex/shared` (only `ws` is external) � Node can't run the shared `.ts` source at runtime.
- The codec works on strings. Server converts frames with `data.toString()`; binary frames come with the phase 8 codec.
- The host laptop has VPN/VM adapters (Cloudflare WARP, Hyper-V). The server labels each printed URL with its adapter name; share the **Wi-Fi** one.
- `rapier3d-compat` requires `await RAPIER.init()` before use (both sides).
- Call `vehicleController.updateVehicle(dt)` **before** `world.step()` each tick.
- Plain `http://` on LAN is not a secure context: avoid APIs that require one (Gamepad is best-effort; keyboard is the baseline).
