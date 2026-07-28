// Exercise save, export, permalink and file-drop against the running app.
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
mkdirSync('build/shots', { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1100, height: 950 }, permissions: ['clipboard-read','clipboard-write'] });
const page = await ctx.newPage();

const problems = [];
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });

await page.goto('http://localhost:4173/classic/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
const box = await page.locator('canvas').boundingBox();
const settle = async () => { for (let i=0;i<120;i++){ if (await page.evaluate(()=>window.__mc4d.pending()===0)) return; await page.waitForTimeout(60);} };
// Section state persists, so clicking blindly toggles rather than opens. Match on the heading
// exactly: a substring match on "Solve" also hits the Start over group, whose hint mentions
// discarding the current solve.
const ensureOpen = async (title) => {
  const heading = page.locator('.group-head h2', { hasText: new RegExp(`^${title}$`, 'i') });
  const group = page.locator('.group').filter({ has: heading });
  if (!(await group.evaluate((el) => el.classList.contains('open')))) {
    await group.locator('.group-head').click();
    await page.waitForTimeout(300);
  }
};
const out = {};

// Make some moves.
const targets = await page.evaluate(({w,h}) => {
  const m = window.__mc4d, found = [], seen = new Set();
  for (let gy=0.2; gy<0.85; gy+=0.05) for (let gx=0.2; gx<0.85; gx+=0.05) {
    const hit = m.pick(Math.round(w*gx), Math.round(h*gy));
    if (hit && !seen.has(hit.sticker)) { seen.add(hit.sticker); found.push({x:Math.round(w*gx),y:Math.round(h*gy)}); }
  }
  return found;
}, { w: box.width, h: box.height });
for (const t of targets.slice(0, 6)) { await page.mouse.click(box.x+t.x, box.y+t.y); await settle(); }
out.twists = await page.locator('.hud b').innerText();
out.stateAfterMoves = await page.evaluate(()=>window.__mc4d.stateHash());

// Save and load live in a collapsed section by default; open it first.
await ensureOpen('Import \/ Export');

// Export a .log and check the original's loader would accept its header.
const logDownload = page.waitForEvent('download');
await page.getByRole('button', { name: 'Export .log' }).click();
const logFile = await logDownload;
const logPath = 'build/shots/exported.log';
await logFile.saveAs(logPath);
const logText = readFileSync(logPath, 'utf8');
out.logHeader = logText.split(/\r?\n/)[0];
out.logEndsWithTerminator = /\.\s*$/.test(logText.trim());

// Save JSON.
const jsonDownload = page.waitForEvent('download');
await page.getByRole('button', { name: 'Save', exact: true }).click();
const jsonFile = await jsonDownload;
await jsonFile.saveAs('build/shots/exported.json');
out.jsonMoves = JSON.parse(readFileSync('build/shots/exported.json','utf8')).moves.length;

// Copy link, then reset and reopen it.
await page.getByRole('button', { name: 'Copy link' }).click();
await page.waitForTimeout(400);
const link = await page.evaluate(() => navigator.clipboard.readText());
out.linkLength = link.length;

await page.getByRole('button', { name: 'Reset', exact: true }).click();
await settle();
out.stateAfterReset = await page.evaluate(()=>window.__mc4d.stateHash());

// A fresh page: navigating the current one to a URL that differs only in the fragment is a
// same-document navigation and would not reload.
const shared = await ctx.newPage();
await shared.goto(link, { waitUntil: 'networkidle' });
await shared.waitForTimeout(2500);
out.stateAfterPermalink = await shared.evaluate(()=>window.__mc4d.stateHash());
out.permalinkRestores = out.stateAfterPermalink === out.stateAfterMoves;
await shared.close();

// Now drop the exported .log back in.
await page.getByRole('button', { name: 'Reset', exact: true }).click();
await settle();
await ensureOpen('Import \/ Export');
await page.setInputFiles('.filebutton input', logPath);
await page.waitForTimeout(1500);
await settle();
out.stateAfterLogImport = await page.evaluate(()=>window.__mc4d.stateHash());
out.logRoundTrips = out.stateAfterLogImport === out.stateAfterMoves;

console.log(JSON.stringify({ ...out, problems }, null, 2));
await browser.close();
