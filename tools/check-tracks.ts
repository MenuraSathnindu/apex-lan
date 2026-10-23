// Drives every generated track headlessly and prints whether it can be lapped.
//   npm run tracks:check            → every track in client/public/tracks/index.json
//   npm run tracks:check -- monza   → just these
// A lap only counts if the server's lap counter saw every checkpoint gate crossed in order.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeTrack, buildTrack, driveLap, initRapier, parseTrackFile, type TrackIndexEntry } from '../shared/src/index.ts';

const DIR = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'client', 'public', 'tracks');
const index: TrackIndexEntry[] = JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8'));
const only = process.argv.slice(2);
await initRapier();

let failed = 0;
console.log(`\n${'track'.padEnd(18)} ${'length'.padStart(8)} ${'lap'.padStart(9)} ${'top'.padStart(9)} ${'hits'.padStart(5)} ${'resets'.padStart(6)}  geometry`);
for (const entry of index) {
  if (only.length && !only.includes(entry.id)) continue;
  const def = parseTrackFile(JSON.parse(readFileSync(join(DIR, `${entry.id}.json`), 'utf8')));
  const t0 = performance.now();
  const track = buildTrack(def);
  const buildMs = performance.now() - t0;
  const a = analyzeTrack(track);
  const r = driveLap(track);
  const ok = r.completed && r.resets === 0;
  if (!ok) failed++;
  const lap = r.lapTimeS === null ? 'DNF' : `${Math.floor(r.lapTimeS / 60)}:${(r.lapTimeS % 60).toFixed(1).padStart(4, '0')}`;
  console.log(
    `${(ok ? '✓ ' : '✗ ') + entry.id.padEnd(16)} ${`${(track.length / 1000).toFixed(2)}km`.padStart(8)} ${lap.padStart(9)} ${`${r.topSpeedKmh.toFixed(0)}km/h`.padStart(9)} ${String(r.barrierHits).padStart(5)} ${String(r.resets).padStart(6)}  ` +
      `min r ${a.minRadiusM.toFixed(0)} m, width ≥ ${a.minWidthM.toFixed(1)} m, barriers ${(a.barrierCoverage * 100).toFixed(0)} %, crossings ${a.crossings}, ` +
      `${track.grandstands.length} stands, pit ${track.pitBuilding ? 'yes' : 'no'}, built in ${buildMs.toFixed(0)} ms`,
  );
}
console.log(failed ? `\n${failed} track(s) could not be lapped cleanly.` : '\nEvery track was lapped cleanly.');
process.exitCode = failed ? 1 : 0;
