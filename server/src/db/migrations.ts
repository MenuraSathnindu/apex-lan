/**
 * Numbered schema migrations. Applied in order, each once, inside a transaction.
 * Never edit a migration that has shipped — add a new one.
 */
export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: 'profiles, sessions, races, laps',
    sql: `
      CREATE TABLE profile (
        id          INTEGER PRIMARY KEY,
        name        TEXT    NOT NULL,
        -- lower-cased name, for login and uniqueness
        name_key    TEXT    NOT NULL UNIQUE,
        tag         TEXT    NOT NULL,
        livery      TEXT    NOT NULL,           -- JSON Livery (number = favourite number)
        pin_hash    TEXT    NOT NULL,           -- bcrypt
        photo       TEXT,                       -- file name in data/photos, or NULL
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );

      -- "Remember me" tokens: only a SHA-256 of the token is stored.
      CREATE TABLE login_token (
        token_hash  TEXT    PRIMARY KEY,
        profile_id  INTEGER NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
        created_at  INTEGER NOT NULL,
        last_used   INTEGER NOT NULL
      );

      CREATE TABLE race (
        id          INTEGER PRIMARY KEY,
        track_id    TEXT    NOT NULL,
        kind        TEXT    NOT NULL DEFAULT 'race',
        laps        INTEGER NOT NULL,
        starters    INTEGER NOT NULL,
        finished_at INTEGER NOT NULL
      );

      -- One row per starter (guests have profile_id NULL so positions stay complete).
      CREATE TABLE race_result (
        race_id     INTEGER NOT NULL REFERENCES race(id) ON DELETE CASCADE,
        position    INTEGER NOT NULL,
        profile_id  INTEGER REFERENCES profile(id) ON DELETE SET NULL,
        grid        INTEGER,
        dnf         INTEGER NOT NULL,
        laps        INTEGER NOT NULL,
        total_ms    INTEGER,
        best_lap_ms INTEGER,
        fastest_lap INTEGER NOT NULL,
        pole        INTEGER NOT NULL,
        points      INTEGER NOT NULL,
        PRIMARY KEY (race_id, position),
        UNIQUE (race_id, profile_id)
      );
      CREATE INDEX race_result_profile ON race_result(profile_id);

      -- Every completed lap of a profiled driver (personal bests, sector bests, hall of fame).
      CREATE TABLE lap (
        race_id     INTEGER NOT NULL REFERENCES race(id) ON DELETE CASCADE,
        profile_id  INTEGER NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
        track_id    TEXT    NOT NULL,
        lap         INTEGER NOT NULL,
        time_ms     INTEGER NOT NULL,
        s1_ms       INTEGER,
        s2_ms       INTEGER,
        s3_ms       INTEGER,
        set_at      INTEGER NOT NULL,
        PRIMARY KEY (race_id, profile_id, lap)
      );
      CREATE INDEX lap_track_time ON lap(track_id, time_ms);
      CREATE INDEX lap_profile_track ON lap(profile_id, track_id);

      -- Championship titles (written by championship mode).
      CREATE TABLE championship_title (
        id          INTEGER PRIMARY KEY,
        profile_id  INTEGER NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
        name        TEXT    NOT NULL,
        won_at      INTEGER NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: 'championships, lap validity',
    sql: `
      CREATE TABLE championship (
        id                  INTEGER PRIMARY KEY,
        name                TEXT    NOT NULL,
        status              TEXT    NOT NULL,          -- 'setup' | 'active' | 'finished'
        settings            TEXT    NOT NULL,          -- JSON SeasonSettings
        next_round          INTEGER,                   -- NULL until started / when finished
        next_session        TEXT,
        champion_profile_id INTEGER REFERENCES profile(id) ON DELETE SET NULL,
        created_at          INTEGER NOT NULL,
        finished_at         INTEGER
      );
      CREATE TABLE championship_round (
        championship_id INTEGER NOT NULL REFERENCES championship(id) ON DELETE CASCADE,
        round           INTEGER NOT NULL,
        track_id        TEXT    NOT NULL,
        sprint          INTEGER NOT NULL,
        PRIMARY KEY (championship_id, round)
      );
      CREATE TABLE championship_team (
        id              INTEGER PRIMARY KEY,
        championship_id INTEGER NOT NULL REFERENCES championship(id) ON DELETE CASCADE,
        name            TEXT    NOT NULL,
        primary_color   INTEGER NOT NULL,
        secondary_color INTEGER NOT NULL
      );
      CREATE TABLE championship_entry (
        championship_id INTEGER NOT NULL REFERENCES championship(id) ON DELETE CASCADE,
        profile_id      INTEGER NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
        team_id         INTEGER REFERENCES championship_team(id) ON DELETE SET NULL,
        joined_round    INTEGER NOT NULL,
        PRIMARY KEY (championship_id, profile_id)
      );
      CREATE TABLE championship_result (
        championship_id INTEGER NOT NULL REFERENCES championship(id) ON DELETE CASCADE,
        round           INTEGER NOT NULL,
        session         TEXT    NOT NULL,              -- 'qualifying' | 'sprint' | 'race'
        profile_id      INTEGER NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
        team_id         INTEGER,                       -- team at the time
        position        INTEGER NOT NULL,
        dnf             INTEGER NOT NULL,
        best_lap_ms     INTEGER,
        points          INTEGER NOT NULL,
        fastest_lap     INTEGER NOT NULL,
        PRIMARY KEY (championship_id, round, session, profile_id)
      );
      ALTER TABLE lap ADD COLUMN valid INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE race ADD COLUMN championship_id INTEGER;
    `,
  },
];
