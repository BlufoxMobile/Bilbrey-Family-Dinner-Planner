// Dev-only: review sheets of the long screens. A phone page is taller than one screenshot can show
// legibly, so each screen is shot one viewport at a time and the tiles are laid side by side:
// dev/screenshots/review-<screen>-<theme>.png (four 390 × 844 tiles across).
//   node dev/shoot-review.mjs                 every screen, light and dark
//   node dev/shoot-review.mjs dark pantry     one theme, one screen
//   node dev/shoot-review.mjs light '' tv      a wide size (1280, tv = 1920 × 1080, firetv = 960 × 540):
//                                              up to three screenfuls each, review-<screen>-<theme>-<size>[-n].png
// The family here has a pantry, a cooked dinner with leftovers, a logged toss, receipts and a
// plan-ahead result, so the cards the feature teams added all have something to show.
import { chromium } from '../tests/node_modules/playwright/index.mjs';
import { startStatic } from './serve.mjs';
import { startMockApi } from './mock-api.mjs';

const [onlyTheme, onlyScreen, wide] = process.argv.slice(2);
const WIDE = { 1280: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }, tv: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, tv: true },
  firetv: { viewport: { width: 960, height: 540 }, deviceScaleFactor: 2, tv: true } }[wide];
const VIEW = { width: 390, height: 844 };
const NOW = new Date('2026-11-16T17:30:00-06:00');
const TODAY = '2026-11-16';
const SCREENS = [['tonight', '#/tonight', '.page-tonight'], ['plan', '#/plan', '.page-plan'], ['pantry', '#/pantry', '.page-pantry'], ['budget', '#/budget', '.page-budget'],
  ['family', '#/family', '.page-family'], ['lunch', '#/lunch', '.page-lunch'], ['list', '#/list', '.page-list'], ['recipes', '#/recipes', '.page-recipes'],
  ['recipe', '#/recipe/cooker-pot-roast', '.page-recipe'], ['cook', `#/cook/${TODAY}`, '.cook'], ['checkin', '#/checkin', '.page-checkin'], ['products', '#/products', '.page-products']];

const SHEETS = [['ahead', '#/plan', '.page-plan', '[data-action="ahead:open"]'], ['more', '#/plan', '.page-plan', '[data-action="plan:more"]'],
  ['ideas', '#/plan', '.page-plan', '[data-action="plan:more"]', 'dialog[open]', '[data-action="ideas:open"]'], ['leftovers', '#/tonight', '.page-tonight', '[data-action="leftovers:more"]'],
  ['night', '#/plan', '.page-plan', '[data-action="plan:tap"][data-date="2026-11-18"]'], ['move', '#/plan', '.page-plan', '[data-action="plan:tap"][data-date="2026-11-18"]', 'dialog[open]', '[data-action="night:move"]'],
  ['away', '#/plan', '.page-plan', '[data-action="plan:tap"][data-date="2026-11-18"]', 'dialog[open]', '[data-action="night:away"]'],
  ['not-for-us', '#/plan', '.page-plan', '[data-action="plan:tap"][data-date="2026-11-18"]', 'dialog[open]', '.night-rate [data-action="vote:dinner"][data-value="-1"]'],
  ['easy', '#/tonight', '.page-tonight', '[data-action="easy:open"]'], ['change-side', '#/plan', '.page-plan', '[data-action="plan:tap"][data-date="2026-11-18"]', 'dialog[open]', '[data-action="side:sub"]'],
  ['gone', '#/pantry', '.page-pantry', '[data-action="pan:gone"]'], ['item', '#/list', '.page-list', '[data-action="list:item"]'], ['lunch-edit', '#/lunch', '.page-lunch', '[data-action="lunch:edit"]'],
  ['lunch-add', '#/lunch', '.page-lunch', '[data-action="lunch:add"]'], ['trip', '#/list', '.page-list', '[data-action="trip:new"]'], ['receipt', '#/budget', '.page-budget', '[data-action="rcpt:scan"]'],
  // Not sheets, but opened the same way: the recipe's cost list, the dinner picker, and the card plan-ahead leaves on the Plan.
  ['cost', '#/recipe/cooker-beef-tips-gravy', '.page-recipe', '#recipe-cost > summary', '#recipe-cost[open]'], ['pick', '#/plan', '.page-plan', '[data-action="plan:tap"][data-date="2026-11-18"]', '.pick-list', '[data-action="night:pick"]'],
  ['ahead-result', '#/plan', '.page-plan', '[data-action="ahead:open"]', '.ahead-card', '[data-action="ahead:go"]']];

