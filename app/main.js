// Boot, routing, the app shell and the shared `app` context the views use.
import { apiBase, VERSION } from './config.js';
import { loadDb } from './data.js';
import { Store, settingsOf } from './state.js';
import { todayISO } from './util.js';
import {
  html, ic, setHTML, toast, closeSheet, refreshLiveSheet, renderSheet, installPhotoFallback, avatar, sheetOpen,
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
import * as onboarding from './views/onboarding.js';
import * as sheets from './views/sheets.js';

const VIEWS = {
  tonight, plan: planView, list: listView, pantry: pantryView, recipes: recipesView, recipe: recipeView,
  budget: budgetView, family: familyView, cook: cookView, lunch: lunchView, receipts: receiptsView, products: productsView,
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
  { id: 'family', label: 'Family & settings', icon: 'family' },
];

const ACTIONS = {};
for (const m of [...Object.values(VIEWS), onboarding, sheets]) Object.assign(ACTIONS, m.actions || {});

export const app = {
  db: null,
  store: null,
  ui: { anchor: null, swapPick: null, swapMode: false, recipeQuery: '', recipeFilters: {}, recipeTab: 'rotation', pantryQuery: '', listFilter: 'all', lunchWho: null, lunchAnchor: null, productsStore: 'sams', productsQuery: '' },
  route: { view: 'tonight', params: [] },
  get state() { return this.store.state; },
  get settings() { return settingsOf(this.store.state); },
  today() { return todayISO(); },
  who() { return this.store.device.who; },
  /** Apply an action result: commit ops, show its message with Undo. */
  commit(res, { quiet = false, undoable = true, onUndo } = {}) {
    if (!res) return false;
    if (res.error || !res.ops?.length) {
      if (res.message && !quiet) toast(res.message);
      return false;
    }
    this.store.commit(res.ops);
    if (!quiet && res.message) {
      toast(res.message, undoable && res.undo?.length ? { undo: () => { this.store.commit(res.undo); onUndo?.(); renderSheet(); toast('Undone.'); } } : {});
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

function syncPill() {
  const s = app.store;
  const pending = s.pending.length;
  const map = {
    synced: { label: 'Synced', tone: 'ok', icon: 'cloud', long: 'Everyone sees the same plan.' },
    syncing: { label: 'Syncing', tone: 'busy', icon: 'refresh', long: 'Sending your changes to the family.' },
    offline: { label: pending ? 'Saved on this phone' : 'Offline', tone: 'off', icon: 'cloudOff', long: 'Offline — changes are saved on this phone and sync when you reconnect.' },
    local: { label: 'This phone only', tone: 'off', icon: 'phone', long: 'Using the planner on this phone only.' },
    'needs-setup': { label: 'Connect', tone: 'warn', icon: 'lock', long: 'Create the family passcode to share the plan.' },
    'needs-passcode': { label: 'Connect', tone: 'warn', icon: 'lock', long: 'Enter the family passcode to share the plan.' },
    error: { label: 'Sync paused', tone: 'warn', icon: 'cloudOff', long: s.statusDetail || 'Sync paused.' },
  };
  const m = map[s.status] || map.offline;
  return html`<button type="button" class="sync sync-${m.tone}" data-action="sheet:sync" aria-label="${m.label}. ${m.long}" title="${m.long}">
    <span class="sync-dot" aria-hidden="true"></span><span class="sync-label">${m.label}</span>
  </button>`;
}

function shell() {
  const who = app.who();
  const active = { recipe: 'recipes', products: 'list', receipts: 'budget' }[app.route.view] || app.route.view;
  const tabActive = active === 'recipes' ? 'plan' : active;
  return html`
    <a class="skip" href="#view">Skip to content</a>
    <aside class="rail" aria-label="Sections">
      <a class="wordmark" href="#/tonight"><span class="wm-mark" aria-hidden="true"></span><span class="wm-text">The Bilbrey<br>Family Dinners</span></a>
      <nav class="rail-nav">
        ${[...TABS, ...MORE].map((t) => html`<a class="rail-link ${active === t.id ? 'is-on' : ''}" href="#/${t.id}" ${active === t.id ? html`aria-current="page"` : ''}>${ic(t.icon)}<span>${t.label}</span></a>`)}
      </nav>
      <div class="rail-foot">${syncPill()}
        <button type="button" class="rail-who" data-action="sheet:who">${avatar(who || '?', { size: 'sm' })}<span>${who ? `${who}’s phone` : 'Who’s using this phone?'}</span></button>
      </div>
    </aside>
    <header class="topbar">
      <a class="wordmark wordmark-sm" href="#/tonight" aria-label="The Bilbrey Family Dinner Planner, tonight"><span class="wm-mark" aria-hidden="true"></span><span class="wm-text">Bilbrey Dinners</span></a>
      <div class="topbar-right">
        ${syncPill()}
        <a class="icon-btn ${active === 'budget' ? 'is-on' : ''}" href="#/budget" aria-label="Budget">${ic('budget')}</a>
        <a class="who-btn ${active === 'family' ? 'is-on' : ''}" href="#/family" aria-label="Family and settings${who ? `, ${who} is using this phone` : ''}">${avatar(who || '?', { size: 'sm' })}</a>
      </div>
    </header>
    <main id="view" class="view view-${app.route.view}" tabindex="-1"></main>
    <nav class="tabbar" aria-label="Sections">
      ${TABS.map((t) => html`<a class="tab ${tabActive === t.id ? 'is-on' : ''}" href="#/${t.id}" ${tabActive === t.id ? html`aria-current="page"` : ''}>${ic(t.icon, { size: 24 })}<span>${t.label}</span></a>`)}
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
    const dirty = check ? el.checked !== el.defaultChecked : el.value !== el.defaultValue;
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
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}

export function render() {
  const root = document.getElementById('app');
  if (!app.db || !app.store) return;
  if (!app.store.device.who || onboarding.gateActive(app)) {
    const snap = lastView === 'gate' ? snapshotForms(root) : [];
    const wasFocused = lastView === 'gate' && document.activeElement?.id;
    root.className = 'app is-gate';
    setHTML(root, onboarding.render(app));
    restoreForms(root, snap);
    if (wasFocused) document.getElementById(wasFocused)?.focus({ preventScroll: true });
    else onboarding.mount?.(app, root);
    lastView = 'gate';
    return;
  }
  app.route = parseRoute();
  const v = VIEWS[app.route.view];
  const changedView = lastView !== `${app.route.view}/${app.route.params.join('/')}`;
  const y = window.scrollY;
  const act = document.activeElement;
  let keep = null;
  if (act && act.id && root.contains(act)) {
    keep = { id: act.id, start: null, end: null };
    try { keep.start = act.selectionStart; keep.end = act.selectionEnd; } catch { /* inputs without a caret */ }
  }
  const snap = changedView ? [] : snapshotForms(root);
  root.className = `app ${app.route.view === 'cook' ? 'is-cook' : ''}`;
  setHTML(root, shell());
  const main = root.querySelector('#view');
  setHTML(main, v.render(app));
  restoreForms(main, snap);
  v.mount?.(app, main);
  document.title = v.title ? `${v.title(app)} — The Bilbrey Family Dinner Planner` : 'The Bilbrey Family Dinner Planner';
  if (changedView) { window.scrollTo(0, 0); if (lastView && lastView !== 'gate') main.focus({ preventScroll: true }); }
  else window.scrollTo(0, y);
  lastView = `${app.route.view}/${app.route.params.join('/')}`;
  if (keep && !changedView) {
    const el = document.getElementById(keep.id);
    if (el) { el.focus({ preventScroll: true }); try { if (keep.start != null) el.setSelectionRange(keep.start, keep.end); } catch { /* not a text input */ } }
  }
}

function applyTheme() {
  const t = app.store.device.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
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
        db: app.db, by: by || app.who() || 'Family', source, today: app.today(),
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
  });
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
  app.store.subscribe((kind) => {
    if (kind === 'device') applyTheme();
    scheduleRender();
    if (kind === 'state') refreshLiveSheet();
  });
  delegate();
  window.addEventListener('hashchange', () => { if (sheetOpen()) closeSheet(); render(); });
  render();
  if (app.store.device.who) app.store.connect();
  const resync = () => { if (document.visibilityState === 'visible' && app.store.device.key && !app.store.device.localOnly) app.store.sync(); };
  document.addEventListener('visibilitychange', resync);
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
