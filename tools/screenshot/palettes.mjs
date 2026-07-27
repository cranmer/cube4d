import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
mkdirSync('build/shots', { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 820 } });
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2200);
const names = await page.locator('.palette .name').allInnerTexts();
for (const name of names) {
  await page.locator('.palette', { hasText: name }).click();
  await page.waitForTimeout(500);
  await page.locator('canvas').screenshot({ path: `build/shots/palette-${name.toLowerCase().replace(/[^a-z]+/g,'-')}.png` });
}
console.log(JSON.stringify({ names, problems }));
await browser.close();
