// Dev-only: quick screenshots of each tab, used while designing.
//   node dev/shoot.mjs [width height] [prefix]
import { chromium } from '../tests/node_modules/playwright/index.mjs';
import { startStatic } from './serve.mjs';
import { startMockApi } from './mock-api.mjs';

const [w = 390, h = 844, prefix = 'phone'] = process.argv.slice(2);
const staticSrv = await startStatic({ port: 0, quiet: true });
const api = await startMockApi({ port: 0, quiet: true });
const base = `http://127.0.0.1:${staticSrv.address().port}/Bilbrey-Family-Dinner-Planner/`;
const apiBase = `http://127.0.0.1:${api.server.address().port}`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 2, colorScheme: process.env.DARK ? 'dark' : 'light' });
const page = await ctx.newPage();
await page.clock.install({ time: new Date('2026-11-16T17:30:00-06:00') });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${base}?api=${encodeURIComponent(apiBase)}`);
await page.waitForSelector('.gate, .page', { timeout: 15000 });
if (await page.$('.gate-who')) {
  await page.screenshot({ path: `dev/screenshots/${prefix}-0-welcome.png` });
  await page.click('[data-who="Jeff"]');
  await page.waitForSelector('.gate input[type=password], .page');
  if (await page.$('#pc-new')) {
    await page.screenshot({ path: `dev/screenshots/${prefix}-0-passcode.png` });
    await page.fill('#pc-new', 'tacos');
    await page.fill('#pc-again', 'tacos');
    await page.click('button[type=submit]');
  }
}
await page.waitForSelector('.page-tonight');
await page.screenshot({ path: `dev/screenshots/${prefix}-1-tonight-empty.png` });
await page.click('[data-action="tonight:plan-week"]');
await page.waitForSelector('.hero-photo');
await page.waitForTimeout(600);
await page.screenshot({ path: `dev/screenshots/${prefix}-2-tonight.png`, fullPage: true });
for (const [i, v] of ['plan', 'list', 'pantry', 'recipes', 'budget', 'family'].entries()) {
  await page.goto(`${base}#/${v}`);
  await page.waitForSelector(`.page-${v}`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `dev/screenshots/${prefix}-${i + 3}-${v}.png`, fullPage: true });
}
await page.goto(`${base}#/recipe/brown-butter-spaghetti`);
await page.waitForSelector('.page-recipe');
await page.waitForTimeout(400);
await page.screenshot({ path: `dev/screenshots/${prefix}-9-recipe.png`, fullPage: true });
await page.goto(`${base}#/cook/2026-11-16`);
await page.waitForSelector('.cook');
await page.screenshot({ path: `dev/screenshots/${prefix}-10-cook.png` });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
console.log('errors', errors, 'overflow', overflow);
await browser.close();
staticSrv.close();
api.server.close();
