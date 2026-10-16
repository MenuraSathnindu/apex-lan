// Downloads the optional art assets into client/public/. Run: npm run assets
// Re-running skips files that already exist; pass --force to re-download.
// Sources and licences: docs/ASSETS.md and client/public/CREDITS.md.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'public');
const PH = 'https://dl.polyhaven.org/file/ph-assets';

const FILES = [
  // Sky + reflections (Poly Haven, CC0)
  [`${PH}/HDRIs/hdr/2k/kloofendal_48d_partly_cloudy_puresky_2k.hdr`, 'hdri/kloofendal_48d_partly_cloudy_puresky_2k.hdr'],
  // Asphalt (Poly Haven "Asphalt 02", CC0)
  [`${PH}/Textures/jpg/2k/asphalt_02/asphalt_02_diff_2k.jpg`, 'textures/asphalt_02_diff_2k.jpg'],
  [`${PH}/Textures/jpg/2k/asphalt_02/asphalt_02_nor_gl_2k.jpg`, 'textures/asphalt_02_nor_gl_2k.jpg'],
  [`${PH}/Textures/jpg/2k/asphalt_02/asphalt_02_rough_2k.jpg`, 'textures/asphalt_02_rough_2k.jpg'],
  // Grass (Poly Haven "Leafy Grass", CC0)
  [`${PH}/Textures/jpg/2k/leafy_grass/leafy_grass_diff_2k.jpg`, 'textures/leafy_grass_diff_2k.jpg'],
  [`${PH}/Textures/jpg/2k/leafy_grass/leafy_grass_nor_gl_2k.jpg`, 'textures/leafy_grass_nor_gl_2k.jpg'],
  [`${PH}/Textures/jpg/2k/leafy_grass/leafy_grass_rough_2k.jpg`, 'textures/leafy_grass_rough_2k.jpg'],
  // Car: Ferrari 458 Italia by vicent091036 (CC-BY 4.0), Draco-compressed, from the three.js examples
  ['https://raw.githubusercontent.com/mrdoob/three.js/r186/examples/models/gltf/ferrari.glb', 'models/car.glb'],
];

const force = process.argv.includes('--force');
let failed = 0;

for (const [url, rel] of FILES) {
  const dest = join(root, rel);
  if (existsSync(dest) && !force) {
    console.log(`  skip  ${rel} (exists)`);
    continue;
  }
  process.stdout.write(`  get   ${rel} ... `);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, buf);
    console.log(`${(buf.length / 1024 / 1024).toFixed(1)} MB`);
  } catch (err) {
    failed++;
    console.log(`FAILED (${err.message})\n        ${url}`);
  }
}

console.log(failed ? `\n${failed} download(s) failed — the game will use fallbacks for those.` : '\nAll assets in place.');
process.exitCode = failed ? 1 : 0;
