# Championship mode — design

Date: 2026-10-23 · Phase 12 · Status: approved in conversation, awaiting spec review

## 1. Goal and agreed decisions

Friends on the LAN play a **season**: a calendar of real circuits, each round a weekend of
qualifying → optional sprint → race, with drivers' and teams' standings that survive across
game nights, ending with a champion celebration that goes on the champion's career profile.

Decisions made with the user:

| Topic | Decision |
|---|---|
| Who takes part | **Profiles only** (logged in). Guests and other non-entrants spectate championship sessions. |
| Late joiners | **Allowed**: the host adds a profile at any round; earlier rounds count as absent (0 points). |
| Qualifying | **Per-season choice**: *timed* (5 / 8 / 12 min, default 8, best valid lap) or *one-shot* (one warm-up lap + one flying lap). |
| Sprint grid | **One qualifying sets both grids** (sprint and race start in qualifying order). |
| Teams | **Players form teams** of 1–2 drivers (name + two colours); teamless drivers aren't in the teams table; teams lock when round 1 starts, late entrants may fill a free seat or create a team; the host can fix mistakes. |
| Calendar preset | **Real 2026-style calendar**, full 24 rounds with its six sprint weekends; the host can trim, reorder and add before starting. |
| Architecture | **Session layer in the room + a championship service** (approach A). |

Season settings (host, at creation): name, rounds (track + sprint flag, ordered), laps per race,
qualifying mode (+ minutes), fastest-lap bonus point (default **off**), tyre wear (default **on**,
using the race's wear setting `normal`; off = `off`).

The preset calendar (tracks we have, in order; ✓ = sprint):
Melbourne, Shanghai ✓, Suzuka, Sakhir, Jeddah, Miami ✓, Montreal ✓, Monaco, Barcelona, Spielberg,
Silverstone ✓, Spa, Budapest, Zandvoort ✓, Monza, Madrid, Baku, Singapore ✓, Austin, Mexico City,
São Paulo, Las Vegas, Lusail, Yas Island. Its UI name is "Real 2026-style calendar" — no series
name (trademark rule).

Out of scope: AI drivers, separate sprint qualifying, penalties/stewarding, team orders, more
than one season running at once in a room.

## 2. Sessions in the room

The room runs one **session** at a time. `RaceState` gains a `session` block:

```ts
type SessionKind = 'free' | 'qualifying' | 'sprint' | 'race';
interface SessionInfo {
  kind: SessionKind;
  /** Laps to run (free, sprint, race). */
  laps: number;
  qualifying?: { mode: 'timed'; minutes: number } | { mode: 'oneShot' };
  /** Server time a timed qualifying ends (0 otherwise). */
  endsAt: number;
  /** Championship context for the HUD ("Round 3 · Qualifying"), or null for a free race. */
  round: { championshipId: number; round: number; rounds: number } | null;
}
```

The existing phases stay: `lobby → countdown → racing → results`. Per-kind behaviour lives in
pure shared functions (`shared/src/race/sessions.ts`), unit-tested:

| Kind | Start positions | Ends when | Classification | Points |
|---|---|---|---|---|
| free | grid by slot (today) | first finisher + finish grace / all finished | finishing order | career only |
| qualifying, timed | pit lane exit (staggered), or grid slots if the track has no pit lane | clock reaches `endsAt`; a lap under way at the flag may finish, at most `RACE.qualiOverrunMs` (2 min) | best **valid** lap; no time → back, in entry order | none |
| qualifying, one-shot | same | every driver completed lap 2 (warm-up + flying lap), or 5 min | lap 2 time if valid; otherwise back | none |
| sprint | qualifying order | `max(1, round(laps / 3))` laps + finish grace | finishing order | 8-7-6-5-4-3-2-1 |
| race | qualifying order | `laps` + finish grace | finishing order | 25-18-15-12-10-8-6-4-2-1, +1 for fastest lap if the setting is on and the holder finished in the top 10 |

**Lap validity.** The lap counter already ignores implausible jumps (respawns, teleports) for
gate crossings. It now also marks the lap containing a jump **invalid**. Invalid laps never count
for qualifying, for personal bests or for the Hall of Fame (the `lap` table gains `valid`;
existing rows count as valid).

**Disconnects.** A sprint/race driver who isn't classified as finished when results come is DNF
(0 points). In qualifying, no valid time = back of the grid.

**Grids.** The room places cars from the session's start order: qualifying → pit lane positions;
sprint/race → grid slots in qualifying order. Clients already take their pose from the server's
roster (`slot`); a session-specific `gridSlot` per player replaces the join-order slot while a
championship session runs.

**Spectators.** In a championship session, players who aren't entrants (guests, profiles not
entered) don't get a car on track: the client parks/hides its car, sends no states, and its camera
follows a classified car (the camera key cycles through cars). They still see the HUD standings.

