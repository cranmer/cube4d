// Does Turn ease round, or jump? Samples the unfolded pane's view matrix over half a second.
//
// Screenshots are no use for this — one takes longer under software GL than the glide does — so the
// matrix itself is what gets watched. A jump shows up as one update; a glide as dozens.
import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto('http://localhost:5173/hypercube/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

await page.evaluate(() => {
  const w = globalThis;
  w.__samples = [];
  // `view` is private to TypeScript only; from here it is an ordinary field.
  const read = () => w.__mc4d?.renderer?.view?.mat4d;
  const tick = () => {
    const m = read();
    if (m) {
      const at = Array.from(m).map((v) => Math.round(v * 1000) / 1000).join(',');
      if (w.__samples[w.__samples.length - 1] !== at) w.__samples.push(at);
    }
    requestAnimationFrame(tick);
  };
  tick();
});

await page.locator('.pane-controls .pad', { hasText: 'TURN' }).first().locator('button').nth(1).click();
await page.waitForTimeout(1200);

const samples = await page.evaluate(() => globalThis.__samples.length);
console.log(`distinct view matrices during one Turn: ${samples}`);
await browser.close();
