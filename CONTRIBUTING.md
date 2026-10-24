# Contributing to apex-lan

Thanks for helping! This is a small hobby project for racing with friends on a LAN, so the
bar is: it stays fun, it stays fast on a laptop's integrated GPU, and it stays free of real
trademarks.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems go
through [`SECURITY.md`](SECURITY.md), not public issues.

## Setup

You need Node.js 22+ and git. Git LFS is only needed if you add large art files (see below).

```sh
git clone https://github.com/MenuraSathnindu/apex-lan.git
cd apex-lan
npm install
npm run dev          # server :3000 + Vite :5173 with hot reload
```

Open <http://localhost:5173>. For multiplayer testing, use two browser **windows** side by
side (background tabs pause rendering, so that car stops sending), or `npm run bots -- 7`.

Before you open a PR:

```sh
npm run typecheck
npm test             # trademark lint + unit tests
npm run build
npm run handling     # only if you touched car tuning or vehicle code
```

CI runs the same steps on Linux and Windows.

## The trademark rule (please read)

The project is open source, so it must not use anyone's trademarks. In code, comments, UI
text, docs, asset names or contents, and commit messages:

- no names or abbreviations of real racing series, governing bodies, teams, drivers, sponsors
  or car manufacturers, and no real car models;
- no logos, real liveries, team numbers or traced fonts;
- tracks are named by **place** (`"Monza"`, `"Italy"`), never by a circuit's or event's name;
- regulation ideas are fine with our own words (for example aero modes are `corner` /
  `straight`, the battery deploy is "boost");
- teams, drivers and liveries are fictional.

`npm run lint:marks` checks this with a banned-term list in `scripts/checkMarks.mjs`. If you
think a real name is genuinely needed (for example a licence credit), ask in the issue first.

## How the code is organised

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) before a big change. The short version:

- `shared/` is pure TypeScript (no DOM, no Node APIs, no three.js): physics, tuning, tracks,
  race rules, the wire protocol. Client and server run the same code.
- Each client is authoritative for its own car at a fixed 60 Hz; the server owns the room and
  decides laps, penalties and results. Please don't move car physics to the server.
- All tuning numbers live in `shared/src/tuning.ts`; no magic numbers in logic.
- Wire messages are discriminated unions in `shared/src/protocol/messages.ts`.
- UI is plain HTML/CSS in `client/src/ui`. No UI framework.
- No per-frame allocations in the render or physics loop; dispose three.js resources.
- Every asset is optional: a missing file falls back to a procedural one with a console
  warning. The game must run straight after `git clone && npm install`.

[`CLAUDE.md`](CLAUDE.md) lists the conventions and the known gotchas in detail.

## Tests

Vitest, colocated as `*.test.ts`. New logic in `shared/` or `server/` comes with tests (lap
logic, stewards, codec round-trips, database queries…). For a bug fix, add a test that fails
without the fix.

## Adding a track

See the README's *Adding a new track* section and [`tools/README.md`](tools/README.md). In
short: add a config entry with a place name, run `npm run tracks -- <id>`, check the SVG
preview, run `npm run tracks:check -- <id>`, and commit the JSON. Track data must come from a
dataset whose licence allows redistribution; record it in [`CREDITS.md`](CREDITS.md).

## Adding art or sounds

- Only CC0 or CC-BY files, and not of a real trademarked product (no real cars).
- Record the source, author and licence in [`CREDITS.md`](CREDITS.md) and
  `client/public/CREDITS.md`.
- Prefer adding the file to `npm run assets` (downloaded, git-ignored) over committing it.
  If a large `.glb`, `.hdr` or texture must be committed, it goes through Git LFS
  (`.gitattributes` already has the rules; run `git lfs install` once).

## Commits and PRs

- Small commits with one concern each, prefixed with the area or phase, e.g.
  `p13: pit lane limiter` or `tracks: add Imola`.
- One topic per PR. Fill in the PR template; include a screenshot or clip for visual changes.
- Graphics changes: check the FPS counter (menu → Show FPS counter) on the Medium preset.

## Reporting bugs and ideas

Use the issue templates: **Bug report**, **Feature request** or **New track**.