const staticSrv = await startStatic({ port: 0, quiet: true });
const api = await startMockApi({ port: 0, quiet: true });
const base = `http://127.0.0.1:${staticSrv.address().port}/Bilbrey-Family-Dinner-Planner/`;
const apiBase = `http://127.0.0.1:${api.server.address().port}`;
const browser = await chromium.launch();
// OUT=dir puts the pictures somewhere else (the gauntlet keeps one folder per round).
const OUT = process.env.OUT || 'dev/screenshots';
await import('node:fs').then((fs) => fs.mkdirSync(OUT, { recursive: true }));

const seed = await browser.newContext({ viewport: VIEW });
const sp = await seed.newPage();
await sp.clock.install({ time: NOW });
await sp.goto(`${base}?api=${encodeURIComponent(apiBase)}`);
await sp.waitForSelector('#pc-new');
await sp.waitForTimeout(500);
await sp.screenshot({ path: `${OUT}/review-first-run.png` });
await sp.fill('#pc-new', 'tacos');
await sp.fill('#pc-again', 'tacos');
await sp.click('button[type=submit]');
await sp.waitForSelector('.page-tonight');
await sp.click('[data-action="tonight:plan-week"]');
await sp.waitForSelector('.hero-photo');
const key = await sp.evaluate(() => JSON.parse(localStorage.getItem('bfdp.v2.device')).key);
let plan = null;
for (let i = 0; i < 100 && !plan?.['2026-11-22']; i++) { await new Promise((r) => setTimeout(r, 100)); plan = (await (await fetch(`${apiBase}/__mock/state`)).json()).state.plan; }
const at = '2026-11-15T23:30:00.000Z';
const item = (qty, since, extra = {}) => ({ qty, stocked: false, ...(since ? { since } : {}), by: 'Family', at, ...extra });
const set = (path, value) => ({ op: 'set', path, value });
const ops = [
  ...Object.entries({ chickenThighs: item(9, '2026-09-03'), chicken: item(6, '2026-09-10'), eyeRoundSteak: item(2.5, '2026-07-01'), beef: item(3, null), lettuce: item(2, '2026-11-12'),
    buns: item(8, '2026-11-14'), broccoli: item(6, '2026-11-01'), milk: item(8, null), potatoes: item(10, '2026-11-14'), salt: { qty: null, stocked: true, by: 'Family', at } }).map(([id, v]) => set(['pantry', id], v)),
  set(['plan', '2026-11-15'], { ...plan['2026-11-18'], status: 'cooked', cookedAt: at, cookedBy: 'Family', deducted: {} }),
  set(['leftovers', '2026-11-15'], { dinner: plan['2026-11-18'].dinner, title: 'Smoky paprika chicken', servings: 3, saved: 4, useBy: '2026-11-18', by: 'Family', at }),
  set(['plan', '2026-11-14'], { ...plan['2026-11-19'], status: 'planned' }),
  set(['waste', 'w1'], { id: 'cornCobs', name: 'Corn on the cob', qty: 4, unit: 'ears', cost: 3.2, reason: 'tossed', date: '2026-11-10', by: 'Family', at }),
  set(['receipts'], [{ id: 'r1', date: '2026-11-01', store: 'sams', amount: 212.4, by: 'Family' }, { id: 'r2', date: '2026-11-09', store: 'jewel', amount: 48.75, by: 'Family' }]),
  set(['settings', 'busyNights'], [1, 3]),
];
const sent = await fetch(`${apiBase}/api/ops`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Family-Key': key }, body: JSON.stringify({ ops, by: 'Family', clientId: 'review', batchId: 'review-seed' }) });
if (sent.status !== 200) console.log('seed failed', sent.status, await sent.text());
await sp.reload();
await sp.waitForSelector('.page-tonight');
await sp.waitForTimeout(600);
const state = await seed.storageState();
await seed.close();

const sheet = await (await browser.newContext({ viewport: { width: VIEW.width * 4 + 50, height: VIEW.height + 20 } })).newPage();
for (const theme of ['light', 'dark']) {
  if (onlyTheme && onlyTheme !== theme) continue;
  const ctx = await browser.newContext({ viewport: WIDE?.viewport || VIEW, deviceScaleFactor: WIDE?.deviceScaleFactor || 1, colorScheme: theme, storageState: state, serviceWorkers: 'block' });
  if (WIDE) {
    await ctx.addInitScript(([tv, th]) => {
      try {
        if (tv) localStorage.setItem('bfdp.v2.display', '{"tv":"on"}');
        const d = JSON.parse(localStorage.getItem('bfdp.v2.device') || '{}'); d.theme = tv ? th : 'auto'; localStorage.setItem('bfdp.v2.device', JSON.stringify(d));
      } catch { /* first load */ }
    }, [!!WIDE.tv, theme]);
  }
  const page = await ctx.newPage();
  await page.clock.install({ time: NOW });
  page.on('pageerror', (e) => console.log(`${theme}: ${e}`));
  for (const [name, hash, sel] of SCREENS) {
    if (onlyScreen && onlyScreen !== name) continue;
    await page.goto(`${base}${hash}`);
    await page.waitForSelector(sel);
    await page.waitForTimeout(700);
    if (WIDE) {
      // The TV scrolls its own main column, a wide window scrolls the page: find whichever moves.
      const step = await page.evaluate(() => {
        const el = [...document.querySelectorAll('main, .app-main, #view, .page')].find((e) => e.scrollHeight > e.clientHeight + 8 && /auto|scroll/.test(getComputedStyle(e).overflowY));
        window.__scroller = el || document.scrollingElement;
        return { h: window.__scroller.clientHeight, total: window.__scroller.scrollHeight };
      });
      for (let n = 0; n < 3 && n * (step.h - 80) < step.total - 80; n++) {
        await page.evaluate((top) => window.__scroller.scrollTo({ top, behavior: 'instant' }), n * (step.h - 80));
        await page.waitForTimeout(150);
        await page.screenshot({ path: `${OUT}/review-${name}-${theme}-${wide}${n ? `-${n + 1}` : ''}.png` });
      }
      continue;
    }
    const tiles = [];
    const total = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0, n = 0; y < total && n < 8; y += VIEW.height - 150, n++) {
      await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
      await page.waitForTimeout(120);
      tiles.push((await page.screenshot()).toString('base64'));
    }
    for (let i = 0; i < tiles.length; i += 4) {
      await sheet.setContent(`<body style="margin:0;display:flex;gap:10px;padding:10px;background:#888">${tiles.slice(i, i + 4).map((t) => `<img width="${VIEW.width}" height="${VIEW.height}" src="data:image/png;base64,${t}">`).join('')}</body>`);
      await sheet.screenshot({ path: `${OUT}/review-${name}-${theme}${i ? `-${i / 4 + 1}` : ''}.png` });
    }
  }
  // The sheets the feature teams added, each opened from the screen that owns it.
  if (!onlyScreen || onlyScreen === 'sheets') {
    const tiles = [];
    for (const [name, hash, sel, opener, shown = 'dialog[open]', next = null] of SHEETS) {
      try {
        await page.goto(`${base}${hash}`);
        await page.waitForSelector(sel);
        await page.waitForTimeout(500);
        await page.locator(opener).first().click({ timeout: 3000 });
        if (next) { await page.waitForSelector('dialog[open]', { timeout: 3000 }); await page.waitForTimeout(400); await page.locator(next).first().click({ timeout: 3000 }); await page.waitForTimeout(500); }
        if (name !== 'prefs') await page.waitForSelector(shown, { timeout: 6000 });
        if (shown !== 'dialog[open]') await page.locator(shown).first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(700);
        if (WIDE) await page.screenshot({ path: `${OUT}/review-sheet-${name}-${theme}-${wide}.png` });
        else tiles.push((await page.screenshot()).toString('base64'));
        await page.keyboard.press('Escape');
        await page.waitForTimeout(350);
      } catch (e) { console.log(`${theme}: sheet ${name} not shot: ${String(e).split('\n')[0]}`); }
    }
    for (let i = 0; i < tiles.length; i += 4) {
      await sheet.setContent(`<body style="margin:0;display:flex;gap:10px;padding:10px;background:#888">${tiles.slice(i, i + 4).map((t) => `<img width="${VIEW.width}" height="${VIEW.height}" src="data:image/png;base64,${t}">`).join('')}</body>`);
      await sheet.screenshot({ path: `${OUT}/review-sheets-${theme}${i ? `-${i / 4 + 1}` : ''}.png` });
    }
  }
  await ctx.close();
}
await browser.close();
staticSrv.close();
api.server.close();
