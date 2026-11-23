// End-to-end tests for smarter planning (SPEC §21): the real app in Chromium against
// dev/mock-api.mjs. Its own file, so it runs beside run-e2e.mjs without touching it:
//   cd tests && node ./e2e/planner.e2e.mjs
// Screenshots: dev/screenshots/planner-*.png (390 px and 1280 px).
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

let browser; let staticSrv; let api; let base; let apiBase; let ctx; let page; let key;
const errors = [];

async function newPage(context, viewport = PHONE) {
  const p = await context.newPage();
  await p.setViewportSize(viewport);
  await p.clock.install({ time: NOW });
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|ERR_INTERNET_DISCONNECTED|net::/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  return p;
}
async function familyState(p = page) {
  const { server, pending } = await p.evaluate(() => ({
    server: JSON.parse(localStorage.getItem('bfdp.v2.server') || 'null'),
    pending: JSON.parse(localStorage.getItem('bfdp.v2.pending') || '[]'),
  }));
  return applyOps(server?.state || {}, pending);
}
async function waitFor(fn, { timeout = 8000, step = 100 } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, step));
  }
  throw new Error('Timed out waiting');
}
const toastMatch = (p, re) => waitFor(async () => re.test((await p.textContent('.toast-root .toast-msg').catch(() => '')) || ''));
/** Waits until an element's text matches: the page re-renders a frame after the state changes. */
const textMatch = (p, sel, re) => waitFor(async () => re.test((await p.textContent(sel).catch(() => '')) || '')).catch(async () => assert.match((await p.textContent(sel).catch(() => '')) || '', re));
const closeToast = (p) => p.locator('.toast-root.is-on .toast-x').click({ timeout: 1000 }).catch(() => {});
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
/** How many elements match. (Never assert on a Playwright handle: a failure would print the whole browser.) */
const count = (p, sel) => p.locator(sel).count();
const clean = (text, what) => assert.ok(!/\bNaN\b|undefined|\[object Object\]|Invalid Date|\bnull\b/.test(text), `${what} shows no NaN/undefined/null: ${text.slice(0, 200)}`);
const go = async (p, hash, sel) => { await p.goto(`${base}${hash}`); await p.waitForSelector(sel); await p.waitForTimeout(150); };
const shot = (p, name, full = false) => p.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: full });
const shotOf = async (p, sel, name) => {
  await p.evaluate((s) => { const el = document.querySelector(s); if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 90); }, sel);
  await p.waitForTimeout(350);
  await shot(p, name);
};
/** Another phone in the family writes to the shared state; this one picks it up. */
async function seed(ops, check) {
  const r = await fetch(`${apiBase}/api/ops`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Family-Key': key }, body: JSON.stringify({ ops, by: 'Candi', clientId: 'e2e-candi', batchId: `seed-${Math.random()}` }) });
  assert.equal(r.status, 200);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await waitFor(async () => check(await familyState()));
}
const setOp = (p, value) => ({ op: 'set', path: p, value });

before(async () => {
  staticSrv = await startStatic({ port: 0, quiet: true });
  api = await startMockApi({ port: 0, quiet: true });
  base = `http://127.0.0.1:${staticSrv.address().port}/Bilbrey-Family-Dinner-Planner/`;
  apiBase = `http://127.0.0.1:${api.server.address().port}`;
  browser = await chromium.launch();
  ctx = await browser.newContext({ deviceScaleFactor: 2, serviceWorkers: 'block' });
  page = await newPage(ctx);
  // First launch: the first device creates the family passcode (one shared profile, docs/spec/20:
  // nobody picks who they are), and the app plans this week itself.
  await page.goto(`${base}?api=${encodeURIComponent(apiBase)}`);
  await page.waitForSelector('#pc-new');
  await page.fill('#pc-new', 'Tacos Tuesday');
  await page.fill('#pc-again', 'tacos tuesday');
  await page.click('form[data-submit="fam:create"] button[type=submit]');
  await page.waitForSelector('.page-tonight');
  await page.click('[data-action="tonight:plan-week"]');
  await page.waitForSelector('.hero-photo');
  key = await page.evaluate(() => JSON.parse(localStorage.getItem('bfdp.v2.device')).key);
  await waitFor(async () => (await (await fetch(`${apiBase}/__mock/state`)).json()).state.plan?.['2026-11-22']);
});

after(async () => {
  await browser?.close();
  staticSrv?.close();
  api?.server.close();
});

test('plan ahead re-plans the planner’s own nights from the pantry, shows before and after, keeps Undo, and survives a reload', async () => {
  // The week was planned before anyone counted the freezer. Candi fills it in: thighs from early
  // September, chicken breast from a week later, a steak and corn from October, and one meat nobody
  // dated. Thursday is set by hand.
  const item = (qty, since, extra = {}) => ({ qty, stocked: false, ...(since ? { since } : {}), at: `${since || '2026-11-10'}T18:00:00.000Z`, by: 'Candi', ...extra });
  const staple = { qty: null, stocked: true, by: 'Candi', at: '2026-11-02T18:00:00.000Z' };
  const before = await familyState();
  const thu = { ...before.plan['2026-11-19'], manual: true, by: 'Candi' };
  await seed([
    ...Object.entries({
      // (The week the planner made leans on chicken thighs already, so it's the chicken breast and the
      // steak that give re-planning something to gain: tikka masala and steak bites instead of buying more.)
      chickenThighs: item(9, '2026-09-03'), chicken: item(12, '2026-09-10'), eyeRoundSteak: item(2.5, '2026-07-01'), cornCobs: item(10, '2026-10-20'), beef: item(3, null),
      tikka: item(60, '2026-11-02'), basmati: item(16, '2026-11-02'), naan: item(20, '2026-11-14'), butter: item(16, '2026-11-14'),
      potatoes: item(10, '2026-11-14'), milk: item(8, null), broccoli: item(6, '2026-11-01'),
      turmeric: staple, cajunSeasoning: staple, soy: staple, salt: staple, pepper: staple, oil: staple, garlic: staple,
    }).map(([id, value]) => setOp(['pantry', id], value)),
    setOp(['plan', '2026-11-19'], thu),
  ], (s) => s.pantry?.eyeRoundSteak?.qty === 2.5 && s.plan['2026-11-19'].manual);

  await go(page, '#/plan', '.page-plan');
  await closeToast(page);
  const was = (await familyState()).plan;
  await page.click('.plan-actions [data-action="ahead:open"]');
  await page.waitForSelector('dialog[open] [data-action="ahead:go"]');
  const end = '2026-11-29';
  await page.click(`dialog[open] [data-action="ahead:quick"][data-end="${end}"]`);
  assert.equal(await page.getAttribute('dialog[open] [data-action="ahead:pantry"]', 'aria-checked'), 'true');
  assert.equal(await page.getAttribute('dialog[open] [data-action="ahead:replan"]', 'aria-checked'), 'true', 're-planning is on by default with “use what we have first”');
  await page.click('dialog[open] .ahead-opts > summary');
  // Turning the pantry off turns re-planning off with it; back on, it follows.
  await page.click('dialog[open] [data-action="ahead:pantry"]');
  assert.equal(await page.getAttribute('dialog[open] [data-action="ahead:replan"]', 'aria-checked'), 'false');
  await page.click('dialog[open] [data-action="ahead:pantry"]');
  assert.equal(await page.getAttribute('dialog[open] [data-action="ahead:replan"]', 'aria-checked'), 'true');
  await page.waitForTimeout(350);
  await shot(page, 'planner-01-plan-ahead-sheet-390');
  await page.click('dialog[open] [data-action="ahead:go"]');
  await toastMatch(page, /^Planned \d+ dinners? through Sunday, Nov 29\./);
  await page.waitForSelector('#ahead-card #ahead-ba', { state: 'attached' });
  let s = await familyState();
  for (let d = 16; d <= 29; d++) assert.ok(s.plan[`2026-11-${d}`]?.dinner, `Nov ${d} is planned`);
  assert.deepEqual(s.plan['2026-11-19'], thu, 'the night Candi set by hand is exactly as she left it');
  assert.equal(s.plan[TODAY].dinner, was[TODAY].dinner, 'tonight’s dinner is never re-planned');
  const replanned = Object.keys(was).filter((d) => d >= TODAY && d <= '2026-11-22' && was[d].dinner !== s.plan[d].dinner);
  assert.ok(replanned.length > 0, 'some of the nights the planner had picked changed');
  assert.ok(!replanned.includes('2026-11-19'));
  assert.deepEqual([s.planAhead.start, s.planAhead.end, s.planAhead.pantryFirst, s.planAhead.replan], [TODAY, end, true, true]);
  const ba = await page.textContent('#ahead-ba');
  const m = /(\d+) of 14 dinners (now )?come from the pantry/.exec(ba);
  assert.ok(m, `the card says how many dinners come from the pantry: ${ba}`);
  assert.ok(Number(m[1]) > s.planAhead.before.fromPantry, `more than before (${m[1]} now, ${s.planAhead.before.fromPantry} before)`);
  assert.match(ba, /About \$[\d,]+\.\d\d in groceries/);
  assert.match(ba, /the usual plan: \d+/);
  assert.match(ba, /Against planning the open nights the usual way: \d+ more dinners? from what’s already here/);
  // What those dinners cost (docs/spec/24 §24.7): the food, the average dinner and plate, and the trip named as a trip.
  const cost = (await page.textContent('#ahead-cost')).replace(/\s+/g, ' ').trim();
  assert.match(cost, /^These 14 dinners: (about )?\$[\d,]+ of food, \$\d+\.\d\d a dinner, \$\d+\.\d\d a serving\. \$[\d,]+ of it is already in the house; the trip for them comes to (about )?\$[\d,]+\.$/);
  const [food, perDinner, perPlate] = cost.match(/\$[\d,.]+\d/g).map((x) => Number(x.replace(/[$,]/g, '')));
  assert.ok(Math.abs(food / 14 - perDinner) < 0.6 && Math.abs(perDinner / 5 - perPlate) < 0.01, `${food} of food is ${perDinner} a dinner and ${perPlate} a plate`);
  const card = await page.textContent('#ahead-card');
  assert.match(card, /Your pantry covers \d+ dinners?/);
  assert.match(card, /Uses up the .+ from (Jul 1|Sep 3)/);
  clean(card, 'the plan-ahead card');
  assert.ok(await noOverflow(page), 'the card fits 390px');
  await closeToast(page);
  await shotOf(page, '#ahead-card', 'planner-02-plan-ahead-result-390');

  // It survives a reload, and shows on the family's other screens.
  await waitFor(async () => (await (await fetch(`${apiBase}/__mock/state`)).json()).state.planAhead?.end === end);
  await page.reload();
  await page.waitForSelector('#ahead-card #ahead-ba', { state: 'attached' });
  assert.match(await page.textContent('#ahead-ba'), /of 14 dinners (now )?come from the pantry/);
  const desk = await newPage(ctx, DESKTOP);
  await go(desk, '#/plan', '.page-plan');
  await desk.waitForSelector('#ahead-card #ahead-ba', { state: 'attached' });
  assert.ok(await noOverflow(desk));
  await shotOf(desk, '#ahead-card', 'planner-03-plan-ahead-result-1280');
  await desk.close();

  // Pressing it again changes nothing: the plan already makes the most of the pantry.
  const planned = (await familyState()).plan;
  await page.click('.plan-actions [data-action="ahead:open"]');
  await page.waitForSelector('dialog[open] [data-action="ahead:go"]');
  // The two weeks are planned, so the sheet moves on to the first stretch with an empty night (gauntlet r5).
  assert.ok((await page.inputValue('dialog[open] #ahead-end')) > end, 'it never opens on a stretch that is already planned');
  await page.click(`dialog[open] [data-action="ahead:quick"][data-end="${end}"]`);
  await page.click('dialog[open] [data-action="ahead:go"]');
  await toastMatch(page, /^Every night through Sunday, Nov 29 is already planned\.$/);
  assert.equal(await page.locator('.toast-root .toast-btn').count(), 0, 'no Undo for a press that changed nothing');
  assert.deepEqual((await familyState()).plan, planned);
  await closeToast(page);

  // Undo takes a plan-ahead back, card and all. (Close the card, plan again, undo.)
  await page.click('[data-action="ahead:close"]');
  await page.waitForSelector('#ahead-card', { state: 'detached' });
  assert.equal((await familyState()).planAhead, undefined);
  await seed([{ op: 'del', path: ['plan', '2026-11-28'] }, { op: 'del', path: ['plan', '2026-11-29'] }], (st) => !st.plan['2026-11-29']);
  const beforeUndo = (await familyState()).plan;
  await page.click('.plan-actions [data-action="ahead:open"]');
  await page.click('dialog[open] [data-action="ahead:go"]');
  await toastMatch(page, /^Planned \d+ dinners? through Sunday, Nov 29/);
  await page.waitForSelector('#ahead-card');
  assert.ok((await familyState()).plan['2026-11-29']?.dinner);
  await page.click('.toast-root .toast-btn');
  await toastMatch(page, /Undone/);
  s = await familyState();
  assert.deepEqual(s.plan, beforeUndo, 'Undo puts every night back');
  assert.equal(s.planAhead, undefined, 'and takes the result card with it');
  await page.waitForSelector('#ahead-card', { state: 'detached' });
  // Leave the two weeks planned for the tests that follow.
  await page.click('.plan-actions [data-action="ahead:open"]');
  await page.click('dialog[open] [data-action="ahead:go"]');
  await page.waitForSelector('#ahead-card');
  await closeToast(page);
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('lean by default and busy nights are family settings under More on the Plan; Use first names what’s old', async () => {
  await go(page, '#/plan', '.page-plan');
  // Planning for lives under More now (docs/spec/29): the week comes first on the page.
  await page.click('.plan-actions [data-action="plan:more"]');
  await page.waitForSelector('dialog[open] .plan-prefs');
  assert.equal(await page.getAttribute('dialog[open] [data-action="plan:lean"]', 'aria-checked'), 'true', 'lean is on by default');
  await page.click('dialog[open] [data-action="plan:busy"][data-day="2"]'); // Wednesdays
  await waitFor(async () => JSON.stringify((await familyState()).settings?.busyNights) === '[2]');
  await page.waitForSelector('dialog[open] [data-action="plan:busy"][data-day="2"][aria-pressed="true"]');
  await textMatch(page, 'dialog[open] .lean-line', /\d+ of \d+ planned dinners are lean plates/);
  await page.click('dialog[open] [data-action="plan:lean"]');
  await toastMatch(page, /Lean by default is off/);
  assert.equal((await familyState()).settings.lean, false);
  await page.click('.toast-root .toast-btn'); // Undo
  await waitFor(async () => (await familyState()).settings.lean !== false);
  await closeToast(page);
  await shotOf(page, 'dialog[open] .plan-prefs', 'planner-04-lean-busy-390');
  await page.keyboard.press('Escape');
  // Use first, on the Pantry: the July steak is past its time, the undated beef counts as old.
  await go(page, '#/pantry', '.page-pantry');
  const fz = await page.textContent('.use-first');
  assert.match(fz, /Eye of round steak/i);
  assert.match(fz, /ground beef/i);
  assert.match(fz, /Not sure when it went in: use it soon/);
  clean(fz, 'use first');
  assert.ok(await noOverflow(page));
  await shotOf(page, '.use-first', 'planner-05-use-first-390');
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('taking food off the shelf asks why: “threw it out” goes in the waste log, and the Budget adds it up', async () => {
  await go(page, '#/pantry', '.page-pantry');
  // No came-home date: a rough answer gives it a use-by. Every date question is in Use first, once (gauntlet r5).
  assert.equal(await page.locator('#when-card').count(), 0, 'no second card at the bottom');
  assert.equal(await page.locator('.use-first .use-ask').count(), 3, 'the beef, the milk and the garlic, each asked once');
  assert.equal(await page.locator('.use-first > .use-list > li').count(), 3, 'three on the first screen, the rest under "more"');
  await textMatch(page, '.use-first .use-more > summary', /^\d+ more$/);
  await shotOf(page, '.use-first', 'planner-06-when-did-this-go-in-390');
  await page.click('.use-first [data-action="pan:about"][data-id="beef"][data-about="older"]');
  await toastMatch(page, /went in a while ago\. It has a use-by now\./);
  assert.equal((await familyState()).pantry.beef.since, '2026-08-18', '“older” is about three months back');
  await closeToast(page);
  assert.equal(await page.locator('.use-first .use-ask').count(), 2);
  await textMatch(page, '.use-first', /Lean ground beefIn the freezer since Aug 18/);

  // Taking it off the shelf (from the row's › sheet) opens the question.
  const corn = (await familyState()).pantry.cornCobs.qty;
  await page.click('#pan-cornCobs .pan-more');
  await page.click('dialog[open] [data-action="pan:remove"]');
  await page.waitForSelector('dialog[open] [data-action="pan:gone"][data-reason="tossed"]');
  const sheet = await page.textContent('dialog[open]');
  assert.match(sheet, /Used it up/);
  assert.match(sheet, /Threw it out/);
  assert.match(sheet, /Wrong count/);
  assert.match(sheet, /about \$\d+\.\d\d for all of it/);
  await page.waitForTimeout(350);
  await shot(page, 'planner-07-why-is-it-leaving-390');
  // The pantry counts corn by the ear (a real thing you can count, docs/spec/29), so the sheet does too: half of the 10 there.
  assert.match(sheet, /all 10 ears unless you change it/);
  await page.fill('dialog[open] #gone-qty', '5');
  await page.click('dialog[open] [data-action="pan:gone"][data-reason="tossed"]');
  await toastMatch(page, /^Logged: [\d½¼¾.]+ ears of .+ thrown out, about \$\d+\.\d\d\. The planner will use it sooner next time\.$/);
  let s = await familyState();
  let log = Object.values(s.waste);
  assert.equal(log.length, 1);
  assert.ok(s.pantry.cornCobs.qty > 0 && s.pantry.cornCobs.qty < corn, 'the rest stays on the shelf');
  assert.equal(Math.round((s.pantry.cornCobs.qty + log[0].qty) * 100) / 100, corn, 'what left the shelf is what was logged');
  assert.deepEqual([log[0].id, log[0].unit, log[0].reason, log[0].date, log[0].by], ['cornCobs', 'ears', 'tossed', TODAY, 'Family']);
  assert.ok(log[0].cost > 0 && log[0].name);
  await closeToast(page);
  // The whole steak goes too; "used it up" logs nothing.
  await page.click('#pan-eyeRoundSteak .pan-more');
  await page.click('dialog[open] [data-action="pan:remove"]');
  await page.click('dialog[open] [data-action="pan:gone"][data-reason="tossed"]');
  await toastMatch(page, /^Logged: 2½ lb of .+ thrown out/);
  await closeToast(page);
  await page.click('#pan-butter .pan-more');
  await page.click('dialog[open] [data-action="pan:remove"]');
  await page.click('dialog[open] [data-action="pan:gone"][data-reason="used"]');
  await toastMatch(page, /used up\. It’s off the shelf\./);
  s = await familyState();
  assert.equal(s.pantry.eyeRoundSteak, undefined);
  assert.equal(s.pantry.butter, undefined);
  log = Object.values(s.waste);
  assert.equal(log.length, 2, 'only the two that were thrown out');
  const total = Math.round(log.reduce((t, w) => t + w.cost, 0) * 100) / 100;
  await closeToast(page);
  await textMatch(page, '.waste-line', new RegExp(`Thrown out in November: \\$${total.toFixed(2).replace('.', '\\.')} \\(2 things\\)`));
  assert.ok(await noOverflow(page));

  await go(page, '#/budget', '.page-budget');
  if (await page.$('.budget-more:not([open]) > summary')) await page.click('.budget-more > summary');
  const waste = await page.textContent('#waste-card');
  assert.match(waste, new RegExp(`\\$${total.toFixed(2).replace('.', '\\.')}\\s*2 things wasted`));
  assert.match(waste, /What gets wasted most/);
  clean(waste, 'the waste card');
  await shotOf(page, '#waste-card', 'planner-08-waste-390');
  // A mistaken entry comes out, with Undo.
  await page.click('#waste-card details summary');
  await page.click(`#waste-card [data-action="bud:waste-remove"]`);
  await toastMatch(page, /Removed from the waste log/);
  assert.equal(Object.keys((await familyState()).waste).length, 1);
  await page.click('.toast-root .toast-btn');
  await waitFor(async () => Object.keys((await familyState()).waste).length === 2);
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('the Budget shows trips against the goal and the year at this rate; a short trip offers to extend', async () => {
  await seed([setOp(['receipts'], [
    { id: 'r1', date: '2026-08-08', store: 'sams', amount: 742.1, by: 'Jeff' },
    { id: 'r2', date: '2026-09-12', store: 'sams', amount: 810.4, by: 'Jeff' },
    { id: 'r3', date: '2026-10-03', store: 'sams', amount: 512.25, by: 'Jeff' }, { id: 'r4', date: '2026-10-21', store: 'jewel', amount: 335.25, by: 'Candi' },
    { id: 'r5', date: '2026-11-01', store: 'sams', amount: 212.4, by: 'Jeff' }, { id: 'r6', date: '2026-11-01', store: 'jewel', amount: 61.1, by: 'Jeff' },
    { id: 'r7', date: '2026-11-09', store: 'jewel', amount: 48.75, by: 'Candi' },
  ])], (s) => s.receipts?.length === 7);
  await go(page, '#/budget', '.page-budget');
  // Trips and the year are details now, folded under "How it’s worked out" (docs/spec/29).
  if (await page.$('.budget-more:not([open]) > summary')) await page.click('.budget-more > summary');
  const trips = await page.textContent('#trips-card');
  assert.match(trips, /Store trips in November/);
  assert.match(trips, /2\s*of 3 trips/, 'Sam’s and Jewel on Nov 1 are one trip; Nov 9 is the second');
  assert.match(trips, /1 trip left for the 15 days to Nov 30: the next list should cover all of them\./);
  assert.match(trips, /Sun, Nov 1\s*Sam's Club and Jewel-Osco\s*\$273\.50/);
  assert.equal(await page.locator('#trips-card .trip-pip.is-on').count(), 2);
  clean(trips, 'the trips card');
  const year = await page.textContent('#year-card');
  const b = /At this rate, about \$([\d,]+) this year\. Your target is \$7,800 \(\$650 a month\)\. The last 3 months averaged \$800\./.exec(year);
  assert.ok(b, `the year line reads as asked: ${year}`);
  assert.match(year, /(over for the year|under the year’s target)/);
  clean(year, 'the year card');
  assert.ok(await noOverflow(page));
  await shotOf(page, '#trips-card', 'planner-09-trips-and-year-390');
  // A tighter goal: two trips are the limit.
  await page.click('#trips-card [data-action="bud:trip-goal"][data-value="2"]');
  await toastMatch(page, /Aiming for 2 store trips a month/);
  await textMatch(page, '#trips-card', /2\s*of 2 trips/);
  await textMatch(page, '#trips-card', /That’s the month’s 2\./);
  await page.click('.toast-root .toast-btn');
  await waitFor(async () => (await familyState()).settings?.tripGoal !== 2);
  await closeToast(page);

  // A trip list through Friday covers five days: five more would skip the next run.
  await seed([setOp(['settings', 'trip'], { start: TODAY, end: '2026-11-20', store: 'both', by: 'Candi', at: '2026-11-16T22:00:00.000Z' })], (s) => s.settings?.trip?.end === '2026-11-20');
  await go(page, '#/budget', '.page-budget');
  const advice = await page.textContent('#trip-advice');
  assert.match(advice, /This trip covers 5 days\. 5 more \(about \$[\d,]+\) skips the next store run\./);
  assert.match(advice, /Extend the trip to Wed, Nov 25/);
  assert.match(advice, /Sam’s .+; Jewel .+\./, 'and how the trip splits between the stores');
  clean(advice, 'the trip advice');
  await shotOf(page, '#trip-advice', 'planner-10-trip-advice-390');
  await page.click('[data-action="trip:extend"]');
  await toastMatch(page, /^The trip now shops through Wednesday, Nov 25: 10 days of food in one run\./);
  const s = await familyState();
  assert.deepEqual([s.settings.trip.start, s.settings.trip.end, s.settings.trip.store], [TODAY, '2026-11-25', 'both']);
  await textMatch(page, '#trip-advice', /This list covers 10 days, through Wed, Nov 25: one run, then no store until then\./);
  await closeToast(page);
  // The Plan page carries the same advice while a trip is on, and the List splits the trip.
  await go(page, '#/plan', '.page-plan');
  assert.equal(await count(page, '#trip-advice'), 1);
  await go(page, '#/list', '.page-list');
  assert.equal(await count(page, '.trip-bar'), 1);
  assert.ok(await noOverflow(page));
  const desk = await newPage(ctx, DESKTOP);
  await go(desk, '#/budget', '.page-budget');
  assert.ok(await noOverflow(desk));
  await shot(desk, 'planner-11-budget-1280', true);
  await go(desk, '#/pantry', '.page-pantry');
  assert.ok(await noOverflow(desk));
  await shot(desk, 'planner-12-pantry-1280');
  await desk.close();
  await seed([{ op: 'del', path: ['settings', 'trip'] }], (st) => !st.settings?.trip);
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('after dinner is cooked the app asks about leftovers once; they can go in a lunch or the freezer; nights never marked get caught up', async () => {
  // Tonight's dinner is about to be cooked; Saturday's and Sunday's were planned and never marked.
  const s0 = await familyState();
  const tonight = s0.plan[TODAY];
  await seed([
    setOp(['plan', '2026-11-15'], { ...s0.plan['2026-11-17'], by: 'Family' }),
    setOp(['plan', '2026-11-14'], { ...s0.plan['2026-11-18'], by: 'Family' }),
  ], (s) => !!s.plan['2026-11-15'] && !!s.plan['2026-11-14']);
  await go(page, '#/tonight', '.page-tonight');
  // One catch-up prompt, and it lives on Tonight (docs/spec/29: one home per card).
  await page.waitForSelector('#catch-card');
  assert.equal(await page.locator('#catch-card, .forgot-card').count(), 1, 'one prompt, not two');
  await page.click('[data-action="tonight:cooked"]');
  await toastMatch(page, /marked cooked/);
  await closeToast(page);
  // Tonight asks about leftovers once: its own card, and no prep job repeating the question.
  await page.waitForSelector('.lo-card .lo-ask');
  assert.equal(await page.locator('.lo-ask').count(), 1, 'one question for the night');
  assert.doesNotMatch(await page.textContent('.prep-card'), /left from tonight/);
  await shotOf(page, '.lo-card', 'planner-13-tonight-leftovers-ask-390');
  // Not on Plan or Pantry any more: one home per card.
  await go(page, '#/plan', '.page-plan');
  assert.equal(await page.locator('.lo-ask, #catch-card, .left-fridge').count(), 0, 'Plan is the week, nothing else');
  await go(page, '#/tonight', '.page-tonight');
  await page.click('.lo-card [data-action="leftovers:save"][data-n="4"]');
  await toastMatch(page, /4 servings of leftovers saved, good through Thursday/);
  await closeToast(page);
  let s = await familyState();
  assert.deepEqual([s.leftovers[TODAY].servings, s.leftovers[TODAY].useBy], [4, '2026-11-19']);
  assert.equal(s.plan[TODAY].leftovers, undefined, 'one leftovers record, not two');
  await page.waitForSelector('.left-fridge .lo-row');
  assert.match(await page.textContent('.left-fridge .lo-row'), /Leftovers: 4 servings, good through Thursday/);
  // The ask for tonight is gone; the only question left is about last night's dinners, which belongs to the catch-up card.
  assert.equal(await page.locator(`.lo-ask [data-date="${TODAY}"]`).count(), 0);
  // Three plates go in the freezer…
  await page.click('.left-fridge [data-action="leftovers:more"]');
  await page.waitForSelector('dialog[open] [data-action="leftovers:freeze"]');
  const sheet = await page.textContent('dialog[open]');
  assert.match(sheet, /’s lunch tomorrow/, 'a packed lunch can take a serving');
  assert.doesNotMatch(sheet, /Candi|Jordan|Jackson/, 'only the people who pack a lunch');
  await page.click('dialog[open] [data-action="leftovers:plates"][data-delta="-1"]');
  assert.equal((await page.textContent('dialog[open] .left-n')).trim(), '3');
  await page.waitForTimeout(350);
  await shot(page, 'planner-14-leftovers-sheet-390');
  await page.click('dialog[open] [data-action="leftovers:freeze"]');
  await toastMatch(page, /^3 plates of leftover .+ in the freezer\. It keeps about 3 months/);
  s = await familyState();
  assert.deepEqual([s.leftovers[TODAY].servings, s.leftovers[TODAY].frozen], [1, 3]);
  const left = Object.entries(s.custom).find(([, c]) => /^Leftover /.test(c.name));
  assert.ok(left, 'the frozen plates are a shelf item');
  assert.deepEqual([s.pantry[left[0]].qty, s.pantry[left[0]].since, s.pantry[left[0]].place], [3, TODAY, 'freezer']);
  assert.equal(s.plan[TODAY].dinner, tonight.dinner);
  await closeToast(page);
  // …and the last serving is someone's lunch tomorrow: that packed lunch comes off the plan.
  await page.click('.left-fridge [data-action="leftovers:more"]');
  await page.waitForSelector('dialog[open] [data-action="leftovers:lunch"]');
  const who = await page.getAttribute('dialog[open] [data-action="leftovers:lunch"]', 'data-name');
  const day = await page.getAttribute('dialog[open] [data-action="leftovers:lunch"]', 'data-to');
  await page.click('dialog[open] [data-action="leftovers:lunch"]');
  await toastMatch(page, /takes a serving of the leftover .+ for lunch tomorrow\. That packed lunch is off the list\.$/);
  s = await familyState();
  assert.equal(s.leftovers[TODAY].servings, 0);
  assert.equal(s.lunch.days[day][who].skip, true);
  assert.match(s.lunch.days[day][who].reason, /^Leftover /);
  await closeToast(page);
  await page.waitForSelector('.left-fridge', { state: 'detached' });
  // The pantry lists the frozen plates in the freezer and as a quick backup.
  await go(page, '#/pantry', '.page-pantry');
  assert.match(await page.textContent(`#pan-${left[0]}`), /Leftover [\s\S]+3 plates on hand/);
  assert.equal(await page.locator('#catch-card').count(), 0, 'the catch-up is Tonight’s, not the Pantry’s');

  // Catch-up: Saturday's and Sunday's dinners were never marked. Tonight asks, once tonight's own
  // after-dinner questions are answered (one question at a time, docs/spec/29).
  await go(page, '#/tonight', '.page-tonight');
  if (await page.$('.howwas [data-action="lighter:dismiss"]')) await page.click('.howwas [data-action="lighter:dismiss"]');
  await page.waitForSelector('#catch-card');
  const card = await page.textContent('#catch-card');
  assert.match(card, /Is the pantry still right\?/);
  assert.match(card, /2 dinners from the last week never came off the shelves/);
  await shotOf(page, '#catch-card', 'planner-15-catch-up-card-390');
  await page.click('#catch-card [data-action="catch:open"]');
  await page.waitForSelector('dialog[open] [data-action="catch:cooked"][data-date="2026-11-15"]');
  await page.waitForTimeout(350);
  await shot(page, 'planner-16-catch-up-sheet-390');
  await page.click('dialog[open] [data-action="catch:cooked"][data-date="2026-11-15"]');
  await waitFor(async () => (await familyState()).plan['2026-11-15'].status === 'cooked');
  // Saturday's wasn't made: the night opens and its food stays on the shelf.
  await page.click('dialog[open] [data-action="catch:skip"][data-date="2026-11-14"]');
  await waitFor(async () => !(await familyState()).plan['2026-11-14']);
  await page.waitForSelector('dialog[open] [data-action="sheet:close"]');
  assert.match(await page.textContent('dialog[open]'), /All caught up/);
  await page.click('dialog[open] [data-action="sheet:close"]');
  s = await familyState();
  assert.ok(s.plan['2026-11-15'].deducted, 'what it used came off the shelves, once');
  await page.waitForSelector('#catch-card', { state: 'detached' });
  // Marked cooked a day late, last night's dinner gets the one leftovers question too.
  await page.waitForSelector('.lo-card .lo-ask');
  assert.match(await page.textContent('.lo-card .lo-ask'), /Any leftovers from last night\?/);
  await page.click('.lo-card [data-action="leftovers:save"][data-n="0"]');
  await page.waitForSelector('.lo-card', { state: 'detached' });
  assert.ok(await noOverflow(page));
  assert.equal(errors.length, 0, errors.join('\n'));
});