## 3. Data and persistence (migration 2)

```sql
CREATE TABLE championship (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL,
  status TEXT NOT NULL,                  -- 'setup' | 'active' | 'finished'
  settings TEXT NOT NULL,                -- JSON: laps, qualifying, fastestLapPoint, tyreWear
  next_round INTEGER NOT NULL,           -- 1-based round to run next
  next_session TEXT NOT NULL,            -- 'qualifying' | 'sprint' | 'race'
  champion_profile_id INTEGER REFERENCES profile(id),
  created_at INTEGER NOT NULL, finished_at INTEGER
);
CREATE TABLE championship_round (
  championship_id INTEGER NOT NULL REFERENCES championship(id) ON DELETE CASCADE,
  round INTEGER NOT NULL, track_id TEXT NOT NULL, sprint INTEGER NOT NULL,
  PRIMARY KEY (championship_id, round)
);
CREATE TABLE championship_team (
  id INTEGER PRIMARY KEY,
  championship_id INTEGER NOT NULL REFERENCES championship(id) ON DELETE CASCADE,
  name TEXT NOT NULL, primary_color INTEGER NOT NULL, secondary_color INTEGER NOT NULL
);
CREATE TABLE championship_entry (
  championship_id INTEGER NOT NULL REFERENCES championship(id) ON DELETE CASCADE,
  profile_id INTEGER NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
  team_id INTEGER REFERENCES championship_team(id) ON DELETE SET NULL,
  joined_round INTEGER NOT NULL,
  PRIMARY KEY (championship_id, profile_id)
);
CREATE TABLE championship_result (
  championship_id INTEGER NOT NULL REFERENCES championship(id) ON DELETE CASCADE,
  round INTEGER NOT NULL,
  session TEXT NOT NULL,                 -- 'qualifying' | 'sprint' | 'race'
  profile_id INTEGER NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
  team_id INTEGER,                       -- team at the time (points stay with it)
  position INTEGER NOT NULL, dnf INTEGER NOT NULL,
  best_lap_ms INTEGER, points INTEGER NOT NULL, fastest_lap INTEGER NOT NULL,
  PRIMARY KEY (championship_id, round, session, profile_id)
);
ALTER TABLE lap ADD COLUMN valid INTEGER NOT NULL DEFAULT 1;
ALTER TABLE race ADD COLUMN championship_id INTEGER;   -- career rows from championship sessions
```

- **Standings are computed, never stored**: `computeStandings(view)` in `shared/src/championship/`
  turns the result rows into drivers' and teams' tables. Teams total the points their drivers
  scored *while in that team* (`team_id` on each row). Ties: countback on race positions (most
  wins, then 2nds, …), then sprint positions, then entry order.
- **Progress**: each session's results are written in **one transaction** together with the
  advance of `next_round` / `next_session`. An abandoned session (host ends it, everyone leaves)
  writes nothing and runs again. After the last race: `status = 'finished'`, champion stored, a
  `championship_title` row added (career "Titles").
- **Resume**: any `setup`/`active` season can be loaded by the host; the room continues at
  `next_round` / `next_session`. Several seasons may be stored; one is loaded in a room at a time.
- **Absent drivers**: no row for that round → shown as absent, 0 points.
- **Career**: sprint and race results also go to the career tables (`race.kind` = 'sprint' /
  'race', `championship_id` set) exactly as free races do today; qualifying P1 sets `pole` on that
  round's race result. Qualifying laps count for bests if valid.

## 4. Flow and screens

**Championship hub** (lobby → 🏁 Championship), full-screen overlay like the profile screen:

