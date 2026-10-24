// Trademark lint: fails if a tracked file names a real racing series, governing body, team,
// driver, sponsor or car manufacturer (CLAUDE.md → Trademark rule). Run: npm run lint:marks
// To mention a real name on purpose (a licence credit, the disclaimer), add a line to ALLOW
// after asking the maintainer, and keep it as narrow as possible.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Banned terms. Word boundaries keep short ones from matching inside ordinary words. */
const TERMS = [
  // Series, governing bodies, regulation trademarks
  /\bF1\b/i,
  /\bformula[- ]?(?:1|one|e)\b/i,
  /\bFIA\b/,
  /\bFOM\b/,
  /\bgrand prix\b/i,
  /\bGP\b/,
  /\bDRS\b/,
  /\bKERS\b/,
  /\bindy ?car\b/i,
  /\bnascar\b/i,
  /\bmoto ?gp\b/i,
  /\bDTM\b/,
  // Teams
  /\bferrari\b/i,
  /\bscuderia\b/i,
  /\bmercedes\b/i,
  /\bmclaren\b/i,
  /\bred ?bull\b/i,
  /\bracing bulls\b/i,
  /\balpha ?tauri\b/i,
  /\btoro rosso\b/i,
  /\baston martin\b/i,
  /\bhaas\b/i,
  /\bsauber\b/i,
  /\balfa romeo\b/i,
  /\bwilliams racing\b/i,
  /\brenault\b/i,
  /\bbrabham\b/i,
  /\btyrrell\b/i,
  // Manufacturers
  /\bporsche\b/i,
  /\blamborghini\b/i,
  /\bmaserati\b/i,
  /\bbugatti\b/i,
  /\bBMW\b/i,
  /\baudi\b/i,
  /\btoyota\b/i,
  /\bhonda\b/i,
  /\bnissan\b/i,
  /\bford\b/i,
  /\bchevrolet\b/i,
  /\bmercedes-benz\b/i,
  // Sponsors / suppliers
  /\bpirelli\b/i,
  /\bpetronas\b/i,
  /\baramco\b/i,
  /\brolex\b/i,
  /\bheineken\b/i,
  // Drivers
  /\bhamilton\b/i,
  /\bverstappen\b/i,
  /\bschumacher\b/i,
  /\bsenna\b/i,
  /\bleclerc\b/i,
  /\balonso\b/i,
  /\bvettel\b/i,
  /\blauda\b/i,
  /\bprost\b/i,
];

/** Lines allowed to contain a term, per file. Each one was agreed with the maintainer. */
const ALLOW = {
  // The disclaimer, word for word (optionally as a blockquote).
  'README.md': [/^(> )?This is an unofficial fan project and is not affiliated with or endorsed by Formula One Group or the FIA\. All trademarks belong to their owners\.$/],
  'CREDITS.md': [/github\.com\/bacinger\/f1-circuits/],
  'client/public/CREDITS.md': [/github\.com\/bacinger\/f1-circuits/],
  'client/public/tracks/ATTRIBUTION.md': [/github\.com\/bacinger\/f1-circuits/],
  'tools/README.md': [/github\.com\/bacinger\/f1-circuits/],
  // The test that keeps event names out of track names has to spell them.
  'server/src/tracks/catalog.test.ts': [/expect\(t\.name\)\.not\.toMatch\(/],
};

/** Files never scanned: this list itself, verbatim third-party licence texts, the lockfile. */
const SKIP = [/^scripts\/checkMarks\.(mjs|test\.ts)$/, /(^|\/)LICENSE-[^/]+\.txt$/, /^package-lock\.json$/];

/** Every banned term in `text`, with its line number (1-based). */
export function findMarks(file, text) {
  const allowed = ALLOW[file] ?? [];
  const out = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    if (allowed.some((re) => re.test(line))) return;
    for (const re of TERMS) {
      const m = re.exec(line);
      if (m) {
        out.push({ file, line: i + 1, term: m[0] });
        break;
      }
    }
  });
  return out;
}

function main() {
  // Tracked files plus new ones not yet added (respecting .gitignore); -z for odd names.
  const list = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' });
  const files = [...new Set(list.split('\0').filter(Boolean))].filter((f) => !SKIP.some((re) => re.test(f)));
  const hits = [];
  for (const file of files) {
    let buf;
    try {
      buf = readFileSync(file);
    } catch {
      continue; // deleted in the working tree
    }
    if (buf.includes(0)) continue; // binary
    hits.push(...findMarks(file, buf.toString('utf8')));
  }
  for (const h of hits) console.log(`${h.file}:${h.line}: "${h.term}"`);
  if (hits.length) {
    console.log(`\n${hits.length} trademarked name(s) found. See CLAUDE.md → Trademark rule.`);
    process.exitCode = 1;
  } else {
    console.log(`lint:marks: ${files.length} files clean.`);
  }
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) main();
