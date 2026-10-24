# tools/

Offline generators. Their output is committed, so playing the game never needs them.

## Track pipeline (`npm run tracks`)

`build-tracks.ts` turns open circuit datasets into our track JSON in
`client/public/tracks/` (format: `TrackFile` in `shared/src/track/trackFile.ts`). The circuits
it knows about, and their names, are in `tracks.config.ts`.

### 1. Get the source data (once)

Clone both datasets into `tools/data/` (git-ignored):

```sh
git clone --depth 1 https://github.com/TUMFTM/racetrack-database tools/data/racetrack-database
git clone --depth 1 https://github.com/bacinger/f1-circuits tools/data/circuits
```

Any folder name works: the script
looks for the folder that contains `circuits/`.

| Dataset | Licence | What we use |
|---|---|---|
| TUMFTM racetrack-database | LGPL-3.0 | Smoothed centrelines in metres with left/right widths (originally from OpenStreetMap). Preferred. |
| Bacinger circuits GeoJSON | MIT | Lat/lon centrelines, the published lengths, and the start/finish line (its first point). Used alone, at 13 m width, for circuits TUMFTM doesn't have. |

### 2. Build

```sh
npm run tracks                 # the first five: Monza, Spa, Silverstone, Suzuka, Monaco
npm run tracks -- --all        # every circuit in tracks.config.ts
npm run tracks -- imola baku   # just these
```

For each track it:
1. loads TUMFTM (x east, y north, widths) or projects Bacinger's lat/lon to metres (north up);
2. rotates/moves TUMFTM onto Bacinger's geography by best fit and reports the fit error;
3. resamples to 5 m, smooths positions and widths, clamps half-widths to 4–12 m;
4. puts point 0 on the start/finish line (Bacinger's first point, plus `startShift`);
5. finds straight-mode zones (the longest low-curvature stretches) and a detection point
   before the longest one, splits sectors in thirds, places checkpoints every ~100 m, a
   20-slot staggered grid and a pit lane beside the start straight (on whichever side has room);
6. compares the length to the published one and lists warnings (crossings, tight grids…).

It also writes `tools/out/<id>.svg` (git-ignored): the layout with start, direction arrows,
zones, detection point, sectors, pit entry/exit and the Bacinger reference dashed in pink.
**Look at these** before committing a new track: the datasets don't say where the start line
is or which way the race goes, so fix those with `startShift` / `reverse` in the config.

Tracks are named by place only (city/area, country), never by a circuit's or event's
trademarked name.

### Licences

The generated files are derived from the datasets, so their licence texts ship next to them
(`client/public/tracks/LICENSE-*.txt`) and `client/public/tracks/ATTRIBUTION.md` lists which
dataset each track came from. Each track JSON also has a `source` block.
