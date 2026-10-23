# Player profiles

Profiles live on the **host's** machine. Friends create one in the lobby (👤 *Log in / create a
profile*) and from then on their name, tag, photo, livery and career follow them to every race
in this room.

## What a profile holds

| | |
|---|---|
| Display name | 2–16 characters, unique on this host (case-insensitive). It is also the login name and can't be changed in the lobby. |
| Tag | Three letters, shown on the timing tower (`ANN`). Defaults from the name. |
| Number + livery | Favourite number and primary / secondary / accent colours. Editing them in the lobby saves them to the profile. |
| Photo | Optional. Shown in the lobby, the timing tower, the podium and above the car (menu → Graphics → *Show player photos above cars*). |
| PIN | Four digits, used to log in on another device or browser. |

## Logging in and the PIN — LAN-level protection, not security

- Creating a profile or logging in (name + PIN) gives the browser a random login token, kept in
  `localStorage`. Every tab of that browser is logged in until you press *Log out*, which revokes
  the token on the host.
- PINs are stored as **bcrypt** hashes and tokens as SHA-256 hashes, so the database file alone
  doesn't reveal them. Failed logins are throttled (5 per minute per address).
- **This only stops friends on the same Wi-Fi from casually driving as you.** A 4-digit PIN can be
  guessed, the game runs over plain `http://` (anyone on the network can read the traffic), and
  whoever has the host laptop has the database. Don't use a PIN you use for anything else, and
  don't expose the server to the internet.
- One profile can drive one car at a time; a second tab logged in as the same profile is told
  it's already driving.

## Photos

Uploads are checked on the host: **JPEG, PNG or WebP only**, decided by the file's actual bytes
(not its name) and by decoding it with `sharp`, up to **5 MB**. The picture is centre-cropped to
**256×256 WebP**, all metadata (EXIF, GPS, camera info) is dropped, and it's saved under a random
file name. Anything else is refused.

## Career stats

The host records every race that reaches the results screen:

- **Races, wins, podiums, points, fastest laps** count only races with at least two starters;
  a solo run counts as *practice* (its laps still count for personal bests).
- **DNF**: still on track when the results came.
- **Points**: `RACE.points` (25-18-15-12-10-8-6-4-2-1) for finishers.
- **Personal best and sector bests per track**, from every lap you've completed (sector times
  come from the track's three sector lines). *Ideal* = the sum of your best sectors.
- **Head to head**: in races you both started, who finished ahead.
- **Poles** come from championship qualifying (P1 starts the race on pole); **championships** count
  seasons won. Sprints add their points to the career but don't count as races or wins.
- A lap with a respawn in it still counts as a lap driven, but never as a best or a qualifying time.
- Guests race normally but nothing is recorded for them.

**Hall of Fame** (lobby → 🏆): every driver's fastest lap on each track, with sectors and the date.

## Where the data is

`server/data/` on the host (git-ignored):

```
server/data/apex.sqlite      ← profiles, races, results, laps (SQLite)
server/data/photos/*.webp    ← profile photos
```

Set `APEX_DATA_DIR=/some/folder` to keep it elsewhere. **Back up** by copying the folder while the
server is stopped (or copy `apex.sqlite`, `apex.sqlite-wal` and `apex.sqlite-shm` together).
Deleting it starts everyone from scratch; browsers that remember an old login are logged out
automatically.

## For developers

- Schema and migrations: `server/src/db/migrations.ts` (numbered; never edit a shipped one).
  Typed queries: `server/src/db/database.ts` (`PlayerDb`). Stats are SQL over the raw rows.
- HTTP API: `server/src/http/api.ts` (`/api/...`, `/photos/...`), types in
  `shared/src/protocol/api.ts`. The room learns about profiles through the `ProfileDirectory`
  and `ResultsSink` interfaces, so its tests use fakes.
- Native modules (`better-sqlite3`, `bcrypt`, `sharp`) ship prebuilt binaries for Windows, macOS
  and Linux; they stay external in the server bundle.
