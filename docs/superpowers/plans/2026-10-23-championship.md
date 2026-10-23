# Championship Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seasons of qualifying → optional sprint → race weekends on real circuits, with persistent drivers' and teams' standings, spectators for non-entrants, and a champion finale recorded to careers.

**Architecture:** The room runs a generic *session* (`free | qualifying | sprint | race`) whose per-kind rules are pure shared functions. A server-side `ChampionshipRunner` (depending on a `ChampionshipStore` interface backed by SQLite) turns season state into the next session and session results into stored rows. Standings are computed from result rows by one shared function used by server and client.

**Tech Stack:** TypeScript (strict), Node 22 + ws + better-sqlite3 (server), Vite + Three.js + plain DOM (client), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-23-championship-design.md`

## Global Constraints

- Profiles only take part; non-entrants spectate championship sessions.
- Points: sprint `[8,7,6,5,4,3,2,1]`, race `[25,18,15,12,10,8,6,4,2,1]`; fastest-lap bonus +1 only if the setting is on, race only, holder finished in the top 10.
- Sprint laps = `max(1, round(raceLaps / 3))`.
- Timed qualifying minutes ∈ {5, 8, 12}, default 8; a lap under way at the flag may finish within 120 000 ms. One-shot: lap 2 is the flying lap; session ends when all have done lap 2 or after 300 000 ms.
- Tie-break: race countback (wins, 2nds, …), then sprint countback, then entry order.
- Season validation: 1–30 rounds, known track ids, laps within `RACE.minLaps..RACE.maxLaps`, season name 1–40 chars, team name 1–24 chars, team size ≤ 2.
- Teams lock when round 1 starts (late entrants: free seat or new team; host may move drivers).
- Preset label "Real 2026-style calendar", rounds in spec §1 order with sprints at Shanghai, Miami, Montreal, Silverstone, Zandvoort, Singapore. No series names anywhere (CLAUDE.md trademark rule).
- Each session's results + season advance are written in one SQLite transaction; abandoned sessions write nothing.
- All tuning numbers in `shared/src/tuning.ts` (`RACE` / new `CHAMPIONSHIP`); all wire messages in `messages.ts`; `/shared` stays pure TS.
- Commits prefixed `p12:`; `npm run typecheck` and `npm test` green before each commit.

## Review Focus

1. **Host leaves mid-session** — host passes on; the new host can end or continue; nothing is written for an abandoned session. Test in Task 6.
2. **Entrant disconnects during qualifying and rejoins** — keeps their best lap (same player id within rejoin grace). Test in Task 5.
3. **A profile is deleted / unknown in old results** — standings and grids still render (rows skipped, no crash). Test in Task 3 (`computeStandings` ignores entries without a profile summary).
4. **Season loaded on a track id that no longer exists** — `champStartSession` refused with a notice instead of crashing. Test in Task 6.
5. **Two teams created with the same name / a driver joining a full team** — refused with a notice. Test in Task 6.

---

### Task 1: Lap validity in the lap counter

**Files:**
- Modify: `shared/src/race/raceTracker.ts`
- Test: `shared/src/race/raceTracker.test.ts`

**Interfaces:**
- Produces: `LapEvent.valid: boolean`, `LapRecord.valid: boolean`; a lap is invalid when an implausible jump (`dist > RACE.maxPlausibleSpeed * dt + 5`) happened after its start. `RaceTracker.fastestLap()` and `Standing.bestLap` consider valid laps only.

- [ ] **Step 1: Failing tests** — `'a respawn jump makes the lap invalid but it still counts'`: drive half a lap, inject one position 300 m ahead along the track, continue; expect the lap event `valid: false`, `laps === 1`, `standings()[0].bestLap === null`, `fastestLap() === null`. `'clean laps are valid'`: existing two-lap drive → every event `valid: true`.
- [ ] **Step 2:** `npx vitest run shared/src/race` → FAIL (`valid` undefined).
- [ ] **Step 3:** Add `invalid: boolean` to `Racer`, set on implausible movement after GO, reset at lap start; propagate to events/records; bestLap/raceBest only from valid laps.
- [ ] **Step 4:** Tests pass; `npm test` green.
- [ ] **Step 5:** Commit `p12: laps with a respawn jump are invalid`.

### Task 2: Session rules (shared)

**Files:**
- Create: `shared/src/race/sessions.ts`, `shared/src/race/sessions.test.ts`
- Modify: `shared/src/tuning.ts` (`CHAMPIONSHIP` block), `shared/src/protocol/messages.ts` (`RaceState.session`), `shared/src/index.ts`

**Interfaces:**
- Produces:
  - `type SessionKind = 'free' | 'qualifying' | 'sprint' | 'race'`
  - `type QualifyingFormat = { mode: 'timed'; minutes: 5 | 8 | 12 } | { mode: 'oneShot' }`
  - `interface SessionInfo { kind; laps: number; qualifying: QualifyingFormat | null; endsAt: number; round: { championshipId: number; round: number; rounds: number; trackId: string } | null }` — added to `RaceState` as `session` (free race default: `{ kind: 'free', laps: race.laps, qualifying: null, endsAt: 0, round: null }`).
  - `CHAMPIONSHIP = { sprintPoints, racePoints, fastestLapBonus: 1, fastestLapTopN: 10, qualiMinutes: [5,8,12], qualiDefaultMinutes: 8, qualiOverrunMs: 120000, oneShotMaxMs: 300000, maxRounds: 30, nameMax: 40, teamNameMax: 24 }` (RACE.points stays and equals racePoints).
  - `sprintLaps(raceLaps: number): number`
  - `sessionPoints(kind: SessionKind, position: number, dnf: boolean): number`
  - `fastestLapBonus(kind, position, dnf, isFastest, enabled): number`
  - `interface QualiLap { id: number; lap: number; time: number; valid: boolean }`
  - `qualifyingOrder(format: QualifyingFormat, laps: readonly QualiLap[], entrants: readonly number[]): { id: number; best: number | null }[]` — timed: best valid lap; oneShot: lap 2 only if valid; no time → after timed drivers in `entrants` order; ties by earlier lap completion order in input.
  - `qualifyingOver(format, now, startsAt, endsAt, inLapIds: ReadonlySet<number>, doneIds: ReadonlySet<number>, entrants): boolean`

- [ ] **Step 1: Failing tests** — `sprintLaps(3) === 1`, `sprintLaps(10) === 3`; `sessionPoints('race',1,false) === 25`, `('race',11,false) === 0`, `('sprint',8,false) === 1`, `('race',1,true) === 0`, `('qualifying',1,false) === 0`; `fastestLapBonus('race',10,false,true,true) === 1`, `('race',11,…) === 0`, `('sprint',1,false,true,true) === 0`, disabled → 0; `qualifyingOrder` timed picks best valid, invalid ignored, no-time drivers last in entrant order; oneShot uses lap 2 only; `qualifyingOver` timed: false before `endsAt`, false after `endsAt` while someone is mid-lap and `now < endsAt + 120000`, true after overrun; oneShot: true when all entrants in `doneIds` or `now ≥ startsAt + 300000`.
- [ ] **Step 2:** Run → FAIL (module missing).
- [ ] **Step 3:** Implement the functions above; add `session` to `RaceState` and default it in `room.ts` / `session.ts` initial states.
- [ ] **Step 4:** `npm run typecheck && npm test` green.
- [ ] **Step 5:** Commit `p12: session kinds and their rules`.

### Task 3: Championship model and standings (shared)

**Files:**
- Create: `shared/src/championship/types.ts`, `shared/src/championship/calendar.ts`, `shared/src/championship/standings.ts`, `shared/src/championship/standings.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Produces:
  - `interface SeasonSettings { laps: number; qualifying: QualifyingFormat; fastestLapPoint: boolean; tyreWear: boolean }`
  - `interface SeasonRound { round: number; trackId: string; sprint: boolean }`
  - `interface SeasonTeam { id: number; name: string; primary: number; secondary: number }`
  - `interface SeasonEntry { profile: ProfileSummary; teamId: number | null; joinedRound: number }`
  - `type ResultSession = 'qualifying' | 'sprint' | 'race'`
  - `interface SeasonResult { round: number; session: ResultSession; profileId: number; teamId: number | null; position: number; dnf: boolean; bestLapMs: number | null; points: number; fastestLap: boolean }`
  - `interface ChampionshipView { id: number; name: string; status: 'setup' | 'active' | 'finished'; settings: SeasonSettings; rounds: SeasonRound[]; teams: SeasonTeam[]; entries: SeasonEntry[]; results: SeasonResult[]; next: { round: number; session: ResultSession } | null; championId: number | null }`
  - `interface SeasonDraft { name: string; settings: SeasonSettings; rounds: { trackId: string; sprint: boolean }[] }`
  - `PRESET_2026: { label: 'Real 2026-style calendar'; rounds: { trackId: string; sprint: boolean }[] }` (24 ids in spec order: melbourne, shanghai✓, suzuka, sakhir, jeddah, miami✓, montreal✓, monaco, barcelona, spielberg, silverstone✓, spa, budapest, zandvoort✓, monza, madrid, baku, singapore✓, austin, mexico-city, sao-paulo, las-vegas, lusail, yas-island)
  - `sanitizeSeasonDraft(raw: unknown, knownTrack: (id: string) => boolean): SeasonDraft | string` (string = reason)
  - `sessionsOf(round: SeasonRound): ResultSession[]` → `['qualifying', 'sprint'?, 'race']`
  - `nextAfter(view, done: { round; session }): { round; session } | null`
  - `interface DriverStanding { profile: ProfileSummary; teamId: number | null; points: number; position: number; perRound: { round: number; race: SeasonResult | null; sprint: SeasonResult | null }[] }`
  - `interface TeamStanding { team: SeasonTeam; points: number; position: number; perRound: { round: number; points: number }[] }`
  - `computeStandings(view): { drivers: DriverStanding[]; teams: TeamStanding[] }`

