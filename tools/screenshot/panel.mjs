// Whole-window shot of an app, for looking at panel and strip layout rather than the puzzle.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5173/hypercube/';
const out = process.argv[3] ?? 'build/shots/panel.png';
mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.screenshot({ path: out });
await browser.close();
console.log(out);
