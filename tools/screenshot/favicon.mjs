// Render the favicon from the real puzzle, so the icon is the thing itself rather than a drawing
// of it. Solved state, default orientation, nothing highlighted.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
mkdirSync('build/shots', { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
// Square viewport so the canvas is square and the puzzle is not framed against a wide axis.
const page = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 2 });
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// Hide the side panel so the canvas takes the whole square, and close the cells up so the icon
// reads as one solid object at 32 pixels rather than a scatter of specks.
await page.evaluate(() => {
  document.querySelector('.panel').style.display = 'none';
  document.querySelector('.layout').style.gridTemplateColumns = '1fr';
  const hud = document.querySelector('.hud');
  if (hud) hud.style.display = 'none';
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
await setSlider(0, 0.86);           // face shrink: cells nearly touching
await page.evaluate(() => window.__mc4d.renderer.setZoom(0.98));
await page.waitForTimeout(500);

await page.locator('canvas').screenshot({ path: 'build/shots/favicon-source.png' });
console.log('rendered');
await browser.close();
