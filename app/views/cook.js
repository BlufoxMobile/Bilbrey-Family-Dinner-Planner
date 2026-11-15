// COOK MODE: big readable steps for the dinner and both sides, tap to check off,
// screen stays awake while it's open.
import { html, ic, when, tf } from '../ui.js';
import { fmtQty, isISODate, midSentence, relativeDay } from '../util.js';
import { dinnerById, scaleItems } from '../planner.js';
import { markCookedOps } from '../actions.js';
import { itemMeta, singular } from '../shopping.js';
import { sidesFor, equipment } from './common.js';

export const title = (app) => {
  const t = target(app);
  return t.d ? `Cooking ${t.d.title}` : 'Cook mode';
};

function target(app) {
  const [a, b] = app.route.params;
  if (a === 'd') return { d: dinnerById(app.db, app.state, b), date: null, entry: null, key: `d:${b}` };
  const date = isISODate(a) ? a : app.today();
  const entry = app.state.plan?.[date];
  return { d: entry?.dinner ? dinnerById(app.db, app.state, entry.dinner) : null, date, entry, key: `n:${date}:${entry?.dinner || ''}` };
}

function loadChecks(key) {
  try { return JSON.parse(sessionStorage.getItem(`bfdp.cook.${key}`) || '{}'); } catch { return {}; }
}
function saveChecks(key, v) {
  try { sessionStorage.setItem(`bfdp.cook.${key}`, JSON.stringify(v)); } catch { /* fine */ }
}

let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener?.('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && document.querySelector('.cook')) keepAwake(true);
});
window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#/cook')) keepAwake(false); });

function amt(q, unit) { return `${fmtQty(q)} ${Math.abs(q - 1) < 1e-9 ? singular(unit) : unit}`; }

export function render(app) {
  const t = target(app);
  const size = app.ui.cookSize || 1;
  if (!t.d) {
    return html`<div class="cook" style="--cook-scale:${size}">
      <header class="cook-bar"><a class="icon-btn" href="#/tonight" aria-label="Close cook mode">${ic('close')}</a><p class="cook-title">Cook mode</p></header>
      <div class="empty"><h3 class="empty-title">Nothing planned to cook</h3><p class="empty-body">Pick tonight’s dinner first, then come back.</p><div class="empty-actions"><a class="btn btn-primary" href="#/tonight">Back to tonight</a></div></div>
    </div>`;
  }
  const checks = loadChecks(t.key);
  const sides = sidesFor(app, t.d.id, t.entry);
  const sections = [
    { id: 'main', title: t.d.title, steps: t.d.steps, items: t.d.items, lead: true },
    ...sides.map((s, i) => ({ id: `side${i}`, title: s.info?.title || 'Side', steps: s.info?.steps || [], items: s.info?.items || {} })),
  ];
  const total = sections.reduce((n, s) => n + s.steps.length, 0);
  const done = sections.reduce((n, s) => n + s.steps.filter((_, k) => checks[`${s.id}:${k}`]).length, 0);
  const all = {};
  for (const s of sections) for (const [id, q] of Object.entries(scaleItems(app.db, app.state, s.items))) all[id] = (all[id] || 0) + q;
  const cooked = t.entry?.status === 'cooked';
  return html`<div class="cook" style="--cook-scale:${size}">
    <header class="cook-bar">
      <a class="icon-btn" href="${t.date ? '#/tonight' : `#/recipe/${t.d.id}`}" aria-label="Close cook mode">${ic('close')}</a>
      <p class="cook-title">${t.date ? relativeDay(t.date, app.today()) : 'Cook mode'}<small>${done} of ${total} steps</small></p>
      <span class="cook-size" role="group" aria-label="Text size">
        <button type="button" class="icon-btn" data-action="cook:size" data-delta="-0.15" aria-label="Smaller text" ${size <= 0.85 ? 'disabled' : ''}>${ic('minus')}</button>
        <span aria-hidden="true">${ic('textSize')}</span>
        <button type="button" class="icon-btn" data-action="cook:size" data-delta="0.15" aria-label="Larger text" ${size >= 1.6 ? 'disabled' : ''}>${ic('plus')}</button>
      </span>
    </header>
    <div class="cook-progress" aria-hidden="true"><span style="width:${total ? Math.round((done / total) * 100) : 0}%"></span></div>
    <div class="cook-body">
      <div class="cook-card">
        <h1 class="cook-dish">${t.d.title}</h1>
        <p class="cook-with">${sides.length ? `with ${sides.map((s) => midSentence(s.info?.title || '')).join(' and ')}` : ''}</p>
        ${equipment(t.d)}
        <p class="muted small">${'wakeLock' in navigator ? 'The screen stays on while cook mode is open.' : 'Tip: turn up auto-lock while you cook.'}</p>
      </div>
      <details class="cook-need">
        <summary>Everything you need, for five</summary>
        <ul class="ingredients">${Object.entries(all).map(([id, q]) => { const m = itemMeta(app.db, app.state, id); return html`<li><span class="ing-amt">${amt(q, m.unit)}</span><span class="ing-name">${m.name}</span></li>`; })}</ul>
      </details>
      ${sections.map((s) => html`<section class="cook-sec" aria-labelledby="cs-${s.id}">
        <h2 id="cs-${s.id}" class="cook-sec-h">${s.lead ? 'The dinner' : s.title}</h2>
        <ol class="cook-steps">${s.steps.map((step, k) => {
          const on = !!checks[`${s.id}:${k}`];
          return html`<li><button type="button" class="cook-step ${on ? 'is-done' : ''}" role="checkbox" aria-checked="${tf(on)}" data-action="cook:check" data-k="${s.id}:${k}">
            <span class="cook-num" aria-hidden="true">${on ? ic('check', { size: 22 }) : k + 1}</span><span class="cook-text">${step}</span>
          </button></li>`;
        })}</ol>
      </section>`)}
      ${when(t.date && !cooked, () => html`<button type="button" class="btn btn-primary btn-lg btn-block" data-action="cook:done" data-date="${t.date}">${ic('checkCircle', { size: 22 })}Dinner’s done: mark cooked</button>`)}
      ${when(cooked, () => html`<p class="status-note status-cooked center">${ic('checkCircle', { size: 18 })}Marked cooked. Enjoy.</p>`)}
    </div>
  </div>`;
}

export function mount() {
  keepAwake(true);
}

export const actions = {
  'cook:check': (app, el) => {
    const t = target(app);
    const c = loadChecks(t.key);
    c[el.dataset.k] = !c[el.dataset.k];
    saveChecks(t.key, c);
    app.render();
  },
  'cook:size': (app, el) => {
    app.ui.cookSize = Math.max(0.85, Math.min(1.6, Math.round(((app.ui.cookSize || 1) + Number(el.dataset.delta)) * 100) / 100));
    app.render();
  },
  'cook:done': (app, el) => {
    if (app.commit(markCookedOps(app.db, app.state, { date: el.dataset.date, who: app.who(), today: app.today() }))) {
      keepAwake(false);
      location.hash = '#/tonight';
    }
  },
};
