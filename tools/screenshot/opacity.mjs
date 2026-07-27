import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
mkdirSync('build/shots', { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 760 } });
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const set = async (i, v) => {
  await page.evaluate(({ i, v }) => {
    const el = document.querySelectorAll('input[type=range]')[i];
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, { i, v });
  await page.waitForTimeout(600);
};
// sliders: 0 face shrink, 1 sticker shrink, 2 opacity, 3 eye w
await set(0, 0.85);
for (const o of [1.0, 0.6, 0.3]) {
  await set(2, o);
  await page.locator('canvas').screenshot({ path: `build/shots/opacity-${o}.png` });
}
console.log(JSON.stringify({ problems }));
await browser.close();
