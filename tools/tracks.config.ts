// Which circuits `npm run tracks` builds, and how. Names are places (city / area, country),
// never a circuit's or event's trademarked name (see CLAUDE.md → Trademark rule).
//
//   tumftm:   file name (without .csv) in tools/data/racetrack-database/tracks — real widths
//   bacinger: circuit id in tools/data/<bacinger repo>/circuits — lat/lon, default width;
//             also the reference for the start/finish line and the published length
//   street:   concrete walls close to the road (no gravel / grass run-off)
//   reverse:  flip the driving direction if the source runs the wrong way
//   startShift: move the start/finish line along the track (m, + = forward)
//   realLengthKm: published length when there's no bacinger reference

export interface TrackSourceConfig {
  id: string;
  name: string;
  country: string;
  tumftm?: string;
  bacinger?: string;
  street?: boolean;
  reverse?: boolean;
  startShift?: number;
  realLengthKm?: number;
  /** Skip in the default build (data known to be unusable). */
  disabled?: string;
}

/** The first five, verified before generating the rest. */
export const FIRST_FIVE = ['monza', 'spa', 'silverstone', 'suzuka', 'monaco'];

export const TRACK_SOURCES: TrackSourceConfig[] = [
  { id: 'monza', name: 'Monza', country: 'Italy', tumftm: 'Monza', bacinger: 'it-1922' },
  { id: 'spa', name: 'Spa', country: 'Belgium', tumftm: 'Spa', bacinger: 'be-1925' },
  { id: 'silverstone', name: 'Silverstone', country: 'United Kingdom', tumftm: 'Silverstone', bacinger: 'gb-1948' },
  { id: 'suzuka', name: 'Suzuka', country: 'Japan', tumftm: 'Suzuka', bacinger: 'jp-1962' },
  // The reference starts at the apex of the first corner; the line is on the curved straight before it.
  { id: 'monaco', name: 'Monaco', country: 'Monaco', bacinger: 'mc-1929', street: true, startShift: -120 },

  // TUMFTM has the pre-2021 layout (+5 % long); the reference has the current one.
  { id: 'yas-island', name: 'Yas Island', country: 'United Arab Emirates', bacinger: 'ae-2009' },
  { id: 'buenos-aires', name: 'Buenos Aires', country: 'Argentina', bacinger: 'ar-1952' },
  { id: 'spielberg', name: 'Spielberg', country: 'Austria', tumftm: 'Spielberg', bacinger: 'at-1969' },
  { id: 'melbourne', name: 'Melbourne', country: 'Australia', tumftm: 'Melbourne', bacinger: 'au-1953' },
  { id: 'baku', name: 'Baku', country: 'Azerbaijan', bacinger: 'az-2016', street: true },
  { id: 'sakhir', name: 'Sakhir', country: 'Bahrain', tumftm: 'Sakhir', bacinger: 'bh-2002' },
  { id: 'sao-paulo', name: 'São Paulo', country: 'Brazil', tumftm: 'SaoPaulo', bacinger: 'br-1940' },
  { id: 'rio', name: 'Rio de Janeiro', country: 'Brazil', bacinger: 'br-1977' },
  { id: 'montreal', name: 'Montreal', country: 'Canada', tumftm: 'Montreal', bacinger: 'ca-1978' },
  { id: 'shanghai', name: 'Shanghai', country: 'China', tumftm: 'Shanghai', bacinger: 'cn-2004' },
  { id: 'nurburg', name: 'Nürburg', country: 'Germany', tumftm: 'Nuerburgring', bacinger: 'de-1927' },
  { id: 'hockenheim', name: 'Hockenheim', country: 'Germany', tumftm: 'Hockenheim', bacinger: 'de-1932' },
  { id: 'barcelona', name: 'Barcelona', country: 'Spain', tumftm: 'Catalunya', bacinger: 'es-1991' },
  { id: 'madrid', name: 'Madrid', country: 'Spain', bacinger: 'es-2026', street: true },
  { id: 'magny-cours', name: 'Magny-Cours', country: 'France', bacinger: 'fr-1960' },
  // Reference drawn against the racing direction (the race runs clockwise).
  { id: 'le-castellet', name: 'Le Castellet', country: 'France', bacinger: 'fr-1969', reverse: true },
  { id: 'budapest', name: 'Budapest', country: 'Hungary', tumftm: 'Budapest', bacinger: 'hu-1986' },
  { id: 'scarperia', name: 'Scarperia', country: 'Italy', bacinger: 'it-1914' },
  { id: 'imola', name: 'Imola', country: 'Italy', bacinger: 'it-1953' },
  // Reference start is at the very beginning of the main straight; the grid belongs on it.
  { id: 'mexico-city', name: 'Mexico City', country: 'Mexico', tumftm: 'MexicoCity', bacinger: 'mx-1962', startShift: 120 },
  { id: 'sepang', name: 'Sepang', country: 'Malaysia', tumftm: 'Sepang', bacinger: 'my-1999' },
  { id: 'zandvoort', name: 'Zandvoort', country: 'Netherlands', tumftm: 'Zandvoort', bacinger: 'nl-1948' },
  { id: 'estoril', name: 'Estoril', country: 'Portugal', bacinger: 'pt-1972' },
  { id: 'portimao', name: 'Portimão', country: 'Portugal', bacinger: 'pt-2008' },
  { id: 'lusail', name: 'Lusail', country: 'Qatar', bacinger: 'qa-2004' },
  { id: 'sochi', name: 'Sochi', country: 'Russia', tumftm: 'Sochi', bacinger: 'ru-2014' },
  { id: 'jeddah', name: 'Jeddah', country: 'Saudi Arabia', bacinger: 'sa-2021', street: true },
  // Reference drawn against the racing direction (the race runs anticlockwise).
  { id: 'singapore', name: 'Singapore', country: 'Singapore', bacinger: 'sg-2008', street: true, reverse: true },
  { id: 'istanbul', name: 'Istanbul', country: 'Turkey', bacinger: 'tr-2005' },
  { id: 'indianapolis', name: 'Indianapolis', country: 'United States', bacinger: 'us-1909' },
  { id: 'watkins-glen', name: 'Watkins Glen', country: 'United States', bacinger: 'us-1956' },
  { id: 'austin', name: 'Austin', country: 'United States', tumftm: 'Austin', bacinger: 'us-2012' },
  { id: 'miami', name: 'Miami', country: 'United States', bacinger: 'us-2022', street: true },
  { id: 'las-vegas', name: 'Las Vegas', country: 'United States', bacinger: 'us-2023', street: true },
  // Reference drawn against the racing direction (the race runs clockwise).
  { id: 'midrand', name: 'Midrand', country: 'South Africa', bacinger: 'za-1961', reverse: true },

  // Only in the TUMFTM set (no lat/lon reference: start = the file's first point).
  { id: 'brands-hatch', name: 'Brands Hatch', country: 'United Kingdom', tumftm: 'BrandsHatch', realLengthKm: 3.908 },
  // The file starts just after a corner; the line goes on the straight that follows.
  { id: 'volokolamsk', name: 'Volokolamsk', country: 'Russia', tumftm: 'MoscowRaceway', startShift: 150 },
  { id: 'nuremberg', name: 'Nuremberg', country: 'Germany', tumftm: 'Norisring', street: true, realLengthKm: 2.3 },
  { id: 'oschersleben', name: 'Oschersleben', country: 'Germany', tumftm: 'Oschersleben', realLengthKm: 3.696 },
  { id: 'indianapolis-oval', name: 'Indianapolis Oval', country: 'United States', tumftm: 'IMS', realLengthKm: 4.023 },
];
