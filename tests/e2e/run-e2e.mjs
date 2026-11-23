// End-to-end tests: the real app in Chromium against dev/mock-api.mjs, served under
// /Bilbrey-Family-Dinner-Planner/ like GitHub Pages. Run: cd tests && npm run e2e
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
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
  p.on('response', (r) => { if (r.status() === 404) console.log('# 404', r.url()); });
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
/** Switches the list to "Order online" (docs/spec/28), where Copy & open and the product buttons live. */
const inStore = async (p) => { if (!(await p.$('.item.is-store'))) { await p.click('[data-action="list:mode"][data-value="store"]'); await p.waitForSelector('.item.is-store'); } };
const orderOnline = async (p) => { if (!(await p.$('.item.is-online'))) { await p.click('[data-action="list:mode"][data-value="online"]'); await p.waitForSelector('.item.is-online'); } };
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
/** No change is on its way to the family server: a sync landing later would redraw the page under the test's hands. */
const synced = (p) => p.evaluate(() => { const s = window.bfdp?.status?.(); return !s || (s.pending === 0 && s.status !== 'syncing'); }).catch(() => true);
/** Waits until no page transition, sheet or flying photo is mid-flight (app/motion.js marks <html> while one is). */
const settled = (p) => p.waitForFunction(() => !/\bis-(vt|moving)\b/.test(document.documentElement.className) && !document.querySelector('.sheet.is-closing'), null, { timeout: 4000 }).catch(() => {});
const shot = async (p, name, full = false) => { await settled(p); await p.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: full }); };
const go = async (p, hash, sel) => {
  await waitFor(() => synced(p), { timeout: 3000, step: 50 }).catch(() => {}); // offline on purpose: carry on
  await p.goto(`${base}${hash}`);
  await p.waitForSelector(sel);
  await p.waitForTimeout(150);
  await settled(p);
};
const listTotal = async (p) => { await go(p, '#/list', '.page-list'); const t = await p.textContent('.total-num').catch(() => '$0'); return Number(String(t).replace(/[^0-9.]/g, '')) || 0; };
const lunchCost = async (p) => { await go(p, '#/list', '.page-list'); const t = await p.textContent('.cost-lines li:nth-child(2) b').catch(() => '$0'); return Number(String(t).replace(/[^0-9.]/g, '')) || 0; };
const listNames = async (p) => { await go(p, '#/list', '.page-list'); return p.$$eval('.item[data-name]', (els) => els.map((e) => e.dataset.name)); };
/** "Cost, coupons & receipts", folded under the list (docs/spec/29), opened. */
const listMore = async (p) => {
  if (await p.$('.list-more:not([open]) > summary')) await p.click('.list-more > summary');
  await p.waitForSelector('.list-more[open]');
};
/** The item sheet (the › on a row; a tap on the row itself ticks it, docs/spec/29), with "Fix the product, price or store" open. */
const openItem = async (p, sel, { fix = true } = {}) => {
  await p.locator(sel).first().click();
  await p.waitForSelector('dialog[open]');
  if (fix && await p.$('dialog[open] .item-fix:not([open]) > summary')) await p.click('dialog[open] .item-fix > summary');
};

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

