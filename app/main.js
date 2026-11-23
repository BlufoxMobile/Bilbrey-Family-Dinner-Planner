// Boot, routing, the app shell and the shared `app` context the views use.
import { apiBase, VERSION } from './config.js';
import { loadDb } from './data.js';
import { Store, settingsOf } from './state.js';
import { todayISO, SHARED_PROFILE } from './util.js';
import { followRenames } from './planner.js';
import {
  html, ic, setHTML, toast, closeSheet, refreshLiveSheet, renderSheet, installPhotoFallback, sheetOpen, hideStaleToast,
} from './ui.js';
import * as tonight from './views/tonight.js';
import * as planView from './views/plan.js';
import * as listView from './views/list.js';
import * as pantryView from './views/pantry.js';
import * as recipesView from './views/recipes.js';
import * as recipeView from './views/recipe.js';
import * as budgetView from './views/budget.js';
import * as familyView from './views/family.js';
import * as cookView from './views/cook.js';
import * as lunchView from './views/lunch.js';
import * as receiptsView from './views/receipts.js';
import * as productsView from './views/products.js';
import { importReceipts } from './receipts.js';
import { importStorePhotos, fetchStorePhoto } from './photos.js';
import * as onboarding from './views/onboarding.js';
import * as sheets from './views/sheets.js';
import * as ideasView from './views/ideas.js';
import * as checkinView from './views/checkin.js';
import * as easyView from './views/easy.js';
import * as motion from './motion.js';
import * as tv from './tv.js';
import * as fx from './fx.js';

const VIEWS = {
  tonight, plan: planView, list: listView, pantry: pantryView, recipes: recipesView, recipe: recipeView,
  budget: budgetView, family: familyView, cook: cookView, lunch: lunchView, receipts: receiptsView, products: productsView, checkin: checkinView,
};
// Phone: five tabs. Recipes live under Plan there; the desktop sidebar lists everything.
const TABS = [
  { id: 'tonight', label: 'Tonight', icon: 'tonight' },
  { id: 'plan', label: 'Plan', icon: 'plan' },
  { id: 'lunch', label: 'Lunch', icon: 'lunch' },
  { id: 'list', label: 'List', icon: 'list' },
  { id: 'pantry', label: 'Pantry', icon: 'pantry' },
];
const MORE = [
  { id: 'recipes', label: 'Recipes', icon: 'recipes' },
  { id: 'budget', label: 'Budget', icon: 'budget' },
  { id: 'checkin', label: 'Weekly check-in', short: 'Check-in', icon: 'chart' },
  { id: 'family', label: 'Family & settings', short: 'Family', icon: 'family' },
];

const ACTIONS = {};
for (const m of [...Object.values(VIEWS), onboarding, sheets, ideasView, easyView]) Object.assign(ACTIONS, m.actions || {});

export const app = {
  db: null,
  store: null,
  ui: { anchor: null, swapPick: null, swapMode: false, recipeQuery: '', recipeFilters: {}, recipeTab: 'rotation', weighSetup: false, pantryQuery: '', listFilter: 'all', lunchWho: null, lunchAnchor: null, productsStore: 'sams', productsQuery: '' },
  route: { view: 'tonight', params: [] },
  // What every screen reads: the saved state, with replaced dinner ids followed (docs/spec/24 §24.8).
  get state() { return followRenames(this.db, this.store.state); },
  get settings() { return settingsOf(this.store.state); },
  today() { return todayISO(); },
  /**
   * One shared profile (docs/spec/20): there is no "who's using this phone". Every screen that
   * still asks gets the family, so every change is stamped "Family".
   */
  who() { return SHARED_PROFILE; },
  /** The one per-person thing a device can choose: whose daily calories line Tonight shows here (or null). */
  todayFor() { return this.store.device.todayFor || null; },
  /** Apply an action result: commit ops, show its message with Undo. */
  commit(res, { quiet = false, undoable = true, onUndo } = {}) {
    if (!res) return false;
    if (res.error || !res.ops?.length) {
      if (res.message && !quiet) toast(res.message);
      return false;
    }
    // Undo puts focus back on the control the change came from (gauntlet r7: it fell to the page top).
    const origin = tv.signatureOf(document.activeElement);
    this.store.commit(res.ops);
    if (!quiet && res.message) {
      toast(res.message, undoable && res.undo?.length ? { undo: () => {
        this.store.commit(res.undo); onUndo?.(); renderSheet(); toast('Undone.');
        requestAnimationFrame(() => setTimeout(() => { if (!tv.focusBySignature(document, origin)) document.querySelector('#view h1, #view .page-title')?.focus?.(); }, 60));
      } } : {});
    }
    return true;
  },
  navigate(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  },
  render: () => scheduleRender(),
};

