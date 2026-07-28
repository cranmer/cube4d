// Drive the app like a player: find real stickers, click them, undo back to solved.
// This is the end-to-end check that no unit test can make — pick, grip resolution, animation,
// state commit and history all have to agree, in a real browser.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
mkdirSync('build/shots', { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
const problems = [];
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });

await page.goto('http://localhost:4173/classic/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

const canvas = page.locator('canvas');
const box = await canvas.boundingBox();
const twists = async () => Number(await page.locator('.hud b').innerText());
const solved = () => page.evaluate(() => window.__mc4d.isSolved());
const stateHash = () => page.evaluate(() => window.__mc4d.stateHash());
const settle = async () => {
  for (let i = 0; i < 100; ++i) {
    if (await page.evaluate(() => window.__mc4d.pending() === 0)) return;
    await page.waitForTimeout(60);
  }
};

// Ask the picker where the stickers actually are, rather than guessing at screen positions.
const targets = await page.evaluate(({ w, h }) => {
  const m = window.__mc4d;
  const found = [];
  const seen = new Set();
  for (let gy = 0.15; gy < 0.9; gy += 0.05) {
    for (let gx = 0.15; gx < 0.9; gx += 0.05) {
      const x = Math.round(w * gx), y = Math.round(h * gy);
      const hit = m.pick(x, y);
      if (hit && !seen.has(hit.sticker)) {
        seen.add(hit.sticker);
        found.push({ x, y, sticker: hit.sticker, poly: hit.poly });
      }
    }
  }
  return found;
}, { w: box.width, h: box.height });

const log = { distinctStickersFound: targets.length, startTwists: await twists() };

// Twist eight of them, spread across the puzzle.
const chosen = [];
for (let i = 0; i < targets.length && chosen.length < 8; i += Math.max(1, Math.floor(targets.length / 8))) {
  chosen.push(targets[i]);
}
const solvedAtStart = await solved();
for (const t of chosen) {
  await page.mouse.click(box.x + t.x, box.y + t.y);
  await settle();
}
log.twistsAfterClicks = await twists();
log.clicked = chosen.length;
log.solvedAtStart = solvedAtStart;
log.solvedAfterClicks = await solved();
log.movesRecorded = await page.evaluate(() => window.__mc4d.moveCount());
await canvas.screenshot({ path: 'build/shots/play-twisted.png' });

// Mid-twist screenshot: click and grab the canvas while the animation is running.
await page.mouse.click(box.x + chosen[0].x, box.y + chosen[0].y);
await page.waitForTimeout(110);
await canvas.screenshot({ path: 'build/shots/play-midtwist.png' });
await settle();

// Now undo everything and check we are back to solved.
for (let i = 0; i < 60; ++i) {
  const btn = page.getByRole('button', { name: 'Undo' });
  if (await btn.isDisabled()) break;
  await btn.click();
  await settle();
}
log.twistsAfterUndo = await twists();
log.solvedAfterUndoAll = await solved();

// Scramble, confirm it is genuinely scrambled, then undo back to solved again.
await page.getByRole('button', { name: 'Scramble' }).click();
await settle();
log.solvedAfterScramble = await solved();
log.scrambleMoves = await page.evaluate(() => window.__mc4d.moveCount());

// Solve it the honest way: undo every scramble twist and confirm the puzzle comes back.
for (let i = 0; i < 400; ++i) {
  const btn = page.getByRole('button', { name: 'Undo' });
  if (await btn.isDisabled()) break;
  await btn.click();
  await settle();
}
log.solvedAfterUndoingScramble = await solved();
await canvas.screenshot({ path: 'build/shots/play-scrambled.png' });

await page.getByRole('button', { name: 'Reset', exact: true }).click();
await page.waitForTimeout(400);

// Hover highlight should not throw and should light something up.
await page.mouse.move(box.x + chosen[0].x, box.y + chosen[0].y);
await page.waitForTimeout(250);
await canvas.screenshot({ path: 'build/shots/play-hover.png' });

console.log(JSON.stringify({ ...log, problems }, null, 2));
await browser.close();
