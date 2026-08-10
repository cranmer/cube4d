// Capture the unfolded pane at rest and part way through one of the six directional moves.
//
// Animations are the one thing the unit tests cannot look at: the geometry of every frame can be
// checked in the core, but whether the result reads as cubes moving is a question about pixels.
// Screenshots under software GL take longer than a move does, so raise RECUT_MS in flat/Viewport.tsx
// while using this — it is the difference between catching the motion and only ever seeing the ends.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const which = process.argv[2] ?? 'Up';
const out = process.argv[3] ?? 'build/shots/motion';
const url = process.argv[4] ?? 'http://localhost:5173/flat/';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

const pane = page.locator('.pane').first();
await pane.screenshot({ path: `${out}/00-rest.png` });

await page
  .locator('.pane-controls .moves button', { hasText: new RegExp(`^${which}$`) })
  .first()
  .click();
for (const i of [1, 2, 3, 4]) {
  await page.waitForTimeout(700);
  await pane.screenshot({ path: `${out}/${String(i).padStart(2, '0')}-${which}.png` });
}
await page.waitForTimeout(2500);
await pane.screenshot({ path: `${out}/99-settled-${which}.png` });

console.log(JSON.stringify({ out, problems }, null, 2));
await browser.close();