function parseRoute() {
  const h = (location.hash || '#/tonight').replace(/^#\/?/, '');
  const [view, ...params] = h.split('/').map(decodeURIComponent);
  return { view: VIEWS[view] ? view : 'tonight', params };
}

function syncPill(where = 'rail') {
  const s = app.store;
  const pending = s.pending.length;
  const map = {
    synced: { label: 'Synced', tone: 'ok', icon: 'cloud', long: 'Every phone and the TV show the same plan.' },
    syncing: { label: 'Syncing', tone: 'busy', icon: 'refresh', long: 'Sending your changes to the family.' },
    offline: { label: pending ? 'Saved here' : 'Offline', tone: 'off', icon: 'cloudOff', long: 'Offline — changes are saved on this device and sync when you reconnect.' },
    local: { label: 'This device only', tone: 'off', icon: 'phone', long: 'Using the planner on this device only.' },
    'needs-setup': { label: 'Connect', tone: 'warn', icon: 'lock', long: 'Create the family passcode to share the plan.' },
    'needs-passcode': { label: 'Connect', tone: 'warn', icon: 'lock', long: 'Enter the family passcode to share the plan.' },
    error: { label: 'Sync paused', tone: 'warn', icon: 'cloudOff', long: s.statusDetail || 'Sync paused.' },
  };
  const m = map[s.status] || map.offline;
  // Synced is the normal state, so the top bar says nothing then (docs/spec/29); anything else shows
  // an icon and a word, never color alone. The side rail on wide screens always shows it.
  if (where === 'top' && s.status === 'synced') return '';
  return html`<button type="button" class="sync sync-${m.tone}" data-action="sheet:sync" aria-label="${m.label}. ${m.long}" title="${m.long}">
    ${ic(m.icon, { size: 18 })}<span class="sync-label">${m.label}</span>
  </button>`;
}

// The short bar that marks the current section; it slides between sections during a page transition.
const NAV_MARK = html`<i class="nav-mark" aria-hidden="true"></i>`;

function shell() {
  const active = { recipe: 'recipes', products: 'list', receipts: 'budget' }[app.route.view] || app.route.view;
  const tabActive = active === 'recipes' ? 'plan' : active;
  return html`
    <a class="skip" href="#view">Skip to content</a>
    <aside class="rail" aria-label="Sections">
      <a class="wordmark" href="#/tonight"><span class="wm-mark" aria-hidden="true"></span><span class="wm-text">The Bilbrey<br>Family Dinners</span></a>
      <nav class="rail-nav">
        ${[...TABS, ...MORE].map((t) => html`<a class="rail-link ${active === t.id ? 'is-on' : ''}" href="#/${t.id}" ${active === t.id ? html`aria-current="page"` : ''}>${active === t.id ? NAV_MARK : ''}${ic(t.icon)}<span ${t.short ? html`data-short="${t.short}"` : ''}>${t.label}</span></a>`)}
      </nav>
      <div class="rail-foot">${syncPill()}</div>
    </aside>
    <header class="topbar">
      <a class="wordmark wordmark-sm" href="#/tonight" aria-label="The Bilbrey Family Dinner Planner, tonight"><span class="wm-mark" aria-hidden="true"></span><span class="wm-text">Bilbrey Dinners</span></a>
      <div class="topbar-right">
        ${syncPill('top')}
        <a class="top-link ${active === 'budget' ? 'is-on' : ''}" href="#/budget" ${active === 'budget' ? html`aria-current="page"` : ''}>${ic('budget', { size: 22 })}<span>Budget</span></a>
        <a class="top-link settings-btn ${active === 'family' ? 'is-on' : ''}" href="#/family" ${active === 'family' ? html`aria-current="page"` : ''}>${ic('family', { size: 22 })}<span>Family</span></a>
      </div>
    </header>
    <main id="view" class="view view-${app.route.view}" tabindex="-1"></main>
    <nav class="tabbar" aria-label="Sections">
      ${TABS.map((t) => html`<a class="tab ${tabActive === t.id ? 'is-on' : ''}" href="#/${t.id}" ${tabActive === t.id ? html`aria-current="page"` : ''}>${tabActive === t.id ? NAV_MARK : ''}${ic(t.icon, { size: 24 })}<span>${t.label}</span></a>`)}
    </nav>`;
}

/** Unsaved form input survives background re-renders (sync, other phones' changes). */
function snapshotForms(root) {
  const out = [];
  root.querySelectorAll('form[data-submit] input, form[data-submit] select, form[data-submit] textarea').forEach((el) => {
    if (el.type === 'hidden' || el.type === 'file' || !el.name) return;
    const form = el.form?.dataset.submit;
    if (!form || el.form.dataset.submitted) return;
    const check = el.type === 'checkbox' || el.type === 'radio';
    // A <select> has no defaultValue: it's edited only when it differs from the option the page chose
    // (gauntlet r5: the Add-an-item store snapped back to Sam's after a Jewel tick).
    const initial = el.tagName === 'SELECT' ? ([...el.options].find((o) => o.defaultSelected) || el.options[0])?.value : el.defaultValue;
    const dirty = check ? el.checked !== el.defaultChecked : el.value !== initial;
    if (dirty) out.push({ form, name: el.name, type: el.type, value: el.value, checked: el.checked });
  });
  return out;
}
function restoreForms(root, snap) {
  for (const f of snap) {
    root.querySelectorAll(`form[data-submit="${f.form}"] [name="${f.name}"]`).forEach((el) => {
      if (f.type === 'radio') { if (el.value === f.value) el.checked = f.checked; } else if (f.type === 'checkbox') el.checked = f.checked;
      else el.value = f.value;
    });
  }
}

let renderQueued = false;
let lastView = null;
let lastGateStep = null;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}