1. **Seasons** — active / unfinished / finished; host: *New season*, *Resume*; anyone: view.
2. **New season** (host) — name; calendar builder (*Load real 2026-style calendar* or empty; add
   track from the list, ↑/↓ reorder, remove, sprint checkbox per round); laps per race; qualifying
   mode (timed 5/8/12 min or one-shot); fastest-lap point; tyre wear. Creates a `setup` season.
3. **Entries & teams** — logged-in players *Enter*; host may add any connected profile. *Create
   team* (name, two colours) / *Join* (free seat) / *Leave*. Teams lock when round 1 starts
   (late entrants: free seat or new team; host can move a driver).
4. **Weekend card** — "Round 3 of 24 · Suzuka · Qualifying (timed, 8 min)" and the schedule of
   the weekend; host: *Start session* (the room switches track, laps, tyre wear itself).
5. **Standings** — Drivers / Teams tabs; per-round results grid, rows = drivers (or teams),
   columns = rounds. Cell colours: gold P1, silver P2, bronze P3, green other points, light blue
   finished without points, red DNF, grey absent; small superscript = sprint position; ⏱ marker =
   fastest lap; total points column. The team grid shows points per round.

**During a championship session**: quick-race lobby controls are hidden; track / laps / wear come
from the season; non-entrants spectate. The HUD shows "R3 · Qualifying · 6:12 left" for timed
qualifying. After results: *Back to championship* shows updated standings and the next session.

**Finale**: after the last race, a champion screen — the champion's photo, name, team, points,
season wins, confetti; podium of the top three drivers and the team champion; the title is
recorded to the career.

## 5. Messages, errors

- **WebSocket** (the room knows who is host): C2S `champCreate {def}`, `champLoad {id}`,
  `champEnter`, `champAddEntrant {profileId}`, `champTeamCreate {name, primary, secondary}`,
  `champTeamJoin {teamId}`, `champTeamLeave`, `champMoveDriver {profileId, teamId|null}` (host),
  `champStartSession`, `champClose`. S2C `champ {view | null}` — the full season view (settings,
  rounds, entries, teams, result rows, next session) whenever it changes; `notice {text}` to a
  sender whose action was refused.
- **HTTP** (read-only history): `GET /api/championships`, `GET /api/championships/:id` → the same
  view type, for browsing finished seasons.
- **Errors**: refused actions (not host, not logged in, team full, teams locked, season finished)
  → `notice` to the sender only. A failed results write → the season doesn't advance, the host
  gets a notice and can rerun the session.
- Validation of `champCreate`: 1–30 rounds, known track ids, laps within `RACE` limits, name 1–40
  chars; team name 1–24 chars, colours valid; everything sanitised server-side.

## 6. Code layout

- `shared/src/race/sessions.ts` — session kinds: start order, end condition, classification, points.
- `shared/src/championship/` — season types (`ChampionshipView`, settings, preset calendar),
  `computeStandings`, countback.
- `shared/src/race/raceTracker.ts` — lap validity, qualifying support (unlimited laps, best valid
  lap, per-lap validity), session end hooks.
- `server/src/db/` — migration 2, championship queries (create, load, entries, teams, write
  session results + advance in one transaction, finish).
- `server/src/game/room.ts` — runs `SessionInfo`; `server/src/game/championshipRunner.ts` — turns
  season state into the next session and session results into rows (depends on a
  `ChampionshipStore` interface; tests use a fake).
- `client/src/ui/championship/` — hub, season editor, entries & teams, standings grid, finale.
- `client/src/game/spectator.ts` — spectator camera / parked car.

## 7. Testing

- Pure: points per kind incl. fastest-lap bonus rule; classification per kind (timed with overrun,
  one-shot, DNFs, no-time); grid from qualifying; standings with countback, absent rounds, team
  changes mid-season.
- DB: migration 2 on an existing v1 database; write-results-and-advance is atomic; resume pointer;
  finale writes champion + title; `lap.valid` respected by bests and Hall of Fame.
- Room (fakes): timed qualifying end incl. a lap finishing after the flag; one-shot; sprint length;
  race grid = qualifying order; spectators get no grid slot and aren't classified; abandoned
  session writes nothing; late entrant; host-only actions refused with a notice.
- End-to-end: a two-round season (one sprint weekend) through the room with simulated drivers,
  checking standings and the finale.
- Browser: hub, editor, standings grid colours, spectator view, champion screen (screenshots).
