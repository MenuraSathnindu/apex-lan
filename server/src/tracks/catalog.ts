import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TRACKS, parseTrackFile, trackIndexEntry, type TrackDef, type TrackIndexEntry } from '@apex/shared';

/** What the room needs to know about tracks (a test can pass an in-memory one). */
export interface TrackProvider {
  /** Every selectable track, built-in ones first. */
  list(): TrackIndexEntry[];
  /** The full definition, or null if unknown/unreadable. */
  get(id: string): TrackDef | null;
}

/** Built-in tracks only (tests, or no generated tracks on disk). */
export function builtInTracks(): TrackProvider {
  return {
    list: () => Object.values(TRACKS).map(trackIndexEntry),
    get: (id) => TRACKS[id] ?? null,
  };
}

/**
 * Built-in tracks plus the generated ones in `dir` (client/public/tracks: index.json + <id>.json).
 * Files are read and validated on first use and cached.
 */
export function trackCatalog(dir: string, log: (m: string) => void = () => {}): TrackProvider {
  const builtIn = builtInTracks();
  let generated: TrackIndexEntry[] = [];
  const indexPath = join(dir, 'index.json');
  if (existsSync(indexPath)) {
    try {
      generated = JSON.parse(readFileSync(indexPath, 'utf8'));
    } catch (err) {
      log(`could not read ${indexPath}: ${(err as Error).message}`);
    }
  } else log(`no generated tracks in ${dir} (only the built-in ones)`);
  const ids = new Set(generated.map((e) => e.id));
  const cache = new Map<string, TrackDef | null>();
  return {
    list: () => [...builtIn.list(), ...generated],
    get(id) {
      const own = builtIn.get(id);
      if (own) return own;
      if (!ids.has(id) || !/^[a-z0-9-]+$/.test(id)) return null;
      if (!cache.has(id)) {
        try {
          cache.set(id, parseTrackFile(JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8'))));
        } catch (err) {
          log(`track ${id}: ${(err as Error).message}`);
          cache.set(id, null);
        }
      }
      return cache.get(id) ?? null;
    },
  };
}
