// Does a pane keep its orientation when it changes mode?
//
// The compass is the honest measure, since it is what says where each axis went — so this reads the
// spoke positions straight out of the inset before and after a toggle. They should not move.
import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

await page.goto('http://localhost:5173/hypercube/', { waitUntil: 'networkidle' });
await page.evaluate(() => globalThis.localStorage?.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

/** Where each spoke's dot sits in pane `i`, and how bright it is. */
const spokes = async (i) =>
  page.locator('.pane').nth(i).locator('[data-dot]').evaluateAll((dots) =>
    dots.map((d) => [d.getAttribute('cx'), d.getAttribute('cy'), d.getAttribute('opacity')].map(Number)),
  );

const drift = (a, b) =>
  Math.max(...a.map((s, i) => Math.max(...s.map((v, j) => Math.abs(v - b[i][j])))));

const settle = () => page.waitForTimeout(1400);

async function check(name, i) {
  const before = await spokes(i);
  await page.locator('.pane-kind').nth(i).click();
  await settle();
  const after = await spokes(i);
  console.log(`${name.padEnd(34)} compass moved by ${drift(before, after).toFixed(3)} px`);
}

await check('unfolded -> projected', 0);
await check('and back again', 0);

// Not from the stock view: tip the projection somewhere odd first.
await page.locator('.pane').nth(1).locator('.pad', { hasText: 'TIP' }).locator('button').nth(1).click();
await settle();
await page.locator('.pane').nth(1).locator('.pad', { hasText: 'TURN' }).locator('button').nth(0).click();
await settle();
await check('projected (tipped) -> unfolded', 1);
await check('and back again', 1);

// And from an arrangement the buttons have moved.
await page.locator('.pane').nth(0).locator('.moves button', { hasText: /^Up$/ }).click();
await settle();
await page.locator('.pane').nth(0).locator('.moves button', { hasText: /^Left$/ }).click();
await settle();
await check('unfolded (moved twice) -> projected', 0);
await check('and back again', 0);

console.log(JSON.stringify({ problems }, null, 2));
await browser.close();
