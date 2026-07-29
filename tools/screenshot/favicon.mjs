// Render the favicon from the real puzzle, so the icon is the thing itself rather than a drawing
// of it. Solved state, default orientation, nothing highlighted.
import { chromium } from 'playwright';
import { copyFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
mkdirSync('build/shots', { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
// Square viewport so the canvas is square and the puzzle is not framed against a wide axis.
const page = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 2 });
await page.goto('http://localhost:4173/classic/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// Hide the panel and every overlay so the canvas takes the whole square and the icon is the puzzle
// and nothing else. The view itself is left at the app's defaults, so the icon is exactly what you
// see on opening the page.
await page.evaluate(() => {
  document.querySelector('.panel').style.display = 'none';
  document.querySelector('.layout').style.gridTemplateColumns = '1fr';
  for (const sel of ['.hud', '.axis-inset', '.viewpad']) {
    document.querySelectorAll(sel).forEach((e) => (e.style.display = 'none'));
  }
});
await page.waitForTimeout(300);

const setSlider = async (i, v) => {
  await page.evaluate(({ i, v }) => {
    const el = document.querySelectorAll('input[type=range]')[i];
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, { i, v });
  await page.waitForTimeout(400);
};
// Default face shrink (0.4) — the separated cells that make the 4D cross shape recognisable.
await page.evaluate(() => window.__mc4d.renderer.setZoom(1.18));
await page.waitForTimeout(500);

await page.locator('canvas').screenshot({ path: 'build/shots/favicon-source.png' });
await browser.close();

// Resize into the sizes the app ships, plus the copy the README and docs use. Doing this here means
// the icon can be regenerated in one command instead of a remembered sequence of sips invocations.
const SIZES = { 16: 'favicon-16.png', 32: 'favicon-32.png', 180: 'favicon-180.png', 512: 'favicon-512.png' };
for (const [size, name] of Object.entries(SIZES)) {
  execFileSync('sips', ['-Z', size, 'build/shots/favicon-source.png', '--out', `apps/web/public/${name}`], {
    stdio: 'ignore',
  });
}
copyFileSync('apps/web/public/favicon-512.png', 'docs/images/favicon.png');
console.log('rendered and resized:', Object.values(SIZES).join(', '), '+ docs/images/favicon.png');