export function render() {
  const root = document.getElementById('app');
  if (!app.db || !app.store) return;
  if (onboarding.gateActive(app)) {
    const step = onboarding.gateStep(app);
    const same = lastView === 'gate' && lastGateStep === step;
    const snap = lastView === 'gate' ? snapshotForms(root) : [];
    const wasFocused = same && root.contains(document.activeElement) ? document.activeElement.id : '';
    root.className = 'app is-gate';
    root.removeAttribute('aria-busy');
    setHTML(root, onboarding.render(app));
    restoreForms(root, snap);
    // A redraw of the same screen keeps the focus where a thumb or a TV remote left it; only a new
    // screen moves it (to the passcode box).
    if (wasFocused) document.getElementById(wasFocused)?.focus({ preventScroll: true });
    else if (!same) onboarding.mount?.(app, root);
    document.title = 'The Bilbrey Family Dinner Planner';
    lastView = 'gate';
    lastGateStep = step;
    focusNext();
    return;
  }
  app.route = parseRoute();
  const v = VIEWS[app.route.view];
  const changedView = lastView !== `${app.route.view}/${app.route.params.join('/')}`;
  if (changedView && lastView) hideStaleToast();
  const y = window.scrollY;
  // What has focus, and where every row and number sits, so both survive the redraw.
  const focus = tv.captureFocus(root);
  const moves = changedView ? null : motion.snapshot(root.querySelector('#view'));
  const snap = changedView ? [] : snapshotForms(root);
  root.className = `app ${app.route.view === 'cook' ? 'is-cook' : ''}`;
  root.removeAttribute('aria-busy');
  setHTML(root, shell());
  const main = root.querySelector('#view');
  setHTML(main, v.render(app));
  restoreForms(main, snap);
  v.mount?.(app, main);
  tv.injectSettingRow(main);
  tv.decorate(main);
  document.title = v.title ? `${v.title(app)} — The Bilbrey Family Dinner Planner` : 'The Bilbrey Family Dinner Planner';
  if (changedView) {
    // Mid-shop, the list comes back where you left it (docs/spec/29), even after a reload.
    if (lastView?.startsWith('list/')) { try { sessionStorage.setItem('bfdp.scroll.list', String(y)); } catch { /* private mode */ } }
    let back = 0;
    if (app.route.view === 'list') { try { back = Number(sessionStorage.getItem('bfdp.scroll.list')) || 0; } catch { back = 0; } }
    window.scrollTo({ top: back, behavior: 'instant' });
    fx.enter(main); // a new screen arrives; a re-render never replays it
    if (lastView && lastView !== 'gate') {
      // Driving with a remote or the keyboard from the navigation: stay on it. Otherwise the new screen takes focus: its first
      // control for a remote or a keyboard, the screen itself (for screen readers) for everyone else.
      const onNav = tv.keysMode() && focus?.nav && tv.restoreFocus(root, focus, { nearest: false, only: '.rail, .tabbar, .topbar' });
      if (!onNav && !(tv.keysMode() && tv.focusFirst(main))) main.focus({ preventScroll: true });
    } else if (tv.tvOn()) tv.focusFirst(main);
  } else {
    window.scrollTo({ top: y, behavior: 'instant' });
    if (!sheetOpen()) tv.restoreFocus(root, focus);
    motion.play(main, moves);
  }
  lastView = `${app.route.view}/${app.route.params.join('/')}`;
  focusNext();
}

