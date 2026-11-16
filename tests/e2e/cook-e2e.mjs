// End-to-end: recipe page → cook mode → timers → mark cooked → leftovers, the recipe box filters,
// and Tonight as the home screen (SPEC §22). The real app in Chromium against dev/mock-api.mjs.
// Run: cd tests && node ./e2e/cook-e2e.mjs   (screenshots land in dev/screenshots/cook-*.png)
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
const TOMORROW = '2026-11-17';
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const TV = { width: 1920, height: 1080 };

let browser; let staticSrv; let api; let base; let apiBase; let ctx; let page; let big;
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
  return applyOps(server?.state || {}, pending);
}
async function waitFor(fn, { timeout = 20000, step = 100 } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, step));
  }
  throw new Error('Timed out waiting');
}
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const shot = (p, name, full = false) => p.screenshot({ path: path.join(SHOTS, `cook-${name}.png`), fullPage: full });
const go = async (p, hash, sel) => { await p.goto(`${base}${hash}`); await p.waitForSelector(sel); await p.waitForTimeout(200); };
const hideToast = (p) => p.locator('.toast-root .toast-x').click({ timeout: 800 }).catch(() => {});
/** Adds family ops the way another phone's changes would arrive: queued, then picked up on load. */
async function seed(p, ops) {
  // Wait until the app has nothing of its own left to send, or its next save would drop these.
  await waitFor(() => p.evaluate(() => JSON.parse(localStorage.getItem('bfdp.v2.pending') || '[]').length === 0 && !localStorage.getItem('bfdp.v2.inflight')));
  await p.evaluate((list) => {
    const pending = JSON.parse(localStorage.getItem('bfdp.v2.pending') || '[]');
    list.forEach((op, i) => pending.push({ ...op, _id: `seed-${Date.now()}-${i}` }));
    localStorage.setItem('bfdp.v2.pending', JSON.stringify(pending));
  }, ops);
  await p.reload();
  await p.waitForSelector('.page, .cook');
}
const stepKey = (p) => p.getAttribute('.cook', 'data-step');
/** Next, and wait until the screen has actually moved on. */
async function next(p) {
  const was = await stepKey(p);
  await p.click('#cook-next');
  await waitFor(async () => (await stepKey(p)) !== was);
}
const cards = (p) => p.$$eval('.r-card', (els) => els.length);
/** A second device joins the family and waits for the plan to arrive. */
async function join(context, viewport) {
  const p = await newPage(context, viewport);
  await p.goto(`${base}?api=${encodeURIComponent(apiBase)}`);
  // One shared profile (docs/spec/20): a new device needs only the family passcode.
  await p.waitForSelector('#pc-enter, .page');
  if (await p.$('#pc-enter')) {
    await p.fill('#pc-enter', 'tacos tuesday');
    await p.click('form[data-submit="fam:enter"] button[type=submit]');
  }
  await p.waitForSelector('.page-tonight .hero-photo');
  return p;
}

