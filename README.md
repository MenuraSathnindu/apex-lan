# apex-lan

**Open-wheel racing for game night.** One laptop hosts, up to eight friends on the same Wi-Fi
open a link and race: real-world circuits, start lights, qualifying, pit stops, championships
and a podium, all in the browser. No installs, no accounts, no internet needed.

<!--
  Screenshots: capture these and save them in docs/media/ (see docs/media/SHOTS.md), then
  uncomment the block below.

<p align="center">
  <img src="docs/media/race-start.gif" alt="Five red lights go out and the grid launches" width="800">
</p>

| | |
|---|---|
| ![Pack racing](docs/media/pack-racing.png) | ![Timing tower and sectors](docs/media/timing-tower.png) |
| ![Pit stop](docs/media/pit-stop.png) | ![Podium](docs/media/podium.png) |
| ![Lobby](docs/media/lobby.png) | ![Track select](docs/media/track-select.png) |
-->

> 📸 Screenshots and a race-start GIF are coming soon.

## Features

- **LAN multiplayer, zero install.** The host runs one command; friends join at
  `http://<host-ip>:3000` or scan the QR code. Up to 8 cars.
- **Open-wheel car physics** at a fixed 60 Hz (Rapier): downforce, active aero (corner and
  straight modes), a hybrid battery with a deploy button, a server-granted overtake boost, tyre
  compounds and wear, and an 8-speed sound gearbox.
- **45 real-world circuit layouts**, generated from open data and named by place (Monza, Spa,
  Suzuka, Monaco…), with kerbs, gravel, walls, a pit lane and grandstands. Plus a built-in
  fictional track, Apex Park.
- **Race weekend like on TV:** five red lights with a random hold, jump-start and track-limits
  penalties, a live timing tower, purple/green/yellow sectors, a pit-lane speed limiter and
  tyre stops, the chequered flag, replays and a podium.
- **Championships:** timed or one-shot qualifying, optional sprints, points, teams, driver and
  team standings, save and resume, spectators, and a champion finale.
- **Player profiles** stored on the host: name + 4-digit PIN, photo, career stats, personal
  bests, head-to-head records and a Hall of Fame.
- **Livery editor** (three colours and a number), procedural car model, skid marks, smoke,
  sparks, Web Audio engine and tyre sounds, minimap, and quality presets that hold 60 fps on
  an integrated laptop GPU.

## Quick start

