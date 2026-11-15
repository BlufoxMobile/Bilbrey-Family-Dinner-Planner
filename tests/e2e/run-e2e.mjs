// End-to-end tests: the real app in Chromium against dev/mock-api.mjs, served under
// /Bilbrey-Family-Dinner-Planner/ like GitHub Pages. Run: cd tests && npm run e2e
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startStatic } from '../../dev/serve.mjs';
import { startMockApi } from '../../dev/mock-api.mjs';
import { applyOps } from '../../app/state.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = path.join(ROOT, 'dev', 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const NOW = new Date('2026-11-16T17:30:00-06:00'); // Monday, 5:30 PM in Glen Ellyn
const TODAY = '2026-11-16';
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

let browser; let staticSrv; let api; let base; let apiBase; let ctx; let page;
const errors = [];

async function newPage(context, viewport = PHONE) {
  const p = await context.newPage();
  await p.setViewportSize(viewport);
  await p.clock.install({ time: NOW });
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|ERR_INTERNET_DISCONNECTED|net::/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  return p;
}

async function familyState(p) {
  const { server, pending } = await p.evaluate(() => ({
    server: JSON.parse(localStorage.getItem('bfdp.v2.server') || 'null'),
    pending: JSON.parse(localStorage.getItem('bfdp.v2.pending') || '[]'),
  }));
  return { state: applyOps(server?.state || {}, pending), pending: pending.length };
}

async function waitFor(fn, { timeout = 8000, step = 100 } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, step));
  }
  throw new Error('Timed out waiting');
}

/** Waits for a toast whose text matches (an earlier toast may still be showing). */
const toastMatch = (p, re) => waitFor(async () => re.test((await p.textContent('.toast-root .toast-msg').catch(() => '')) || ''));
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const shot = (p, name, full = false) => p.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: full });
const go = async (p, hash, sel) => { await p.goto(`${base}${hash}`); await p.waitForSelector(sel); await p.waitForTimeout(150); };
const listTotal = async (p) => { await go(p, '#/list', '.page-list'); const t = await p.textContent('.total-num').catch(() => '$0'); return Number(String(t).replace(/[^0-9.]/g, '')) || 0; };
const listNames = async (p) => { await go(p, '#/list', '.page-list'); return p.$$eval('.item-name', (els) => els.map((e) => e.textContent.trim())); };

before(async () => {
  staticSrv = await startStatic({ port: 0, quiet: true });
  api = await startMockApi({ port: 0, quiet: true });
  base = `http://127.0.0.1:${staticSrv.address().port}/Bilbrey-Family-Dinner-Planner/`;
  apiBase = `http://127.0.0.1:${api.server.address().port}`;
  browser = await chromium.launch();
  ctx = await browser.newContext({ deviceScaleFactor: 2, serviceWorkers: 'block', permissions: ['clipboard-read', 'clipboard-write'] });
  page = await newPage(ctx);
});

after(async () => {
  await browser?.close();
  staticSrv?.close();
  api?.server.close();
});

