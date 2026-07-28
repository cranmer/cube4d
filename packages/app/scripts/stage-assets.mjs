/**
 * Copy the puzzle assets the app ships into its public directory.
 *
 * They live in fixtures/ because the test suites use them too, and duplicating binaries in git
 * would be a good way to let the two copies drift. Staging them at build time keeps one source of
 * truth — and means CI, which regenerates fixtures from the Java, ships exactly what it verified.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const BUILT = `${ROOT}build/assets/`;
const FIXTURES = `${ROOT}fixtures/assets/`;
const TO = fileURLToPath(new URL('../public/assets/', import.meta.url));
const MANIFEST = `${ROOT}fixtures/manifest.json`;

mkdirSync(TO, { recursive: true });
copyFileSync(MANIFEST, `${TO}manifest.json`);
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

/**
 * Ship every puzzle in the catalog, but only the gzipped form — the app sniffs the magic bytes and
 * inflates if needed, so the uncompressed copies would be dead weight. All 128 come to about 8 MB.
 *
 * Assets come from build/assets when a full export is present; otherwise from the handful committed
 * under fixtures/assets, so a clone without a JDK still builds and runs the default puzzle.
 */
let staged = 0;
let missing = 0;
let bytes = 0;
for (const puzzle of manifest.puzzles) {
  const name = `${puzzle.path}.gz`;
  const source = existsSync(BUILT + name) ? BUILT + name : FIXTURES + name;
  if (!existsSync(source)) {
    missing++;
    continue;
  }
  copyFileSync(source, TO + name);
  bytes += statSync(source).size;
  staged++;
}

const summary = `staged ${staged}/${manifest.puzzles.length} puzzle assets (${(
  bytes / 1048576
).toFixed(1)} MB)`;

if (missing > 0 && !process.env.MC4D_ALLOW_PARTIAL_ASSETS) {
  // This used to be a warning, and a build with 9 of 128 puzzles shipped to production because a
  // warning printed into a CI log is not a safeguard. Every puzzle in the manifest is offered in
  // the picker, so a missing one is a 404 the user meets by clicking a button that looks fine.
  throw new Error(
    `${summary}; ${missing} missing.\n` +
      "Run 'npm run assets' to export the full catalog (needs a JDK 21), " +
      'or set MC4D_ALLOW_PARTIAL_ASSETS=1 to build with only the committed fixtures.',
  );
}
console.log(summary + (missing ? `; ${missing} missing (partial build allowed)` : ''));
