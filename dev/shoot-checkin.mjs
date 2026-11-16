// Dev-only: screenshots of the weekly check-in (docs/spec/25) on a phone, a laptop and the TV,
// plus Tonight's reminder and the Easy tonight sheet. → dev/screenshots/checkin-*.png
import { chromium } from '../tests/node_modules/playwright/index.mjs';
import { startStatic } from './serve.mjs';
import { startMockApi } from './mock-api.mjs';

const NOW = new Date('2026-11-16T17:30:00-06:00');
const staticSrv = await startStatic({ port: 0, quiet: true });
const api = await startMockApi({ port: 0, quiet: true });
const base = `http://127.0.0.1:${staticSrv.address().port}/Bilbrey-Family-Dinner-Planner/`;
const apiBase = `http://127.0.0.1:${api.server.address().port}`;
const browser = await chromium.launch();
const out = (n) => new URL(`./screenshots/checkin-${n}.png`, import.meta.url).pathname;
const errors = [];

const seed = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const sp = await seed.newPage();
sp.on('pageerror', (e) => errors.push(`seed: ${e.message}`));
sp.on('console', (m) => { if (m.type() === 'error') errors.push(`seed console: ${m.text()}`); });
await sp.clock.install({ time: NOW });
await sp.goto(`${base}?api=${encodeURIComponent(apiBase)}`);
await sp.waitForSelector('#pc-new');
await sp.fill('#pc-new', 'tacos');
await sp.fill('#pc-again', 'tacos');
await sp.click('button[type=submit]');
await sp.waitForSelector('.page-tonight');
await sp.click('[data-action="tonight:plan-week"]');
await sp.waitForSelector('.hero-photo');
const key = await sp.evaluate(() => JSON.parse(localStorage.getItem('bfdp.v2.device')).key);
const at = '2026-11-15T23:30:00.000Z';
const set = (path, value) => ({ op: 'set', path, value });
const item = (qty) => ({ qty, stocked: false, by: 'Family', at });
const ops = [
  ...Object.entries({ chicken: item(6), beef: item(3), buns: item(16), pasta: item(32), marinara: item(48), tortillas: item(20), cheddar: item(16), lettuce: item(2), potatoes: item(10), pulledPork: item(3), fries: item(64), broccoli: item(24), greenBeans: item(4), salt: { qty: null, stocked: true, by: 'Family', at } }).map(([id, v]) => set(['pantry', id], v)),
  set(['receipts'], [
    { id: 'r0', date: '2026-10-12', store: 'jewel', amount: 96.2 }, { id: 'r1', date: '2026-10-24', store: 'sams', amount: 188.4 },
    { id: 'r2', date: '2026-11-03', store: 'sams', amount: 212.4 }, { id: 'r3', date: '2026-11-15', store: 'jewel', amount: 176.46 }]),
  set(['waste', 'w1'], { id: 'cornCobs', name: 'Corn on the cob', qty: 4, unit: 'ears', cost: 6.2, reason: 'tossed', date: '2026-11-15', by: 'Family', at }),
  set(['leftovers', '2026-11-15'], { title: 'Smoky paprika chicken', servings: 3, saved: 4, useBy: '2026-11-18', by: 'Family', at }),
];
const sent = await fetch(`${apiBase}/api/ops`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Family-Key': key }, body: JSON.stringify({ ops, by: 'Family', clientId: 'ck', batchId: 'ck-seed' }) });
if (sent.status !== 200) console.log('seed failed', sent.status, await sent.text());
await sp.reload();
await sp.waitForSelector('.page-tonight');
await sp.waitForSelector('#checkin-card');
await sp.screenshot({ path: out('tonight-390') });
await sp.locator('#easy-open').scrollIntoViewIfNeeded();
await sp.screenshot({ path: out('tonight-easy-link-390') });
await sp.click('#easy-open');
await sp.waitForSelector('.sheet .sheet-text');
await sp.waitForTimeout(500);
await sp.screenshot({ path: out('easy-390') });
console.log('easy sheet:', (await sp.textContent('.sheet')).replace(/\s+/g, ' ').slice(0, 700));
await sp.keyboard.press('Escape');
await sp.goto(`${base}#/checkin`);
await sp.waitForSelector('.page-checkin');
await sp.waitForTimeout(400);
await sp.screenshot({ path: out('page-390'), fullPage: true });
// Set up a weigh-in on this phone, then add history through the device record and look again.
await sp.click('[data-action="weigh:open-setup"]');
await sp.waitForSelector('.ck-setup');
await sp.locator('.ck-setup').scrollIntoViewIfNeeded();
await sp.screenshot({ path: out('setup-390'), fullPage: true });
await sp.check('input[name=who][value=Candi]', { force: true });
await sp.check('input[name=goal][value=gain]', { force: true });
await sp.fill('.ck-setup input[name=lb]', '118.6');
await sp.click('.ck-setup button[type=submit]');
await sp.waitForSelector('#ck-lb');
// Shared with the family (the default): add a few weeks of history for both of them on the server.
const hist = [set(['checkin', 'weights', 'Candi'], { '2026-10-19': 116.2, '2026-10-26': 116.8, '2026-11-02': 117.4, '2026-11-09': 117.9, '2026-11-16': 118.6 }),
  set(['checkin', 'people', 'Jeff'], { goal: 'lose' }), set(['checkin', 'weights', 'Jeff'], { '2026-10-26': 214.2, '2026-11-02': 212.8, '2026-11-09': 211.4, '2026-11-16': 210.6 })];
await sp.waitForTimeout(800);
await fetch(`${apiBase}/api/ops`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Family-Key': key }, body: JSON.stringify({ ops: hist, by: 'Family', clientId: 'ck', batchId: 'ck-hist' }) });
await sp.reload();
await sp.waitForSelector('.page-checkin .ck-chart-weigh');
await sp.waitForTimeout(400);
await sp.screenshot({ path: out('weigh-390'), fullPage: true });
await sp.emulateMedia({ colorScheme: 'dark' });
await sp.waitForTimeout(300);
await sp.screenshot({ path: out('weigh-390-dark'), fullPage: true });
const state = await seed.storageState();
await seed.close();

for (const [name, opts, q] of [['1280', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }, ''], ['tv', { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 }, '&tv=1']]) {
  const ctx = await browser.newContext({ ...opts, storageState: state });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await p.clock.install({ time: NOW });
  await p.goto(`${base}?api=${encodeURIComponent(apiBase)}${q}#/checkin`);
  await p.waitForSelector('.page-checkin');
  await p.waitForTimeout(600);
  await p.screenshot({ path: out(`page-${name}`), fullPage: name !== 'tv' });
  const text = (await p.textContent('#view')).replace(/\s+/g, ' ');
  console.log(name, 'shows the shared weigh-ins:', /Candi’s weigh-in/.test(text) && /Jeff’s weigh-in/.test(text));
  if (name === 'tv') { await p.goto(`${base}?api=${encodeURIComponent(apiBase)}${q}#/tonight`); await p.waitForSelector('.page-tonight'); await p.waitForTimeout(500); await p.screenshot({ path: out('tonight-tv') }); }
  await ctx.close();
}
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
staticSrv.close();
api.server.close();