before(async () => {
  staticSrv = await startStatic({ port: 0, quiet: true });
  api = await startMockApi({ port: 0, quiet: true });
  base = `http://127.0.0.1:${staticSrv.address().port}/Bilbrey-Family-Dinner-Planner/`;
  apiBase = `http://127.0.0.1:${api.server.address().port}`;
  browser = await chromium.launch();
  ctx = await browser.newContext({ deviceScaleFactor: 2, serviceWorkers: 'block', hasTouch: true });
  page = await newPage(ctx);
  // A laptop and the TV: no touch screen, same family (the context shares nothing, so it joins with the passcode).
  big = await browser.newContext({ deviceScaleFactor: 1, serviceWorkers: 'block' });
  // First launch: the family passcode (nobody picks who they are), a planned week with smashburgers tonight (a dinner with timers and a side).
  await page.goto(`${base}?api=${encodeURIComponent(apiBase)}`);
  await page.waitForSelector('#pc-new');
  await page.fill('#pc-new', 'Tacos Tuesday');
  await page.fill('#pc-again', 'tacos tuesday');
  await page.click('form[data-submit="fam:create"] button[type=submit]');
  await page.waitForSelector('.page-tonight');
  await page.click('[data-action="tonight:plan-week"]');
  await page.waitForSelector('.hero-photo');
  const at = NOW.toISOString();
  await seed(page, [
    { op: 'set', path: ['plan', TODAY], value: { dinner: 'smashburgers', sides: ['jewel-fries'], status: 'planned', by: 'Jeff', at } },
    { op: 'set', path: ['plan', TOMORROW], value: { dinner: 'tikka-masala', sides: ['turmeric-rice', 'warm-naan'], status: 'planned', by: 'Jeff', at } },
    { op: 'set', path: ['pantry', 'beef'], value: { qty: 3, since: '2026-11-03', at, by: 'Jeff' } },
    { op: 'set', path: ['pantry', 'buns'], value: { qty: 8, since: '2026-11-14', at, by: 'Jeff' } },
    { op: 'set', path: ['pantry', 'lettuce'], value: { qty: 2, since: '2026-11-12', at, by: 'Jeff' } },
  ]);
});

after(async () => {
  await browser?.close();
  staticSrv?.close();
  api?.server.close();
});