test('first launch: no “who is this”, the app says what it is, create the family passcode, plan the week', async () => {
  // The very first frame says what it's doing instead of guessing (the family server is slow to answer here).
  await page.route(`${apiBase}/api/health`, async (r) => { await new Promise((ok) => setTimeout(ok, 700)); r.continue().catch(() => {}); });
  await page.goto(`${base}?api=${encodeURIComponent(apiBase)}`);
  await page.waitForSelector('.gate-checking');
  assert.match(await page.textContent('.gate-card'), /Looking for the family’s plan/);
  assert.match(await page.textContent('.gate-points'), /There are no separate profiles/);
  await shot(page, 'e2e-01-welcome');
  await page.waitForSelector('#pc-new');
  await page.unroute(`${apiBase}/api/health`);
  assert.equal(await page.locator('.who-pick').count(), 0, 'nobody is asked who they are');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'pc-new', 'ready to type');
  assert.ok(await noOverflow(page));
  await shot(page, 'e2e-02-create-passcode');
  // Two passcodes that don't match: said plainly, and what was typed is still there to fix.
  await page.fill('#pc-new', 'Tacos Tuesday');
  await page.fill('#pc-again', 'tacos wednesday');
  await page.click('form[data-submit="fam:create"] button[type=submit]');
  await page.waitForSelector('.form-error');
  assert.match(await page.textContent('.form-error'), /don’t match/);
  assert.equal(await page.inputValue('#pc-new'), 'Tacos Tuesday');
  // "Show the passcode": you can read it, so there's no second box.
  await page.click('[data-action="fam:show-pass"]');
  await page.waitForSelector('#pc-new[type=text]');
  assert.equal(await page.locator('#pc-again').count(), 0);
  assert.equal(await page.inputValue('#pc-new'), 'Tacos Tuesday', 'still there after switching');
  await page.click('[data-action="fam:show-pass"]');
  await page.waitForSelector('#pc-again');
  await page.fill('#pc-again', 'tacos tuesday');
  await page.click('form[data-submit="fam:create"] button[type=submit]');
  await page.waitForSelector('.page-tonight');
  assert.equal(await page.locator('.rail-who, .who-btn').count(), 0, 'no person switcher in the app shell');
  assert.match(await page.textContent('.hero-title'), /Nothing planned/);
  await page.click('[data-action="tonight:plan-week"]');
  await page.waitForSelector('.hero-photo');
  const { state } = await familyState(page);
  for (let d = 16; d <= 22; d++) assert.ok(state.plan[`2026-11-${d}`]?.dinner, `Nov ${d} planned`);
  await waitFor(async () => (await (await fetch(`${apiBase}/__mock/state`)).json()).state.plan?.['2026-11-22']);
  await waitFor(async () => (await page.$('.topbar')) && !(await page.$('.topbar .sync')));
  assert.equal((await (await fetch(`${apiBase}/__mock/state`)).json()).lastOpsBy, 'Family', 'changes are sent as the family, not as a person');
  assert.equal(state.plan['2026-11-16'].by, 'Family');
  await shot(page, 'e2e-03-tonight');
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('every tab renders cleanly at 390×844 and 1280×800', async () => {
  const { state } = await familyState(page);
  const someDinner = state.plan[TODAY].dinner;
  const routes = [['#/tonight', '.page-tonight'], ['#/plan', '.page-plan'], ['#/list', '.page-list'], ['#/pantry', '.page-pantry'],
    ['#/recipes', '.page-recipes'], [`#/recipe/${someDinner}`, '.page-recipe'], ['#/budget', '.page-budget'], ['#/family', '.page-family'], [`#/cook/${TODAY}`, '.cook'],
    ['#/lunch', '.page-lunch'], ['#/products', '.page-products'], ['#/receipts', '.page-receipts']];
  for (const vp of [PHONE, DESKTOP]) {
    const p = await newPage(ctx, vp);
    for (const [hash, sel] of routes) {
      await go(p, hash, sel);
      assert.ok(await noOverflow(p), `${hash} at ${vp.width}px has no horizontal scroll`);
      const text = await p.textContent('#view');
      assert.ok(!/\bNaN\b|undefined|\[object Object\]|Invalid Date|\bnull\b/.test(text), `${hash} shows no NaN/undefined/null`);
      await p.waitForTimeout(250);
      const hidden = await p.$$eval('img[data-photo]', (imgs) => imgs.filter((i) => i.complete && i.naturalWidth > 0 && !i.classList.contains('is-loaded')).map((i) => i.getAttribute('src')));
      assert.deepEqual(hidden, [], `${hash}: every loaded photo is shown, not left invisible over its placeholder`);
    }
    await go(p, '#/plan', '.page-plan');
    await shot(p, `e2e-04-plan-${vp.width}`);
    await go(p, '#/tonight', '.page-tonight');
    await shot(p, `e2e-05-tonight-${vp.width}`);
    await go(p, '#/lunch', '.page-lunch');
    await shot(p, `e2e-20-lunch-${vp.width}`, vp.width > 400);
    await p.close();
  }
  // Month view and the 360px small phone.
  const small = await newPage(ctx, { width: 360, height: 740 });
  await go(small, '#/plan', '.page-plan');
  // How much to show lives under More (docs/spec/29), so the page has one set of range choices: Plan ahead's.
  await small.click('[data-action="plan:more"]');
  await small.click('dialog[open] [data-action="plan:period"][data-value="month"]');
  await small.keyboard.press('Escape');
  await small.waitForSelector('.month');
  assert.ok(await noOverflow(small), 'month view fits 360px');
  for (const [hash, sel] of routes) { await go(small, hash, sel); assert.ok(await noOverflow(small), `${hash} fits 360px`); }
  await go(small, '#/lunch', '.page-lunch');
  await shot(small, 'e2e-21-lunch-360');
  await small.close();
  const desk = await newPage(ctx, DESKTOP);
  await go(desk, '#/plan', '.page-plan');
  await desk.waitForSelector('.month');
  await shot(desk, 'e2e-06-month-1280');
  await desk.click('[data-action="plan:more"]');
  await desk.click('dialog[open] [data-action="plan:period"][data-value="week"]');
  await desk.close();
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('a photo that finishes loading before its markup is on the page still shows', async () => {
  await go(page, '#/tonight', '.page-tonight');
  const r = await page.evaluate(async () => {
    const src = document.querySelector('img[data-photo]').getAttribute('src');
    const wrap = document.createElement('div');
    wrap.innerHTML = `<span class="photo"><img src="${src}" data-photo alt=""></span>`;
    const img = wrap.querySelector('img');
    await new Promise((res) => { if (img.complete) res(); else img.addEventListener('load', res, { once: true }); });
    await new Promise((res) => setTimeout(res, 30)); // its load event has come and gone while detached
    document.body.append(wrap);
    await new Promise((res) => setTimeout(res, 30));
    const shown = img.classList.contains('is-loaded');
    wrap.remove();
    return shown;
  });
  assert.ok(r, 'the photo is revealed once it is inserted');
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
  // One tap skips it; a reason is optional, under the fold, and nothing is picked for you (docs/spec/29).
  assert.ok(await page.$('dialog[open] [data-action="away:quick"][data-push="skip"]'));
  assert.equal(await page.locator('dialog[open] input[name="reason"]:checked').count(), 0, 'no reason chosen for you');
  await page.click('dialog[open] .away-more > summary');
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
  await page.click('dialog[open] [data-action="away:quick"][data-push="skip"]');
  await toastMatch(page, /Friday/);
  await page.click('.toast-root .toast-btn');
  await toastMatch(page, /Undone/);
  s = (await familyState(page)).state;
  assert.equal(s.plan['2026-11-20'].status, 'planned', 'Undo restored the night');
});

test('substituting a side is remembered for that dinner and survives a reload', async () => {
  await go(page, '#/plan', '.page-plan');
  // Change side lives in the night sheet (docs/spec/29).
  await page.click('[data-action="plan:tap"][data-date="2026-11-17"]');
  const btn = page.locator('dialog[open] [data-action="side:sub"][data-slot="0"]');
  assert.match(await btn.textContent(), /Change side/);
  const dinner = await btn.getAttribute('data-dinner');
  await btn.click();
  await page.waitForSelector('dialog[open] .pick-row');
  // From a night it's that night only unless you pick "Every time" (gauntlet r4).
  assert.equal(await page.getAttribute('dialog[open] [data-action="side:scope"]', 'aria-checked'), 'false', 'just this night unless switched on');
  await page.click('dialog[open] [data-action="side:scope"]');
  await page.waitForSelector('dialog[open] [data-action="side:scope"][aria-checked="true"]');
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
  assert.ok(sideText.toLowerCase().includes(title.split('\n')[0].trim().slice(0, 10).toLowerCase()), 'the new side shows on the planner');
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
  assert.equal((await page.textContent('dialog[open] .read-by')).trim(), 'Read by Claude Opus 5.5');
  await shot(page, 'e2e-10-scan-review');
  const rows = await page.$$('dialog[open] .review-row');
  assert.ok(rows.length >= 3, 'found several items');
  await page.click('dialog[open] form[data-submit="pan:confirm"] button[type=submit]');
  await toastMatch(page, /to the pantry/);
  const s = (await familyState(page)).state;
  assert.equal(s.pantry.greenBeans.qty, 4);
  assert.equal(s.pantry.salt.stocked, true);
  assert.ok(Object.keys(s.custom || {}).some((k) => /rotel/.test(k)), 'unmatched item became a shelf item');
  assert.ok(s.pantry.marinara.qty >= 22, `one jar of Rao's is a jar of ounces, not 1 oz (got ${s.pantry.marinara.qty})`);
  assert.equal(s.pantry.marinara.label, "Rao's Homemade Marinara Sauce", 'the label the scanner read is kept');
  const after = await listNames(page);
  assert.ok(!after.includes('Table salt'), 'salt is off the list');
  await go(page, '#/pantry', '.page-pantry');
  await shot(page, 'e2e-11-pantry');
});

test('shopping: fix a price, copy & open a store, check off, done shopping fills the pantry', async () => {
  await go(page, '#/list', '.page-list');
  const key = await page.getAttribute('.store-jewel .item .item-more', 'data-key');
  await openItem(page, '.store-jewel .item .item-more');
  await page.waitForSelector('dialog[open] form[data-submit="item:price"]');
  await page.fill('dialog[open] input[name="price"]', '1.11');
  await page.click('dialog[open] form[data-submit="item:price"] button[type=submit]');
  await toastMatch(page, /Price saved/);
  let s = (await familyState(page)).state;
  assert.ok(Object.entries(s.myProducts || {}).some(([k, v]) => k === `jewel/${key}` && v.price === 1.11 && v.source === 'typed'), 'the family’s price is saved on the item’s product');
  await page.keyboard.press('Escape');
  await orderOnline(page); // Copy & open lives in "Order online" (docs/spec/28)
  await page.click('[data-action="list:handoff"][data-store="jewel"]');
  await page.waitForSelector('dialog[open] .steps-small li');
  const href = await page.getAttribute('dialog[open] a.btn-primary', 'href');
  assert.match(href, /jewelosco\.com/);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(copied, /^Shop my grocery list/, 'copied in the format Jewel-Osco AI reads');
  assert.ok(copied.length <= 2000, 'fits Jewel-Osco AI’s box');
  assert.ok(await page.$('dialog[open] [data-action="list:copy-ai"]'), 'Copy for Jewel-Osco AI');
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

test('messages show on top of an open sheet, Undo works there, and a dismissed message never blocks taps', async () => {
  await go(page, '#/list', '.page-list');
  await openItem(page, '.store-sams .item .item-more');
  await page.waitForSelector('dialog[open] form[data-submit="item:price"]');
  const id = await page.evaluate(() => document.querySelector('dialog[open] form[data-submit="item:price"]').dataset.id);
  assert.equal(await page.locator('dialog[open] [data-action="item:brand"]').count(), 0, 'no store-brand / name-brand toggle any more');
  const was = await page.inputValue('dialog[open] form[data-submit="item:price"] input[name="price"]');
  await page.fill('dialog[open] form[data-submit="item:price"] input[name="price"]', String(Math.round((Number(was) + 1.11) * 100) / 100));
  await page.click('dialog[open] form[data-submit="item:price"] button[type=submit]');
  await toastMatch(page, /Price saved for the whole family/);
  assert.equal((await familyState(page)).state.myProducts?.[`sams/${id}`]?.source, 'typed', 'the price is the item’s product at Sam’s now');
  await page.click('dialog[open] .toast-root .toast-btn'); // a modal sheet sits in the top layer: the toast must be inside it
  await toastMatch(page, /Undone/);
  assert.equal((await familyState(page)).state.myProducts?.[`sams/${id}`], undefined, 'Undo from inside the sheet reverted the price');
  assert.equal(await page.inputValue('dialog[open] form[data-submit="item:price"] input[name="price"]'), was, 'the sheet shows the undone price');
  await page.keyboard.press('Escape');
  await page.click('.toast-root .toast-x');
  await page.waitForTimeout(400);
  const blocked = await page.evaluate(() => {
    const r = document.querySelector('.toast-root .toast').getBoundingClientRect();
    return !!document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('.toast-root');
  });
  assert.equal(blocked, false, 'a hidden toast lets taps through to the list under it');
});

test('budget: log a receipt, switch meat to lighter, the projection follows', async () => {
  await go(page, '#/budget', '.page-budget');
  const before = Number((await page.textContent('.budget-num')).replace(/[^0-9.]/g, ''));
  // One number on Budget and on the check-in: where the month is heading (docs/spec/29).
  assert.match(await page.textContent('.budget-answer'), /^About \$[\d,]+ (over|under)\s*the \$650 target$/, 'the answer first');
  await page.click('details:has(form[data-submit="bud:receipt"]) > summary');
  await page.fill('form[data-submit="bud:receipt"] input[name="amount"]', '86.40');
  await page.click('form[data-submit="bud:receipt"] button[type=submit]');
  await page.waitForSelector('.receipt-row', { timeout: 5000 });
  const withReceipt = Number((await page.textContent('.budget-num')).replace(/[^0-9.]/g, ''));
  assert.ok(Math.abs(withReceipt - (before + 86.4)) < 0.011, `receipt adds to the projection (${before} → ${withReceipt})`);
  // Meat per dinner is a house setting now, on Family & settings.
  assert.equal(await page.locator('.page-budget [data-action="fam:meat"]').count(), 0);
  await go(page, '#/family', '.page-family');
  await page.click('[data-action="fam:meat"][data-value="0.85"]');
  await page.waitForTimeout(200);
  await go(page, '#/budget', '.page-budget');
  const lighter = Number((await page.textContent('.budget-num')).replace(/[^0-9.]/g, ''));
  assert.ok(lighter <= withReceipt, 'lighter meat never costs more');
  assert.equal((await familyState(page)).state.settings.meatScale, 0.85);
  await shot(page, 'e2e-18-budget', true);
  await go(page, '#/family', '.page-family');
  await page.click('[data-action="fam:meat"][data-value="1"]');
});

test('lunch: edit Knox’s lunches, swap a drink for a day, skip a day, and the list follows', async () => {
  await go(page, '#/lunch', '.page-lunch');
  await page.locator('.toast-root .toast-x').click({ timeout: 1000 }).catch(() => {});
  // Grown-ups get one idea at a time on the week page, honestly labeled; kids get none there.
  await page.click('[data-action="lunch:who"][data-who="Jeff"]');
  await page.waitForSelector('.person.is-on:has-text("Jeff")');
  assert.ok((await page.$$('.page-lunch .lighter')).length <= 1, 'at most one idea on the page');
  for (const t of await page.$$eval('.page-lunch .lighter-text', (els) => els.map((e) => e.textContent))) {
    if (/plus|extra grilled chicken/i.test(t)) assert.doesNotMatch(t, /^\s*Lighter idea/, 'adding chicken is not called lighter');
  }
  // Jeff and Knox pack lunches; nobody else is listed or bought for, and anyone can be added.
  assert.deepEqual(await page.$$eval('.people [data-action="lunch:who"]', (els) => els.map((e) => e.dataset.who)), ['Jeff', 'Knox']);
  assert.ok(await page.$('.page-lunch [data-action="lunch:add"]'), '“Add a person” is always there');
  assert.match(await page.textContent('.lunch-foot'), /for Jeff and Knox only/);
  await page.click('[data-action="lunch:who"][data-who="Knox"]');
  await page.waitForSelector('.person.is-on:has-text("Knox")');
  assert.equal((await page.$$('.page-lunch .lighter')).length, 0, 'no ideas on a kid’s week');
  await page.waitForSelector('.person.is-on:has-text("Knox")');
  assert.ok((await page.$$('.lunch-day')).length >= 5, 'Mon–Fri');
  // The editor: add a snack to the rotation.
  await page.click('[data-action="lunch:edit"][data-who="Knox"]');
  await page.waitForSelector('dialog[open] .ed-item');
  const addId = await page.getAttribute('dialog[open] .ed-item[data-slot="snack"][aria-pressed="false"]', 'data-id');
  await page.locator(`dialog[open] .ed-item[data-slot="snack"][data-id="${addId}"]`).click();
  await waitFor(async () => (await familyState(page)).state.lunch?.people?.Knox?.slots?.snack?.includes(addId));
  await page.waitForSelector(`dialog[open] .ed-item[data-id="${addId}"][aria-pressed="true"]`);
  await page.waitForTimeout(300);
  await shot(page, 'e2e-22-lunch-editor');
  await page.keyboard.press('Escape');
  // Swap Thursday's drink for just that day.
  await page.click('.lunch-day[data-date="2026-11-19"] .ld-slot[data-slot="drink"]');
  await page.waitForSelector('dialog[open] .pick-row');
  const otherId = await page.getAttribute('dialog[open] .pick-row:not(.is-current)', 'data-id');
  await page.locator(`dialog[open] .pick-row[data-id="${otherId}"]`).click();
  await toastMatch(page, /that day/);
  let s = (await familyState(page)).state;
  assert.equal(s.lunch.days['2026-11-19'].Knox.picks.drink, otherId);
  // Skip Wednesday: its groceries leave the list.
  const before = await lunchCost(page);
  await go(page, '#/lunch', '.page-lunch');
  await page.click('[data-action="lunch:who"][data-who="Knox"]');
  await page.click('.lunch-day[data-date="2026-11-18"] [data-action="lunch:skip"]');
  await page.click('dialog[open] [data-action="lunch:skip-save"][data-reason="No school"]');
  await toastMatch(page, /won’t need a packed lunch/);
  s = (await familyState(page)).state;
  assert.equal(s.lunch.days['2026-11-18'].Knox.skip, true);
  await page.waitForSelector('.lunch-day.is-skipped[data-date="2026-11-18"]');
  const after = await lunchCost(page);
  assert.ok(after < before, `lunch groceries went down (${before} → ${after})`);
  // The Lunches filter (with the cost, under the list) shows only lunch items.
  await listMore(page);
  await page.click('[data-action="list:filter"][data-value="lunches"]');
  await page.waitForSelector('[data-action="list:filter"][data-value="lunches"].is-on');
  const tags = await page.$$eval('.store-sec .item', (els) => els.map((e) => e.hasAttribute('data-lunch')));
  assert.ok(tags.length > 0 && tags.every(Boolean), 'only lunch-tagged items');
  await shot(page, 'e2e-23-list-lunches');
  await page.click('.filter-on [data-action="list:filter"][data-value="all"]');
});

test('calories and protein: today’s line on Tonight for whoever this device picks, and a per-device switch to hide them', async () => {
  // One shared profile: no device belongs to a person, so the line is off until someone picks whose to show.
  await go(page, '#/tonight', '.page-tonight');
  assert.equal(await page.locator('.today-nutri').count(), 0, 'nobody’s daily total by default');
  await go(page, '#/family', '.page-family');
  assert.deepEqual(await page.$$eval('[data-action="fam:today"]', (els) => els.map((e) => e.textContent.trim())), ['Nobody', 'Jeff', 'Knox']);
  await page.click('[data-action="fam:today"][data-value="Jeff"]');
  await page.waitForSelector('[data-action="fam:today"][data-value="Jeff"].is-on');
  await go(page, '#/tonight', '.page-tonight');
  await page.waitForSelector('.today-nutri');
  assert.match(await page.textContent('.today-nutri'), /Today for Jeff: about [\d,]+ calories and \d+ g protein/);
  assert.match(await page.textContent('.today-nutri'), /Breakfast and snacks aren’t counted/);
  await go(page, '#/family', '.page-family');
  await page.click('[data-action="fam:nutrition"]');
  await go(page, '#/tonight', '.page-tonight');
  assert.equal(await page.locator('.today-nutri').count(), 0, 'hidden on this device');
  await go(page, '#/family', '.page-family');
  await page.click('[data-action="fam:nutrition"]');
  await go(page, '#/tonight', '.page-tonight');
  await page.waitForSelector('.today-nutri');
});

test('what a meal costs (docs/spec/24): beside the calories on Tonight, the week, the picker, the recipe box and the recipe', async () => {
  const COST = /^(about )?\$\d+\.\d\d a serving$/;
  const FULL = /^(about )?\$\d+\.\d\d a serving · \$\d+\.\d\d for five/;
  // Tonight stays on cooking (docs/spec/29); the night's sheet has the full line.
  await go(page, '#/plan', '.page-plan');
  await page.click(`[data-action="plan:tap"][data-date="${TODAY}"]`);
  const hero = (await page.textContent('dialog[open] .night-cost')).trim();
  assert.match(hero, FULL, 'the night: per serving and for five');
  const [each, five] = hero.match(/\$(\d+\.\d\d)/g).map((x) => Number(x.slice(1)));
  assert.ok(Math.abs(each * 5 - five) <= 0.03, `${each} a serving is a fifth of ${five}`);
  await page.keyboard.press('Escape');
  await settled(page);
  // The week's cards and the summary under them.
  const cards = await page.$$eval('.day .day-cost', (els) => els.map((e) => e.textContent.trim()));
  assert.ok(cards.length >= 5 && cards.every((t) => COST.test(t)), `every planned night shows its cost (${cards.length})`);
  assert.match(await page.textContent('.plan-summary'), /dinners planned(, \d+ nights? away)?: (about )?\$\d+\.\d\d a serving\. \$[\d,]+\.\d\d on the list\./);
  // The dinner picker: every option can be told apart by price before choosing.
  await page.click('.day:not(.is-today):not(.is-past) .day-hit');
  await page.waitForSelector('dialog[open] [data-action="night:pick"]');
  await page.click('dialog[open] [data-action="night:pick"]');
  await page.waitForSelector('dialog[open] .pick-row');
  const picks = await page.$$eval('dialog[open] .pick-row', (els) => els.map((e) => e.querySelector('.pick-cost')?.textContent.trim() || ''));
  assert.ok(picks.length > 20 && picks.every((t) => COST.test(t)), 'every option in the picker has a cost');
  assert.ok(new Set(picks).size > 10, 'and they differ');
  await page.keyboard.press('Escape');
  await settled(page);
  // The recipe box: the line on each card, and "Cheapest first".
  await go(page, '#/recipes', '.page-recipes');
  assert.ok((await page.$$eval('.r-card .r-cost', (els) => els.map((e) => e.textContent.trim()))).every((t) => COST.test(t)));
  if (await page.$('.filters-more:not([open]) > summary')) await page.click('.filters-more > summary');
  assert.ok((await page.$$eval('#rf-sort option', (els) => els.map((e) => e.textContent.trim()))).includes('Sort: Cheapest first'));
  await page.selectOption('#rf-sort', 'cheap');
  await page.waitForFunction(() => document.querySelector('#rf-sort')?.value === 'cheap');
  await page.waitForTimeout(200);
  const prices = await page.$$eval('.r-card .r-cost b', (els) => els.map((e) => Number(e.textContent.replace('$', ''))));
  assert.ok(prices.length > 20 && prices.every((x, i) => i === 0 || x >= prices[i - 1]), `cheapest plate first: ${prices.slice(0, 12).join(', ')}`);
  assert.ok(prices[prices.length - 1] > prices[0] * 1.5, `a real spread: $${prices[0]} to $${prices[prices.length - 1]}`);
  // The recipe: the line at the top, and the list ingredient by ingredient that adds up to it.
  await page.click('.r-card');
  await page.waitForSelector('.page-recipe .recipe-cost');
  const top = (await page.textContent('.page-recipe .recipe-cost')).trim();
  assert.match(top, FULL);
  assert.equal(await page.locator('#recipe-cost[open]').count(), 0, 'the list is folded away until asked for');
  await page.click('#recipe-cost > summary');
  await page.waitForSelector('#recipe-cost[open] .cost-items li');
  const rows = await page.$$eval('#recipe-cost .cost-items li:not(.ci-total)', (els) => els.map((e) => ({ name: e.querySelector('.ci-name').firstChild.textContent.trim(), where: e.querySelector('.ci-name small').textContent, cost: e.querySelector('.ci-cost').textContent })));
  assert.ok(rows.length >= 4 && rows.every((r) => r.name && /Sam’s Club|Jewel-Osco/.test(r.where)), 'each ingredient with its amount and store');
  const sum = rows.reduce((n, r) => n + (Number((r.cost.match(/\$(\d+\.\d\d)/) || [])[1]) || 0), 0);
  const total = Number((await page.textContent('#recipe-cost .ci-total .ci-cost')).replace('$', ''));
  assert.ok(Math.abs(sum - total) <= 0.01 * rows.length, `the lines (${sum.toFixed(2)}) add up to the total (${total})`);
  assert.ok(Math.abs(total - Number(top.match(/\$(\d+\.\d\d) for five/)[1])) < 0.005, 'the same total as the line at the top');
  if (/^about/.test(top)) assert.match(await page.textContent('#recipe-cost'), /Prices marked est\. are estimates until a receipt or a price check replaces them\./);
  assert.ok(await noOverflow(page));
  assert.ok(await page.$eval('#recipe-cost > summary', (el) => el.getBoundingClientRect().height >= 44), 'a 44 px target');
});

test('coupons: Clip Jewel coupons and Sam’s Instant Savings, honestly explained', async () => {
  await go(page, '#/list', '.page-list');
  await listMore(page);
  await page.click('[data-action="list:coupons"][data-store="jewel"]');
  await page.waitForSelector('dialog[open] a[data-coupons="jewel"]');
  assert.match(await page.getAttribute('dialog[open] a[data-coupons="jewel"]', 'href'), /^https:\/\/www\.jewelosco\.com\//);
  assert.match(await page.getAttribute('dialog[open] a[data-coupons="sams"]', 'href'), /^https:\/\/www\.samsclub\.com\//);
  const text = await page.textContent('dialog[open]');
  assert.match(text, /clipped/i);
  assert.match(text, /automatically/i);
  await page.waitForTimeout(350);
  await shot(page, 'e2e-24-coupons');
  await page.keyboard.press('Escape');
  await orderOnline(page); // Copy & open lives in "Order online" (docs/spec/28)
  await page.click('[data-action="list:handoff"][data-store="jewel"]');
  await page.waitForSelector('dialog[open] .hint a[href*="jewelosco"]', { state: 'attached' });
  await page.keyboard.press('Escape');
});

test('thumbs: the family’s one signal, labelled. “Not for us” asks first, keeps tonight, and Undo brings it back; “Loved” just happens', async () => {
  await go(page, '#/plan', '.page-plan');
  await page.locator('.toast-root .toast-x').click({ timeout: 1000 }).catch(() => {});
  await page.click(`[data-action="plan:tap"][data-date="${TODAY}"]`);
  await page.waitForSelector('dialog[open] .night-rate .thumbs-labelled');
  assert.match(await page.textContent('dialog[open] .night-rate'), /Loved\s*Not for us/, 'the thumbs say what they do');
  await page.waitForTimeout(300);
  await shot(page, 'e2e-25-night-thumbs');
  const before = (await familyState(page)).state.plan[TODAY].dinner;
  const later = Object.entries((await familyState(page)).state.plan).filter(([d, e]) => d > TODAY && e?.dinner === before && e.status === 'planned').map(([d]) => d);
  // "Not for us" changes the menu for everyone, so it asks; Keep it changes nothing.
  await page.click('dialog[open] .night-rate [data-action="vote:dinner"][data-value="-1"]');
  await page.waitForSelector('dialog[open] [data-confirm="yes"]');
  assert.match(await page.textContent('dialog[open]'), /off the menu for everyone\?/);
  assert.match(await page.textContent('dialog[open]'), /Tonight stays\./);
  await page.click('dialog[open] [data-confirm="no"]');
  await page.waitForSelector('dialog[open] .night-rate');
  assert.equal((await familyState(page)).state.votes?.[before]?.Family === -1, false, 'Keep it kept it');
  await page.click('dialog[open] .night-rate [data-action="vote:dinner"][data-value="-1"]');
  await page.click('dialog[open] [data-confirm="yes"]');
  await toastMatch(page, /^.+ is marked “not for us”, so it’s off the menu\. .+ takes its place/);
  let s = (await familyState(page)).state;
  assert.deepEqual(s.votes[before], { Family: -1 }, 'one signal for the whole family, no names');
  assert.ok(s.retired[before], 'dropped right away');
  assert.equal(s.plan[TODAY].dinner, before, 'tonight stays as it is: its groceries are bought');
  for (const d of later) assert.notEqual(s.plan[d].dinner, before, `${d}, after tonight, gets the new dinner`);
  await page.click('.toast-root .toast-btn');
  await toastMatch(page, /Undone/);
  s = (await familyState(page)).state;
  assert.equal(s.plan[TODAY].dinner, before);
  assert.ok(!s.retired?.[before] && s.votes?.[before] === undefined);
  // A thumbs up is “loved”: a family favorite, no question asked.
  await page.waitForSelector('dialog[open] .night-rate');
  await settled(page);
  const wasFav = !!(await page.$('dialog[open] .night-rate .thumb-up.is-on'));
  if (wasFav) {
    await page.locator('dialog[open] .night-rate [data-action="vote:dinner"][data-value="1"]').click();
    await toastMatch(page, /back to fine/);
    assert.deepEqual((await familyState(page)).state.votes[before], { Family: 0 });
    await page.waitForSelector('dialog[open] .night-rate .thumb-up:not(.is-on)');
  }
  await waitFor(() => synced(page), { timeout: 3000, step: 50 }).catch(() => {});
  await page.locator('dialog[open] .night-rate [data-action="vote:dinner"][data-value="1"]').click();
  await toastMatch(page, /is a family favorite now/);
  await page.waitForSelector('dialog[open] .night-rate .thumb-up.is-on');
  assert.deepEqual((await familyState(page)).state.votes[before], { Family: 1 });
  // Tapping it again goes back to fine.
  await page.locator('dialog[open] .night-rate [data-action="vote:dinner"][data-value="1"]').click();
  await toastMatch(page, /back to fine/);
  await page.waitForSelector('dialog[open] .night-rate .thumb-up:not(.is-on)');
  if (wasFav) {
    await page.locator('dialog[open] .night-rate [data-action="vote:dinner"][data-value="1"]').click();
    await toastMatch(page, /is a family favorite now/);
  } else {
    await waitFor(async () => (await familyState(page)).state.votes?.[before] === undefined);
  }
  await page.keyboard.press('Escape');
  await settled(page);
});

test('a side’s “Not for us” asks first, then swaps in a similar side everywhere; Restore from Recipes, Not for us', async () => {
  await go(page, '#/tonight', '.page-tonight');
  const dinner = (await familyState(page)).state.plan[TODAY].dinner;
  const sidesBefore = await page.textContent('.hero-sides');
  const subsBefore = JSON.stringify((await familyState(page)).state.substitutions || {});
  await go(page, `#/recipe/${dinner}`, '.page-recipe');
  const side = await page.getAttribute('.recipe-sides [data-action="vote:side"][data-value="-1"]', 'data-id');
  await page.locator(`.recipe-sides [data-action="vote:side"][data-id="${side}"][data-value="-1"]`).click();
  await page.click('dialog[open] [data-confirm="yes"]');
  await toastMatch(page, /is marked “not for us”, so it’s off the menu/);
  let s = (await familyState(page)).state;
  assert.deepEqual(s.sideVotes[side], { Family: -1 });
  assert.equal(JSON.stringify(s.substitutions || {}), subsBefore, 'nothing written to substitutions');
  await go(page, '#/tonight', '.page-tonight');
  await waitFor(async () => (await page.textContent('.hero-sides').catch(() => '')) !== sidesBefore || !(await page.$('.hero-sides')));
  await go(page, '#/recipes', '.page-recipes');
  await page.click('[data-action="rec:tab"][data-tab="out"]');
  await page.waitForSelector(`[data-action="rec:restore-side"][data-id="${side}"]`);
  assert.match(await page.textContent('.dropped-list'), /Not for us/);
  assert.doesNotMatch(await page.textContent('.dropped-list'), /Thumbs down from|Taken out by/, 'nobody is named');
  await shot(page, 'e2e-26-dropped');
  await page.click(`[data-action="rec:restore-side"][data-id="${side}"]`);
  await toastMatch(page, /back on the menu/);
  s = (await familyState(page)).state;
  assert.ok(!Object.values(s.sideVotes?.[side] || {}).includes(-1));
  await page.click('[data-action="rec:tab"][data-tab="rotation"]');
  await go(page, '#/tonight', '.page-tonight');
  assert.equal(await page.textContent('.hero-sides'), sidesBefore, 'the side is back');
});

test('“How was dinner?” shows after it’s cooked and the next morning, then waves off', async () => {
  await go(page, '#/tonight', '.page-tonight');
  assert.equal(await page.locator('.howwas').count(), 0, 'not before dinner is cooked');
  await page.click('[data-action="tonight:cooked"]');
  // One after-dinner question at a time (docs/spec/29): leftovers first, then how it was.
  await page.waitForSelector('.lo-card .lo-ask');
  assert.equal(await page.locator('.howwas').count(), 0, 'not two questions at once');
  await page.click('.lo-card [data-action="leftovers:save"][data-n="0"]');
  await page.waitForSelector('.howwas .rate-row');
  assert.equal(await page.locator('.hero-rate').count(), 0, 'no second set of thumbs on the card above');
  await page.locator('.toast-root .toast-x').click({ timeout: 1000 }).catch(() => {});
  await page.locator('.howwas').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shot(page, 'e2e-27-howwas');
  // The next morning it asks about last night.
  await page.clock.setSystemTime(new Date('2026-11-17T08:15:00-06:00'));
  await page.reload();
  await page.waitForSelector('.howwas');
  assert.match(await page.textContent('.howwas'), /last night \(Monday\)/);
  const sideId = await page.getAttribute('.howwas [data-action="vote:side"][data-value="1"]', 'data-id');
  await page.locator(`.howwas [data-action="vote:side"][data-id="${sideId}"][data-value="1"]`).click();
  await page.waitForSelector(`.howwas [data-action="vote:side"][data-id="${sideId}"].thumb-up.is-on`);
  assert.deepEqual((await familyState(page)).state.sideVotes[sideId], { Family: 1 });
  await page.click('.howwas [data-action="lighter:dismiss"]');
  await waitFor(async () => !(await page.$('.howwas')));
  // Back to Monday evening: still waved off for that night; put tonight back to planned.
  await page.clock.setSystemTime(NOW);
  await page.reload();
  await page.waitForSelector('.page-tonight');
  assert.equal(await page.locator('.howwas').count(), 0, 'waved off stays waved off');
  await page.click('[data-action="night:uncook"]');
  await waitFor(async () => (await familyState(page)).state.plan[TODAY].status === 'planned');
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('receipts: scan → check every line → save; the list shows “paid”, Find it, and My products', async () => {
  await go(page, '#/list', '.page-list');
  await page.locator('.toast-root .toast-x').click({ timeout: 1000 }).catch(() => {});
  await inStore(page);
  // A line for something that's surely on this week's Sam's list.
  const id0 = await page.getAttribute('.store-sams .item:not(.is-checked) .item-more', 'data-key');
  const name0 = await page.getAttribute(`.store-sams .item:has(.item-more[data-key="${id0}"])`, 'data-name');
  const extra = !['chicken', 'cheese'].includes(id0);
  api.db.receiptExtraLines = extra ? [{ text: 'MM ITEM', product: `Member's Mark ${name0}`, brand: "Member's Mark", size: '', qty: 1, unitPrice: 12.34, lineTotal: 12.34, matchId: id0 }] : [];
  await listMore(page); // Scan a receipt is with the cost, under the list
  await page.click('[data-action="rcpt:scan"]');
  await page.waitForSelector('dialog[open] [data-testid="rcpt-files"]');
  await page.click('dialog[open] [data-action="rcpt:store"][data-value="sams"]');
  await page.setInputFiles('dialog[open] [data-testid="rcpt-files"]', path.join(ROOT, 'icons', 'icon-512.png'));
  await page.waitForSelector('dialog[open] .rcpt-thumbs img');
  await page.click('dialog[open] [data-action="rcpt:read"]');
  await page.waitForSelector('dialog[open] .rcpt-line');
  assert.equal((await page.textContent('dialog[open] .read-by')).trim(), 'Read by Claude Opus 5.5');
  const mock = await (await fetch(`${apiBase}/__mock/state`)).json();
  assert.equal(mock.lastReceipt.images, 1);
  assert.equal(mock.lastReceipt.store, 'sams');
  assert.ok(mock.lastReceipt.known > 50, 'sends the catalog so lines come back matched');
  // The tortillas line had no match from the scanner; the review suggests one, in words with Fix (gauntlet r5).
  assert.match(await page.textContent('dialog[open] .rcpt-line:nth-child(3)'), /Probably /);
  assert.match(await page.textContent('dialog[open] .rcpt-headline'), /Sam's Club · Nov 15 · \$/, 'store, date and total as one line');
  await page.click('dialog[open] .rcpt-line:nth-child(3) [data-action="rcpt:open"]');
  const tortSel = await page.$eval('dialog[open] .rcpt-line:nth-child(3) select', (el) => el.value);
  assert.ok(tortSel, 'a suggested match for the tortillas');
  // Paper towels: not on our list, still counted.
  assert.equal(await page.$eval('dialog[open] .rcpt-line:nth-child(4) select', (el) => el.value), '');
  assert.match(await page.textContent('dialog[open] .rcpt-check'), /Receipt total/);
  await page.waitForTimeout(500);
  await shot(page, 'e2e-28-receipt-review');
  await page.click('dialog[open] [data-action="rcpt:save"]');
  await toastMatch(page, /^Saved \$[\d.,]+ from Sam's Club, Nov 15\. Learned \d+ prices/);
  const s = (await familyState(page)).state;
  const rid = Object.keys(s.receiptLog)[0];
  assert.match(rid, /^sams-2026-11-15-\d+$/);
  assert.equal(s.myProducts['sams/chicken'].price, 19.43);
  assert.equal(s.myProducts['sams/chicken'].packSize, 6.5);
  assert.equal(s.myProducts['sams/cheese'].price, 7.48, 'paid per pack after the $2 off');
  assert.ok(s.receipts.some((r) => r.receiptId === rid), 'counted once in the Budget');
  await waitFor(async () => (await familyState(page)).pending === 0 && (await page.$('.topbar')) && !(await page.$('.topbar .sync')));
  // The list: the product, "paid $… · Nov 15", and Find it for that exact product.
  await go(page, '#/list', '.page-list');
  // The receipt is still syncing; its answer redraws the list once. Let that pass before holding on to a row.
  await waitFor(async () => (await familyState(page)).pending === 0);
  await page.waitForTimeout(150);
  // The receipt's pack is in the pantry now. When that one pack covers the week, the item leaves the
  // list (which dinners are planned decides that), so the family "uses it up" and the list asks again.
  if (!(await page.locator(`.item-main[data-key="${id0}"]`).count())) {
    await go(page, '#/pantry', '.page-pantry');
    await page.fill(`#pan-${id0} .qty-input`, '0');
    await page.dispatchEvent(`#pan-${id0} .qty-input`, 'change');
    await waitFor(async () => (await familyState(page)).state.pantry[id0].qty === 0);
    await go(page, '#/list', '.page-list');
  }
  const row = page.locator(`.item:has(.item-more[data-key="${id0}"])`);
  await row.waitFor();
  const expectName = extra ? `Member's Mark ${name0}` : id0 === 'chicken' ? "Member's Mark Boneless Skinless Chicken Breasts" : "Member's Mark Shredded Mild Cheddar";
  // The row names the product the receipt says the family buys (docs/spec/29); the sheet has where the price came from.
  await waitFor(async () => ((await row.locator('.item-product').textContent().catch(() => '')) || '').trim().startsWith(expectName.slice(0, 20)));
  await waitFor(() => row.scrollIntoViewIfNeeded().then(() => true, () => false)); // a sync can redraw the list mid-scroll; try again
  await shot(page, 'e2e-29-list-paid');
  await openItem(page, `.item-more[data-key="${id0}"]`);
  assert.match(await page.textContent('dialog[open] .item-fix'), /Paid on your Nov 15 receipt/);
  assert.match(await page.getAttribute('dialog[open] a[data-findit]', 'href'), /^https:\/\/www\.samsclub\.com\//);
  await page.keyboard.press('Escape');
  await settled(page);
  // Order online: Sam's rows open the exact product (docs/spec/29: no whole-list copy for Sam's).
  await orderOnline(page);
  assert.ok(await page.$(`.store-sams .item:has(.item-more[data-key="${id0}"]) .order-it`));
  await inStore(page);
  // My products: the receipt filled it in; Change opens the picker.
  await go(page, '#/products', '.page-products');
  assert.match(await page.textContent('.product-row.is-mine'), /Paid \$[\d.]+ on Nov 15/);
  await page.click('.product-row.is-mine [data-action="prod:pick"]');
  await page.waitForSelector('dialog[open] .current-product');
  assert.match(await page.getAttribute('dialog[open] .current-product a', 'href'), /^https:\/\/www\.samsclub\.com\//);
  await page.keyboard.press('Escape');
  await shot(page, 'e2e-30-my-products');
  // Budget lists it with its lines; scanning the same receipt again doesn't double count.
  await go(page, '#/budget', '.page-budget');
  await page.click('.rcpt-card summary');
  await page.waitForSelector('.rcpt-card[open] .rcpt-history-lines li');
  await page.click('[data-action="rcpt:scan"]');
  await page.setInputFiles('dialog[open] [data-testid="rcpt-files"]', path.join(ROOT, 'icons', 'icon-192.png'));
  api.db.claude.keySet = false; // no Claude key: the free scanner reads it, and the sheet says so
  await page.click('dialog[open] [data-action="rcpt:read"]');
  await page.waitForSelector('dialog[open] .hint-warn');
  assert.equal((await page.textContent('dialog[open] .read-by')).trim(), 'Read by the free scanner');
  api.db.claude.keySet = true;
  assert.equal(await page.getAttribute('dialog[open] [data-action="rcpt:save"]', 'disabled'), '');
  await page.keyboard.press('Escape');
  api.db.receiptExtraLines = [];
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('receipts: the console import helper runs past purchases through the same path, deduped', async () => {
  await go(page, '#/budget', '.page-budget');
  const r = await page.evaluate(() => window.bfdp.importReceipts([
    { store: 'jewel', date: '2026-11-02', total: 23.5, lines: [{ product: 'Signature Select Shredded Cheddar', size: '8 oz', qty: 2, lineTotal: 7.98, matchId: 'cheese' }] },
    { store: 'jewel', date: '2026-11-02', total: 23.5, lines: [] },
  ]));
  assert.deepEqual([r.receipts, r.lines, r.matched, r.productsSet, r.skippedDuplicates, r.saved], [1, 1, 1, 1, 1, true]);
  const dry = await page.evaluate(() => window.bfdp.importReceipts([{ store: 'jewel', date: '2026-11-02', total: 23.5 }], { dryRun: true }));
  assert.deepEqual([dry.skippedDuplicates, dry.saved], [1, false]);
  const s = (await familyState(page)).state;
  assert.equal(s.myProducts['jewel/cheese'].price, 3.99);
  assert.equal(s.myProducts['jewel/cheese'].packSize, 8);
  await waitFor(async () => (await (await fetch(`${apiBase}/__mock/state`)).json()).state.receiptLog?.['jewel-2026-11-02-2350']);
});

test('two-tap swap on the planner trades two nights', async () => {
  const { state } = await familyState(page);
  const a = state.plan['2026-11-21'].dinner;
  const b = state.plan['2026-11-22'].dinner;
  await go(page, '#/plan', '.page-plan');
  await page.click('[data-action="plan:more"]');
  await page.click('dialog[open] [data-action="plan:swapmode"]');
  await page.click('[data-action="plan:tap"][data-date="2026-11-21"]');
  await page.waitForSelector('.day.is-picked');
  await page.click('[data-action="plan:tap"][data-date="2026-11-22"]');
  await toastMatch(page, /Swapped|moved/);
  const s = (await familyState(page)).state;
  assert.equal(s.plan['2026-11-21'].dinner, b);
  assert.equal(s.plan['2026-11-22'].dinner, a);
});

test('plan ahead (SPEC §16): two weeks, pantry first, a result card, then the list for that stretch', async () => {
  // Candi's phone fills in the freezer: thighs from early September, a steak and corn from October.
  const key = await page.evaluate(() => JSON.parse(localStorage.getItem('bfdp.v2.device')).key);
  const item = (qty, since, extra = {}) => ({ qty, stocked: false, since, at: `${since}T18:00:00.000Z`, by: 'Candi', ...extra });
  const seed = Object.entries({
    chickenThighs: item(9, '2026-09-03'), eyeRoundSteak: item(2.5, '2026-10-20'), cornCobs: item(10, '2026-10-20'),
    tikka: item(30, '2026-11-02'), basmati: item(8, '2026-11-02'), naan: item(10, '2026-11-14'), butter: item(16, '2026-11-14'),
    // 10 lb: tonight's dinner (picked by an earlier test) may be one with smashed potatoes, and a kept night's
    // food is set aside before the pantry nights are chosen (SPEC §21.1).
    potatoes: item(10, '2026-11-14'), milk: item(8, '2026-11-14'),
    turmeric: { qty: null, stocked: true, by: 'Candi', at: '2026-11-02T18:00:00.000Z' }, cajunSeasoning: { qty: null, stocked: true, by: 'Candi', at: '2026-11-02T18:00:00.000Z' }, soy: { qty: null, stocked: true, by: 'Candi', at: '2026-11-02T18:00:00.000Z' },
  }).map(([id, value]) => ({ op: 'set', path: ['pantry', id], value }));
  const sent = await fetch(`${apiBase}/api/ops`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Family-Key': key }, body: JSON.stringify({ ops: seed, by: 'Candi', clientId: 'e2e-candi', batchId: 'freezer' }) });
  assert.equal(sent.status, 200);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await waitFor(async () => (await familyState(page)).state.pantry?.eyeRoundSteak?.qty === 2.5);

  await go(page, '#/plan', '.page-plan');
  await page.locator('.toast-root .toast-x').click({ timeout: 1000 }).catch(() => {});
  await page.click('[data-action="ahead:open"]');
  await page.waitForSelector('dialog[open] [data-action="ahead:go"]');
  const end = '2026-11-29';
  await page.click(`dialog[open] [data-action="ahead:quick"][data-end="${end}"]`);
  await page.waitForSelector(`dialog[open] [data-action="ahead:quick"][data-end="${end}"][aria-pressed="true"]`);
  assert.equal(await page.inputValue('dialog[open] #ahead-end'), end, 'the 2-week chip sets the last night');
  assert.equal(await page.getAttribute('dialog[open] [data-action="ahead:pantry"]', 'aria-checked'), 'true', '“Use what we have first” is on by default');
  assert.equal(await page.getAttribute('dialog[open] #ahead-end', 'max'), '2026-12-17', 'no more than a month out');
  await page.waitForTimeout(400);
  await shot(page, 'e2e-31-plan-ahead-sheet');
  await page.click('dialog[open] [data-action="ahead:go"]');
  await toastMatch(page, /^Planned \d+ dinners? through Sunday, Nov 29\./);
  await page.waitForSelector('#ahead-card');
  const s = (await familyState(page)).state;
  for (let d = 23; d <= 29; d++) assert.ok(s.plan[`2026-11-${d}`]?.dinner, `Nov ${d} is planned`);
  // SPEC §21.1: the planner's own nights are re-planned too, so the thighs may get a night this week.
  // (Which dinner that is depends on the recipe box; any dinner made with chicken thighs will do.)
  const withThighs = new Set(JSON.parse(readFileSync(path.join(ROOT, 'data/recipes.json'), 'utf8')).dinners.filter((d) => d.items?.chickenThighs).map((d) => d.id));
  const thighNight = Object.entries(s.plan).find(([d, e]) => d > TODAY && d <= end && withThighs.has(e.dinner));
  assert.ok(thighNight, 'the September chicken thighs get a night');
  const card = await page.textContent('#ahead-card');
  assert.match(card, /Your pantry covers \d+ dinners?/);
  assert.match(card, /Uses up the boneless skinless chicken thighs from Sep 3/);
  assert.match(card, /Still needs groceries/);
  assert.ok(!/\bNaN\b|undefined|\bnull\b/.test(card));
  assert.ok(await noOverflow(page), 'the card fits 390px');
  await page.locator('.toast-root .toast-x').click({ timeout: 1000 }).catch(() => {});
  await page.evaluate(() => { const el = document.getElementById('ahead-card'); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 84); });
  await page.waitForTimeout(400);
  await shot(page, 'e2e-32-plan-ahead-result');
  await page.locator('#ahead-card').screenshot({ path: path.join(SHOTS, 'e2e-32b-plan-ahead-card.png'), style: '.topbar, .tabbar { visibility: hidden !important; }' });
  // Desktop: everything is planned now, so it just shows how far the pantry goes.
  const desk = await newPage(ctx, DESKTOP);
  await go(desk, '#/plan', '.page-plan');
  await desk.click('[data-action="ahead:open"]');
  await desk.click(`dialog[open] [data-action="ahead:quick"][data-end="${end}"]`);
  await desk.click('dialog[open] [data-action="ahead:go"]');
  await desk.waitForSelector('#ahead-card');
  await toastMatch(desk, /Every night through Sunday, Nov 29 is already planned/);
  assert.ok(await noOverflow(desk));
  await desk.locator('.toast-root .toast-x').click({ timeout: 1000 }).catch(() => {});
  await desk.evaluate(() => { const el = document.getElementById('ahead-card'); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 140); });
  await desk.waitForTimeout(400);
  await shot(desk, 'e2e-33-plan-ahead-result-1280');
  await desk.close();
  // The pantry page says how far the pantry carries the plan when it covers tonight.
  await go(page, '#/pantry', '.page-pantry');
  assert.ok(await page.$('.use-first, .pan-place'), 'the pantry shows what to use first and the shelves');
  // See the shopping list: the plain list for the nights it planned, tonight through Nov 29, and no
  // trip nobody started (gauntlet r5).
  await go(page, '#/plan', '.page-plan');
  await page.waitForSelector('#ahead-card');
  await page.click('[data-action="ahead:list"]');
  await page.waitForSelector('.page-list [data-action="list:span-clear"]');
  assert.equal(await page.locator('.page-list .trip-bar').count(), 0, 'no trip bar');
  assert.equal((await familyState(page)).state.settings?.trip, undefined, 'no trip started');
  assert.match(await page.textContent('.page-list .period-label'), /Nov 16 – 29/);
  assert.ok(await noOverflow(page));
  await page.waitForTimeout(400);
  await shot(page, 'e2e-34-plan-ahead-list');
  await page.click('[data-action="list:span-clear"]'); // back to the week for the tests that follow
  await page.waitForSelector('.page-list [data-action="list:span-clear"]', { state: 'detached' });
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('Claude in settings: the model and this month’s spend, a model switch, and the connector link', async () => {
  await go(page, '#/family', '.page-family');
  await page.locator('.toast-root .toast-x').click({ timeout: 1000 }).catch(() => {});
  // House rules come first; Claude waits under Advanced (docs/spec/29).
  assert.ok(!(await page.isVisible('.claude-card')), 'folded away until asked for');
  await page.click('.set-advanced > summary');
  await page.waitForSelector('.claude-card .ai-spend');
  assert.match(await page.textContent('.claude-card .ai-status'), /^Claude Opus 5\.5 reads your photos$/);
  assert.match(await page.textContent('.claude-card .ai-spend'), /\$1\.20 of \$5\.00/);
  assert.match(await page.textContent('.claude-card .seg-ai [data-value="claude-opus-5-5"]'), /About 2–6¢ a photo/); // the first photo of a scan stores the list (6¢ at the Worker's prices, which the mock shares), the rest read it back (2¢)
  assert.match(await page.textContent('.claude-card .seg-ai [data-value="claude-haiku-5-5"]'), /Under 1¢ a photo/);
  await page.click('[data-action="ai:model"][data-value="claude-sonnet-5-5"]');
  await toastMatch(page, /^Claude Sonnet 5\.5 reads your photos and suggests dinners from now on/);
  assert.equal((await familyState(page)).state.settings.aiModel, 'claude-sonnet-5-5');
  await waitFor(async () => /^Claude Sonnet 5\.5 reads your photos$/.test(await page.textContent('.claude-card .ai-status')));
  assert.equal(await page.getAttribute('[data-action="ai:model"][data-value="claude-sonnet-5-5"]', 'aria-checked'), 'true');
  await waitFor(async () => (await (await fetch(`${apiBase}/__mock/state`)).json()).state.settings?.aiModel === 'claude-sonnet-5-5');
  // Connect your Claude chats: the private link, how to add it, Copy, and a new link.
  await page.click('[data-action="ai:link"]');
  await page.waitForSelector('#ai-link');
  const link = await page.inputValue('#ai-link');
  let mock = await (await fetch(`${apiBase}/__mock/state`)).json();
  assert.ok(link.endsWith(`/mcp/${mock.mcpToken}`), link);
  const steps = await page.textContent('.ai-connect');
  assert.match(steps, /Settings.*Connectors.*Add custom connector/s);
  assert.match(steps, /Bilbrey Dinner Planner/);
  assert.match(steps, /Here’s our fridge — update the pantry/);
  await page.click('[data-action="ai:copy"]');
  await toastMatch(page, /Link copied/);
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), link);
  await page.locator('.toast-root .toast-x').click({ timeout: 1000 }).catch(() => {});
  await page.waitForTimeout(350);
  await page.locator('.claude-card').screenshot({ path: path.join(SHOTS, 'e2e-31-claude-card.png') });
  await page.click('[data-action="ai:rotate"]');
  await page.click('dialog[open] [data-confirm="yes"]');
  await toastMatch(page, /New link ready/);
  await waitFor(async () => (await page.inputValue('#ai-link')) !== link);
  const link2 = await page.inputValue('#ai-link');
  mock = await (await fetch(`${apiBase}/__mock/state`)).json();
  assert.notEqual(link2, link, 'the old link is replaced');
  assert.ok(link2.endsWith(`/mcp/${mock.mcpToken}`));
  // Back to Opus for the rest of the run.
  await page.click('[data-action="ai:model"][data-value="claude-opus-5-5"]');
  await waitFor(async () => (await familyState(page)).state.settings.aiModel === 'claude-opus-5-5');
  assert.ok(await noOverflow(page));
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('What can I make? a photo and a note → ideas → Make it tonight; its missing items land on the list', async () => {
  const before = (await familyState(page)).state;
  assert.ok(before.plan[TODAY]?.dinner, 'tonight already has a dinner');
  // What can I make? is under More on the Plan (docs/spec/29).
  await go(page, '#/plan', '.page-plan');
  await page.locator('.toast-root .toast-x').click({ timeout: 1000 }).catch(() => {});
  await page.click('[data-action="plan:more"]');
  await page.click('dialog[open] [data-action="ideas:open"]');
  await page.waitForSelector('dialog[open] [data-testid="ideas-files"]');
  await page.setInputFiles('dialog[open] [data-testid="ideas-files"]', path.join(ROOT, 'icons', 'icon-512.png'));
  await page.waitForSelector('dialog[open] .idea-thumbs img');
  await page.fill('dialog[open] #idea-note', 'use the chicken first');
  await page.waitForTimeout(400);
  await shot(page, 'e2e-32-ideas-pick');
  await page.click('dialog[open] [data-action="ideas:go"]');
  await page.waitForSelector('dialog[open] .idea-card', { timeout: 20000 });
  const mock = await (await fetch(`${apiBase}/__mock/state`)).json();
  assert.equal(mock.lastIdeas.images, 1);
  assert.equal(mock.lastIdeas.note, 'use the chicken first');
  assert.equal(mock.lastIdeas.detail, true, 'the app asks for timed steps, tips and the two times');
  assert.ok(mock.lastIdeas.pantry > 3, 'the pantry goes along');
  assert.ok(mock.lastIdeas.sides > 20 && mock.lastIdeas.catalog > 100, 'with the sides and the catalog');
  assert.equal((await page.$$('dialog[open] .idea-card')).length, 2, 'the seafood idea is never shown');
  assert.match(await page.textContent('dialog[open] .read-by'), /^Ideas from Claude Opus 5\.5, from your photo and the pantry$/);
  const card = page.locator('dialog[open] .idea-card').first();
  const title = (await card.locator('.idea-title').textContent()).trim();
  const cardText = await card.textContent();
  assert.match(cardText, /You’d need:.*fresh basil/i);
  assert.match(cardText, /min · Stovetop/);
  assert.doesNotMatch(cardText, /undefined|NaN|null/);
  assert.equal(await page.evaluate(() => document.querySelector('dialog[open] .sheet-body').scrollWidth <= document.querySelector('dialog[open] .sheet-body').clientWidth), true, 'no sideways scroll in the sheet');
  await page.waitForTimeout(400);
  await shot(page, 'e2e-33-ideas');
  await card.locator('[data-action="ideas:tonight"]').click();
  // Tonight already has a dinner: it asks first.
  await page.waitForSelector('dialog[open] [data-action="ideas:replace"]');
  await page.waitForTimeout(300);
  await shot(page, 'e2e-34-ideas-replace');
  await page.click('dialog[open] [data-action="ideas:replace"]:not([data-move])');
  await toastMatch(page, new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} is on for tonight\\. It replaces .+\\. The list has the \\d things it needs\\.$`));
  let s = (await familyState(page)).state;
  const id = s.plan[TODAY].dinner;
  assert.ok(s.customDinners?.[id], 'tonight is a family-made dinner');
  assert.equal(s.customDinners[id].title, title);
  assert.equal(s.customDinners[id].rotation, 'bench', 'a one-off stays out of the rotation');
  assert.equal(s.customDinners[id].prepMinutes, 10, 'hands-on time is saved for the recipe page');
  assert.equal(s.customDinners[id].cookMinutes, 20);
  assert.deepEqual(s.customDinners[id].stepDetails[1], { text: s.customDinners[id].steps[1], minutes: 12, setting: 'medium-high' }, 'timed steps are saved beside the plain sentences');
  assert.equal(s.customDinners[id].tips.length, 1);
  assert.equal(s.plan[TODAY].manual, true);
  assert.equal(s.plan[TODAY].by, 'Family');
  assert.ok(Object.values(s.custom || {}).some((c) => c.name === 'Fresh basil'), 'the unmatched basil is a shelf item');
  await page.waitForSelector('dialog[open] .idea-card .badge-plan');
  // The second idea goes on a night next month, then in the recipe box.
  await page.locator('dialog[open] .idea-card').nth(1).locator('[data-action="ideas:night"]').click();
  await page.waitForSelector('dialog[open] .move-list');
  assert.equal((await page.$$('dialog[open] [data-action="ideas:pick-night"]')).length, 31, 'tonight and the next 30 nights');
  await page.waitForTimeout(300);
  await shot(page, 'e2e-35-ideas-night');
  await page.click('dialog[open] [data-action="ideas:pick-night"][data-date="2026-12-01"]');
  await toastMatch(page, /is on for Tuesday, Dec 1\./);
  s = (await familyState(page)).state;
  const id2 = s.plan['2026-12-01'].dinner;
  assert.equal(s.customDinners[id2].rotation, 'bench');
  await page.waitForSelector('dialog[open] .idea-card:nth-of-type(2) .badge-plan');
  await page.locator('dialog[open] .idea-card').nth(1).locator('[data-action="ideas:box"]').click();
  await toastMatch(page, /is in the recipe box and joins the rotation/);
  s = (await familyState(page)).state;
  assert.equal(s.customDinners[id2].rotation, 'core', 'the same dinner, now in the rotation');
  assert.equal(Object.keys(s.customDinners).length, 2, 'no duplicates');
  await page.waitForSelector('dialog[open] .idea-card .badge-fav');
  await page.waitForTimeout(300);
  await shot(page, 'e2e-36-ideas-saved');
  await page.keyboard.press('Escape');
  // What it needs is on the list.
  const names = await listNames(page);
  assert.ok(names.some((n) => /fresh basil/i.test(n)), `the basil is on the list (${names.join(', ')})`);
  assert.ok(names.some((n) => /lemon/i.test(n)), 'and the lemons');
  await go(page, '#/tonight', '.page-tonight');
  assert.equal((await page.textContent('.hero-title')).trim(), title);
  await go(page, '#/plan', '.page-plan');
  assert.ok(await page.$('.plan-actions [data-action="plan:more"]'), 'Plan has More, where What can I make? lives');
  await waitFor(async () => (await (await fetch(`${apiBase}/__mock/state`)).json()).state.customDinners?.[id]);
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('offline: changes are saved on the device and sync when the connection returns', async () => {
  const { state } = await familyState(page);
  const d = state.plan[TODAY].dinner;
  await page.route(`${apiBase}/**`, (r) => r.abort());
  await go(page, `#/recipe/${d}`, '.page-recipe');
  const want = (await page.$('.page-recipe [data-action="vote:dinner"][data-value="1"].is-on')) ? 0 : 1; // already a favorite → the tap says “fine”
  await page.click('[data-action="vote:dinner"][data-value="1"]');
  await waitFor(async () => (await familyState(page)).pending > 0);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await waitFor(async () => /Saved here|Offline/.test(await page.textContent('.topbar .sync')));
  await shot(page, 'e2e-12-offline');
  assert.equal((await familyState(page)).state.votes[d].Family, want, 'the family’s signal shows right away');
  let server = await (await fetch(`${apiBase}/__mock/state`)).json();
  assert.notEqual(server.state.votes?.[d]?.Family, want, 'the server has not seen it yet');
  await page.unroute(`${apiBase}/**`);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await waitFor(async () => (await familyState(page)).pending === 0, { timeout: 15000 });
  server = await (await fetch(`${apiBase}/__mock/state`)).json();
  assert.equal(server.state.votes[d].Family, want, 'the queued change reached the family');
  await waitFor(async () => (await page.$('.topbar')) && !(await page.$('.topbar .sync')));
});

test('a whole trip comes home in one tap', async () => {
  await go(page, '#/plan', '.page-plan');
  await page.click('[data-action="plan:tap"][data-date="2026-11-19"]');
  await page.click('dialog[open] [data-action="night:away"]');
  await page.click('dialog[open] .away-more > summary');
  await page.click('dialog[open] [data-away-mode="range"]');
  await page.fill('dialog[open] input[name="from"]', '2026-11-19');
  await page.fill('dialog[open] input[name="to"]', '2026-11-21');
  await page.click('dialog[open] .chip-radio:has(input[value="Out of town"])');
  await page.click('dialog[open] form[data-submit="away:save"] button[type=submit]');
  await toastMatch(page, /3 nights/);
  await page.click('[data-action="plan:tap"][data-date="2026-11-20"]');
  await page.click('dialog[open] [data-action="night:back-trip"]');
  await toastMatch(page, /3 nights are back/);
  const s = (await familyState(page)).state;
  for (const d of ['2026-11-19', '2026-11-20', '2026-11-21']) assert.notEqual(s.plan[d]?.status, 'away', `${d} is home`);
});

test('cook mode: one big step at a time, mark cooked, then the leftovers question', async () => {
  // The full flow (timers, swipe, keys, resume, leftover nights) is in tests/e2e/cook-e2e.mjs.
  await go(page, `#/cook/${TODAY}`, '.cook.is-ready');
  await page.click('#cook-next');
  await page.waitForSelector('.cook.is-step .cook-step-text');
  await page.click('[data-action="cook:steps"]');
  await page.waitForSelector('dialog[open] .cook-step');
  const n = (await page.$$('dialog[open] .cook-step')).length;
  assert.ok(n >= 3, 'entrée and side steps');
  await page.click(`dialog[open] .cook-step >> nth=${n - 1}`);
  await waitFor(async () => (await page.textContent('.cook-title')).includes(`Step ${n} of ${n}`));
  await shot(page, 'e2e-13-cook');
  await page.click('#cook-next');
  await page.waitForSelector('.cook.is-finish');
  await page.click('[data-action="cook:done"]');
  await page.waitForSelector('.cook-finish .lo-ask');
  assert.equal((await familyState(page)).state.plan[TODAY].status, 'cooked');
  await page.click('.cook-finish [data-action="leftovers:save"][data-n="0"]');
  await page.waitForSelector('.page-tonight');
  assert.equal((await familyState(page)).state.leftovers[TODAY].saved, 0);
  await page.waitForSelector('.kicker-done');
});

test('a second phone joins with the passcode and sees the same tonight', async () => {
  const jeffTitle = (await page.textContent('.hero-title')).trim();
  await waitFor(async () => (await familyState(page)).pending === 0);
  const ctx2 = await browser.newContext({ deviceScaleFactor: 2, serviceWorkers: 'block' });
  const p2 = await newPage(ctx2);
  await p2.goto(`${base}?api=${encodeURIComponent(apiBase)}`);
  // A new device needs only the passcode: nobody picks who they are.
  await p2.waitForSelector('#pc-enter');
  assert.equal(await p2.locator('.who-pick').count(), 0);
  assert.match(await p2.textContent('.gate-title'), /Enter the family passcode/);
  assert.ok(await noOverflow(p2));
  await shot(p2, 'e2e-14a-join-passcode');
  await p2.fill('#pc-enter', 'wrong one');
  await p2.click('form[data-submit="fam:enter"] button[type=submit]');
  await p2.waitForSelector('.form-error');
  // A wrong passcode: said next to the box, the box is marked, and what was typed is still there to fix.
  assert.match(await p2.textContent('.form-error'), /doesn.t match/);
  assert.equal(await p2.getAttribute('#pc-enter', 'aria-invalid'), 'true');
  assert.equal(await p2.inputValue('#pc-enter'), 'wrong one');
  await p2.click('[data-action="fam:show-pass"]');
  await p2.waitForSelector('#pc-enter[type=text]');
  assert.equal(await p2.inputValue('#pc-enter'), 'wrong one', 'now readable, to spot the slip');
  await shot(p2, 'e2e-14b-wrong-passcode');
  // The browser logs the expected 401 for the wrong passcode; that's not an app error.
  for (let i = errors.length - 1; i >= 0; i--) if (/status of 401/.test(errors[i])) errors.splice(i, 1);
  await p2.fill('#pc-enter', 'TACOS TUESDAY');
  await p2.click('form[data-submit="fam:enter"] button[type=submit]');
  await p2.waitForSelector('.page-tonight');
  await p2.waitForSelector('.hero-title');
  assert.equal((await p2.textContent('.hero-title')).trim(), jeffTitle);
  await shot(p2, 'e2e-14-second-phone');
  await ctx2.close();
  assert.equal(errors.length, 0, errors.join('\n'));
});

// ---------------------------------------------------------------- one shared profile (docs/spec/20)

test('shared profile: a device that used to be “Candi’s phone” opens straight into the plan, and old per-person votes read as one family voice', async () => {
  await waitFor(async () => (await familyState(page)).pending === 0);
  const key = await page.evaluate(() => JSON.parse(localStorage.getItem('bfdp.v2.device')).key);
  const { state } = await familyState(page);
  const planned = new Set(Object.values(state.plan || {}).map((e) => e?.dinner));
  await go(page, '#/recipes', '.page-recipes');
  const ids = await page.$$eval('.r-card', (els) => els.filter((e) => !e.querySelector('.r-fav')).map((e) => e.getAttribute('href').replace('#/recipe/', '')));
  const [liked, dropped] = ids.filter((id) => !planned.has(id) && !state.votes?.[id] && !state.retired?.[id]);
  assert.ok(liked && dropped, 'two ordinary dinners to vote on');
  // What an older copy of the app saved: each person's own thumbs.
  const seed = [{ op: 'set', path: ['votes', liked], value: { Jeff: 1, Candi: 1 } }, { op: 'set', path: ['votes', dropped], value: { Jeff: 1, Knox: -1 } }];
  const sent = await fetch(`${apiBase}/api/ops`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Family-Key': key }, body: JSON.stringify({ ops: seed, by: 'Knox', clientId: 'e2e-old-phone', batchId: 'old-votes' }) });
  assert.equal(sent.status, 200);
  const old = await browser.newContext({ deviceScaleFactor: 2, serviceWorkers: 'block' });
  const p = await newPage(old);
  await p.addInitScript(([api, k]) => {
    if (localStorage.getItem('bfdp.v2.device')) return;
    localStorage.setItem('bfdp.apiBase', api);
    localStorage.setItem('bfdp.v2.device', JSON.stringify({ who: 'Candi', key: k, clientId: 'c-old-candi', theme: 'auto' }));
  }, [apiBase, key]);
  await p.goto(`${base}#/tonight`);
  await p.waitForSelector('.page-tonight');
  assert.equal(await p.locator('.gate').count(), 0, 'no first-open screen, nothing to migrate');
  await waitFor(async () => (await p.$('.topbar')) && !(await p.$('.topbar .sync')));
  // Her "today" line is still hers on this device; nothing else on screen belongs to a person.
  await p.waitForSelector('.today-nutri');
  assert.match(await p.textContent('.today-nutri'), /Today for Candi/);
  assert.equal(await p.locator('.rail-who, .who-btn').count(), 0);
  // Two thumbs-up → loved, a family favorite.
  await go(p, `#/recipe/${liked}`, '.page-recipe');
  await p.waitForSelector('.votes [data-action="vote:dinner"][data-value="1"].is-on');
  assert.ok(await p.$('.page-recipe .badge-fav'), 'shown as a family favorite');
  assert.equal(await p.locator('.vote-person').count(), 0, 'no row of five people voting');
  assert.doesNotMatch(await p.textContent('.votes'), /Voting as|Jeff|Candi|Knox|Jordan|Jackson/);
  await p.locator('.votes').scrollIntoViewIfNeeded();
  await shot(p, 'e2e-p8-recipe-family-signal');
  // Anyone's thumbs-down → not for us, with nobody named.
  await go(p, `#/recipe/${dropped}`, '.page-recipe');
  await p.waitForSelector('.votes [data-action="vote:dinner"][data-value="-1"].is-on');
  assert.match(await p.textContent('.badge-out'), /^\s*Not for us\s*$/);
  // The family takes it back with one tap: the whole old record is replaced, so Jeff's old thumbs-up doesn't make it "loved".
  await p.click('.votes [data-action="vote:dinner"][data-value="-1"]');
  await toastMatch(p, /is back on the menu\.$/);
  await waitFor(async () => (await familyState(p)).pending === 0);
  let server = (await (await fetch(`${apiBase}/__mock/state`)).json()).state;
  assert.equal(server.votes[dropped], undefined);
  assert.equal(await p.locator('.votes .vote-btn.is-on').count(), 0, 'fine: neither thumb');
  // Put the other one back to fine too, and leave the family's data as it was.
  await go(p, `#/recipe/${liked}`, '.page-recipe');
  await p.click('.votes [data-action="vote:dinner"][data-value="1"]');
  await toastMatch(p, /back to fine/);
  await waitFor(async () => (await familyState(p)).pending === 0);
  server = (await (await fetch(`${apiBase}/__mock/state`)).json()).state;
  assert.equal(server.votes[liked], undefined);
  await old.close();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await waitFor(async () => { const s = (await familyState(page)).state; return !s.votes?.[liked] && !s.votes?.[dropped]; });
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('lunches for whoever packs: add a person (name, spots, items), the list follows; pause; remove; Undo', async () => {
  const before = await lunchCost(page);
  await go(page, '#/lunch', '.page-lunch');
  await page.locator('.toast-root .toast-x').click({ timeout: 1000 }).catch(() => {});
  await page.click('.page-lunch [data-action="lunch:add"]');
  await page.waitForSelector('dialog[open] #lunch-add-name');
  // A name that's already packing is turned down, in words.
  await page.fill('#lunch-add-name', 'jeff');
  await page.click('dialog[open] form[data-submit="lunch:add-save"] button[type=submit]');
  await page.waitForSelector('dialog[open] .form-error');
  assert.match(await page.textContent('dialog[open] .form-error'), /Jeff already packs a lunch/);
  await page.fill('#lunch-add-name', 'Candi');
  // Main and Drink to start with; add Snack as a spot she packs.
  assert.deepEqual(await page.$$eval('dialog[open] [data-action="lunch:add-slot"][aria-pressed="true"]', (els) => els.map((e) => e.dataset.slot)), ['main', 'drink']);
  await page.click('dialog[open] [data-action="lunch:add-slot"][data-slot="snack"]');
  await page.waitForSelector('dialog[open] .ed-item[data-slot="snack"]');
  const pick = {};
  for (const slot of ['main', 'snack', 'drink']) {
    pick[slot] = await page.getAttribute(`dialog[open] .ed-item[data-slot="${slot}"]`, 'data-id');
    await page.locator(`dialog[open] .ed-item[data-slot="${slot}"][data-id="${pick[slot]}"]`).click();
    await page.waitForSelector(`dialog[open] .ed-item[data-id="${pick[slot]}"][aria-pressed="true"]`);
  }
  assert.equal(await page.inputValue('#lunch-add-name'), 'Candi', 'the name survives the sheet redrawing');
  assert.match(await page.textContent('dialog[open] form[data-submit="lunch:add-save"] button[type=submit]'), /Add Candi with 3 items/);
  await page.locator('dialog[open] .sheet-body').evaluate((el) => { el.scrollTop = 0; });
  await page.waitForTimeout(300);
  await shot(page, 'e2e-p1-lunch-add-person');
  await page.click('dialog[open] form[data-submit="lunch:add-save"] button[type=submit]');
  await toastMatch(page, /Candi’s lunches are planned/);
  let s = (await familyState(page)).state;
  assert.deepEqual(s.lunch.people.Candi, { enabled: true, added: TODAY, days: [1, 2, 3, 4, 5], slots: { main: [pick.main], side: [], snack: [pick.snack], drink: [pick.drink] } });
  await page.waitForSelector('.person.is-on:has-text("Candi")');
  assert.deepEqual(await page.$$eval('.people [data-action="lunch:who"]', (els) => els.map((e) => e.dataset.who)), ['Jeff', 'Candi', 'Knox']);
  assert.ok((await page.$$('.lunch-day')).length >= 5, 'her week is planned');
  assert.equal((await page.$$('.page-lunch .lighter')).length, 0, 'no swap ideas unless switched on for her');
  assert.match(await page.textContent('.lunch-foot'), /for Jeff, Candi and Knox only/);
  assert.ok(await noOverflow(page));
  await page.locator('.toast-root .toast-x').click({ timeout: 1000 }).catch(() => {});
  await shot(page, 'e2e-p2-lunch-three-people');
  const withCandi = await lunchCost(page);
  assert.ok(withCandi > before, `her lunch groceries joined the list (${before} → ${withCandi})`);
  // Family & settings says who packs; nothing else there is about one person.
  await go(page, '#/family', '.page-family');
  assert.deepEqual(await page.$$eval('.packer-name b', (els) => els.map((e) => e.textContent)), ['Jeff', 'Candi', 'Knox']);
  assert.match(await page.textContent('#lun-h + p'), /Packing for Jeff, Candi and Knox\./);
  assert.equal(await page.locator('.me-row').count(), 0, 'no “whose phone is this”');
  assert.equal(await page.locator('[data-action="sheet:who"]').count(), 0);
  // Pause from the editor: stays on the page, groceries off the list.
  await go(page, '#/lunch', '.page-lunch');
  await page.click('[data-action="lunch:who"][data-who="Candi"]');
  await page.click('[data-action="lunch:edit"][data-who="Candi"]');
  await page.waitForSelector('dialog[open] [data-action="lunch:enable"][aria-checked="true"]');
  await page.click('dialog[open] [data-action="lunch:enable"]');
  await toastMatch(page, /Candi’s lunches are paused/);
  await page.waitForSelector('dialog[open] [data-action="lunch:enable"][aria-checked="false"]');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.lunch-paused');
  assert.match(await page.textContent('.person.is-paused'), /Candi · paused/);
  assert.match(await page.textContent('.lunch-foot'), /for Jeff and Knox only/);
  await page.locator('.toast-root .toast-x').click({ timeout: 1000 }).catch(() => {});
  await shot(page, 'e2e-p3-lunch-paused');
  assert.equal(await lunchCost(page), before, 'paused: her groceries are off the list');
  // Resume, then remove for good (with a confirmation); Undo brings her back.
  await go(page, '#/lunch', '.page-lunch');
  await page.click('[data-action="lunch:who"][data-who="Candi"]');
  await page.click('.lunch-paused [data-action="lunch:resume"]');
  await toastMatch(page, /Candi’s lunches are back on/);
  // Tomorrow's card is folded under "Change tomorrow's lunch" (gauntlet r5): the week is there, the first card hidden.
  await page.waitForSelector('.lunch-person .lunch-day', { state: 'attached' });
  await page.click('[data-action="lunch:edit"][data-who="Candi"]');
  await page.click('dialog[open] [data-action="lunch:remove"]');
  await page.waitForSelector('dialog[open] [data-confirm="yes"]');
  assert.match(await page.textContent('dialog[open] .sheet-title'), /Remove Candi from lunches\?/);
  await page.click('dialog[open] [data-confirm="yes"]');
  await toastMatch(page, /Candi is off the lunch plan/);
  await waitFor(async () => (await page.$$eval('.people [data-action="lunch:who"]', (els) => els.map((e) => e.dataset.who))).join() === 'Jeff,Knox');
  await page.click('.toast-root .toast-btn');
  await toastMatch(page, /Undone/);
  await waitFor(async () => (await page.$$eval('.people [data-action="lunch:who"]', (els) => els.map((e) => e.dataset.who))).join() === 'Jeff,Candi,Knox');
  await page.click('[data-action="lunch:who"][data-who="Candi"]');
  await page.click('[data-action="lunch:edit"][data-who="Candi"]');
  await page.click('dialog[open] [data-action="lunch:remove"]');
  await page.click('dialog[open] [data-confirm="yes"]');
  await toastMatch(page, /Candi is off the lunch plan/);
  s = (await familyState(page)).state;
  assert.deepEqual(s.lunch.people.Candi, { enabled: false, removed: true });
  assert.equal(await lunchCost(page), before, 'back to Jeff’s and Knox’s lunches only');
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('Family & settings is one shared page: clear groups, text size for the TV, nothing about one person but who packs lunch', async () => {
  for (const vp of [PHONE, DESKTOP]) {
    const p = await newPage(ctx, vp);
    await go(p, '#/family', '.page-family');
    assert.deepEqual(await p.$$eval('.page-family .section-title', (els) => els.map((e) => e.textContent.trim())),
      // House rules first; the plumbing waits under Advanced (docs/spec/29).
      ['House rules', 'Shopping and budget', 'Packed lunches', 'Display on this device', 'Stores', 'Advanced', 'Family sync', 'Dinner ideas & photo reading (Claude)', 'Good to know', 'This device’s data']);
    assert.ok(!(await p.isVisible('#sync-h')), 'sync is folded away while it’s fine');
    const text = await p.textContent('.page-family');
    assert.doesNotMatch(text, /Whose phone|’s phone|Votes and changes from this phone/);
    assert.ok(await noOverflow(p));
    await shot(p, `e2e-p4-settings-${vp.width}`, true);
    await p.close();
  }
  // The passcode can be changed by anyone on a connected device, and the fold-out stays open while you type.
  await go(page, '#/family', '.page-family');
  if (await page.$('.set-advanced:not([open]) > summary')) await page.click('.set-advanced > summary');
  await page.click('details[data-more="change-pass"] summary');
  await page.waitForSelector('details[data-more="change-pass"][open] #pc-change');
  await page.fill('#pc-change', 'new passcode');
  await page.click('details[data-more="change-pass"] [data-action="fam:show-pass"]');
  await page.waitForSelector('#pc-change[type=text]');
  assert.ok(await page.$('details[data-more="change-pass"][open]'), 'still open after the page redrew');
  assert.equal(await page.inputValue('#pc-change'), 'new passcode');
  await page.click('details[data-more="change-pass"] [data-action="fam:show-pass"]');
  await page.fill('#pc-change', '');
  await page.click('details[data-more="change-pass"] summary');
  // Text size: Large, for a TV across the room; it sticks on this device and comes back on reload.
  const size = () => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  const regular = await size();
  await page.click('[data-action="fam:text"][data-value="large"]');
  await waitFor(async () => (await size()) > regular);
  for (const [hash, sel] of [['#/family', '.page-family'], ['#/tonight', '.page-tonight'], ['#/plan', '.page-plan'], ['#/list', '.page-list'], ['#/lunch', '.page-lunch']]) {
    await go(page, hash, sel);
    assert.ok(await noOverflow(page), `${hash} fits a phone at the large text size`);
  }
  await page.reload();
  await page.waitForSelector('.page-lunch');
  assert.ok((await size()) > regular, 'applied before first paint on reload');
  await go(page, '#/family', '.page-family');
  await page.click('[data-action="fam:text"][data-value="regular"]');
  await waitFor(async () => (await size()) === regular);
});

test('first open on the TV: offline says so and lets you in; the passcode can be typed and fixed with keys only (a remote)', async () => {
  // A Fire TV's browser: 960×540 CSS pixels, driven by a remote (arrow/Tab keys and OK).
  const TV = { width: 960, height: 540 };
  const tv = await browser.newContext({ deviceScaleFactor: 2, serviceWorkers: 'block', userAgent: 'Mozilla/5.0 (Linux; Android 9; AFTKA) AppleWebKit/537.36 (KHTML, like Gecko) Silk/112.5.1 like Chrome/112.0.5615.213 Safari/537.36' });
  const p = await newPage(tv, TV);
  const focused = () => p.evaluate(() => document.activeElement?.id || '');
  const inView = (sel) => p.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth; });
  await p.route(`${apiBase}/**`, async (r) => { await new Promise((ok) => setTimeout(ok, 350)); r.abort().catch(() => {}); });
  await p.goto(`${base}?api=${encodeURIComponent(apiBase)}`);
  await p.waitForSelector('.gate-checking');
  await p.waitForSelector('.gate-offline');
  assert.match(await p.textContent('.gate-title'), /Can’t reach the family’s plan/);
  await waitFor(async () => (await focused()) === 'gate-retry');
  assert.ok(await inView('#gate-retry') && await inView('#gate-later') && await inView('.gate-more > summary'), 'every choice is on screen without scrolling');
  await shot(p, 'e2e-p5-tv-first-open-offline');
  // Still no connection: OK on Try again looks, then comes back to the same screen with the focus on Try again.
  await p.keyboard.press('Enter');
  await p.waitForSelector('.gate-checking');
  await p.waitForSelector('.gate-offline');
  await waitFor(async () => (await focused()) === 'gate-retry');
  // "Look around first" works offline: the recipes are all there.
  await p.keyboard.press('Tab');
  assert.equal(await focused(), 'gate-later');
  await p.keyboard.press('Enter');
  await p.waitForSelector('.page-tonight');
  await p.goto(`${base}#/recipes`);
  await p.waitForSelector('.r-card');
  // Another evening, with the Wi-Fi working: the TV is opened fresh.
  await p.unroute(`${apiBase}/**`);
  await p.evaluate(() => { localStorage.removeItem('bfdp.v2.device'); });
  await p.reload();
  await p.waitForSelector('#pc-enter');
  assert.match(await p.textContent('.gate-title'), /Enter the family passcode/);
  assert.equal(await focused(), 'pc-enter', 'the remote starts in the passcode box');
  assert.ok(await inView('#pc-enter') && await inView('#pc-submit-enter'), 'the box and Join are on screen on a 540-pixel-high TV');
  assert.match(await p.textContent('.gate-remote'), /With a remote/);
  assert.ok(await inView('#gate-later') && await inView('.gate-more > summary'), 'and so are the other choices');
  assert.ok(await noOverflow(p));
  // Type it with a slip, check it with "Show the passcode", send it: all with keys.
  await p.keyboard.type('tacos tuesdya');
  await p.keyboard.press('Tab');
  assert.equal(await focused(), 'pc-show-enter');
  await p.keyboard.press('Enter');
  await p.waitForSelector('#pc-enter[type=text]');
  assert.equal(await p.inputValue('#pc-enter'), 'tacos tuesdya');
  assert.equal(await focused(), 'pc-show-enter', 'focus stays put when the screen redraws');
  await shot(p, 'e2e-p6-tv-passcode-shown');
  await p.keyboard.press('Tab');
  assert.equal(await focused(), 'pc-submit-enter');
  await p.keyboard.press('Enter');
  await p.waitForSelector('.form-error');
  for (let i = errors.length - 1; i >= 0; i--) if (/status of 401/.test(errors[i])) errors.splice(i, 1);
  assert.match(await p.textContent('.form-error'), /doesn.t match/);
  await waitFor(async () => (await focused()) === 'pc-enter');
  assert.equal(await p.inputValue('#pc-enter'), 'tacos tuesdya', 'nothing to retype: fix the two letters');
  assert.ok(await inView('.form-error'), 'the reason is on screen');
  await shot(p, 'e2e-p7-tv-wrong-passcode');
  await p.keyboard.press('End');
  await p.keyboard.press('Backspace');
  await p.keyboard.press('Backspace');
  await p.keyboard.type('ay');
  await p.keyboard.press('Enter');
  await p.waitForSelector('.page-recipes'); // straight back to where the TV was
  await waitFor(async () => /Synced/.test(await p.textContent('.rail .sync')));
  await go(p, '#/tonight', '.page-tonight');
  assert.ok((await p.textContent('.hero-title')).trim().length > 3, 'the TV shows the family’s tonight');
  assert.ok(await noOverflow(p));
  // Large text for the couch.
  await go(p, '#/family', '.page-family');
  await p.click('[data-action="fam:text"][data-value="large"]');
  for (const [hash, sel] of [['#/family', '.page-family'], ['#/plan', '.page-plan'], ['#/list', '.page-list'], ['#/lunch', '.page-lunch'], ['#/tonight', '.page-tonight']]) {
    await go(p, hash, sel);
    assert.ok(await noOverflow(p), `${hash} fits the TV at the large text size`);
  }
  await p.waitForTimeout(400);
  await shot(p, 'e2e-p9-tv-tonight-large');
  await tv.close();
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('a device that was changed before it joined asks before sending those changes to the family', async () => {
  await waitFor(async () => (await familyState(page)).pending === 0);
  const serverBefore = JSON.stringify((await (await fetch(`${apiBase}/__mock/state`)).json()).state.plan);
  const c = await browser.newContext({ deviceScaleFactor: 2, serviceWorkers: 'block' });
  const p = await newPage(c);
  await p.goto(`${base}?api=${encodeURIComponent(apiBase)}`);
  await p.waitForSelector('#pc-enter');
  // Someone looks around first and plans a week on it.
  await p.click('#gate-later');
  await p.waitForSelector('.page-tonight');
  await p.click('[data-action="tonight:plan-week"]');
  await p.waitForSelector('.hero-photo');
  assert.ok((await familyState(p)).pending > 0, 'kept on this device only');
  assert.match(await p.textContent('.topbar .sync'), /Connect/);
  // Then it joins: asked first, and choosing the family's plan leaves the local week behind.
  await go(p, '#/family', '.page-family');
  await p.fill('#pc-enter', 'tacos tuesday');
  await p.click('form[data-submit="fam:enter"] button[type=submit]');
  await p.waitForSelector('dialog[open] [data-confirm="yes"]');
  assert.match(await p.textContent('dialog[open] .sheet-title'), /Start from the family’s plan\?/);
  assert.match(await p.textContent('dialog[open] .sheet-text'), /\d+ changes? (was|were) made on this device before it joined/);
  await shot(p, 'e2e-p10-join-with-local-changes');
  await p.click('dialog[open] [data-confirm="yes"]');
  await toastMatch(p, /You’re on the family plan/);
  await waitFor(async () => (await p.$('.topbar')) && !(await p.$('.topbar .sync')));
  assert.equal((await familyState(p)).pending, 0);
  assert.equal(JSON.stringify((await (await fetch(`${apiBase}/__mock/state`)).json()).state.plan), serverBefore, 'the family’s plan is untouched');
  assert.equal(JSON.stringify((await familyState(p)).state.plan), serverBefore, 'and this device now shows it');
  await c.close();
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('after 6 pm Central, what gets saved is still dated today (not the UTC day)', async () => {
  const p = await newPage(ctx);
  await p.clock.setSystemTime(new Date('2026-11-16T19:30:00-06:00')); // 01:30 UTC on Tuesday the 17th
  await go(p, '#/tonight', '.page-tonight');
  assert.match(await p.textContent('.dateline'), /Monday, November 16/);
  await go(p, '#/pantry', '.page-pantry');
  const more = p.locator('.page-pantry [data-action="pan:step"]:not([data-delta^="-"])').first();
  const id = await more.getAttribute('data-id');
  const was = (await familyState(p)).state.pantry[id];
  // More of what's already on the shelf keeps the day the older food came home (docs/spec/21 §21.3)…
  await more.click();
  let s = await waitFor(async () => {
    const st = (await familyState(p)).state;
    return String(st.pantry?.[id]?.at || '').startsWith('2026-11-17T01:3') && st.pantry[id].qty > was.qty ? st : null;
  });
  assert.equal(s.pantry[id].since, was.since, 'adding to stock doesn’t make the older food look new');
  // …and food coming home to an empty shelf is dated today: Monday in Glen Ellyn, though it's Tuesday in UTC.
  await p.fill(`#pan-${id} .qty-input`, '0');
  await p.dispatchEvent(`#pan-${id} .qty-input`, 'change');
  await waitFor(async () => (await familyState(p)).state.pantry?.[id]?.qty === 0);
  await go(p, '#/pantry', '.page-pantry');
  await p.locator(`.page-pantry [data-action="pan:step"][data-id="${id}"]:not([data-delta^="-"])`).first().click();
  s = await waitFor(async () => { const st = (await familyState(p)).state; return st.pantry?.[id]?.qty > 0 ? st : null; });
  assert.match(s.pantry[id].at, /^2026-11-17T01:3/);
  assert.equal(s.pantry[id].since, '2026-11-16', 'the pantry’s “came home” day is Monday in Glen Ellyn');
  await waitFor(async () => (await familyState(p)).pending === 0);
  await p.close();
});

test('two ways to shop (docs/spec/28): in the store by aisle with big pictures, or each item opened on the store’s site', async () => {
  await go(page, '#/list', '.page-list');
  await page.locator('.toast-root .toast-x').click({ timeout: 1000 }).catch(() => {});
  await inStore(page);
  assert.equal(await page.getAttribute('[data-action="list:mode"][data-value="store"]', 'aria-checked'), 'true');
  // Sam's: stops in aisle order, each row with its picture square and an aisle chip.
  const stops = await page.$$eval('.store-sams .aisle.is-stop .aisle-h', (h) => h.map((x) => x.firstChild.textContent.trim()));
  assert.ok(stops.length >= 2, `aisle stops: ${stops.join(', ')}`);
  const key = (c) => { const m = /^Aisle ([A-Z]*)(\d+)/.exec(c); return `${m[1].padEnd(2, ' ')}${m[2].padStart(3, '0')}`; };
  assert.deepEqual(stops, [...stops].sort((a, b) => key(a).localeCompare(key(b))), 'walked in aisle order');
  assert.ok(await page.locator('.store-sams .item.is-store .item-thumb').count() >= 2, 'every row keeps a picture square');
  assert.equal(await page.locator('.store-sams .store-handoff').count(), 0, 'Copy & open is for ordering');
  // The family adds a Jewel aisle once; everyone sees it.
  const jewelKey = await page.getAttribute('.store-jewel .item:not(.is-checked) .item-more', 'data-key');
  await openItem(page, `.store-jewel .item-more[data-key="${jewelKey}"]`, { fix: false });
  await page.waitForSelector('.aisle-box');
  await page.fill('.aisle-box input[name="aisle"]', 'produce');
  await page.click('.aisle-box button[type="submit"]');
  await toastMatch(page, /like 12 or M9/);
  await page.fill('.aisle-box input[name="aisle"]', 'aisle 7');
  await page.click('.aisle-box button[type="submit"]');
  await toastMatch(page, /Aisle 7 at Jewel-Osco, for everyone/);
  const s = await waitFor(async () => { const st = (await familyState(page)).state; return st.aisles?.jewel?.[jewelKey]?.aisle === '7' ? st : null; });
  assert.ok(s.aisles.jewel[jewelKey].by);
  await page.keyboard.press('Escape');
  await page.waitForSelector(`.store-jewel .aisle.is-stop .item-main[data-key="${jewelKey}"]`);
  assert.match(await page.textContent(`.store-jewel .aisle.is-stop:has(.item-main[data-key="${jewelKey}"]) .aisle-h`), /Aisle 7/);
  await shot(page, 'e2e-60-list-in-store');
  // Order online: each item opens on the store's site; the exact product page when we know it.
  await orderOnline(page);
  assert.equal(await page.locator('.store-sams .store-handoff').count(), 0, 'Sam’s: each row opens on its own');
  assert.ok(await page.locator('.store-jewel .store-handoff').count(), 'Jewel: one copy for Jewel-Osco AI');
  const links = await page.$$eval('.store-sams .order-it', (a) => a.map((x) => ({ kind: x.dataset.order, href: x.getAttribute('href'), target: x.target })));
  assert.ok(links.length >= 2);
  for (const l of links) {
    assert.equal(l.target, '_blank');
    assert.match(l.href, l.kind === 'product' ? /^https:\/\/www\.samsclub\.com\/ip\/[^/]+\/\d+$/ : /^https:\/\/www\.samsclub\.com\/s\//);
  }
  assert.ok(links.some((l) => l.kind === 'product'), 'at least one exact product page');
  assert.ok(await noOverflow(page));
  await shot(page, 'e2e-61-list-order-online');
  // The choice is this phone's: it survives a reload.
  await page.reload();
  await page.waitForSelector('.page-list .item.is-online');
  await inStore(page);
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

// ---------------------------------------------------------------- design system (docs/spec/19-design.md)

const DESIGN_SCREENS = [['tonight', '.page-tonight'], ['plan', '.page-plan'], ['list', '.page-list'], ['pantry', '.page-pantry'], ['recipes', '.page-recipes'], ['family', '.page-family']];
const FIRE_TV = 'Mozilla/5.0 (Linux; Android 11; AFTKA) AppleWebKit/537.36 (KHTML, like Gecko) Silk/130.4.1 like Chrome/130.0.6723.102 Safari/537.36';
/** A context that starts from the family's saved state, with this device's theme (and TV switch) set before the app boots. */
async function designContext({ viewport, deviceScaleFactor = 1, theme, tv = null, userAgent, reducedMotion }) {
  const c = await browser.newContext({ viewport, deviceScaleFactor, colorScheme: theme, serviceWorkers: 'block', storageState: await ctx.storageState(), ...(userAgent ? { userAgent } : {}), ...(reducedMotion ? { reducedMotion } : {}) });
  await c.addInitScript(([tvSetting, th]) => {
    try {
      if (tvSetting) localStorage.setItem('bfdp.v2.display', JSON.stringify({ tv: tvSetting }));
      const d = JSON.parse(localStorage.getItem('bfdp.v2.device') || '{}');
      if (d.key && th) { d.theme = th; localStorage.setItem('bfdp.v2.device', JSON.stringify(d)); } // a device that has joined (there is no "who" any more)
    } catch { /* first load */ }
  }, [tv, tv ? theme : null]);
  return c;
}
const active = (p) => p.evaluate(() => {
  const a = document.activeElement;
  if (!a || a === document.body) return null;
  return { tag: a.tagName, cls: a.className, href: a.getAttribute('href'), action: a.dataset.action || null, date: a.dataset.date || null, key: a.dataset.key || null, inDialog: !!a.closest('dialog'), inRail: !!a.closest('.rail'), inView: !!a.closest('#view'), text: (a.textContent || '').trim().slice(0, 40) };
});

test('design: Tonight, Plan, List, Pantry, Recipes and Family at phone, desktop and TV size, light and dark', async () => {
  const sizes = [
    { name: '390', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 },
    { name: '1280', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
    { name: 'tv', viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, tv: 'on' }, // a 1080p panel: the 960-wide canvas at 2×
  ];
  for (const size of sizes) {
    for (const theme of ['light', 'dark']) {
      const c = await designContext({ ...size, theme });
      const p = await newPage(c, size.viewport);
      for (const [name, sel] of DESIGN_SCREENS) {
        await go(p, `#/${name}`, sel);
        await p.waitForTimeout(250);
        assert.ok(await noOverflow(p), `${name} at ${size.name} (${theme}) has no horizontal scroll`);
        const state = await p.evaluate(() => ({ tv: document.documentElement.classList.contains('is-tv'), theme: document.documentElement.dataset.theme || 'auto', scheme: getComputedStyle(document.documentElement).colorScheme, zoom: getComputedStyle(document.documentElement).getPropertyValue('--tv-zoom').trim() }));
        assert.equal(state.tv, !!size.tv, `${size.name}: TV layout ${size.tv ? 'on' : 'off'}`);
        assert.equal(state.scheme, theme, `${name} at ${size.name} renders the ${theme} theme`);
        if (size.tv) assert.equal(state.zoom, '2', 'a 1920-wide screen is the 960 canvas at 2×');
        await shot(p, `design-${name}-${size.name}-${theme}`);
      }
      if (size.tv) {
        // The kitchen display: tonight's dinner, its name on the photo, and the prep list, all on the first screen.
        await go(p, '#/tonight', '.page-tonight');
        const board = await p.evaluate(() => {
          const r = (s) => document.querySelector(s)?.getBoundingClientRect();
          const photo = r('.hero-photo'); const title = r('.hero-title'); const side = r('.tonight-side'); const rail = r('.rail');
          return { vh: innerHeight, vw: innerWidth, photo, title, side, rail, clock: document.querySelector('.tv-clock')?.textContent || '' };
        });
        assert.ok(board.photo && board.photo.bottom <= board.vh + 1, 'the whole photograph is on the first screen');
        assert.ok(board.title.top >= board.photo.top && board.title.bottom <= board.photo.bottom, 'the dinner’s name is set on its photograph');
        assert.ok(board.title.height / 1 >= 90, `the name is big enough to read across the room (${Math.round(board.title.height)}px tall)`);
        assert.ok(board.side.left > board.photo.right && board.side.top < board.vh * 0.25, 'prep sits beside the photo');
        assert.ok(Math.abs(board.rail.height - board.vh) <= 2, 'the rail is exactly as tall as the screen under zoom');
        assert.ok(board.photo.left >= board.vw * 0.05 && board.side.right <= board.vw * 0.951, 'content keeps out of the overscan margins');
        assert.match(board.clock, /^\d{1,2}:\d{2}\s?[AP]M$/, 'the kitchen clock shows the time');
        assert.match(await p.textContent('.tonight-side'), /Thaw & prep/);
      }
      await c.close();
    }
  }
  // No horizontal scroll from the smallest phone to a wide monitor.
  const wide = await designContext({ viewport: { width: 320, height: 800 }, theme: 'light' });
  const wp = await newPage(wide, { width: 320, height: 800 });
  for (const width of [320, 768, 1024, 1920]) {
    await wp.setViewportSize({ width, height: 800 });
    for (const [name, sel] of DESIGN_SCREENS) {
      await wp.goto(`${base}#/${name}`);
      await wp.waitForSelector(sel);
      assert.ok(await noOverflow(wp), `${name} fits ${width}px`);
    }
    if (width === 320) { await wp.goto(`${base}#/tonight`); await wp.waitForSelector('.page-tonight'); await wp.waitForTimeout(300); await shot(wp, 'design-tonight-320-light'); }
  }
  await wide.close();
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('design: targets are at least 44px, every photo has its size, and focus is always visible', async () => {
  const c = await designContext({ viewport: PHONE, deviceScaleFactor: 2, theme: 'light' });
  const p = await newPage(c);
  for (const [name, sel] of DESIGN_SCREENS) {
    await go(p, `#/${name}`, sel);
    const small = await p.evaluate(() => [...document.querySelectorAll('#app button, #app a[href], #app select, #app input:not([type=hidden]):not(.sr-only), #app summary')]
      .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && !el.closest('.sr-only, .skip'))
      .map((el) => {
        // An inline text link's target is its line; a control tucked inside a bigger target counts as that target.
        const r = el.getBoundingClientRect();
        const after = getComputedStyle(el, '::after'); const before = getComputedStyle(el, '::before');
        const grow = (ps) => (ps.content !== 'none' && ps.position === 'absolute' ? Math.max(0, -parseFloat(ps.top) || 0) + Math.max(0, -parseFloat(ps.bottom) || 0) : 0);
        const h = r.height + Math.max(grow(after), grow(before));
        return { h, w: r.width, inline: getComputedStyle(el).display === 'inline', what: `${el.tagName}.${String(el.className).split(' ')[0]} “${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)}”` };
      })
      .filter((x) => !x.inline && (x.h < 43.5 || x.w < 43.5))
      .map((x) => `${x.what} ${Math.round(x.w)}×${Math.round(x.h)}`));
    assert.deepEqual(small, [], `${name}: every control is at least 44×44`);
    const unsized = await p.$$eval('.photo > img[data-photo]', (imgs) => imgs.filter((i) => !i.getAttribute('width') || !i.getAttribute('height') || (!i.hasAttribute('loading') && !i.hasAttribute('fetchpriority'))).length);
    assert.equal(unsized, 0, `${name}: every photo carries width and height and is lazy unless it is the hero`);
  }
  // Tab to a few controls on each kind of surface: each one shows a ring that stands off its background.
  await go(p, '#/tonight', '.page-tonight');
  for (let i = 0; i < 9; i++) {
    await p.keyboard.press('Tab');
    const ring = await p.evaluate(() => { const a = document.activeElement; const s = getComputedStyle(a); return { w: parseFloat(s.outlineWidth) || 0, style: s.outlineStyle, tag: a.tagName, cls: String(a.className), within: !!a.closest('.scan-btn, .rcpt-file, .chip-radio') }; });
    assert.ok(ring.within || (ring.style !== 'none' && ring.w >= 3), `focus ring on ${ring.tag}.${ring.cls}`);
  }
  await c.close();
});

test('remote control: arrows move focus, Enter activates, Back closes a sheet then goes back, and focus survives a redraw', async () => {
  // What a Fire TV stick reports: Silk, 960 × 540 at 2×. Nothing is switched on by hand.
  const c = await designContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 2, theme: 'dark', userAgent: FIRE_TV });
  const p = await newPage(c, { width: 960, height: 540 });
  await go(p, '#/tonight', '.page-tonight');
  assert.ok(await p.evaluate(() => document.documentElement.classList.contains('is-tv')), 'a Fire TV is recognized by its user agent');
  assert.equal(await p.evaluate(() => document.documentElement.dataset.theme), 'dark', 'a TV left on “match” is dark');
  let a = await active(p);
  assert.ok(a && a.inView, 'a remote has somewhere to start: something on the screen has focus');
  assert.match(a.cls, /hero-photo/, 'it starts on tonight’s dinner');
  const ring = await p.evaluate(() => { const s = getComputedStyle(document.activeElement); return { w: parseFloat(s.outlineWidth), style: s.outlineStyle }; });
  assert.ok(ring.style === 'solid' && ring.w >= 4, 'the focused thing wears a thick ring');
  await shot(p, 'design-tv-focus-tonight');

  // Left goes to the navigation (onto the current section), Down walks it, Enter opens that section.
  await p.keyboard.press('ArrowLeft');
  a = await active(p);
  assert.ok(a.inRail && a.href === '#/tonight', `Left lands on the current section in the rail (${a.href})`);
  await p.keyboard.press('ArrowDown');
  a = await active(p);
  assert.equal(a.href, '#/plan', 'Down moves to the next section');
  await p.keyboard.press('Enter');
  await p.waitForSelector('.page-plan');
  await settled(p);
  a = await active(p);
  assert.ok(a.inRail && a.href === '#/plan', 'after the screen changes, focus is still on the rail');
  await p.keyboard.press('ArrowRight');
  a = await active(p);
  assert.ok(a.inView, 'Right crosses into the screen');

  // Across the week: Right and Left step from night to night.
  await p.focus('.day-hit[data-date="2026-11-18"]');
  await p.keyboard.press('ArrowRight');
  assert.equal((await active(p)).date, '2026-11-19');
  await p.keyboard.press('ArrowLeft');
  await p.keyboard.press('ArrowLeft');
  assert.equal((await active(p)).date, '2026-11-17');
  await p.waitForTimeout(600); // the smooth scroll that brings it into view
  const onScreen = await p.evaluate(() => { const r = document.activeElement.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
  assert.ok(onScreen, 'whatever takes focus is scrolled onto the screen');
  await p.waitForTimeout(400);
  await shot(p, 'design-tv-focus-plan');

  // Enter opens the night; focus is inside the sheet and cannot leave it.
  await p.keyboard.press('Enter');
  await p.waitForSelector('dialog[open] .sheet-body');
  a = await active(p);
  assert.ok(a.inDialog, 'focus moves into the sheet');
  for (const k of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowLeft', 'ArrowLeft', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown']) {
    await p.keyboard.press(k);
    assert.ok((await active(p))?.inDialog, `${k}: focus stays inside the open sheet`);
  }
  await p.waitForTimeout(600); // the smooth scroll that follows the focus
  await shot(p, 'design-tv-focus-sheet');
  // The remote's Back button closes the sheet and puts focus back on the night it came from.
  await p.evaluate(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'GoBack', bubbles: true, cancelable: true })));
  await p.waitForSelector('dialog[open]', { state: 'detached' });
  a = await active(p);
  assert.equal(a.date, '2026-11-17', 'focus returns to the night that opened the sheet');
  // Escape does the same from inside a sheet…
  await p.keyboard.press('Enter');
  await p.waitForSelector('dialog[open] .sheet-body');
  // (A thumbs-up inside the sheet redraws the whole planner behind it; focus still finds its way back.)
  if (await p.$('dialog[open] .thumb-up')) {
    await p.click('dialog[open] .thumb-up');
    await p.waitForTimeout(300);
    assert.ok((await active(p))?.inDialog, 'a redraw keeps focus in the sheet');
  }
  await p.keyboard.press('Escape');
  await p.waitForSelector('dialog[open]', { state: 'detached' });
  assert.equal((await active(p)).date, '2026-11-17', 'focus returns to the same night even though the planner was redrawn');
  // …and with no sheet open, Back goes back to the screen before.
  await p.keyboard.press('Escape');
  await p.waitForSelector('.page-tonight');
  assert.match(p.url(), /#\/tonight$/, 'Back returns to Tonight');

  // A redraw keeps focus: check an item off with Enter and the same checkbox still has it.
  await go(p, '#/list', '.page-list');
  const key = await p.evaluate(() => { const b = document.querySelector('.item:not(.is-checked) .check'); b.focus(); return b.dataset.key; });
  await p.keyboard.press('Enter');
  await waitFor(async () => p.evaluate((k) => !!document.querySelector(`.item.is-checked .check[data-key="${k}"]`), key));
  a = await active(p);
  assert.ok(a && a.key === key && /check/.test(a.cls), 'the checkbox that was pressed still has focus after the list redraws');
  assert.ok(await p.evaluate(() => !!document.querySelector('.item.is-checked .check-box.pop')), 'the box pops as it is checked');
  await p.keyboard.press('Enter');
  await waitFor(async () => p.evaluate((k) => !document.querySelector(`.item.is-checked .check[data-key="${k}"]`), key));

  // Text boxes keep their arrow keys: Left moves the caret, Down leaves the box.
  await go(p, '#/recipes', '.page-recipes');
  await p.focus('.search input');
  await p.keyboard.type('chick');
  await p.keyboard.press('ArrowLeft');
  const caret = await p.evaluate(() => ({ at: document.activeElement.selectionStart, input: document.activeElement.tagName === 'INPUT', value: document.activeElement.value }));
  assert.deepEqual(caret, { at: 4, input: true, value: 'chick' }, 'Left moved the caret, not the focus');
  await p.keyboard.press('ArrowDown');
  a = await active(p);
  assert.ok(a && a.tag !== 'INPUT', 'Down leaves the text box for the next thing below');
  assert.ok(await noOverflow(p));
  await c.close();

  // On a computer the arrows are left alone until someone drives with the keyboard (Tab), and a click hands them back.
  const d = await designContext({ viewport: DESKTOP, theme: 'light' });
  const q = await newPage(d, DESKTOP);
  await go(q, '#/recipes', '.page-recipes');
  assert.equal(await q.evaluate(() => document.documentElement.classList.contains('is-tv')), false, 'a laptop is not a TV');
  await q.keyboard.press('ArrowDown');
  assert.equal(await q.evaluate(() => (document.activeElement === document.body || document.activeElement.id === 'view')), true, 'arrows scroll as usual for a mouse user');
  await q.keyboard.press('Tab');
  await q.keyboard.press('Tab');
  const before = await active(q);
  await q.keyboard.press('ArrowDown');
  const after = await active(q);
  assert.ok(after && JSON.stringify(after) !== JSON.stringify(before), 'after Tab, arrows move focus on a computer too');
  await q.focus('.r-card');
  const first = await q.evaluate(() => document.activeElement.getAttribute('href'));
  await q.keyboard.press('ArrowRight');
  const second = await q.evaluate(() => document.activeElement.getAttribute('href'));
  assert.ok(/^#\/recipe\//.test(second) && second !== first, 'Right steps to the next recipe card');
  const sameRow = await q.evaluate(([f, s]) => Math.abs(document.querySelector(`a[href="${f}"]`).getBoundingClientRect().top - document.querySelector(`a[href="${s}"]`).getBoundingClientRect().top) < 4, [first, second]);
  assert.ok(sameRow, 'and it is the card beside it, not one from another row');
  await q.mouse.click(900, 70);
  await q.evaluate(() => document.activeElement.blur?.());
  const y0 = await q.evaluate(() => scrollY);
  await q.keyboard.press('ArrowDown');
  await q.waitForTimeout(250);
  assert.ok(await q.evaluate((y) => scrollY > y || document.activeElement === document.body, y0), 'after a click the arrows scroll again');
  await d.close();
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('motion: pages cross-fade, a tapped photo travels, sheets leave, and reduced motion turns all of it off', async () => {
  const c = await designContext({ viewport: PHONE, deviceScaleFactor: 2, theme: 'light' });
  const p = await newPage(c);
  await go(p, '#/recipes', '.page-recipes');
  // A tap on a recipe card starts a view transition and the card's photo is the shared element.
  const seen = await p.evaluate(async () => {
    const card = document.querySelector('.r-card');
    const out = { vt: false, shared: false, nav: null };
    const watch = new MutationObserver(() => {
      if (document.documentElement.classList.contains('is-vt')) { out.vt = true; out.nav = document.documentElement.dataset.nav || out.nav; }
      if ([...document.querySelectorAll('.photo, .hero-photo')].some((e) => e.style.viewTransitionName === 'shared-photo')) out.shared = true;
    });
    watch.observe(document.documentElement, { attributes: true, subtree: true, childList: true, attributeFilter: ['class', 'style', 'data-nav'] });
    card.click();
    await new Promise((r) => setTimeout(r, 900));
    watch.disconnect();
    return { ...out, supported: typeof document.startViewTransition === 'function', still: document.documentElement.classList.contains('is-vt'), on: location.hash };
  });
  assert.match(seen.on, /^#\/recipe\//);
  assert.ok(seen.supported && seen.vt, 'the route change ran as a view transition');
  assert.equal(seen.nav, 'forward', 'going into a recipe moves forward');
  assert.ok(seen.shared, 'the tapped photo was the shared element');
  assert.equal(seen.still, false, 'and the transition finished');
  await p.waitForSelector('.page-recipe');
  await shot(p, 'design-recipe-390-light');

  // A sheet rises on a spring and leaves on its way out; the photo that was tapped flies into it.
  await go(p, '#/plan', '.page-plan');
  const flew = await p.evaluate(async () => {
    let ghost = false;
    const watch = new MutationObserver(() => { if (document.querySelector('.photo-ghost')) ghost = true; });
    watch.observe(document.body, { childList: true, subtree: true });
    const night = [...document.querySelectorAll('.day:not(.is-away):not(.is-open) .day-hit')].find((b) => b.querySelector('.photo img.is-loaded'));
    night.scrollIntoView({ block: 'center', behavior: 'instant' });
    await new Promise((r) => setTimeout(r, 120));
    night.click();
    await new Promise((r) => setTimeout(r, 60));
    const anim = getComputedStyle(document.querySelector('dialog[open] .sheet-panel')).animationName;
    await new Promise((r) => setTimeout(r, 900));
    watch.disconnect();
    return { ghost, anim, left: !!document.querySelector('.photo-ghost'), hidden: !!document.querySelector('.is-ghosted') };
  });
  assert.equal(flew.anim, 'sheet-up', 'the sheet slides up');
  assert.ok(flew.ghost, 'the night’s photo travelled into the sheet');
  assert.ok(!flew.left && !flew.hidden, 'and was tidied away afterwards');
  await shot(p, 'design-sheet-390-light');
  const closing = await p.evaluate(async () => {
    document.querySelector('dialog[open] .sheet-close').click();
    const d = document.getElementById('sheet');
    const during = { open: d.open, cls: d.classList.contains('is-closing') };
    await new Promise((r) => setTimeout(r, 700));
    return { during, after: d.open };
  });
  assert.deepEqual(closing, { during: { open: true, cls: true }, after: false }, 'closing plays an exit, then the dialog really closes');
  // Dragging the sheet down by its handle dismisses it.
  await p.click('.day:not(.is-away):not(.is-open) .day-hit');
  await p.waitForSelector('dialog[open] .sheet-body');
  await settled(p);
  await p.waitForTimeout(500);
  const grip = await p.evaluate(() => { const r = document.querySelector('dialog[open] .sheet-grip').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await p.mouse.move(grip.x, grip.y);
  await p.mouse.down();
  for (let i = 1; i <= 12; i++) { await p.mouse.move(grip.x, grip.y + i * 30); await p.waitForTimeout(16); }
  assert.ok(await p.evaluate(() => document.getElementById('sheet').classList.contains('is-dragging')), 'the sheet follows the finger');
  await p.mouse.up();
  await p.waitForSelector('dialog[open]', { state: 'detached' });
  await c.close();

  // Reduced motion: no view transition, no flying photo, no exit animation, no shimmer.
  const r = await designContext({ viewport: PHONE, deviceScaleFactor: 2, theme: 'light', reducedMotion: 'reduce' });
  const rp = await newPage(r);
  await go(rp, '#/recipes', '.page-recipes');
  const calm = await rp.evaluate(async () => {
    let vt = false;
    const watch = new MutationObserver(() => { if (document.documentElement.classList.contains('is-vt')) vt = true; });
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    document.querySelector('.r-card').click();
    await new Promise((res) => setTimeout(res, 300));
    watch.disconnect();
    return { vt, hash: location.hash };
  });
  assert.match(calm.hash, /^#\/recipe\//);
  assert.equal(calm.vt, false, 'no view transition when motion is reduced');
  await go(rp, '#/plan', '.page-plan');
  await rp.click('.day:not(.is-away):not(.is-open) .day-hit');
  await rp.waitForSelector('dialog[open] .sheet-body');
  const still = await rp.evaluate(() => {
    const d = document.getElementById('sheet');
    const ghost = !!document.querySelector('.photo-ghost');
    document.querySelector('dialog[open] .sheet-close').click();
    return { ghost, openAfterClose: d.open, dur: getComputedStyle(document.querySelector('.btn')).transitionDuration };
  });
  assert.equal(still.ghost, false, 'no flying photo');
  assert.equal(still.openAfterClose, false, 'the sheet closes at once');
  assert.ok(still.dur.split(',').every((x) => parseFloat(x) < 0.001), `transitions are off (${still.dur})`);
  await r.close();
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('the “TV display” switch lives in settings, on this device only, and print still hides the chrome', async () => {
  const c = await designContext({ viewport: DESKTOP, theme: 'light' });
  const p = await newPage(c, DESKTOP);
  await go(p, '#/family', '.page-family');
  assert.equal(await p.getAttribute('.tv-row .switch', 'aria-checked'), 'false');
  await p.click('[data-action="tv:toggle"]');
  await toastMatch(p, /TV display is on/);
  await waitFor(() => p.evaluate(() => document.documentElement.classList.contains('is-tv')));
  // The page redraws on the next frame after the class flips.
  await waitFor(async () => (await p.getAttribute('.tv-row .switch', 'aria-checked')) === 'true');
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('bfdp.v2.display')).tv), 'on', 'kept on this device');
  const shared = await (await fetch(`${apiBase}/__mock/state`)).json();
  assert.ok(!JSON.stringify(shared.state).includes('"tv"'), 'never in the family’s shared state');
  assert.ok(await noOverflow(p), 'the TV layout fits a 1280px window too');
  await p.reload();
  await p.waitForSelector('.page-family');
  assert.ok(await p.evaluate(() => document.documentElement.classList.contains('is-tv')), 'and it is still on after a reload');
  await p.click('[data-action="tv:toggle"]');
  await waitFor(() => p.evaluate(() => !document.documentElement.classList.contains('is-tv')));
  // Print: the list on paper has no navigation, no buttons, no photos.
  await go(p, '#/list', '.page-list');
  await p.emulateMedia({ media: 'print' });
  const printed = await p.evaluate(() => {
    const shown = (s) => { const el = document.querySelector(s); return !!el && getComputedStyle(el).display !== 'none'; };
    return { rail: shown('.rail'), tabbar: shown('.tabbar'), topbar: shown('.topbar'), check: shown('.item .check'), items: document.querySelectorAll('.item').length, name: shown('.item-name'), bg: getComputedStyle(document.body).backgroundColor };
  });
  assert.deepEqual({ rail: printed.rail, tabbar: printed.tabbar, topbar: printed.topbar, check: printed.check, name: printed.name }, { rail: false, tabbar: false, topbar: false, check: false, name: true });
  assert.ok(printed.items > 5 && /255, 255, 255/.test(printed.bg), 'the list prints black on white');
  await p.emulateMedia({ media: 'screen' });
  await c.close();
  assert.equal(errors.length, 0, errors.join('\n'));
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

test('an update reaches a phone with the app open: it reloads into the new version, or offers Refresh mid-task', async () => {
  const swCtx = await browser.newContext({ serviceWorkers: 'allow', storageState: await ctx.storageState() });
  const p = await swCtx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(`${base}#/plan`);
  await p.waitForSelector('.page-plan');
  await waitFor(() => p.evaluate(() => !!navigator.serviceWorker.controller) || p.reload().then(() => false), { timeout: 15000, step: 500 });
  let loads = 0;
  p.on('load', () => { loads++; });
  const publish = async (tag) => {
    staticSrv.swSuffix = `// ${tag}`;
    await p.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
  };
  try {
    // Idle: the new service worker takes over and the page reloads into it on its own.
    await publish('release A');
    await waitFor(async () => loads >= 1, { timeout: 15000 });
    await p.waitForSelector('.page-plan');
    assert.match(p.url(), /#\/plan$/, 'stays on the same screen');
    // Mid-task (a sheet is open): no surprise reload, a Refresh offer instead.
    await p.click('[data-action="plan:tap"]');
    await p.waitForSelector('dialog[open]');
    const before = loads;
    await publish('release B');
    await waitFor(async () => /just updated/.test((await p.textContent('.toast-root .toast-msg').catch(() => '')) || ''), { timeout: 15000 });
    assert.equal(loads, before, 'did not reload under an open sheet');
    await p.click('.toast-root .toast-btn');
    await waitFor(async () => loads > before, { timeout: 10000 });
  } finally {
    staticSrv.swSuffix = '';
    await swCtx.close();
  }
  assert.equal(errors.length, 0, errors.join('\n'));
});
