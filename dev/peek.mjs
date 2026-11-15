// Dev-only: planned week, then viewport screenshots of a route at several scroll offsets.
//   node dev/peek.mjs '#/list' 0,900,1800 [width] [height]
import { chromium } from '../tests/node_modules/playwright/index.mjs';
import { startStatic } from './serve.mjs';
import { startMockApi } from './mock-api.mjs';

const [hash = '#/tonight', offs = '0', w = 390, h = 844] = process.argv.slice(2);
const staticSrv = await startStatic({ port: 0, quiet: true });
const api = await startMockApi({ port: 0, quiet: true, passcode: 'tacos' });
const base = `http://127.0.0.1:${staticSrv.address().port}/Bilbrey-Family-Dinner-Planner/`;
const apiBase = `http://127.0.0.1:${api.server.address().port}`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 2, colorScheme: process.env.DARK ? 'dark' : 'light' });
const page = await ctx.newPage();
await page.clock.install({ time: new Date('2026-11-16T17:30:00-06:00') });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript(() => { try { if (!localStorage.getItem('bfdp.v2.device')) localStorage.setItem('bfdp.v2.device', JSON.stringify({ who: 'Jeff', dismissedGate: true })); } catch {} });
await page.goto(`${base}?api=${encodeURIComponent(apiBase)}#/tonight`);
await page.waitForSelector('.page-tonight');
if (await page.$('[data-action="tonight:plan-week"]')) { await page.click('[data-action="tonight:plan-week"]'); await page.waitForSelector('.hero-photo'); }
if (process.env.SETUP) await page.evaluate(process.env.SETUP);
await page.goto(`${base}${hash}`);
await page.waitForTimeout(700);
if (process.env.CLICK) { for (const sel of process.env.CLICK.split('||')) { await page.click(sel); await page.waitForTimeout(500); } }
const name = (process.env.NAME || hash.replace(/[^a-z0-9]+/gi, '-')).replace(/^-|-$/g, '');
for (const y of offs.split(',').map(Number)) {
  await page.evaluate((yy) => { const s = document.querySelector('dialog[open] .sheet-body'); if (s) s.scrollTop = yy; else window.scrollTo(0, yy); }, y);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `dev/screenshots/peek-${name}-${w}-${y}.png` });
}
console.log('errors', errors, 'overflow', await page.evaluate(() => document.documentElement.scrollWidth - innerWidth));
await browser.close(); staticSrv.close(); api.server.close();
