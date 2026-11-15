// RECIPES: the recipe box — rotation, bench and voted-out dinners, search and filters.
import { html, ic, when, tf } from '../ui.js';
import { CATEGORIES, PROTEINS } from '../config.js';
import { listJoin } from '../util.js';
import {
  allDinners, inRotation, isRetired, isPromoted, isFavorite, isHealthier, voteInfo, droppedSides, implicitPromotions, downVoters,
} from '../planner.js';
import { restoreOps, restoreSideOps } from '../actions.js';
import { dinnerPhoto, sidePhoto } from './common.js';

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
    return html`<p class="empty-body pad">Nothing has been dropped. One thumbs down from anyone takes a dinner or a side off the menu, and it waits here in case you change your minds.</p>`;
  }
  return html`
    ${when(list.length, () => html`<ul class="dropped-list">${list.map((d) => html`<li class="dropped-row">
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

function filtered(app) {
  const f = app.ui.recipeFilters;
  const q = app.ui.recipeQuery.trim().toLowerCase();
  return allDinners(app.db, app.state)
    .filter((d) => inTab(app, d, app.ui.recipeTab))
    .filter((d) => !q || [d.title, d.subtitle, d.category, d.protein, ...d.tags].join(' ').toLowerCase().includes(q))
    .filter((d) => !f.category || d.category === f.category)
    .filter((d) => !f.protein || d.protein === f.protein)
    .filter((d) => !f.fav || isFavorite(app.state, d))
    .filter((d) => !f.quick || d.minutes <= 30)
    .filter((d) => !f.healthy || isHealthier(d))
    .sort((a, b) => a.title.localeCompare(b.title));
}

function card(app, d) {
  const v = voteInfo(app.state, d.id);
  return html`<li><a class="r-card" href="#/recipe/${d.id}">
    ${dinnerPhoto(app, d, { size: 'card' })}
    <span class="r-body">
      <b class="r-title">${d.title}</b>
      <span class="r-meta">${d.minutes} min, ${d.category}${when(isFavorite(app.state, d), () => html`<span class="r-fav">${ic('star', { size: 14 })}<span class="sr-only">Family favorite</span></span>`)}</span>
      ${when(v.up || v.down, () => html`<span class="r-votes">${v.up ? html`<span>${ic('up_vote', { size: 14 })}${v.up}</span>` : ''}${v.down ? html`<span class="is-down">${ic('down_vote', { size: 14 })}${v.down}</span>` : ''}</span>`)}
    </span>
  </a></li>`;
}

function grid(app) {
  const list = filtered(app);
  if (app.ui.recipeTab === 'out') return droppedView(app, list);
  if (!list.length) {
    const empty = app.ui.recipeTab === 'bench' ? 'Every bench dinner has joined the rotation.'
        : 'No dinners match. Clear a filter or try another word.';
    return html`<p class="empty-body pad">${empty}</p>`;
  }
  return html`<ul class="r-grid">${list.map((d) => card(app, d))}</ul>`;
}

export function render(app) {
  const f = app.ui.recipeFilters;
  const counts = Object.fromEntries(TABS.map((t) => [t.id, allDinners(app.db, app.state).filter((d) => inTab(app, d, t.id)).length]));
  counts.out += droppedSides(app.db, app.state).length;
  const chip = (key, label) => html`<button type="button" class="chip ${f[key] ? 'is-on' : ''}" aria-pressed="${f[key] ? 'true' : 'false'}" data-action="rec:toggle" data-key="${key}">${label}</button>`;
  return html`<div class="page page-recipes">
    <header class="page-head"><h1 class="page-title">Recipes</h1></header>
    <div class="tabs" role="tablist" aria-label="Which dinners">
      ${TABS.map((t) => html`<button type="button" role="tab" class="tab-opt ${app.ui.recipeTab === t.id ? 'is-on' : ''}" aria-selected="${tf(app.ui.recipeTab === t.id)}" data-action="rec:tab" data-tab="${t.id}">${t.label}<small>${counts[t.id]}</small></button>`)}
    </div>
    <label class="search">${ic('search', { size: 20 })}<input type="search" id="recipe-search" placeholder="Search tikka, burgers, noodles…" value="${app.ui.recipeQuery}" data-input="rec:search" aria-label="Search recipes" autocomplete="off"></label>
    <div class="filters" role="group" aria-label="Filters">
      ${chip('fav', 'Favorites')}${chip('quick', '30 min or less')}${chip('healthy', 'Healthier')}
      <select class="input input-chip ${f.category ? 'is-on' : ''}" data-change="rec:select" data-key="category" aria-label="Category">
        <option value="">Any category</option>${CATEGORIES.map((c) => html`<option ${f.category === c ? 'selected' : ''}>${c}</option>`)}
      </select>
      <select class="input input-chip ${f.protein ? 'is-on' : ''}" data-change="rec:select" data-key="protein" aria-label="Protein">
        <option value="">Any protein</option>${PROTEINS.map((p) => html`<option value="${p}" ${f.protein === p ? 'selected' : ''}>${p[0].toUpperCase() + p.slice(1)}</option>`)}
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
  'rec:search': (app, el) => {
    app.ui.recipeQuery = el.value;
    const box = document.getElementById('recipe-results');
    if (box) box.innerHTML = grid(app).s;
  },
};
