// Render the app in a headless browser and save a screenshot.
// Used to verify the renderer actually produces an image — a shader bug is invisible to unit tests.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:4173/classic/';
const out = process.argv[3] ?? 'build/shots/puzzle.png';
mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });

const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

const overlay = await page.locator('.overlay').count();
const overlayText = overlay ? await page.locator('.overlay').innerText() : '';

// Sample the canvas: how much of it is not the background colour?
const stats = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  if (!canvas) return { error: 'no canvas' };
  const gl = canvas.getContext('webgl2');
  return { width: canvas.width, height: canvas.height, hasWebgl2: !!gl };
});

await page.screenshot({ path: out });
console.log(JSON.stringify({ stats, overlay: overlayText, problems }, null, 2));
await browser.close();