/** A screen can ask for the focus after the next draw (app.ui.focusNext = an element id): a wrong passcode puts it back in the box. */
function focusNext() {
  const id = app.ui.focusNext;
  if (!id) return;
  app.ui.focusNext = null;
  const el = document.getElementById(id);
  if (!el) return;
  el.focus({ preventScroll: true }); // the text is left as typed, not selected: one slipped letter shouldn't cost the whole passcode
  // A heading that takes focus after an action (Mark cooked → "Any leftovers tonight?") comes into view too.
  if (/^H\d$/.test(el.tagName)) el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
}

// How deep a screen sits, so a transition knows whether it is going in, coming back, or moving sideways.
const DEPTH = { recipe: 1, products: 1, receipts: 1, cook: 2 };
function onRoute() {
  if (sheetOpen()) closeSheet({ instant: true });
  motion.flushClose();
  const to = parseRoute();
  const from = (lastView || '').split('/')[0];
  if (!from || from === 'gate' || lastView === `${to.view}/${to.params.join('/')}`) { render(); return; }
  const a = DEPTH[from] || 0; const b = DEPTH[to.view] || 0;
  motion.page(render, { dir: b > a ? 'forward' : b < a ? 'back' : 'tab' });
}

const THEME_COLOR = { light: '#F3F5F0', dark: '#0E1311' };
/** Light, dark, or the system's choice. A TV left on "match" is dark: it is a lamp in the living room. */
function applyTheme() {
  const { theme: t, textSize } = app.store.device;
  const chosen = t === 'light' || t === 'dark' ? t : tv.tvOn() ? 'dark' : null;
  if (chosen) document.documentElement.dataset.theme = chosen;
  else delete document.documentElement.dataset.theme;
  if (textSize === 'large') document.documentElement.dataset.text = 'large';
  else delete document.documentElement.dataset.text;
  // The browser's own chrome (status bar, task switcher) follows the choice too.
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    m.content = chosen ? THEME_COLOR[chosen] : THEME_COLOR[/dark/.test(m.media) ? 'dark' : 'light'];
  });
}

