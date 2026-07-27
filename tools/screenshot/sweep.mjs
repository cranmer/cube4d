import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
mkdirSync('build/shots', { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 760, height: 700 } });
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

async function setSlider(index, value) {
  await page.evaluate(({ index, value }) => {
    const input = document.querySelectorAll('input[type=range]')[index];
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, { index, value });
  await page.waitForTimeout(700);
}

for (const fs of [0.4, 0.7, 0.95]) {
  await setSlider(0, fs);
  await page.locator('canvas').screenshot({ path: `build/shots/faceshrink-${fs}.png` });
}
await setSlider(0, 0.4);
for (const ew of [1.05, 2.0, 4.0]) {
  await setSlider(2, ew);
  await page.locator('canvas').screenshot({ path: `build/shots/eyew-${ew}.png` });
}
console.log('done');
await browser.close();
