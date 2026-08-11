// Press the two rotate pads and photograph what they do to the cross.
//
// A rotation should leave the middle and bottom cubes exactly where they are — it turns the middle
// cube about an axis through itself — and cycle the four arms around that axis.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const out = 'build/shots/spins';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto('http://localhost:5173/hypercube/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

const where = async () => ({
  middle: await page.locator('.standing').first().locator('.standing-value').innerText(),
  bottom: await page.locator('.standing').last().locator('.standing-value').innerText(),
});
const pane = page.locator('.pane').first();
await pane.screenshot({ path: `${out}/00-rest.png` });

for (const [pad, side] of [[0, 1], [0, 0], [1, 1], [1, 0]]) {
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const buttons = page.locator('.pane-controls .spins .pad').nth(pad).locator('button');
  const name = await page.locator('.pane-controls .spins .pad').nth(pad).locator('span').innerText();
  const hint = await buttons.nth(side).getAttribute('title');
  await buttons.nth(side).click();
  await page.waitForTimeout(1200);
  const end = await where();
  await pane.screenshot({ path: `${out}/${name.replace('–', '-')}-${side}.png` });
  console.log(`${name} ${side ? 'right' : 'left'}  -> ${end.middle}/${end.bottom}   ${hint}`);
}

await browser.close();
