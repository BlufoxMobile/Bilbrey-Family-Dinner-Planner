// RECIPES (SPEC §22.7): the recipe box with photos. Search, and the filters that matter to this
// family: can we make it from the pantry now, is it lean, which appliance, how long, which protein.
// Rotation, bench and dropped dinners keep their tabs.
import { html, ic, when, tf } from '../ui.js';
import { CATEGORIES, PROTEINS } from '../config.js';
import { listJoin } from '../util.js';
import {
  allDinners, inRotation, isRetired, isPromoted, isFavorite, voteInfo, droppedSides, implicitPromotions, downVoters,
} from '../planner.js';
import { restoreOps, restoreSideOps } from '../actions.js';
import { onHand } from '../coverage.js';
import { fmtKcal } from '../nutrition.js';
import { recipeFacts, recipeMatches, recipeCompare, fmtMinutes, EQUIPMENT, TIME_FILTERS, RECIPE_SORTS } from '../cooking.js';
import { dinnerPhoto, sidePhoto, showNutrition, leanMark, equipLabel } from './common.js';

export const title = () => 'Recipes';

const TABS = [
  { id: 'rotation', label: 'In rotation' },
  { id: 'bench', label: 'Bench' },
  { id: 'out', label: 'Dropped' },
];

function inTab(app, d, tab) {
  if (tab === 'rotation') return inRotation(app.state, d, app.db);
  if (tab === 'bench') return d.rotation === 'bench' && !isPromoted(app.state, d.id) && !isRetired(app.state, d.id) && !implicitPromotions(app.db, app.state).has(d.id);
  return isRetired(app.state, d.id);
}

/** Who dropped it: the thumbs-down names, or the parent who retired it by hand. */
function droppedWhy(app, id) {
  const who = downVoters(app.state, id);
  if (who.length) return `Thumbs down from ${listJoin(who)}`;
  const r = app.state.retired?.[id];
  return r?.manual && r.by ? `Taken out by ${r.by}` : 'Off the menu';
}

function droppedView(app, list) {
  const sides = droppedSides(app.db, app.state);
  if (!list.length && !sides.length) {
    return html`<p class="empty-body pad">${hasFilters(app) ? 'No dropped dinners match. Clear the search and filters to see them all.' : 'Nothing has been dropped. One thumbs down from anyone takes a dinner or a side off the menu, and it waits here in case you change your minds.'}</p>`;
  }
  return html`
    ${when(list.length, () => html`<ul class="dropped-list">${list.map(({ d }) => html`<li class="dropped-row">
      <a class="dropped-main" href="#/recipe/${d.id}">${dinnerPhoto(app, d, { size: 'thumb' })}<span><b>${d.title}</b><small>${droppedWhy(app, d.id)}</small></span></a>
      <button type="button" class="btn btn-small btn-secondary" data-action="rec:restore-dinner" data-id="${d.id}">Restore</button>
    </li>`)}</ul>`)}
    ${when(sides.length, () => html`<h2 class="section-title dropped-h">Sides</h2><ul class="dropped-list">${sides.map((s) => {
      const v = app.state.sideVotes?.[s.id] || {};
      const who = Object.keys(v).filter((p) => v[p] === -1);
      return html`<li class="dropped-row">
        <span class="dropped-main">${sidePhoto(app, { parsed: { type: 'side', id: s.id }, info: { kind: s.kind } }, { size: 'thumb' })}<span><b>${s.title}</b><small>Thumbs down from ${listJoin(who)}. Dinners that had it get a similar side.</small></span></span>
        <button type="button" class="btn btn-small btn-secondary" data-action="rec:restore-side" data-id="${s.id}">Restore</button>
      </li>`;
    })}</ul>`)}
    <p class="muted small pad">Restore clears the thumbs-downs, so it can be planned again.</p>`;
}

// The facts behind the filters (pantry check, calories, lean) for every dinner, worked out once
// per change to the family's data: typing in the search box must stay instant.
let memo = { state: null, db: null, facts: new Map() };
function factsFor(app, d) {
  if (memo.state !== app.state || memo.db !== app.db) memo = { state: app.state, db: app.db, facts: new Map(), rem: onHand(app.db, app.state) };
  if (!memo.facts.has(d.id)) memo.facts.set(d.id, recipeFacts(app.db, app.state, d, memo.rem));
  return memo.facts.get(d.id);
}

