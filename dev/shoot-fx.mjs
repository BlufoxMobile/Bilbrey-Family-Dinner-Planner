// Dev-only: frames of the cinematic motion (docs/spec/26): the launch, a screen arriving, charts
// drawing, a card revealing on scroll. → dev/screenshots/fx-*.png
import { chromium } from '../tests/node_modules/playwright/index.mjs';
import { startStatic } from './serve.mjs';
import { startMockApi } from './mock-api.mjs';

const staticSrv = await startStatic({ port: 0, quiet: true });
const api = await startMockApi({ port: 0, quiet: true });
const base = `http://127.0.0.1:${staticSrv.address().port}/Bilbrey-Family-Dinner-Planner/`;
const apiBase = `http://127.0.0.1:${api.server.address().port}`;
const browser = await chromium.launch();
const out = (n) => new URL(`./screenshots/fx-${n}.png`, import.meta.url).pathname;
const errors = [];
const url = (hash = '') => `${base}?api=${encodeURIComponent(apiBase)}&fx=all${hash}`;

for (const [name, opts] of [['390', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 }], ['1280', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }]]) {
  const ctx = await browser.newContext(opts);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`); });
  await p.goto(url());
  await p.waitForSelector('.fx-splash');
  await p.waitForTimeout(650);
  await p.screenshot({ path: out(`splash-${name}`) });
  await p.waitForSelector('#pc-new, #pc-enter');
  if (await p.$('#pc-new')) { await p.fill('#pc-new', 'tacos'); await p.fill('#pc-again', 'tacos'); } else await p.fill('#pc-enter', 'tacos');
  await p.click('button[type=submit]');
  await p.waitForSelector('.page-tonight');
  if (await p.$('[data-action="tonight:plan-week"]')) await p.click('[data-action="tonight:plan-week"]');
  await p.waitForSelector('.hero-photo');
  const key = await p.evaluate(() => JSON.parse(localStorage.getItem('bfdp.v2.device')).key);
  const set = (path, value) => ({ op: 'set', path, value });
  const ops = [set(['receipts'], [{ id: 'r1', date: '2026-10-24', store: 'sams', amount: 188.4 }, { id: 'r2', date: '2026-11-03', store: 'sams', amount: 212.4 }, { id: 'r3', date: '2026-11-15', store: 'jewel', amount: 176.46 }]),
    set(['checkin', 'people', 'Jeff'], { goal: 'lose' }), set(['checkin', 'weights', 'Jeff'], { '2026-10-26': 214.2, '2026-11-02': 212.8, '2026-11-09': 211.4, '2026-11-16': 210.6 }),
    set(['checkin', 'people', 'Candi'], { goal: 'gain' }), set(['checkin', 'weights', 'Candi'], { '2026-10-26': 116.8, '2026-11-02': 117.4, '2026-11-09': 117.9, '2026-11-16': 118.6 })];
  await fetch(`${apiBase}/api/ops`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Family-Key': key }, body: JSON.stringify({ ops, by: 'Family', clientId: `fx${name}`, batchId: `fx-${name}` }) });
  await p.goto(url('#/checkin'));
  await p.waitForSelector('.page-checkin .ck-fill');
  await p.waitForTimeout(380);
  await p.screenshot({ path: out(`checkin-mid-${name}`) });
  await p.waitForTimeout(2200);
  await p.screenshot({ path: out(`checkin-done-${name}`) });
  const hidden = await p.evaluate(() => document.querySelectorAll('.fx-reveal:not(.is-in)').length);
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await p.waitForTimeout(1200);
  const after = await p.evaluate(() => document.querySelectorAll('.fx-reveal:not(.is-in)').length);
  await p.screenshot({ path: out(`checkin-scrolled-${name}`) });
  console.log(name, 'cards waiting below the fold:', hidden, '→ after scrolling:', after, '| aurora:', await p.evaluate(() => !!document.querySelector('.fx-aurora')));
  await p.evaluate(() => { location.hash = '#/tonight'; });
  await p.waitForSelector('.page-tonight .fx-w');
  await p.waitForTimeout(330);
  await p.screenshot({ path: out(`tonight-mid-${name}`) });
  await p.waitForTimeout(2200);
  await p.screenshot({ path: out(`tonight-done-${name}`) });
  console.log(name, 'headline reads:', JSON.stringify(await p.textContent('.hero-title')));
  await ctx.close();
}
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
staticSrv.close();
api.server.close();