- [ ] **Step 1: Failing tests** — preset has 24 rounds and exactly the 6 sprint rounds listed above (existence of the ids is checked by the server catalog test in Task 4, since /shared can't read files); `sanitizeSeasonDraft` rejects 0 and 31 rounds, unknown track, empty/41-char name, laps out of range, minutes 7; `sessionsOf` with/without sprint; `nextAfter` walks Q→S→R→next round Q and returns null after the last race; standings: points summed from sprint+race, absent rounds give 0 and `null` cells, countback (equal points → more wins first, then more 2nds; equal race countback → sprint countback; then entry order), team points only from rows carrying that team's id (driver moved teams mid-season keeps old points with old team), teamless drivers absent from teams table, results for a profile with no entry ignored.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Green.
- [ ] **Step 5:** Commit `p12: championship model, preset calendar, standings with countback`.

### Task 4: Database — migration 2 and championship store

**Files:**
- Modify: `server/src/db/migrations.ts` (version 2 = spec §3 SQL), `server/src/db/database.ts`
- Create: `server/src/db/championships.ts`, `server/src/db/championships.test.ts`
- Modify: `server/src/tracks/catalog.test.ts` (preset ids exist)

**Interfaces:**
- Consumes: Task 3 types.
- Produces: `interface ChampionshipStore` (in `championships.ts`) implemented by `class ChampionshipDb` (takes the `PlayerDb`'s `db` handle):
  - `create(draft: SeasonDraft, now: number): ChampionshipView`
  - `list(): { id; name; status; rounds: number; next: …; championId }[]`
  - `view(id: number): ChampionshipView | null`
  - `addEntry(id, profileId, joinedRound): void` · `setTeam(id, profileId, teamId | null): void`
  - `createTeam(id, name, primary, secondary): SeasonTeam`
  - `start(id): void` (setup → active, next = round 1 qualifying)
  - `writeSession(id, round, session, rows: SeasonResult[], career: RaceInput | null, next: { round; session } | null, champion: number | null, now): void` — one transaction: insert rows, insert career race (if given) with `championship_id`, advance pointer, on `next === null` set finished + champion + `championship_title` (name = season name).
- `PlayerDb.recordRace` accepts `kind: 'race' | 'sprint'`, `championshipId?: number`; `RaceInput.lapTimes[].valid`; bests / hall of fame use `valid = 1`.

- [ ] **Step 1: Failing tests** — migration from a v1 file (create PlayerDb on a temp file at v1 by running only migration 1, insert a lap, then open with all migrations) keeps the lap with `valid = 1`; create/view round-trip; `writeSession` advances the pointer; a thrown insert (duplicate profile row) rolls back the pointer; finale sets `status = 'finished'`, champion, and `stats(champion).championships === 1`; invalid lap excluded from `hallOfFame` and `trackRecords`; catalog test: every `PRESET_2026` id is in the track catalog.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Green.
- [ ] **Step 5:** Commit `p12: championship tables and store`.

### Task 5: Room runs sessions

**Files:**
- Modify: `server/src/game/room.ts`, `shared/src/protocol/messages.ts`
- Test: `server/src/game/room.test.ts`

**Interfaces:**
- Consumes: Task 1, 2.
- Produces:
  - `PlayerInfo.gridSlot: number | null` (grid / pit position for the current session; null = spectator), `PlayerInfo.entrant: boolean`.
  - `Room.runSession(spec: { session: SessionInfo; trackId: string; tyreWear: TyreWearSetting; entrants: number[] /* player ids in start order */ }, onDone: (outcome: SessionOutcome) => void): string | null` (returns refusal reason).
  - `interface SessionOutcome { kind: SessionKind; classification: { playerId: number; position: number; dnf: boolean; bestLapMs: number | null; laps: number; totalMs: number | null }[]; fastestLapId: number | null; lapsOf: (playerId: number) => readonly LapRecord[] }`
  - Qualifying uses the tracker with unlimited laps; end via `qualifyingOver`; classification via `qualifyingOrder`. Sprint laps via `sprintLaps`. Free race behaviour unchanged (existing tests untouched).
  - `TRACK.pitStarts(track, count)` helper in `shared/src/track/track.ts`: poses along the pit lane full section (falls back to `spawnGrid`).
- [ ] **Step 1: Failing tests** — timed qualifying: two entrants, one sets a lap, clock passes `endsAt` while the other is mid-lap, finishes within overrun → included; after overrun session goes to results with order by best lap; one-shot: lap 1 ignored, lap 2 counts, ends when both have done lap 2; sprint with `laps` 9 runs 3 laps; race grid: `gridSlot` follows `entrants` order; non-entrant gets `gridSlot: null`, isn't in standings, and its states are ignored by the tracker; disconnect-and-rejoin during qualifying keeps the best lap; `endRace` during a session calls nothing (abandoned).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement (the existing `start` message builds a free session through the same path).
- [ ] **Step 4:** Green.
- [ ] **Step 5:** Commit `p12: room runs qualifying, sprint and race sessions`.

### Task 6: Championship runner and messages

**Files:**
- Create: `server/src/game/championshipRunner.ts`, `server/src/game/championshipRunner.test.ts`
- Modify: `server/src/game/room.ts`, `server/src/main.ts`, `shared/src/protocol/messages.ts`

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces:
  - C2S: `champCreate {draft}`, `champLoad {id}`, `champClose`, `champEnter`, `champAddEntrant {profileId}`, `champTeamCreate {name, primary, secondary}`, `champTeamJoin {teamId}`, `champTeamLeave`, `champMoveDriver {profileId, teamId: number | null}`, `champStartSession`, `champList`.
  - S2C: `champ {view: ChampionshipView | null}`, `champList {seasons}`, `notice {text}`.
  - `class ChampionshipRunner { constructor(room: RoomControl, store: ChampionshipStore, tracks: TrackProvider, log) ; handle(player, msg): void ; onRoster(): void }` where `RoomControl` is the subset of `Room` it needs (`runSession`, `broadcast`, `notify(playerId, text)`, `playersByProfile()`, `hostProfileId()`).
  - On session done: build `SeasonResult[]` (points via Task 2, fastest lap bonus, team at the time), career `RaceInput` for sprint/race (pole = qualifying P1 of that round on the race result), `nextAfter`, champion = `computeStandings(view).drivers[0]` when finished; `store.writeSession(...)`; on failure notify host and leave the pointer.
- [ ] **Step 1: Failing tests** (fake store + fake room) — host-only actions refused with `notice` for others; not-logged-in `champEnter` refused; team full / same name / teams locked after round 1 refused; late entrant added at round 3 has `joinedRound 3`; start session on unknown track id → notice; abandoned session (fake room calls back nothing) leaves pointer; completed race with fastest-lap setting on gives +1 to a top-10 holder; finale sets champion; a store `writeSession` that throws → host notified, pointer unchanged.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement and wire in `main.ts` (`new ChampionshipDb(db.db)`).
- [ ] **Step 4:** Green.
- [ ] **Step 5:** Commit `p12: championship runner and messages`.

### Task 7: History API

**Files:** Modify `server/src/http/api.ts`, `server/src/http/api.test.ts`

**Interfaces:** `GET /api/championships` → `champList` rows; `GET /api/championships/:id` → `ChampionshipView` or 404.

- [ ] **Step 1:** Failing tests: list empty → `[]`; created season appears; unknown id 404.
- [ ] **Step 2–4:** Implement (api gets `championships: ChampionshipStore` option), green.
- [ ] **Step 5:** Commit `p12: championship history endpoints`.

### Task 8: Client — sessions, spectators

**Files:**
- Create: `client/src/game/spectator.ts`
- Modify: `client/src/main.ts`, `client/src/ui/raceHud.ts`, `client/src/ui/raceOverlay.ts`, `client/src/game/session.ts`, `client/src/render/cameraRig.ts`

**Interfaces:**
- `Session.gridPose()` uses `me.gridSlot` (pit starts for qualifying via `pitStarts`); `null` → spectator.
- `class Spectator { follow(id | null); cycle(); update(cameraRig, remoteCars, dt) }` — while spectating, the local car is parked at `y = -50` (no collisions) and no `state` messages are sent.
- HUD: session label (`R3/24 · Qualifying`, `· 6:12 left` for timed), qualifying shows best lap per driver instead of laps.

- [ ] **Step 1:** Unit test `spectator.test.ts`: `cycle()` walks visible remote ids in order and wraps; `follow(null)` picks the leader.
- [ ] **Step 2–4:** Implement; `npm run typecheck && npm test`.
- [ ] **Step 5:** Commit `p12: client sessions, qualifying HUD and spectating`.

### Task 9: Client — championship hub

**Files:**
- Create: `client/src/ui/championship/hub.ts`, `editor.ts`, `entries.ts`, `standingsGrid.ts`, `client/src/ui/championship/standingsGrid.test.ts`
- Modify: `client/src/ui/lobby.ts` (🏁 button, quick-race controls hidden while a season is loaded), `client/src/main.ts`, `client/index.html`, `client/src/ui/style.css`

**Interfaces:**
- `cellClass(r: SeasonResult | null): 'gold' | 'silver' | 'bronze' | 'points' | 'finished' | 'dnf' | 'absent'` in `standingsGrid.ts` (pure, tested): P1 gold, P2 silver, P3 bronze, points>0 green, finished without points light blue, dnf red, null grey.
- Hub views per spec §4 (seasons, editor with preset/reorder/sprint toggles, entries & teams, weekend card, Drivers/Teams standings with per-round grid).

- [ ] **Step 1:** Failing test for `cellClass` (all seven cases).
- [ ] **Step 2–4:** Implement hub; typecheck/test green.
- [ ] **Step 5:** Commit `p12: championship hub, season editor, teams and standings grid`.

### Task 10: Finale, end-to-end season, docs, browser check

**Files:**
- Create: `client/src/ui/championship/finale.ts`, `server/src/game/season.e2e.test.ts`
- Modify: `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/OPEN_WHEEL_PLAN.md`, `docs/PROFILES.md`

- [ ] **Step 1:** E2E test: real `Room` + `ChampionshipRunner` + `ChampionshipDb(':memory:')`, two profiled drivers, two rounds (round 1 sprint), qualifying one-shot; simulated drivers feed positions along the centreline (driver A faster); expect standings A first with 25+8+25 = 58 points and the season finished with A champion and a title row.
- [ ] **Step 2–3:** Implement finale screen (champion photo via `avatarHtml`, name, team, points, season wins, top three, team champion, canvas confetti), shown when `view.status` becomes `finished`.
- [ ] **Step 4:** `npm run typecheck && npm test && npm run build`; browser screenshots of hub, editor, standings grid, spectator view, finale.
- [ ] **Step 5:** Docs (phase line, conventions, plan status) and commit `p12: champion finale, season e2e test, docs`.
