// Toggle panes between projected and unfolded, and open a third, to see the mixed layouts.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const out = 'build/shots/modes';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

await page.goto('http://localhost:5173/hypercube/', { waitUntil: 'networkidle' });
await page.evaluate(() => globalThis.localStorage?.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

const kinds = async () => page.locator('.pane-kind').allInnerTexts();
const shot = async (name) => {
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`${name.padEnd(22)} ${(await kinds()).join(' | ')}`);
};

await shot('00-open');

// Both unfolded, each with its own arrangement: press Up in the second one only.
await page.locator('.pane-kind').nth(1).click();
await shot('01-both-unfolded');
await page.locator('.pane').nth(1).locator('.moves button', { hasText: /^Up$/ }).click();
await shot('02-second-moved');

// Third pane, left projected.
await page.locator('.chips .chip', { hasText: /^C$/ }).first().click();
await shot('03-three-panes');

// And the first pane back to projected, to check the camera it parked comes back.
await page.locator('.pane-kind').first().click();
await shot('04-first-projected');

console.log(JSON.stringify({ problems }, null, 2));
await browser.close();