function delegate() {
  const run = (attr) => (ev) => {
    const el = ev.target.closest(`[data-${attr}]`);
    if (!el || el.disabled) return;
    const name = el.dataset[attr];
    const fn = ACTIONS[name];
    if (!fn) return;
    if (attr === 'action' && (el.tagName === 'BUTTON' || el.tagName === 'A')) ev.preventDefault();
    fn(app, el, ev);
  };
  document.addEventListener('click', run('action'));
  document.addEventListener('change', run('change'));
  document.addEventListener('input', run('input'));
  document.addEventListener('submit', (ev) => {
    const form = ev.target.closest('form[data-submit]');
    if (!form) return;
    ev.preventDefault();
    form.dataset.submitted = '1'; // once sent, a re-render may clear it
    ACTIONS[form.dataset.submit]?.(app, form, ev);
  });
}

ACTIONS['sheet:close'] = () => closeSheet();
// The "TV display" switch: kept on this device (app/tv.js), never in the family's shared state.
ACTIONS['tv:toggle'] = () => {
  const on = !tv.tvOn();
  tv.setTvSetting(on === tv.tvDetected() ? 'auto' : on ? 'on' : 'off');
  toast(on ? 'TV display is on for this screen.' : 'TV display is off for this screen.');
};

/**
 * A small console door for importing past purchase history (SPEC §9.4). Each receipt goes
 * through the same importReceipt() as a scanned one and then the normal op queue and sync,
 * so it's deduped (store + date + total) and never counted twice. Harmless to leave in.
 *   bfdp.importReceipts([{ store: 'sams', date: '2026-10-03', total: 212.4, lines: [...] }])
 *   bfdp.importReceipts(list, { dryRun: true })   // see what would happen, change nothing
 */
