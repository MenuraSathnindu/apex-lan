import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { APEX_PARK, PRESET_2026, buildTrack, initRapier } from '@apex/shared';
import { trackContract } from '../../../shared/src/track/trackContract.testutil.ts';
import { trackCatalog } from './catalog.ts';

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../client/public/tracks');
const catalog = trackCatalog(DIR);
const FIRST_FIVE = ['monza', 'spa', 'silverstone', 'suzuka', 'monaco'];

beforeAll(async () => {
  await initRapier();
});

describe('track catalog', () => {
  it('lists the built-in track first, then the generated ones', () => {
    const ids = catalog.list().map((t) => t.id);
    expect(ids[0]).toBe(APEX_PARK.id);
    for (const id of FIRST_FIVE) expect(ids).toContain(id);
  });

  it('has every track of the 2026-style preset calendar', () => {
    for (const r of PRESET_2026.rounds) expect(catalog.get(r.trackId), r.trackId).not.toBeNull();
  });

  it('refuses unknown ids and path tricks', () => {
    expect(catalog.get('nowhere')).toBeNull();
    expect(catalog.get('../package')).toBeNull();
  });

  it('names tracks by place only', () => {
    for (const t of catalog.list()) expect(t.name).not.toMatch(/circuit|autodromo|ring\b|grand prix|international/i);
  });
});

describe.each(FIRST_FIVE)('generated track %s', (id) => {
  const def = catalog.get(id)!;
  const track = buildTrack(def);

  it('loads and meets the track contract', () => {
    expect(def.id).toBe(id);
    trackContract(track);
  });

  it('is within 3 % of the published length', () => {
    expect(def.realLengthKm).toBeDefined();
    expect(Math.abs(track.length / 1000 - def.realLengthKm!) / def.realLengthKm!).toBeLessThan(0.03);
  });

  it('has straight-mode zones, a detection point, three sectors and a 20-slot grid', () => {
    expect(def.aeroZones!.length).toBeGreaterThan(0);
    expect(def.detectionPoint).toBeGreaterThanOrEqual(0);
    expect(def.sectors).toHaveLength(3);
    expect(def.grid).toHaveLength(20);
  });

  // Driving a full lap of a real circuit takes ~10 s per track here, so that check runs in
  // `npm run tracks:check` (every generated track) instead of on every `npm test`.
});
