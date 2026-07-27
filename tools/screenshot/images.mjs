// Regenerate the images used in the README and docs, plus the favicon, from the live app.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
mkdirSync('build/shots', { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });

const setSlider = async (page, i, v) => {
  await page.evaluate(({ i, v }) => {
    const el = document.querySelectorAll('input[type=range]')[i];
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, { i, v });
  await page.waitForTimeout(450);
};

// Hero: cells closed up, which is the silhouette people recognise as MagicCube4D.
{
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 2 });
  await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  await page.evaluate(() => {
    document.querySelector('.panel').style.display = 'none';
    document.querySelector('.layout').style.gridTemplateColumns = '1fr';
    document.querySelector('.hud').style.display = 'none';
  });
  await setSlider(page, 0, 0.92);
  await page.evaluate(() => window.__mc4d.renderer.setZoom(1.05));
  await page.waitForTimeout(400);
  await page.locator('canvas').screenshot({ path: 'build/shots/hero.png' });
  await page.close();
}

// The full app, at defaults.
{
  const page = await browser.newPage({ viewport: { width: 1100, height: 780 }, deviceScaleFactor: 2 });
  await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  await page.screenshot({ path: 'build/shots/app.png' });
  await page.close();
}

// Transparency, for the porting log.
{
  const page = await browser.newPage({ viewport: { width: 900, height: 860 } });
  await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  await page.evaluate(() => {
    document.querySelector('.panel').style.display = 'none';
    document.querySelector('.layout').style.gridTemplateColumns = '1fr';
    document.querySelector('.hud').style.display = 'none';
  });
  await setSlider(page, 0, 0.9);
  await setSlider(page, 2, 0.55);
  await page.locator('canvas').screenshot({ path: 'build/shots/transparency.png' });
  await page.close();
}
console.log('done');
await browser.close();