function installConsoleHelpers() {
  const STATE_LIMIT = 950_000; // the Worker refuses a family state over 1 MB; leave headroom
  window.bfdp = Object.freeze({
    version: VERSION,
    /**
     * → { receipts, lines, matched, productsSet, skippedDuplicates, errors, ops, stateBytes, dryRun, results }
     * receipts: receipts saved now; lines/matched: their lines and the lines matched to an
     * ingredient; productsSet: store/ingredient products set; skippedDuplicates: already saved.
     */
    importReceipts(list, { dryRun = false, by = null, source = 'import' } = {}) {
      if (!app.db || !app.store) throw new Error('The planner is still loading.');
      const arr = Array.isArray(list) ? list : [list];
      const { ops, results, state } = importReceipts(app.store.state, arr, {
        db: app.db, by: by || SHARED_PROFILE, source, today: app.today(),
      });
      const ok = results.filter((r) => !r.duplicate && !r.error);
      const productKeys = new Set(ok.flatMap((r) => r.products || []));
      const stateBytes = new TextEncoder().encode(JSON.stringify(state)).length;
      const summary = {
        receipts: ok.length,
        lines: ok.reduce((t, r) => t + (r.lines || 0), 0),
        matched: ok.reduce((t, r) => t + (r.matched || 0), 0),
        productsSet: productKeys.size,
        skippedDuplicates: results.filter((r) => r.duplicate).length,
        countedInBudget: ok.filter((r) => r.counted).length,
        errors: results.filter((r) => r.error).map((r) => `${r.store || '?'} ${r.date || '?'}: ${r.error}`),
        ops: ops.length,
        requests: Math.ceil(ops.length / 200),
        stateBytes,
        dryRun,
        results,
      };
      if (stateBytes > STATE_LIMIT) {
        return { ...summary, saved: false, error: `That would make the family data ${Math.round(stateBytes / 1024)} KB; the limit is 1 MB. Nothing was saved. Import fewer receipts at a time.` };
      }
      if (!dryRun && ops.length) app.store.commit(ops);
      return { ...summary, saved: !dryRun && ops.length > 0 };
    },
    status: () => ({ status: app.store?.status, pending: app.store?.pending.length || 0, revision: app.store?.server.revision }),

    /**
     * Store product pictures in one go (docs/spec/23): the family server fetches each picture from
     * the store's own image host and keeps it with the pantry pictures; the list, the pantry and
     * the product chooser then show it.
     *   await bilbrey.importStorePhotos([{ itemId: 'chicken', url: 'https://images.albertsons-media.com/is/image/ABS/184070124', store: 'jewel', product: 'Signature Farms Boneless Skinless Chicken Breasts' }])
     *   await bilbrey.importStorePhotos(list, { dryRun: true })   // check the list, fetch nothing
     * A bad entry or a failed picture never stops the rest, and running it again is safe: pictures
     * the server already has aren't fetched twice, and items that already show theirs are untouched.
     * → { total, saved, unchanged, failed, skipped, refusedHosts, stopped, failures: [{ itemId, error }], results }
     */
    async importStorePhotos(list, { dryRun = false, refresh = false, concurrency = 3 } = {}) {
      if (!app.db || !app.store) throw new Error('The planner is still loading.');
      if (!dryRun && (app.store.device.localOnly || !app.store.device.key)) {
        return { total: Array.isArray(list) ? list.length : 1, saved: 0, error: 'Connect this device with the family passcode first: the pictures are kept on the family server.' };
      }
      const r = await importStorePhotos(list, {
        db: app.db, state: () => app.store.state, dryRun, refresh, concurrency,
        fetchPhoto: (url, o) => fetchStorePhoto(app.store, url, o),
        commit: (ops) => app.store.commit(ops),
      });
      const failures = r.results.filter((x) => x.status === 'failed' || x.status === 'skipped').map((x) => ({ itemId: x.itemId, status: x.status, error: x.error, ...(x.httpStatus ? { httpStatus: x.httpStatus } : {}) }));
      if (r.saved) app.render();
      return { ...r, failures };
    },

    /** How full the family's storage is: the state document, pictures, backups (GET /api/storage). */
    storage: () => app.store.api('GET', '/api/storage', null, { timeoutMs: 30000 }),
    /** The server's saved copies of the family state: one a day for two weeks, plus one before each restore or tidy-up. */
    backups: () => app.store.api('GET', '/api/backups'),
    /**
     * Everything needed to start over, as one JSON file (saved to this device unless download: false).
     *   await bilbrey.exportBackup()            // today's state
     *   await bilbrey.exportBackup({ backup: 12 })   // one of bilbrey.backups()
     */
    async exportBackup({ backup = null, download = true } = {}) {
      const data = await app.store.api('GET', `/api/export${backup == null ? '' : `?backup=${encodeURIComponent(backup)}`}`, null, { timeoutMs: 60000 });
      if (download && typeof document !== 'undefined') {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
        a.download = `family-dinner-planner-backup-${app.today()}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      }
      return data;
    },
    /**
     * Puts a saved copy back for the whole family. Pass a backup id from bilbrey.backups(), or an
     * export file's contents (or just its state). The state it replaces is kept as a backup first.
     *   await bilbrey.restoreBackup(12)
     */
    async restoreBackup(from) {
      const body = typeof from === 'number' ? { backup: from } : { state: from && typeof from === 'object' && from.state && typeof from.state === 'object' ? from.state : from };
      const r = await app.store.api('POST', '/api/restore', { ...body, confirm: 'restore', by: app.who() || 'Family' }, { timeoutMs: 60000 });
      await app.store.sync();
      return r;
    },
    /** Pictures nothing points to any more (a replaced pantry photo, a product no longer bought). dryRun: true only counts them. */
    cleanupPhotos: ({ dryRun = true } = {}) => app.store.api('POST', '/api/photo/cleanup', { dryRun }),
  });
  // The same door under the family's name (the one the docs use from v3 on).
  window.bilbrey = window.bfdp;
}
ACTIONS.nav = (a, el) => a.navigate(el.dataset.href);

async function boot() {
  const root = document.getElementById('app');
  installPhotoFallback(document);
  try {
    app.db = await loadDb({ base: './' });
  } catch (e) {
    root.className = 'app is-gate';
    setHTML(root, html`<section class="gate"><div class="gate-card">
      <span class="wm-mark wm-lg" aria-hidden="true"></span>
      <h1 class="gate-title">The recipes didn’t load</h1>
      <p class="gate-text">Check your connection, then try again. (${e.message})</p>
      <button type="button" class="btn btn-primary btn-block" onclick="location.reload()">Try again</button>
    </div></section>`);
    return;
  }
  app.store = new Store({ apiBase: apiBase() });
  applyTheme();
  let lastStatus = app.store.status;
  app.store.subscribe((kind) => {
    if (kind === 'device') applyTheme();
    scheduleRender();
    if (kind === 'state') refreshLiveSheet();
    // A connected device (the TV on the wall) that stops syncing because the passcode changed says so,
    // instead of quietly showing an old plan behind a small "Connect" pill.
    const now = app.store.status;
    if (kind === 'status' && now === 'needs-passcode' && lastStatus !== now && app.store.device.key) {
      toast('The family passcode changed. Enter the new one to keep this device up to date.', { action: { label: 'Enter it', fn: () => app.navigate('#/family') }, duration: 120000 });
    }
    lastStatus = now;
  });
  delegate();
  motion.install();
  fx.install();
  tv.install({ sheetOpen, closeSheet, changed: () => { applyTheme(); scheduleRender(); } });
  applyTheme();
  window.addEventListener('hashchange', onRoute);
  render();
  app.store.connect(); // every device, from the first open: there is no "who are you" step to wait for
  const resync = () => { if (document.visibilityState === 'visible' && app.store.device.key && !app.store.device.localOnly) app.store.sync(); };
  document.addEventListener('visibilitychange', resync);
  window.addEventListener('pagehide', () => { if (app.route?.view === 'list') { try { sessionStorage.setItem('bfdp.scroll.list', String(window.scrollY)); } catch { /* private mode */ } } });
  window.addEventListener('online', () => (app.store.device.key ? app.store.sync() : app.store.connect()));
  window.addEventListener('focus', resync);
  setInterval(resync, 30000);
  // Re-render at midnight Chicago time so "tonight" moves on.
  let day = app.today();
  setInterval(() => { const t = app.today(); if (t !== day) { day = t; scheduleRender(); } }, 60000);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') watchForUpdates();
  document.documentElement.dataset.version = VERSION;
  installConsoleHelpers();
}

/**
 * Updates reach every phone without anyone reinstalling. The service worker takes over as
 * soon as a new version is installed; when that happens under a page an older version was
 * serving (that page may be mixing new code with the old version's cached recipes), reload
 * into the new one, or offer a Refresh if someone is in the middle of something.
 * A home-screen app can stay open for days, so look for updates whenever it comes back.
 */
function watchForUpdates() {
  const sw = navigator.serviceWorker;
  let controlled = !!sw.controller;
  let reg = null;
  sw.register('./sw.js', { scope: './' }).then((r) => { reg = r; }).catch(() => { /* offline support is a bonus */ });
  let lastCheck = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !reg || Date.now() - lastCheck < 30 * 60000) return;
    lastCheck = Date.now();
    reg.update().catch(() => { /* offline: try again next time */ });
  });
  // A TV shows the planner all day and never "comes back", so it also looks once an hour.
  setInterval(() => {
    if (!reg || document.visibilityState !== 'visible' || Date.now() - lastCheck < 30 * 60000) return;
    lastCheck = Date.now();
    reg.update().catch(() => { /* offline: try again next hour */ });
  }, 60 * 60000);
  let handled = false;
  sw.addEventListener('controllerchange', () => {
    // The very first install taking over this page: it's already current. Any later change is an update.
    if (!controlled) { controlled = true; return; }
    if (handled) return;
    handled = true;
    const busy = sheetOpen() || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if (!busy) { location.reload(); return; }
    toast('The planner was just updated.', { action: { label: 'Refresh', fn: () => location.reload() }, duration: 120000 });
  });
}

boot();
