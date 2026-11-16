// Dev-only: freeze-frames of the transitions, to check them by eye.
//   node dev/shoot-motion.mjs        → dev/screenshots/motion-<what>-<n>.png
// Each transition is slowed down 6× (the --dur-* tokens are overridden) so a screenshot can land mid-flight.
import { chromium } from '../tests/node_modules/playwright/index.mjs';
import { startStatic } from './serve.mjs';
import { startMockApi } from './mock-api.mjs';

const staticSrv = await startStatic({ port: 0, quiet: true });
const api = await startMockApi({ port: 0, quiet: true });
const base = `http://127.0.0.1:${staticSrv.address().port}/Bilbrey-Family-Dinner-Planner/`;
const apiBase = `http://127.0.0.1:${api.server.address().port}`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.clock.install({ time: new Date('2026-11-16T17:30:00-06:00') });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${base}?api=${encodeURIComponent(apiBase)}`);
await page.waitForSelector('#pc-new'); // one shared profile: only the family passcode
await page.fill('#pc-new', 'tacos');
await page.fill('#pc-again', 'tacos');
await page.click('button[type=submit]');
await page.waitForSelector('.page-tonight');
await page.click('[data-action="tonight:plan-week"]');
await page.waitForSelector('.hero-photo');
await page.waitForTimeout(800);
await page.addStyleTag({ content: ':root { --dur-fast: 1080ms !important; --dur-base: 1680ms !important; --dur-slow: 2520ms !important; }' });

async function frames(name, act, times = [250, 700, 1200, 1900]) {
  await act();
  let last = 0;
  for (const [i, t] of times.entries()) {
    await page.waitForTimeout(t - last);
    last = t;
    await page.screenshot({ path: `dev/screenshots/motion-${name}-${i + 1}.png` });
  }
  await page.waitForTimeout(2600);
}

await frames('tonight-to-recipe', () => page.evaluate(() => document.querySelector('.hero-photo').click()));
await frames('recipe-to-plan-tab', () => page.evaluate(() => document.querySelector('.tabbar a[href="#/plan"]').click()));
await page.evaluate(() => document.querySelector('.day-hit').scrollIntoView({ block: 'center', behavior: 'instant' }));
await page.waitForTimeout(300);
await frames('sheet-open', () => page.evaluate(() => document.querySelector('.day .day-hit').click()));
await frames('sheet-close', () => page.evaluate(() => document.querySelector('dialog[open] .sheet-close').click()), [200, 600, 1000]);
await page.evaluate(() => { location.hash = '#/recipes'; });
await page.waitForSelector('.r-card');
await page.waitForTimeout(3000);
await frames('grid-to-recipe', () => page.evaluate(() => document.querySelectorAll('.r-card')[3].click()));
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
staticSrv.close();
api.server.close();