test('first launch: who is this, create the family passcode, plan the week', async () => {
  await page.goto(`${base}?api=${encodeURIComponent(apiBase)}`);
  await page.waitForSelector('.gate-who');
  await shot(page, 'e2e-01-welcome');
  await page.click('[data-who="Jeff"]');
  await page.waitForSelector('#pc-new');
  await shot(page, 'e2e-02-create-passcode');
  await page.fill('#pc-new', 'Tacos Tuesday');
  await page.fill('#pc-again', 'tacos tuesday');
  await page.click('form[data-submit="fam:create"] button[type=submit]');
  await page.waitForSelector('.page-tonight');
  assert.match(await page.textContent('.hero-title'), /Nothing planned/);
  await page.click('[data-action="tonight:plan-week"]');
  await page.waitForSelector('.hero-photo');
  const { state } = await familyState(page);
  for (let d = 16; d <= 22; d++) assert.ok(state.plan[`2026-11-${d}`]?.dinner, `Nov ${d} planned`);
  await waitFor(async () => (await (await fetch(`${apiBase}/__mock/state`)).json()).state.plan?.['2026-11-22']);
  await waitFor(async () => /Synced/.test(await page.textContent('.topbar .sync')));
  await shot(page, 'e2e-03-tonight');
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('every tab renders cleanly at 390×844 and 1280×800', async () => {
  const { state } = await familyState(page);
  const someDinner = state.plan[TODAY].dinner;
  const routes = [['#/tonight', '.page-tonight'], ['#/plan', '.page-plan'], ['#/list', '.page-list'], ['#/pantry', '.page-pantry'],
    ['#/recipes', '.page-recipes'], [`#/recipe/${someDinner}`, '.page-recipe'], ['#/budget', '.page-budget'], ['#/family', '.page-family'], [`#/cook/${TODAY}`, '.cook']];
  for (const vp of [PHONE, DESKTOP]) {
    const p = await newPage(ctx, vp);
    for (const [hash, sel] of routes) {
      await go(p, hash, sel);
      assert.ok(await noOverflow(p), `${hash} at ${vp.width}px has no horizontal scroll`);
      const text = await p.textContent('#view');
      assert.ok(!/\bNaN\b|undefined|\[object Object\]/.test(text), `${hash} shows no NaN/undefined`);
    }
    await go(p, '#/plan', '.page-plan');
    await shot(p, `e2e-04-plan-${vp.width}`);
    await go(p, '#/tonight', '.page-tonight');
    await shot(p, `e2e-05-tonight-${vp.width}`);
    await p.close();
  }
  // Month view and the 360px small phone.
  const small = await newPage(ctx, { width: 360, height: 740 });
  await go(small, '#/plan', '.page-plan');
  await small.click('[data-action="plan:period"][data-value="month"]');
  await small.waitForSelector('.month');
  assert.ok(await noOverflow(small), 'month view fits 360px');
  for (const [hash, sel] of routes) { await go(small, hash, sel); assert.ok(await noOverflow(small), `${hash} fits 360px`); }
  await small.close();
  const desk = await newPage(ctx, DESKTOP);
  await go(desk, '#/plan', '.page-plan');
  await desk.waitForSelector('.month');
  await shot(desk, 'e2e-06-month-1280');
  await desk.click('[data-action="plan:period"][data-value="week"]');
  await desk.close();
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('“Make this tonight” on a dinner later in the week swaps the two nights', async () => {
  const { state } = await familyState(page);
  const tonight = state.plan[TODAY].dinner;
  const thu = state.plan['2026-11-19'].dinner;
  await go(page, `#/recipe/${thu}`, '.page-recipe');
  await page.click('[data-action="rec:tonight"]');
  await toastMatch(page, /Swapped/);
  const after = (await familyState(page)).state;
  assert.equal(after.plan[TODAY].dinner, thu);
  assert.equal(after.plan['2026-11-19'].dinner, tonight, 'tonight’s dinner moved to Thursday');
  await go(page, '#/tonight', '.page-tonight');
  const title = await page.textContent('.hero-title');
  assert.ok(title.trim().length > 3);
});

test('not eating at home removes that dinner’s groceries; Undo brings it back', async () => {
  const before = await listTotal(page);
  await go(page, '#/plan', '.page-plan');
  await page.click('[data-action="plan:tap"][data-date="2026-11-18"]');
  await page.click('dialog[open] [data-action="night:away"]');
  await page.waitForSelector('form[data-submit="away:save"]');
  await page.click('dialog[open] .chip-radio:has(input[value="Date night"])');
  await page.fill('dialog[open] input[name="note"]', 'Anniversary');
  await page.waitForTimeout(400);
  await shot(page, 'e2e-07-away-sheet');
  await page.click('dialog[open] form[data-submit="away:save"] button[type=submit]');
  await toastMatch(page, /date night/);
  let s = (await familyState(page)).state;
  assert.equal(s.plan['2026-11-18'].status, 'away');
  assert.equal(s.plan['2026-11-18'].away.reason, 'Date night');
  const afterTotal = await listTotal(page);
  assert.ok(afterTotal < before, `list total went down (${before} → ${afterTotal})`);
  await go(page, '#/plan', '.page-plan');
  await page.waitForSelector('.day.is-away[data-date="2026-11-18"]');
  await shot(page, 'e2e-08-plan-with-away');
  // Another night away, then Undo.
  await page.click('[data-action="plan:tap"][data-date="2026-11-20"]');
  await page.click('dialog[open] [data-action="night:away"]');
  await page.click('dialog[open] form[data-submit="away:save"] button[type=submit]');
  await toastMatch(page, /Friday/);
  await page.click('.toast-root .toast-btn');
  await toastMatch(page, /Undone/);
  s = (await familyState(page)).state;
  assert.equal(s.plan['2026-11-20'].status, 'planned', 'Undo restored the night');
});

test('substituting a side is remembered for that dinner and survives a reload', async () => {
  await go(page, '#/plan', '.page-plan');
  const btn = await page.$('.day[data-date="2026-11-17"] .sub-btn[data-slot="0"]');
  const dinner = await btn.getAttribute('data-dinner');
  await btn.click();
  await page.waitForSelector('dialog[open] .pick-row');
  const choice = await page.$('dialog[open] .pick-row');
  const ref = await choice.getAttribute('data-ref');
  const title = (await choice.textContent()).trim();
  await choice.click();
  await toastMatch(page, /Remembered for/);
  await page.reload();
  await page.waitForSelector('.page-plan');
  const s = (await familyState(page)).state;
  assert.equal(s.substitutions[dinner]['0'], ref);
  const sideText = await page.textContent('.day[data-date="2026-11-17"] .day-sides');
  assert.ok(sideText.includes(title.split('\n')[0].trim().slice(0, 10)), 'the new side shows on the planner');
  await page.click('[data-action="plan:tap"][data-date="2026-11-17"]');
  await page.waitForSelector('dialog[open] .remembered');
  await page.waitForTimeout(500);
  await shot(page, 'e2e-09-night-sheet-remembered');
  await page.keyboard.press('Escape');
});

test('pantry scan (mock AI) confirms items and they drop off the list', async () => {
  const names = await listNames(page);
  assert.ok(names.includes('Table salt'), 'salt is on the list before the scan');
  await go(page, '#/pantry', '.page-pantry');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVQI12P8z8DAwMDAxMDAwMDAAAANHQEDK+mmyAAAAABJRU5ErkJggg==', 'base64');
  await page.setInputFiles('input[type=file]', { name: 'shelf.png', mimeType: 'image/png', buffer: png });
  await page.waitForSelector('dialog[open] .review-row', { timeout: 15000 });
  await shot(page, 'e2e-10-scan-review');
  const rows = await page.$$('dialog[open] .review-row');
  assert.ok(rows.length >= 3, 'found several items');
  await page.click('dialog[open] form[data-submit="pan:confirm"] button[type=submit]');
  await toastMatch(page, /to the pantry/);
  const s = (await familyState(page)).state;
  assert.equal(s.pantry.greenBeans.qty, 4);
  assert.equal(s.pantry.salt.stocked, true);
  assert.ok(Object.keys(s.custom || {}).some((k) => /rotel/.test(k)), 'unmatched item became a shelf item');
  const after = await listNames(page);
  assert.ok(!after.includes('Table salt'), 'salt is off the list');
  await go(page, '#/pantry', '.page-pantry');
  await shot(page, 'e2e-11-pantry');
});

test('shopping: fix a price, copy & open a store, check off, done shopping fills the pantry', async () => {
  await go(page, '#/list', '.page-list');
  const first = await page.$('.store-jewel .item .item-main');
  const key = await first.getAttribute('data-key');
  await first.click();
  await page.waitForSelector('dialog[open] form[data-submit="item:price"]');
  await page.fill('dialog[open] input[name="price"]', '1.11');
  await page.click('dialog[open] form[data-submit="item:price"] button[type=submit]');
  await toastMatch(page, /Price saved/);
  let s = (await familyState(page)).state;
  assert.ok(Object.entries(s.prices || {}).some(([k, v]) => k.endsWith(`/${key}`) && v.price === 1.11), 'family price saved');
  await page.keyboard.press('Escape');
  await page.click('[data-action="list:handoff"][data-store="jewel"]');
  await page.waitForSelector('dialog[open] .steps-small li');
  const href = await page.getAttribute('dialog[open] a.btn-primary', 'href');
  assert.match(href, /jewelosco\.com/);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(copied, /^Jewel-Osco list for /);
  assert.ok(!/undefined|NaN/.test(copied));
  await page.waitForTimeout(400);
  await shot(page, 'e2e-17-handoff-jewel');
  await page.keyboard.press('Escape');
  await page.locator('.store-sams .item .check').nth(0).click();
  await waitFor(async () => (await page.$$('.store-sams .item.is-checked')).length === 1);
  await page.locator('.store-sams .item .check').nth(1).click();
  await waitFor(async () => (await page.$$('.store-sams .item.is-checked')).length === 2);
  const doneKeys = await page.$$eval('.store-sams .item.is-checked .item-main', (els) => els.map((e) => e.dataset.key));
  await page.click('[data-action="list:done"]');
  await page.click('dialog[open] [data-confirm="yes"]');
  await toastMatch(page, /in the pantry/);
  s = (await familyState(page)).state;
  for (const k of doneKeys) assert.ok(s.pantry[k], `${k} is in the pantry`);
  await waitFor(async () => {
    const keysNow = await page.$$eval('.item .item-main', (els) => els.map((e) => e.dataset.key));
    return doneKeys.every((k) => !keysNow.includes(k));
  });
});

test('budget: log a receipt, switch meat to lighter, the projection follows', async () => {
  await go(page, '#/budget', '.page-budget');
  const before = Number((await page.textContent('.budget-num')).replace(/[^0-9.]/g, ''));
  await page.fill('form[data-submit="bud:receipt"] input[name="amount"]', '86.40');
  await page.click('form[data-submit="bud:receipt"] button[type=submit]');
  await page.waitForSelector('.receipt-row', { timeout: 5000 });
  const withReceipt = Number((await page.textContent('.budget-num')).replace(/[^0-9.]/g, ''));
  assert.ok(Math.abs(withReceipt - (before + 86.4)) < 0.011, `receipt adds to the projection (${before} → ${withReceipt})`);
  await page.click('[data-action="fam:meat"][data-value="0.85"]');
  await page.waitForTimeout(200);
  const lighter = Number((await page.textContent('.budget-num')).replace(/[^0-9.]/g, ''));
  assert.ok(lighter <= withReceipt, 'lighter meat never costs more');
  assert.equal((await familyState(page)).state.settings.meatScale, 0.85);
  await shot(page, 'e2e-18-budget', true);
  await page.click('[data-action="fam:meat"][data-value="1"]');
});

test('two-tap swap on the planner trades two nights', async () => {
  const { state } = await familyState(page);
  const a = state.plan['2026-11-21'].dinner;
  const b = state.plan['2026-11-22'].dinner;
  await go(page, '#/plan', '.page-plan');
  await page.click('[data-action="plan:swapmode"]');
  await page.click('[data-action="plan:tap"][data-date="2026-11-21"]');
  await page.waitForSelector('.day.is-picked');
  await page.click('[data-action="plan:tap"][data-date="2026-11-22"]');
  await toastMatch(page, /Swapped|moved/);
  const s = (await familyState(page)).state;
  assert.equal(s.plan['2026-11-21'].dinner, b);
  assert.equal(s.plan['2026-11-22'].dinner, a);
});

test('offline: changes are saved on the phone and sync when the connection returns', async () => {
  const { state } = await familyState(page);
  const d = state.plan[TODAY].dinner;
  await page.route(`${apiBase}/**`, (r) => r.abort());
  await go(page, `#/recipe/${d}`, '.page-recipe');
  await page.click('[data-action="rec:vote"][data-value="1"]');
  await waitFor(async () => (await familyState(page)).pending > 0);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await waitFor(async () => /Saved on this phone|Offline/.test(await page.textContent('.topbar .sync')));
  await shot(page, 'e2e-12-offline');
  assert.equal((await familyState(page)).state.votes[d].Jeff, 1, 'the vote shows right away');
  let server = await (await fetch(`${apiBase}/__mock/state`)).json();
  assert.ok(!server.state.votes?.[d]?.Jeff, 'the server has not seen it yet');
  await page.unroute(`${apiBase}/**`);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await waitFor(async () => (await familyState(page)).pending === 0, { timeout: 15000 });
  server = await (await fetch(`${apiBase}/__mock/state`)).json();
  assert.equal(server.state.votes[d].Jeff, 1, 'the queued vote reached the family');
  await waitFor(async () => /Synced/.test(await page.textContent('.topbar .sync')));
});

test('cook mode: big steps, check off, mark cooked', async () => {
  await go(page, `#/cook/${TODAY}`, '.cook');
  const steps = await page.$$('.cook-step');
  assert.ok(steps.length >= 3, 'entrée and side steps');
  await steps[0].click();
  await page.waitForSelector('.cook-step.is-done');
  await shot(page, 'e2e-13-cook');
  await page.click('[data-action="cook:done"]');
  await page.waitForSelector('.page-tonight');
  assert.equal((await familyState(page)).state.plan[TODAY].status, 'cooked');
  await page.waitForSelector('.kicker-done');
});

test('a second phone joins with the passcode and sees the same tonight', async () => {
  const jeffTitle = (await page.textContent('.hero-title')).trim();
  await waitFor(async () => (await familyState(page)).pending === 0);
  const ctx2 = await browser.newContext({ deviceScaleFactor: 2, serviceWorkers: 'block' });
  const p2 = await newPage(ctx2);
  await p2.goto(`${base}?api=${encodeURIComponent(apiBase)}`);
  await p2.click('[data-who="Candi"]');
  await p2.waitForSelector('#pc-enter');
  await p2.fill('#pc-enter', 'wrong one');
  await p2.click('form[data-submit="fam:enter"] button[type=submit]');
  await p2.waitForSelector('.form-error');
  // The browser logs the expected 401 for the wrong passcode; that's not an app error.
  for (let i = errors.length - 1; i >= 0; i--) if (/status of 401/.test(errors[i])) errors.splice(i, 1);
  await p2.fill('#pc-enter', 'TACOS TUESDAY');
  await p2.click('form[data-submit="fam:enter"] button[type=submit]');
  await p2.waitForSelector('.page-tonight');
  await p2.waitForSelector('.hero-title');
  assert.equal((await p2.textContent('.hero-title')).trim(), jeffTitle);
  await shot(p2, 'e2e-14-candi-phone');
  await ctx2.close();
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('dark theme renders without overflow', async () => {
  const dark = await browser.newContext({ deviceScaleFactor: 2, colorScheme: 'dark', serviceWorkers: 'block', storageState: await ctx.storageState() });
  const p = await newPage(dark);
  await go(p, '#/tonight', '.page-tonight');
  await shot(p, 'e2e-15-dark-tonight');
  await go(p, '#/list', '.page-list');
  assert.ok(await noOverflow(p));
  await shot(p, 'e2e-16-dark-list');
  await dark.close();
});

test('installable PWA: the service worker caches the app so it opens offline', async () => {
  const swCtx = await browser.newContext({ serviceWorkers: 'allow', storageState: await ctx.storageState() });
  const p = await swCtx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(`${base}#/tonight`);
  await p.waitForSelector('.page-tonight');
  await p.evaluate(async () => { await navigator.serviceWorker.ready; });
  await waitFor(() => p.evaluate(() => !!navigator.serviceWorker.controller) || p.reload().then(() => false), { timeout: 15000, step: 500 });
  const manifest = await p.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
  assert.equal(manifest.short_name, 'Bilbrey Dinners');
  await swCtx.setOffline(true);
  await p.reload();
  await p.waitForSelector('.page-tonight', { timeout: 15000 });
  assert.ok((await p.textContent('.hero-title')).trim().length > 3, 'tonight renders offline');
  await p.goto(`${base}#/recipes`);
  await p.waitForSelector('.r-card');
  await shot(p, 'e2e-19-offline-recipes');
  await swCtx.close();
  assert.equal(errors.length, 0, errors.join('\n'));
});