const FILTER_KEYS = ['fav', 'makeable', 'lean', 'equipment', 'time', 'protein', 'category', 'quick', 'healthy'];
const activeFilters = (app) => FILTER_KEYS.filter((k) => app.ui.recipeFilters[k]);
const hasFilters = (app) => activeFilters(app).length > 0 || !!app.ui.recipeQuery.trim();

function filtered(app) {
  const f = app.ui.recipeFilters;
  return allDinners(app.db, app.state)
    .filter((d) => inTab(app, d, app.ui.recipeTab))
    .map((d) => ({ d, facts: factsFor(app, d) }))
    .filter(({ d, facts }) => recipeMatches(d, facts, f, app.ui.recipeQuery, { favorite: isFavorite(app.state, d) }))
    .sort(recipeCompare(app.ui.recipeSort || 'az'));
}

function card(app, { d, facts }) {
  const v = voteInfo(app.state, d.id);
  const nutri = showNutrition(app) && facts.kcal != null;
  return html`<li><a class="r-card" href="#/recipe/${d.id}">
    ${dinnerPhoto(app, d, { size: 'card' })}
    <span class="r-body">
      <b class="r-title">${d.title}</b>
      <span class="r-meta">${facts.minutes ? fmtMinutes(facts.minutes) : ''}${facts.minutes ? ', ' : ''}${d.category}${when(isFavorite(app.state, d), () => html`<span class="r-fav">${ic('star', { size: 14 })}<span class="sr-only">Family favorite</span></span>`)}</span>
      ${when(nutri, () => html`<span class="r-nutri">≈ ${fmtKcal(facts.kcal)} cal, ${Math.round(facts.protein)} g protein${leanMark(facts, { compact: true })}</span>`)}
      ${when(facts.total, () => html`<span class="r-pantry ${facts.makeable ? 'is-ready' : ''}">${facts.makeable ? html`${ic('check', { size: 14 })}Everything’s in the pantry` : `${facts.total - facts.missing} of ${facts.total} ingredients on hand`}</span>`)}
      ${when(v.up || v.down, () => html`<span class="r-votes">${v.up ? html`<span>${ic('up_vote', { size: 14 })}${v.up}</span>` : ''}${v.down ? html`<span class="is-down">${ic('down_vote', { size: 14 })}${v.down}</span>` : ''}</span>`)}
    </span>
  </a></li>`;
}

/** What to say when nothing matches: name the filter that emptied the list, and offer the way out. */
function emptyGrid(app) {
  const f = app.ui.recipeFilters;
  const q = app.ui.recipeQuery.trim();
  if (!hasFilters(app)) {
    return html`<p class="empty-body pad">${app.ui.recipeTab === 'bench' ? 'Every bench dinner has joined the rotation.' : 'No dinners here yet.'}</p>`;
  }
  const why = f.makeable ? 'Nothing here can be made from the pantry alone right now. Scan the pantry so it’s up to date, or sort by “Closest to ready” to see what needs the least.'
    : f.equipment ? `No ${equipLabel(f.equipment)} dinners ${q || activeFilters(app).length > 1 ? 'match these filters' : `are in this tab yet${f.equipment === 'possible cooker' ? '. Ask Claude for PossibleCooker ideas from “What can I make?” on the Plan' : ''}`}.`
      : q ? `No dinners match “${q}”${activeFilters(app).length ? ' with these filters' : ''}.` : 'No dinners match these filters.';
  return html`<div class="empty r-empty">
    <span class="empty-ic">${ic('search', { size: 28 })}</span>
    <h2 class="empty-title">Nothing matches</h2>
    <p class="empty-body">${why}</p>
    <div class="empty-actions"><button type="button" class="btn btn-primary" data-action="rec:clear">Clear search and filters</button></div>
  </div>`;
}

function grid(app) {
  const list = filtered(app);
  if (app.ui.recipeTab === 'out') return droppedView(app, list);
  if (!list.length) return emptyGrid(app);
  return html`<p class="r-count muted small" aria-live="polite">${list.length} ${list.length === 1 ? 'dinner' : 'dinners'}${hasFilters(app) ? html` match. <button type="button" class="link-btn" data-action="rec:clear">Clear</button>` : ''}</p>
    <ul class="r-grid">${list.map((x) => card(app, x))}</ul>`;
}

