// Render a thumbnail of every puzzle in the catalog, for the gallery page.
//
// These are renders of the real puzzles rather than illustrations — the same principle as the
// favicon. One browser, one page, switching puzzles through the permalink fragment: reloading per
// puzzle would be slower and would throw away the module-level geometry cache for no benefit.
//
//   node tools/screenshot/gallery.mjs [--limit N]
//
// Writes apps/web/public/gallery/<path>.webp. Committed, because regenerating needs a browser and a
// full asset export, and the images only change when the renderer or the default palette does.
//
// WebP rather than PNG: these are flat-shaded polygons over a dark ground with soft gradients, which
// is close to the worst case for PNG. The same images come out five times smaller — 1.2 MB for the
// whole catalog against 5.6 MB — with no visible difference at the size they are shown. Needs
// `cwebp` on PATH (brew install webp).
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';

const OUT = 'apps/web/public/gallery';
const TMP = 'build/shots/gallery-src.png';
const QUALITY = 82;
/** Rendered at twice this and downsampled, which is cheaper than antialiasing a thin sticker edge. */
const PX = 300;

const limit = Number(process.argv[process.argv.indexOf('--limit') + 1]) || Infinity;
const manifest = JSON.parse(readFileSync('fixtures/manifest.json', 'utf8'));
const puzzles = manifest.puzzles.slice(0, limit);

mkdirSync(OUT, { recursive: true });
mkdirSync('build/shots', { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: PX, height: PX }, deviceScaleFactor: 2 });
await page.goto('http://localhost:4173/classic/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// Strip everything that is not the puzzle: the panel, the counter, the compass, the view pads.
await page.addStyleTag({
  content: `.panel,.hud,.axis-inset,.viewpad,.banner,.notice{display:none!important}
            .layout{grid-template-columns:1fr!important;grid-template-rows:1fr!important}`,
});

let done = 0;
let failed = 0;
let bytes = 0;
for (const puzzle of puzzles) {
  const name = puzzle.path.replace(/\.mc4dpz$/, '');
  try {
    await page.evaluate((id) => {
      location.hash = `p=${encodeURIComponent(id)}`;
    }, puzzle.id);

    // The renderer republishes __mc4d whenever it takes on new geometry, so matching the manifest's
    // own counts is a precise "this is the puzzle I asked for", not a guess about timing.
    await page.waitForFunction(
      (want) => {
        const g = globalThis.__mc4d?.geometry;
        return !!g && g.nStickers === want.nStickers && g.nFaces === want.nFaces;
      },
      { nStickers: puzzle.nStickers, nFaces: puzzle.nFaces },
      { timeout: 60_000 },
    );
    // Zoom is set per puzzle by the renderer from its own radius, so nothing to choose here.
    await page.waitForTimeout(260);
    await page.locator('canvas').screenshot({ path: TMP });
    execFileSync('sips', ['-Z', String(PX), TMP, '--out', TMP], { stdio: 'ignore' });
    execFileSync('cwebp', ['-quiet', '-q', String(QUALITY), TMP, '-o', `${OUT}/${name}.webp`]);
    bytes += statSync(`${OUT}/${name}.webp`).size;
    done++;
    if (done % 16 === 0) console.log(`  ${done}/${puzzles.length}…`);
  } catch (e) {
    failed++;
    console.warn(`  ! ${puzzle.id}: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
  }
}

await browser.close();
console.log(
  `${done} thumbnails, ${failed} failed, ${(bytes / 1024 / 1024).toFixed(1)} MB total in ${OUT}`,
);
if (!existsSync(`${OUT}/4-3-3_3.webp`)) process.exitCode = 1;
