// RECIPES: the recipe box — rotation, bench and voted-out dinners, search and filters.
import { html, ic, when } from '../ui.js';
import { CATEGORIES, PROTEINS } from '../config.js';
import { allDinners, inRotation, isRetired, isPromoted, isFavorite, isHealthier, voteInfo } from '../planner.js';
import { dinnerPhoto } from './common.js';

export const title = () => 'Recipes';

const TABS = [
  { id: 'rotation', label: 'In rotation' },
  { id: 'bench', label: 'Bench' },
  { id: 'out', label: 'Voted out' },
];

function inTab(app, d, tab) {
  if (tab === 'rotation') return inRotation(app.state, d);
  if (tab === 'bench') return d.rotation === 'bench' && !isPromoted(app.state, d.id) && !isRetired(app.state, d.id);
  return isRetired(app.state, d.id);
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
  if (!list.length) {
    const empty = app.ui.recipeTab === 'out' ? 'No dinners have been voted out. Three thumbs-down retires one and brings in a bench dinner.'
      : app.ui.recipeTab === 'bench' ? 'Every bench dinner has joined the rotation.'
        : 'No dinners match. Clear a filter or try another word.';
    return html`<p class="empty-body pad">${empty}</p>`;
  }
  return html`<ul class="r-grid">${list.map((d) => card(app, d))}</ul>`;
}

export function render(app) {
  const f = app.ui.recipeFilters;
  const counts = Object.fromEntries(TABS.map((t) => [t.id, allDinners(app.db, app.state).filter((d) => inTab(app, d, t.id)).length]));
  const chip = (key, label) => html`<button type="button" class="chip ${f[key] ? 'is-on' : ''}" aria-pressed="${f[key] ? 'true' : 'false'}" data-action="rec:toggle" data-key="${key}">${label}</button>`;
  return html`<div class="page page-recipes">
    <header class="page-head"><h1 class="page-title">Recipes</h1></header>
    <div class="tabs" role="tablist" aria-label="Which dinners">
      ${TABS.map((t) => html`<button type="button" role="tab" class="tab-opt ${app.ui.recipeTab === t.id ? 'is-on' : ''}" aria-selected="${app.ui.recipeTab === t.id}" data-action="rec:tab" data-tab="${t.id}">${t.label}<small>${counts[t.id]}</small></button>`)}
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
  'rec:tab': (app, el) => { app.ui.recipeTab = el.dataset.tab; app.render(); },
  'rec:toggle': (app, el) => { app.ui.recipeFilters[el.dataset.key] = !app.ui.recipeFilters[el.dataset.key]; app.render(); },
  'rec:select': (app, el) => { app.ui.recipeFilters[el.dataset.key] = el.value || null; app.render(); },
  'rec:search': (app, el) => {
    app.ui.recipeQuery = el.value;
    const box = document.getElementById('recipe-results');
    if (box) box.innerHTML = grid(app).s;
  },
};
