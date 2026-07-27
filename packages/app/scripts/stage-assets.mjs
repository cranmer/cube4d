/**
 * Copy the puzzle assets the app ships into its public directory.
 *
 * They live in fixtures/ because the test suites use them too, and duplicating binaries in git
 * would be a good way to let the two copies drift. Staging them at build time keeps one source of
 * truth — and means CI, which regenerates fixtures from the Java, ships exactly what it verified.
 */
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FROM = `${ROOT}fixtures/assets/`;
const TO = fileURLToPath(new URL('../public/assets/', import.meta.url));

/** Puzzles the app can currently load. Phase 5 replaces this with the full catalog + a manifest. */
const SHIPPED = ['4-3-3_3.mc4dpz.gz'];

mkdirSync(TO, { recursive: true });
const available = new Set(readdirSync(FROM));
for (const name of SHIPPED) {
  if (!available.has(name)) {
    throw new Error(`${name} is missing from fixtures/assets — run 'npm run assets' to regenerate`);
  }
  copyFileSync(FROM + name, TO + name);
}
console.log(`staged ${SHIPPED.length} puzzle asset(s)`);