You need [Node.js 22+](https://nodejs.org/) and git.

```sh
git clone https://github.com/MenuraSathnindu/apex-lan.git
cd apex-lan
npm install
npm run host
```

`npm run host` builds the game and starts the server on port 3000. It prints the links to
share and a QR code. Play on the same machine at <http://localhost:3000>.

Optional: `npm run assets` downloads a sky HDRI and road/grass textures (about 30 MB, CC0) for
a more realistic look. Everything works without them.

## How friends join over Wi-Fi

1. Everyone connects to the **same Wi-Fi** as the host laptop.
2. The host shares the **`Join at:`** link marked `(Wi-Fi)` from the terminal, e.g.
   `http://192.168.1.10:3000`, or friends scan the QR code.
3. Friends open it in a desktop browser (Chrome, Edge or Firefox). That's it.

If nobody can connect, it's almost always the firewall: allow TCP port 3000 and set the Wi-Fi
network to *Private*. [`HOSTING.md`](HOSTING.md) has the one-line fix and a troubleshooting list.

The first player to join is the host and gets the **Start** button.

## Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Throttle | W / ↑ | Right trigger |
| Brake / reverse | S / ↓ | Left trigger |
| Steer | A D / ← → | Left stick |
| Boost (deploy battery) | Q / Left Shift | Right bumper |
| Open / close wings (straights) | E | Left face button |
| Handbrake | Space | Bottom face button |
| Reset / respawn | R | Right face button / Back |
| Change camera (chase / hood) | C | Top face button |
| Menu (volumes, graphics, key bindings, camera) | Esc | Start |

Keys can be rebound in the menu. Browsers only expose gamepads on secure pages, so a gamepad
works for the host on `localhost`; friends on `http://` use the keyboard. There are no touch
controls yet.

## Game modes

| Mode | What happens |
|---|---|
| **Quick race** | The host picks a track, laps and tyre wear, then starts. Five lights, race, podium, results. |
| **Championship** | A season of rounds: qualifying (timed or one-shot) → optional sprint → race. Points for drivers and teams, standings after every round, save and resume later, and a finale for the champion. Players who aren't entered spectate. |
| **Profiles & Hall of Fame** | Log in with a name and PIN to keep career stats, best laps per track and head-to-head records across races. |

PINs are **LAN-level protection only**: they stop a friend from picking your name by accident,
not a determined attacker. See [`SECURITY.md`](SECURITY.md).

## Tech stack

- **TypeScript** everywhere (strict), npm workspaces.
- **Client:** Vite, [three.js](https://threejs.org/), `postprocessing`, N8AO, plain HTML/CSS
  UI, Web Audio.
- **Server:** Node 22, `ws`, SQLite (`better-sqlite3`), `bcrypt`, `sharp` for photos.
- **Shared:** physics with [Rapier](https://rapier.rs/), track generation, lap timing and race
  rules, used identically by client and server.
- **Netcode:** each client simulates its own car and sends its state 30×/s; the server owns
  the room, validates and relays states, and decides laps, penalties and results. Remote cars
  are interpolated 100 ms behind. Details in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Project structure

```
apex-lan/
├─ client/          browser game (Vite + three.js)
│  ├─ src/render/   scene, car model, track meshes, effects, post-processing
│  ├─ src/game/     race helpers, pit stops, replays, podium director
│  ├─ src/ui/       lobby, HUD, timing tower, menus, championship screens
│  ├─ src/audio/    procedural engine and effect sounds
│  └─ public/tracks/ generated circuit JSON (+ dataset licences)
├─ server/          Node server: rooms, relay, stewards, HTTP API, SQLite profiles
├─ shared/          pure TS used by both: physics, tuning, tracks, race rules, protocol
├─ tools/           offline track generator and checker
├─ scripts/         asset downloader, bots, handling report, trademark lint
└─ docs/            architecture, assets, profiles, design specs and plans
```

## Commands

| Command | What it does |
|---|---|
| `npm run host` | Build, then serve the game on :3000 (what you run on game night) |
| `npm run dev` | Hot-reload dev mode (friends join on :5173) |
| `npm test` | Trademark lint + unit tests |
| `npm run typecheck` | TypeScript across all workspaces |
| `npm run bots -- 7` | Fill the room with 7 bot cars that lap the track |
| `npm run handling` | Headless driving tests: 0–100, braking, cornering g |
| `npm run tracks` / `tracks:check` | Regenerate circuits / drive a lap of each with the autopilot |

## Adding a new track

Tracks are data: a 5 m centreline with left/right widths, starting on the start line, plus
sectors, zones, a grid and a pit lane. `buildTrack()` turns it into meshes and colliders.

1. Clone the two source datasets into `tools/data/` (commands in [`tools/README.md`](tools/README.md)).
2. Add an entry to `tools/tracks.config.ts` with an `id`, a **place name** (city/area and
   country, never a circuit's or event's trademarked name) and the dataset ids.
3. Run `npm run tracks -- <id>` and open `tools/out/<id>.svg`. Fix the start line with
   `startShift` and the direction with `reverse` if needed.
4. Run `npm run tracks:check -- <id>`: the autopilot must complete a lap the server counts.
5. Commit the JSON and the updated `index.json`. Open a PR with the *New track* template.

A hand-made track works too: write a `TrackDef` (`shared/src/track/trackFile.ts`) and make it
pass `trackContract`.

## Roadmap

- **Foundations:** binary network codec with a protocol version, car-spec registry, splitting
  `Room` into sessions, more refactors.
- **Visuals:** body roll, real tree models, track elevation.
- **Broadcast:** onboard camera and driver intro cards.
- **Input:** touch controls; HTTPS on LAN so friends can use gamepads.
- **Release:** versioned releases with a changelog.

Ideas and track requests are welcome as issues.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Please read the trademark rule before your first PR,
and follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Credits

Track layouts are derived from the TUMFTM racetrack-database (LGPL-3.0, from OpenStreetMap
data) and Tomislav Bacinger's circuits GeoJSON (MIT). Optional sky and textures are CC0 from
Poly Haven. The car, scenery and all sounds are made in code. The full list with licences and
links is in [`CREDITS.md`](CREDITS.md).

## Licence

The code is [MIT](LICENSE). Generated track data in `client/public/tracks/` keeps its source
datasets' licences (see [`ATTRIBUTION.md`](client/public/tracks/ATTRIBUTION.md)).

## Disclaimer

This is an unofficial fan project and is not affiliated with or endorsed by Formula One Group or the FIA. All trademarks belong to their owners.

Teams, drivers and liveries in the game are fictional. Circuits are named by place only.
