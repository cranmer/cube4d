// Drive the six directional buttons and report where each press leaves the cross.
//
// A press is named for a place in the cross, so it has to move the same slots every time. Reading
// the labels back after a sequence is how that gets checked against the running app rather than
// against the maths that produced it.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const out = 'build/shots/presses';
mkdirSync(out, { recursive: true });
const url = process.argv[3] ?? 'http://localhost:5173/hypercube/';
const sequences = (process.argv[2] ?? 'Up|Left|Up,Left|Up,Left,Front').split('|');

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

const where = async () => ({
  middle: await page.locator('.standing').first().locator('.standing-value').innerText(),
  bottom: await page.locator('.standing').last().locator('.standing-value').innerText(),
});

for (const sequence of sequences) {
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const start = await where();
  for (const press of sequence.split(',')) {
    await page.locator('.pane-controls .moves button', { hasText: new RegExp(`^${press}$`) }).first().click();
    await page.waitForTimeout(900);
  }
  const end = await where();
  await page.locator('.pane').first().screenshot({ path: `${out}/${sequence.replace(/,/g, '-')}.png` });
  console.log(`${sequence.padEnd(20)} ${start.middle}/${start.bottom} -> ${end.middle}/${end.bottom}`);
}

await browser.close();