test('Tonight is the home screen: dinner, start cooking, prep, use first, lunches, the week', async () => {
  await go(page, '#/tonight', '.page-tonight');
  assert.match(await page.textContent('.hero-title'), /smashburgers/i);
  assert.equal(await page.getAttribute('#tonight-cook', 'href'), `#/cook/${TODAY}`);
  assert.match(await page.textContent('.hero .nutri'), /≈ [\d,]+ cal.*\d+ g protein/s);
  assert.match(await page.textContent('.hero .why'), /Uses up the romaine hearts from Nov 12 \(best by tomorrow\)/, 'the burgers take the lettuce that is about to turn');
  assert.ok(await page.$('.prep-card'), 'thaw and prep');
  assert.match(await page.textContent('.use-first'), /romaine|lettuce/i);
  assert.match(await page.textContent('.lunch-today'), /Jeff/);
  const week = await page.textContent('.week-card');
  assert.match(week, /calories, an average dinner plate/);
  assert.match(week, /dinners have a vegetable or salad\s*\d of \d/);
  assert.match(week, /nights cooking at home\s*\d/);
  assert.doesNotMatch(await page.textContent('.page-tonight'), /goal|target|limit|too many|bad/i, 'no targets, no judgement');
  assert.ok(await noOverflow(page));
  await shot(page, 'tonight-390', true);
  await waitFor(async () => (await (await fetch(`${apiBase}/__mock/state`)).json()).state.pantry?.lettuce);
  for (const [vp, name] of [[DESKTOP, '1280'], [TV, '1920x1080']]) {
    const p = await join(big, vp);
    await go(p, '#/tonight', '.page-tonight');
    assert.ok(await noOverflow(p), `Tonight at ${name} has no sideways scroll`);
    // A remote walks the page in order: the first big thing is Start cooking.
    const order = await p.$$eval('.page-tonight a[href], .page-tonight button:not([disabled])', (els) => els.map((e) => e.id || e.dataset.action || e.getAttribute('href')));
    assert.ok(order.indexOf('tonight-cook') >= 0 && order.indexOf('tonight-cook') <= 3, 'Start cooking is among the first stops');
    await shot(p, `tonight-${name}`, vp === DESKTOP);
    await p.close();
  }
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('the recipe page: why, times, equipment, pantry check, the plate timed together, steps, safe temps, nutrition', async () => {
  await go(page, '#/recipe/smashburgers', '.page-recipe');
  assert.match(await page.textContent('.recipe-why'), /Why it’s on the plan tonight/);
  assert.match(await page.textContent('.time-strip'), /30 min/);
  assert.match(await page.textContent('.gear'), /Blackstone\s*Medium-high/);
  assert.doesNotMatch(await page.textContent('.gear'), /Blackstone\s*Blackstone/, 'the appliance is named once');
  // For five, against the pantry: the beef and buns are in, the cheese isn't.
  assert.match(await page.textContent('.pantry-sum'), /\d+ of \d+ ingredients are in the pantry/);
  assert.match(await page.textContent('.ing-have'), /In the pantry/);
  assert.ok((await page.$$('.ing-none, .ing-short')).length > 0, 'missing ingredients are marked');
  assert.equal((await page.$$('.tl-row')).length, 2, 'the dinner and its side on one clock');
  assert.match(await page.textContent('.recipe-timing .cook-cues'), /Air-fryer fries\. Start it about \d+ min in/);
  assert.ok((await page.$$('.steps-detail .step')).length >= 4);
  assert.match(await page.textContent('.steps-detail'), /Blackstone, medium-high/);
  assert.match(await page.textContent('.steps-detail .step-ings'), /2 lb lean ground beef/);
  assert.match(await page.textContent('.recipe-tips'), /Cold beef smashes best/, 'the recipe’s own tips');
  assert.ok((await page.$$('.recipe-sides .steps-side li')).length >= 2, 'the side has its own method');
  assert.match(await page.textContent('.temps'), /160°F/);
  assert.match(await page.textContent('.recipe-leftovers'), /Cooked patties keep 3 days in the fridge/, 'the recipe’s own leftovers note');
  assert.match(await page.textContent('.recipe-nutrition'), /≈ [\d,]+\s*calories/);
  assert.equal((await page.$$('.nutri-table tbody tr')).length, 2, 'the dinner and the side');
  // The plate guide shows once, in plain words, and goes away for good.
  const guide = await page.textContent('.plate-guide');
  assert.match(guide, /Half the plate/);
  assert.match(guide, /A palm/);
  assert.match(guide, /A cupped hand/);
  assert.doesNotMatch(guide, /calorie|kid|bad|should/i);
  assert.ok(await noOverflow(page));
  await shot(page, 'recipe-390', true);
  await page.click('.plate-guide [data-action="lighter:dismiss"]');
  await waitFor(async () => !(await page.$('.plate-guide')));
  await page.waitForSelector('[data-action="rec:plate-guide"]');
  for (const [vp, name] of [[DESKTOP, '1280'], [TV, '1920x1080']]) {
    const p = await join(big, vp);
    await go(p, '#/recipe/smashburgers', '.page-recipe');
    assert.ok(await noOverflow(p));
    await shot(p, `recipe-${name}`, vp === DESKTOP);
    await p.close();
  }
  // A family-saved dinner has only plain steps: the page still stands up.
  await seed(page, [{ op: 'set', path: ['customDinners', 'grandmas-goulash'], value: { title: 'Grandma’s goulash', category: 'Comfort', protein: 'beef', minutes: 40, equipment: ['possible cooker'], items: { beef: 2 }, steps: ['Brown the beef.', 'Add everything else and slow cook on low for 4 hours.'], sides: ['steamed-broccoli', 'garlic-toast'], rotation: 'core' } }]);
  await go(page, '#/recipe/grandmas-goulash', '.page-recipe');
  assert.match(await page.textContent('.gear'), /PossibleCooker/);
  assert.equal((await page.$$('.steps-detail .step')).length, 2);
  assert.match(await page.textContent('.steps-detail'), /4 hr/);
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('cook mode: get ready, one step at a time by tap, keys, swipe and the step list', async () => {
  await go(page, '#/recipe/smashburgers', '.page-recipe');
  await page.click('#rec-cook');
  await page.waitForSelector('.cook.is-ready');
  assert.match(await page.textContent('.cook-facts'), /About 30 min for the whole plate/);
  await page.click('.cook-gather-row >> nth=0');
  await page.waitForSelector('.cook-gather-row.is-on');
  await shot(page, 'ready-390');
  await page.click('#cook-next');
  await page.waitForSelector('.cook.is-step');
  const n = Number(await page.getAttribute('.cook', 'data-n'));
  assert.equal(n, 8, 'five burger steps and three for the fries, in one list');
  assert.equal(await stepKey(page), 'main:0', 'the griddle heats first: the burgers take the longest');
  const size = await page.$eval('.cook-step-text', (el) => parseFloat(getComputedStyle(el).fontSize));
  assert.ok(size >= 23, `step text is large on a phone (${size}px)`);
  assert.match(await page.textContent('.cook-title'), /Step 1 of 8/);
  assert.match(await page.textContent('.cook-setting'), /Blackstone, medium-high/);
  assert.match(await page.textContent('.cook-ings'), /2 lb lean ground beef/);
  assert.match(await page.textContent('.cook-dish-tag'), /Blackstone smashburgers\s*step 1 of 5/);
  // Arrow keys (and a TV remote's left / right).
  await page.keyboard.press('ArrowRight');
  await waitFor(async () => (await stepKey(page)) === 'side0:0');
  assert.match(await page.textContent('.cook-ings'), /26 oz frozen fries/);
  await page.keyboard.press('ArrowLeft');
  await waitFor(async () => (await stepKey(page)) === 'main:0');
  await page.keyboard.press('MediaTrackNext');
  await waitFor(async () => (await stepKey(page)) === 'side0:0');
  // Swipe left for the next step.
  await page.evaluate(() => {
    const el = document.querySelector('.cook-stage');
    const touch = (x) => [new Touch({ identifier: 1, target: el, clientX: x, clientY: 300 })];
    el.dispatchEvent(new TouchEvent('touchstart', { touches: touch(320), changedTouches: touch(320), bubbles: true }));
    el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: touch(90), bubbles: true }));
  });
  await waitFor(async () => (await stepKey(page)) === 'side0:1');
  assert.match(await page.textContent('.cook-setting'), /400°F/);
  assert.match(await page.textContent('.cook-dish-tag'), /Air-fryer fries\s*step 2 of 3/);
  assert.ok(await noOverflow(page));
  await shot(page, 'step-390');
  await next(page);
  assert.equal(await stepKey(page), 'main:1', 'back to the burgers while the fries cook');
  // Every step, in order; tap one to go there.
  await page.click('[data-action="cook:steps"]');
  await page.waitForSelector('dialog[open] .cook-step');
  assert.equal((await page.$$('dialog[open] .cook-step')).length, 8);
  assert.equal((await page.$$('dialog[open] .cook-step.is-done')).length, 3);
  await shot(page, 'steps-sheet-390');
  await page.click('dialog[open] .cook-step >> nth=2');
  await waitFor(async () => (await stepKey(page)) === 'side0:1');
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('timers keep running across steps, ring with a banner, and survive a reload', async () => {
  assert.equal(await stepKey(page), 'side0:1');
  await page.click('.cook-timer-start');
  await page.waitForSelector('.cook-timer.is-running');
  assert.match(await page.textContent('.cook-timer-clock'), /^1[12]:\d\d$/, 'a 12 minute timer (the low end of 12–18)');
  await shot(page, 'timer-390');
  // Back to the griddle step: the fries' timer rides along at the bottom.
  await page.keyboard.press('ArrowLeft');
  await waitFor(async () => (await stepKey(page)) === 'side0:0');
  await page.keyboard.press('ArrowLeft');
  await waitFor(async () => (await stepKey(page)) === 'main:0');
  await page.waitForSelector('.cook-dock .cook-pill.is-running');
  await page.click('.cook-timer-start'); // heat the Blackstone, 10 minutes
  await page.waitForSelector('.cook-step-card .cook-timer.is-running');
  await page.clock.fastForward(60_000);
  await waitFor(async () => /^(10|11):\d\d$/.test(await page.textContent('.cook-dock .cook-pill b')));
  // Reload in the middle of dinner: same step, both timers still counting.
  await page.reload();
  await page.waitForSelector('.cook.is-step');
  assert.equal(await stepKey(page), 'main:0', 'picked up on the same step');
  assert.match(await page.textContent('.cook-resumed'), /Picked up where you left off/);
  await page.waitForSelector('.cook-dock .cook-pill.is-running');
  await page.waitForSelector('.cook-step-card .cook-timer.is-running');
  // The Blackstone timer finishes first: a banner over everything, and the step says done.
  await page.clock.fastForward(9 * 60_000 + 5000);
  await page.waitForSelector('#cook-alert .cook-alert-row');
  assert.match(await page.textContent('#cook-alert'), /Timer done.*Blackstone smashburgers: 10 min/s);
  await page.waitForSelector('.cook-step-card .cook-timer.is-done');
  await shot(page, 'alert-390');
  await page.click('#cook-alert [data-action="cook:timer-add"]');
  await waitFor(async () => !(await page.$('#cook-alert')));
  await page.waitForSelector('.cook-step-card .cook-timer.is-running');
  await page.clock.fastForward(61_000);
  await page.waitForSelector('#cook-alert .cook-alert-row');
  await page.click('#cook-alert [data-action="cook:timer-ack"]');
  await waitFor(async () => !(await page.$('#cook-alert')));
  // The fries ring while we're on another step: the banner and the pill both say so; tap the pill to go back.
  await page.clock.fastForward(60_000);
  await page.waitForSelector('#cook-alert .cook-alert-row');
  assert.match(await page.textContent('#cook-alert'), /Air-fryer fries: 12–18 min per batch/);
  await page.waitForSelector('.cook-dock .cook-pill.is-done');
  await page.click('.cook-dock .cook-pill');
  await waitFor(async () => (await stepKey(page)) === 'side0:1');
  await page.click('.cook-step-card [data-action="cook:timer-ack"]');
  await waitFor(async () => !(await page.$('#cook-alert')));
  await page.waitForSelector('.cook-timer-start'); // the next batch can start a fresh one
  // Any step can have its own timer.
  await page.click('[data-action="cook:timer-pick"]');
  await page.click('dialog[open] [data-action="cook:timer-new"][data-minutes="5"]');
  await page.waitForSelector('.cook-timer.is-running');
  await page.click('[data-action="cook:timer-pause"]');
  await page.waitForSelector('.cook-timer.is-paused');
  await page.click('[data-action="cook:timer-cancel"]');
  await waitFor(async () => !(await page.$('.cook-timer.is-paused')));
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('cook mode on a laptop and on the TV: big type, the step beside what it needs', async () => {
  for (const [vp, name, min] of [[DESKTOP, '1280', 36], [TV, '1920x1080', 50]]) {
    const p = await join(big, vp);
    await go(p, `#/cook/${TODAY}`, '.cook.is-ready');
    assert.ok(await noOverflow(p));
    await shot(p, `ready-${name}`);
    await waitFor(() => p.evaluate(() => document.activeElement?.id === 'cook-next'));
    assert.equal(await p.evaluate(() => document.activeElement?.id), 'cook-next', 'a remote starts on Next');
    await p.keyboard.press('Enter');
    await p.waitForSelector('.cook.is-step');
    await p.keyboard.press('ArrowRight');
    await waitFor(async () => (await stepKey(p)) === 'side0:0');
    await p.keyboard.press('ArrowRight');
    await waitFor(async () => (await stepKey(p)) === 'side0:1');
    const size = await p.$eval('.cook-step-text', (el) => parseFloat(getComputedStyle(el).fontSize));
    assert.ok(size >= min, `step text at ${name} is ${size}px`);
    assert.equal(await p.evaluate(() => document.activeElement?.id), 'cook-next', 'focus stays on Next from step to step');
    await p.keyboard.press('MediaPlayPause');
    await p.waitForSelector('.cook-timer.is-running');
    assert.ok(await p.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1), 'cook mode fits the screen: nothing scrolls behind it');
    await shot(p, `step-${name}`);
    await p.click('[data-action="cook:timer-cancel"]');
    await p.evaluate(() => localStorage.removeItem('bfdp.cook.session'));
    await p.close();
  }
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('finish: mark cooked (the pantry drops), then the leftovers question', async () => {
  await go(page, `#/cook/${TODAY}`, '.cook');
  const n = Number(await page.getAttribute('.cook', 'data-n'));
  for (let i = 0; i < n + 1 && (await stepKey(page)) !== 'finish'; i++) await next(page);
  await page.waitForSelector('.cook.is-finish');
  assert.match(await page.textContent('.cook-uses'), /takes what it used out of the pantry: .*lean ground beef/);
  await shot(page, 'finish-390');
  await page.click('#cook-done');
  await page.waitForSelector('.cook-finish .lo-ask');
  let s = await familyState(page);
  assert.equal(s.plan[TODAY].status, 'cooked');
  assert.equal(s.pantry.beef.qty, 1, '3 lb less the 2 lb the burgers used');
  assert.equal(s.pantry.buns.qty, 3);
  await hideToast(page);
  await shot(page, 'leftovers-390');
  await page.click('.cook-finish [data-action="leftovers:save"][data-n="4"]');
  await page.waitForSelector('.page-tonight');
  s = await familyState(page);
  assert.deepEqual({ dinner: s.leftovers[TODAY].dinner, servings: s.leftovers[TODAY].servings, saved: s.leftovers[TODAY].saved, useBy: s.leftovers[TODAY].useBy },
    { dinner: 'smashburgers', servings: 4, saved: 4, useBy: '2026-11-19' });
  await page.waitForSelector('.kicker-done');
  // Cook mode starts fresh next time, and its timers are gone.
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('bfdp.cook.session'))), null);
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('leftovers wait on Tonight: eat one, or make it a leftover night', async () => {
  await go(page, '#/tonight', '.page-tonight');
  await hideToast(page);
  assert.match(await page.textContent('.use-first .lo-row'), /Blackstone smashburgers.*Leftovers: 4 servings, good through Thursday/s);
  assert.equal(await page.locator('.lo-card').count(), 0, 'the question was already answered');
  await page.click('[data-action="leftovers:ate"]');
  await waitFor(async () => (await familyState(page)).leftovers[TODAY].servings === 3);
  await hideToast(page);
  await page.evaluate(() => document.querySelector('.use-first')?.scrollIntoView({ block: 'start' }));
  await shot(page, 'tonight-leftovers-390');
  await page.click('[data-action="leftovers:night"]');
  await page.waitForSelector('dialog[open] [data-action="leftovers:night-set"]');
  assert.match(await page.textContent('dialog[open]'), /Instead of Chicken tikka masala/);
  await page.click(`dialog[open] [data-action="leftovers:night-set"][data-night="${TOMORROW}"]`);
  let s = await waitFor(async () => { const x = await familyState(page); return x.plan[TOMORROW].status === 'away' ? x : null; });
  assert.deepEqual(s.plan[TOMORROW].away, { reason: 'Leftovers', note: 'Blackstone smashburgers, from Monday', from: TODAY });
  assert.equal(s.plan[TOMORROW].dinner, 'tikka-masala', 'the dinner it bumped is kept, to bring back');
  assert.equal(s.leftovers[TODAY].night, TOMORROW);
  await page.waitForSelector('.menu-row.is-away');
  assert.match(await page.textContent('.menu-row.is-away'), /Leftover night/);
  // The next day Tonight says so; cooking after all brings the dinner back.
  await page.clock.setSystemTime(new Date('2026-11-17T17:30:00-06:00'));
  await page.reload();
  await page.waitForSelector('.hero-leftover');
  assert.match(await page.textContent('.hero-leftover'), /Leftover night.*3 servings.*165°F/s);
  await shot(page, 'leftover-night-390');
  await page.click('.hero-leftover [data-action="night:back"]');
  s = await waitFor(async () => { const x = await familyState(page); return x.plan[TOMORROW].status === 'planned' ? x : null; });
  assert.equal(s.plan[TOMORROW].dinner, 'tikka-masala');
  await page.clock.setSystemTime(NOW);
  await page.reload();
  await page.waitForSelector('.page-tonight');
  // Not cooked after all: the pantry gets its food back and the leftovers go away.
  await page.click('[data-action="night:uncook"]');
  s = await waitFor(async () => { const x = await familyState(page); return x.plan[TODAY].status === 'planned' ? x : null; });
  assert.equal(s.pantry.beef.qty, 3);
  assert.equal(s.leftovers?.[TODAY], undefined);
  // Marked cooked from Tonight's own button, the question is asked there.
  await hideToast(page);
  await page.click('[data-action="tonight:cooked"]');
  await page.waitForSelector('.lo-card .lo-ask');
  await page.click('.lo-card [data-action="leftovers:save"][data-n="0"]');
  await waitFor(async () => (await familyState(page)).leftovers?.[TODAY]?.saved === 0);
  await waitFor(async () => !(await page.$('.lo-card')));
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('the recipe box: search and the filters that matter to this family', async () => {
  await go(page, '#/recipes', '.page-recipes');
  const all = (await page.$$('.r-card')).length;
  assert.ok(all > 30);
  assert.match(await page.textContent('.r-card'), /≈ [\d,]+ cal, \d+ g protein/);
  await page.click('#rf-lean');
  await page.waitForSelector('#rf-lean.is-on');
  const lean = (await page.$$('.r-card')).length;
  assert.ok(lean > 0 && lean < all);
  assert.equal((await page.$$('.r-card .lean-mark')).length, lean, 'every card left is marked lean');
  await shot(page, 'recipes-lean-390');
  await page.click('#rf-lean');
  await waitFor(async () => (await cards(page)) === all);
  await page.selectOption('#rf-equipment', 'air fryer');
  const air = await waitFor(async () => { const c = await cards(page); return c < all ? c : 0; });
  assert.ok(air > 0);
  await page.selectOption('#rf-time', '30');
  await waitFor(async () => (await cards(page)) < air);
  await page.selectOption('#rf-time', '');
  await waitFor(async () => (await cards(page)) === air);
  await page.selectOption('#rf-equipment', 'possible cooker');
  const cooker = await waitFor(async () => { const c = await cards(page); return c !== air && c < all ? c : 0; });
  assert.ok(cooker >= 10, `the PossibleCooker dinners and the family's own (${cooker})`);
  const cookerText = await page.textContent('.r-grid');
  assert.match(cookerText, /goulash/i);
  assert.match(cookerText, /\d+ min hands-on, \d+ hr( \d+ min)? in all/, 'a slow cook says hands-on time and the total');
  assert.doesNotMatch(cookerText, /\d{3} min/, 'never "520 min"');
  await page.selectOption('#rf-protein', 'mixed');
  await page.waitForSelector('.r-empty');
  assert.match(await page.textContent('.r-empty'), /No PossibleCooker dinners match these filters/);
  await page.click('.r-empty [data-action="rec:clear"]');
  await waitFor(async () => (await page.$$('.r-card')).length === all);
  // Search reads ingredients too.
  await page.fill('#recipe-search', 'tikka');
  await waitFor(async () => (await page.$$('.r-card')).length >= 1 && (await page.$$('.r-card')).length < 6);
  assert.match(await page.textContent('.r-grid'), /tikka masala/i);
  await page.fill('#recipe-search', '');
  // "Can make now": nothing until the pantry covers a whole dinner, with a way out.
  await page.click('#rf-makeable');
  await page.waitForSelector('.r-empty');
  assert.match(await page.textContent('.r-empty'), /Closest to ready/);
  await page.click('.r-empty [data-action="rec:clear"]');
  await waitFor(async () => (await cards(page)) === all);
  await page.selectOption('#rf-sort', 'ready');
  await waitFor(async () => /\d+ of \d+ ingredients on hand/.test(await page.textContent('.r-card .r-pantry')));
  await page.selectOption('#rf-sort', 'az');
  await waitFor(async () => (await page.inputValue('#rf-sort')) === 'az' && (await cards(page)) === all);
  assert.ok(await noOverflow(page));
  for (const [vp, name] of [[PHONE, '390'], [DESKTOP, '1280'], [TV, '1920x1080']]) {
    const p = vp === PHONE ? await newPage(ctx, vp) : await join(big, vp);
    await go(p, '#/recipes', '.page-recipes');
    assert.ok(await noOverflow(p));
    await p.waitForTimeout(400);
    await shot(p, `recipes-${name}`);
    await p.close();
  }
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('dead ends: nothing planned, a night out, and a recipe that isn’t on tonight’s plan', async () => {
  await go(page, '#/cook/2026-12-25', '.cook');
  assert.match(await page.textContent('.cook .empty'), /Nothing planned for/);
  assert.ok(await page.$('.cook [data-action="night:pick"]'), 'a way to pick a dinner');
  await go(page, '#/cook/d/tikka-masala', '.cook.is-ready');
  const n = Number(await page.getAttribute('.cook', 'data-n'));
  await next(page);
  await page.click('[data-action="cook:steps"]');
  await page.click(`dialog[open] .cook-step >> nth=${n - 1}`);
  await waitFor(async () => /^Step \d+ of \d+/.test(await page.textContent('.cook-title')) && (await page.textContent('.cook-title')).includes(`Step ${n} of ${n}`));
  await next(page);
  await page.waitForSelector('.cook.is-finish');
  assert.match(await page.textContent('.cook-finish'), /isn’t on tonight’s plan/);
  assert.ok(await page.$('.cook-finish [data-action="rec:tonight"]'));
  await page.click('.cook-finish [data-action="cook:exit"]');
  await page.waitForSelector('.page-recipe');
  await go(page, '#/recipe/not-a-real-dinner', '.empty');
  assert.match(await page.textContent('.empty'), /isn’t in the box/);
  assert.equal(errors.length, 0, errors.join('\n'));
});

test('a dinner that was cooked but never marked: Tonight asks the next day, then asks about leftovers', async () => {
  await page.clock.setSystemTime(new Date('2026-11-18T07:45:00-06:00'));
  await go(page, '#/tonight', '.page-tonight');
  await page.waitForSelector('.forgot-card');
  assert.match(await page.textContent('.forgot-card'), /Chicken tikka masala was on the plan for Tuesday and isn’t marked cooked/);
  await page.click('.forgot-card [data-action="night:cooked"]');
  const s = await waitFor(async () => { const x = await familyState(page); return x.plan[TOMORROW].status === 'cooked' ? x : null; });
  assert.equal(s.plan[TOMORROW].cookedBy, 'Family');
  await waitFor(async () => !(await page.$('.forgot-card')));
  await page.waitForSelector('.lo-card .lo-ask');
  assert.match(await page.textContent('.lo-card'), /Any leftovers from last night\?\s*Chicken tikka masala\./);
  await hideToast(page);
  await page.evaluate(() => document.querySelector('.lo-card')?.scrollIntoView({ block: 'center' }));
  await shot(page, 'tonight-morning-after-390');
  await page.click('.lo-card [data-action="leftovers:save"][data-n="2"]');
  await waitFor(async () => (await familyState(page)).leftovers?.[TOMORROW]?.servings === 2);
  await page.waitForSelector('.use-first .lo-row');
  await page.clock.setSystemTime(NOW);
  assert.equal(errors.length, 0, errors.join('\n'));
});
