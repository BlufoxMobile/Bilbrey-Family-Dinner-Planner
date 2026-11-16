// Dev-only: the design review sheet. Screenshots of the main screens at phone, desktop and TV
// size in both themes, into dev/screenshots/design-<screen>-<size>-<theme>.png.
//   node dev/shoot-design.mjs                 everything
//   node dev/shoot-design.mjs 390 light       one size, one theme
//   node dev/shoot-design.mjs tv dark tonight one screen
// Sizes: 390 (390×844 @2x), 1280 (1280×800), tv (1920×1080: the 960-wide TV canvas at 2×).
import { chromium } from '../tests/node_modules/playwright/index.mjs';
import { startStatic } from './serve.mjs';
import { startMockApi } from './mock-api.mjs';

const [onlySize, onlyTheme, onlyScreen] = process.argv.slice(2);
const SIZES = {
  390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 },
  1280: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  tv: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, tv: true },
};
const SCREENS = [['tonight', '.page-tonight'], ['plan', '.page-plan'], ['list', '.page-list'], ['pantry', '.page-pantry'], ['recipes', '.page-recipes'], ['family', '.page-family'],
  ['recipe', '.page-recipe'], ['budget', '.page-budget'], ['lunch', '.page-lunch'], ['cook', '.cook'], ['sheet', 'dialog[open]']];

const staticSrv = await startStatic({ port: 0, quiet: true });
const api = await startMockApi({ port: 0, quiet: true });
const base = `http://127.0.0.1:${staticSrv.address().port}/Bilbrey-Family-Dinner-Planner/`;
const apiBase = `http://127.0.0.1:${api.server.address().port}`;
const browser = await chromium.launch();
const NOW = new Date('2026-11-16T17:30:00-06:00');
const errors = [];

// One family, set up once; every size and theme starts from its saved state.
const seed = await browser.newContext({ viewport: SIZES[390].viewport });
const sp = await seed.newPage();
await sp.clock.install({ time: NOW });
await sp.goto(`${base}?api=${encodeURIComponent(apiBase)}`);
await sp.click('[data-who="Jeff"]');
await sp.fill('#pc-new', 'tacos');
await sp.fill('#pc-again', 'tacos');
await sp.click('button[type=submit]');
await sp.waitForSelector('.page-tonight');
await sp.click('[data-action="tonight:plan-week"]');
await sp.waitForSelector('.hero-photo');
await sp.waitForTimeout(800);
const dinner = await sp.evaluate(() => document.querySelector('.hero-photo').getAttribute('href').split('/').pop());
const state = await seed.storageState();
await seed.close();

for (const [size, cfg] of Object.entries(SIZES)) {
  if (onlySize && onlySize !== size) continue;
  for (const theme of ['light', 'dark']) {
    if (onlyTheme && onlyTheme !== theme) continue;
    const ctx = await browser.newContext({ viewport: cfg.viewport, deviceScaleFactor: cfg.deviceScaleFactor, colorScheme: theme, storageState: state, serviceWorkers: 'block' });
    await ctx.addInitScript(([tv, th]) => {
      try {
        if (tv) localStorage.setItem('bfdp.v2.display', '{"tv":"on"}');
        const d = JSON.parse(localStorage.getItem('bfdp.v2.device') || '{}'); d.theme = tv ? th : 'auto'; localStorage.setItem('bfdp.v2.device', JSON.stringify(d));
      } catch { /* first load */ }
    }, [!!cfg.tv, theme]);
    const page = await ctx.newPage();
    await page.clock.install({ time: NOW });
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${size}/${theme}: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`${size}/${theme}: ${e}`));
    for (const [name, sel] of SCREENS) {
      if (onlyScreen && onlyScreen !== name) continue;
      const hash = name === 'recipe' ? `#/recipe/${dinner}` : name === 'cook' ? '#/cook/2026-11-16' : name === 'sheet' ? '#/plan' : `#/${name}`;
      await page.goto(`${base}${hash}`);
      if (name === 'sheet') { await page.waitForSelector('.page-plan'); await page.click('[data-action="plan:tap"][data-date="2026-11-18"]'); }
      await page.waitForSelector(sel);
      await page.waitForTimeout(900);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (overflow > 0) errors.push(`${size}/${theme}/${name}: overflows by ${overflow}px`);
      await page.screenshot({ path: `dev/screenshots/design-${name}-${size}-${theme}.png`, fullPage: !!process.env.FULL && name !== 'sheet' && name !== 'cook' });
      if (name === 'sheet') await page.keyboard.press('Escape');
    }
    await ctx.close();
  }
}
console.log(errors.length ? errors.join('\n') : 'no errors, no overflow');
await browser.close();
staticSrv.close();
api.server.close();