export function render(app) {
  const f = app.ui.recipeFilters;
  const all = allDinners(app.db, app.state);
  const counts = Object.fromEntries(TABS.map((t) => [t.id, all.filter((d) => inTab(app, d, t.id)).length]));
  counts.out += droppedSides(app.db, app.state).length;
  const used = new Set(all.flatMap((d) => d.equipment));
  // Every appliance in the house that a recipe uses, and always the PossibleCooker (Jeff's new one).
  const appliances = EQUIPMENT.filter((e) => used.has(e.id) || e.id === 'possible cooker');
  const chip = (key, label, hint = '') => html`<button type="button" id="rf-${key}" class="chip ${f[key] ? 'is-on' : ''}" aria-pressed="${f[key] ? 'true' : 'false'}" data-action="rec:toggle" data-key="${key}" ${hint ? html`title="${hint}"` : ''}>${label}</button>`;
  const select = (key, any, opts, label) => html`<select id="rf-${key}" class="input input-chip ${f[key] ? 'is-on' : ''}" data-change="rec:select" data-key="${key}" aria-label="${label}">
      <option value="">${any}</option>${opts.map((o) => html`<option value="${o.id}" ${f[key] === o.id ? 'selected' : ''}>${o.label}</option>`)}
    </select>`;
  return html`<div class="page page-recipes">
    <header class="page-head"><h1 class="page-title">Recipes</h1></header>
    <div class="tabs" role="tablist" aria-label="Which dinners">
      ${TABS.map((t) => html`<button type="button" role="tab" id="rt-${t.id}" class="tab-opt ${app.ui.recipeTab === t.id ? 'is-on' : ''}" aria-selected="${tf(app.ui.recipeTab === t.id)}" data-action="rec:tab" data-tab="${t.id}">${t.label}<small>${counts[t.id]}</small></button>`)}
    </div>
    <label class="search">${ic('search', { size: 20 })}<input type="search" id="recipe-search" placeholder="Search chicken, tikka, air fryer…" value="${app.ui.recipeQuery}" data-input="rec:search" aria-label="Search recipes by name, ingredient or appliance" autocomplete="off"></label>
    <div class="filters" role="group" aria-label="Filters">
      ${chip('makeable', 'Can make now', 'Everything for it, sides included, is in the pantry')}
      ${when(showNutrition(app), () => chip('lean', 'Lean', 'Lighter plates with plenty of protein'))}
      ${chip('fav', 'Favorites')}
      ${select('equipment', 'Any appliance', appliances.map((e) => ({ id: e.id, label: equipLabel(e.id) })), 'Appliance')}
      ${select('time', 'Any time', TIME_FILTERS, 'Time')}
      ${select('protein', 'Any protein', PROTEINS.map((p) => ({ id: p, label: p[0].toUpperCase() + p.slice(1) })), 'Protein')}
      ${select('category', 'Any category', CATEGORIES.map((c) => ({ id: c, label: c })), 'Category')}
      <select id="rf-sort" class="input input-chip r-sort" data-change="rec:sort" aria-label="Sort">
        ${RECIPE_SORTS.filter((s) => showNutrition(app) || !['protein', 'light'].includes(s.id)).map((s) => html`<option value="${s.id}" ${(app.ui.recipeSort || 'az') === s.id ? 'selected' : ''}>Sort: ${s.label}</option>`)}
      </select>
    </div>
    <div id="recipe-results">${grid(app)}</div>
  </div>`;
}

export const actions = {
  'rec:restore-dinner': (app, el) => app.commit(restoreOps(app.db, app.state, { dinnerId: el.dataset.id })),
  'rec:restore-side': (app, el) => app.commit(restoreSideOps(app.db, app.state, { sideId: el.dataset.id })),
  'rec:tab': (app, el) => { app.ui.recipeTab = el.dataset.tab; app.render(); },
  'rec:toggle': (app, el) => { app.ui.recipeFilters[el.dataset.key] = !app.ui.recipeFilters[el.dataset.key]; app.render(); },
  'rec:select': (app, el) => { app.ui.recipeFilters[el.dataset.key] = el.value || null; app.render(); },
  'rec:sort': (app, el) => { app.ui.recipeSort = el.value || 'az'; app.render(); },
  'rec:clear': (app) => { app.ui.recipeFilters = {}; app.ui.recipeQuery = ''; app.render(); },
  'rec:search': (app, el) => {
    app.ui.recipeQuery = el.value;
    const box = document.getElementById('recipe-results');
    if (box) box.innerHTML = grid(app).s;
  },
};
