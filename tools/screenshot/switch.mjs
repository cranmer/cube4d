// Does changing a pane's mode jump, or glide?
//
// A glide between the two modes' matrices is meaningless -- they only describe the same orientation
// at the end -- so this counts distinct view matrices after a toggle. One is right; dozens is a
// glide, and would be the new drawing at the old drawing's angle swinging round to where it belongs.
import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto('http://localhost:5173/hypercube/', { waitUntil: 'networkidle' });
await page.evaluate(() => globalThis.localStorage?.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// Pane A publishes the test handle, so it is the one that can be watched from here.
const watch = () =>
  page.evaluate(() => {
    const w = globalThis;
    w.__seen = [];
    const tick = () => {
      const m = w.__mc4d?.renderer?.view?.mat4d;
      if (m) {
        const at = Array.from(m).map((v) => Math.round(v * 1000) / 1000).join(',');
        if (w.__seen[w.__seen.length - 1] !== at) w.__seen.push(at);
      }
      w.__frame = requestAnimationFrame(tick);
    };
    tick();
  });

const cases = [
  'unfolded -> projected',
  'projected -> unfolded',
  // From a viewpoint the net has no matching stock view for, so the matrices really do differ.
  'tipped: unfolded -> projected',
  'tipped: projected -> unfolded',
];
for (const label of cases) {
  if (label.startsWith('tipped') && !label.endsWith('projected')) {
    // Already unfolded here; tip the pane after it goes back to a projection.
  }
  if (label === 'tipped: unfolded -> projected') {
    await page.locator('.pane-kind').first().click(); // to projected
    await page.waitForTimeout(700);
    await page.locator('.pane').first().locator('.pad', { hasText: 'TIP' }).locator('button').nth(1).click();
    await page.waitForTimeout(900);
    await page.locator('.pane-kind').first().click(); // back to unfolded, adopting the tip
    await page.waitForTimeout(900);
  }
  await watch();
  await page.locator('.pane-kind').first().click();
  await page.waitForTimeout(1500);
  const seen = await page.evaluate(() => {
    cancelAnimationFrame(globalThis.__frame);
    return globalThis.__seen.length;
  });
  // The first sample is wherever it already was, so a jump shows up as two.
  console.log(`${label.padEnd(24)} ${seen} distinct view matrices (2 = a jump)`);
}

await browser.close();
