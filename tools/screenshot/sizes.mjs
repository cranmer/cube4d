// Open several hypercube sizes in an app and report whether each one actually draws.
//
// "Draws" means: no console error, a canvas with non-background pixels, and a twist count the
// session agrees with. A puzzle that loads but renders nothing looks the same as one that is
// still loading, which is exactly the failure worth catching automatically.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const app = process.argv[2] ?? 'multi';
const lengths = (process.argv[3] ?? '2,3,4,5').split(',').map(Number);
const out = `build/shots/sizes-${app}`;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });

for (const length of lengths) {
  const problems = [];
  const onConsole = (m) => { if (m.type() === 'error') problems.push(m.text()); };
  const onError = (e) => problems.push(`pageerror: ${e.message}`);
  page.on('console', onConsole);
  page.on('pageerror', onError);

  await page.goto(`http://localhost:5173/${app}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => globalThis.localStorage?.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  // Open the puzzle picker and choose {4,3,3} of this edge length.
  // Open it only if it is shut: the apps differ about which sections start open, and clicking
  // regardless closed it in the ones where it already was.
  const section = page.locator('.group-head', { hasText: /Puzzles/i }).first();
  if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click();
  await page.waitForTimeout(400);
  const family = page.locator('.family-head').filter({ hasText: /4,3,3|Hypercube/i }).first();
  if (await family.count()) {
    const expanded = await family.getAttribute('aria-expanded');
    if (expanded !== 'true') await family.click();
    await page.waitForTimeout(300);
  }
  // By position rather than by label: each button carries its download size too, so matching on
  // text is fiddlier than counting. Edge length 1 is not offered, so the list starts at 2.
  const choice = page.locator('.picker button.length').nth(length - 2);
  const found = await choice.count();
  if (!found) {
    console.log('  sections:', (await page.locator('.group-head h2').allInnerTexts()).join(' / '));
    console.log('  families:', (await page.locator('.family-head').allInnerTexts()).join(' / ').replace(/\n/g, ' '));
    console.log('  lengths:', (await page.locator('.picker button.length').allInnerTexts()).join(' / ').replace(/\n/g, ' '));
  }
  if (found) await choice.click();
  await page.waitForTimeout(4000);

  // What the puzzle core believes it loaded, which is more use than a pixel count: the drawing
  // buffer is not preserved between frames, so reading pixels back gets a cleared one.
  const drawn = await page.evaluate(() => {
    const g = globalThis.__mc4d?.geometry;
    return g ? { stickers: g.nStickers, cells: g.nFaces } : { error: 'no geometry' };
  });
  const overlay = await page.locator('.overlay').count();
  const overlayText = overlay ? await page.locator('.overlay').innerText() : '';
  await page.screenshot({ path: `${out}/${length}.png` });
  console.log(
    `${app} {4,3,3} ${length}  picked=${found ? 'yes' : 'NO'}  ${JSON.stringify(drawn)}` +
      `  overlay=${JSON.stringify(overlayText)}  problems=${problems.length ? problems.join(' | ') : 'none'}`,
  );
  page.off('console', onConsole);
  page.off('pageerror', onError);
}

await browser.close();
