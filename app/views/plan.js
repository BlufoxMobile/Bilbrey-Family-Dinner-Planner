// PLAN: 1–3 weeks or a month of day cards, opening straight on the week (docs/spec/29). One
// primary button (Plan ahead) and a More sheet for the rest: ideas, two-tap swap, filling open
// nights, re-planning, the plan-from store and "Planning for". Drag-and-drop on desktop.
// Smarter planning (SPEC §21): plan ahead re-plans the planner's own picks with a before/after,
// lean by default and busy nights, the freezer watch, leftovers and pantry catch-up.
import { html, ic, when, segmented, toast, openSheet, closeSheet, renderSheet, switchToggle, tf } from '../ui.js';
import { addDays, diffDays, money, rangeLabel, shortDate, startOfWeek, monthName, weekday, monthOnly, datesBetween, weekdayName, midSentence } from '../util.js';
import { PERIODS, periodRange, shiftPeriod, dinnerById, isFillable, nightType, storeCoverage, isRetired, itemsForNight, defaultAnchor as defaultAnchorFor } from '../planner.js';
import { listJoin, byLabel } from '../util.js';
import { buildList, plannedNights, unitText } from '../shopping.js';
import { generateOps, swapNightsOps, settingOps, markCookedOps, undoFor } from '../actions.js';
import { del } from '../state.js';
import { sidesFor, dinnerPhoto, awayReason, dayStamp, showNutrition, thumbs, prepCard, leftoversAskCard, leftoverRows, costOf, costNote } from './common.js';
import { planCost } from '../cost.js';
import { plateNutrition, fmtKcal } from '../nutrition.js';
import { openNight } from './sheets.js';
import { tripAdviceCard } from './budget.js';
import { veggieCheck, leanOn, busyNightsOf, leanSummary } from '../health.js';
import { AHEAD_QUICK, aheadEnd, aheadLimit, clampAheadEnd, planAheadOps, pantryStretch, aheadStats, aheadRecord } from '../planahead.js';
import { freezerWatch } from '../freshness.js';
import { catchUp, skippedNightOps, lunchUsedOps } from '../waste.js';

export const title = () => 'Plan';

/** The period to show by default: this one, or the next if only a couple of nights are left. */
export function defaultAnchor(app) {
  return defaultAnchorFor(app.today(), app.settings.period, app.settings.weekStartsOn);
}

export function currentRange(app) {
  const anchor = app.ui.anchor || defaultAnchor(app);
  return periodRange(anchor, app.settings.period, app.settings.weekStartsOn);
}

const STORE_OPTS = [{ id: 'both', label: 'Both stores' }, { id: 'sams', label: "Sam's only" }, { id: 'jewel', label: 'Jewel only' }];

export function periodNav(app, range, { compact = false } = {}) {
  const today = app.today();
  const isCurrent = range.dates.includes(today);
  return html`<div class="period-nav ${compact ? 'period-nav-sm' : ''}">
    <button type="button" class="icon-btn" data-action="plan:shift" data-dir="-1" aria-label="Previous period">${ic('left')}</button>
    <p class="period-label" aria-live="polite"><b>${app.settings.period === 'month' ? monthName(range.start) : rangeLabel(range.start, range.end)}</b>
      <small>${isCurrent ? (app.settings.period === 'month' ? 'This month' : 'This week' + (range.dates.length > 7 ? ' onward' : '')) : range.start > today ? `Starts in ${diffDays(range.start, today)} ${diffDays(range.start, today) === 1 ? 'day' : 'days'}` : 'Past'}</small></p>
    <button type="button" class="icon-btn" data-action="plan:shift" data-dir="1" aria-label="Next period">${ic('right')}</button>
    ${when(!isCurrent, () => html`<button type="button" class="btn btn-small btn-quiet" data-action="plan:today">Today</button>`)}
  </div>`;
}

function dayCard(app, date, { compact = false } = {}) {
  const today = app.today();
  const e = app.state.plan?.[date];
  const d = e?.dinner ? dinnerById(app.db, app.state, e.dinner) : null;
  const away = e?.status === 'away';
  const cooked = e?.status === 'cooked';
  const past = date < today;
  const picked = app.ui.swapPick === date;
  const type = nightType(date, app.settings);
  const cls = ['day', away && 'is-away', cooked && 'is-cooked', !d && !away && 'is-open', past && 'is-past', date === today && 'is-today', picked && 'is-picked', app.ui.swapMode && 'is-swapping'].filter(Boolean).join(' ');
  if (past && !d && !away) {
    return html`<article class="day is-past is-past-empty" data-date="${date}"><span class="day-hit day-hit-static">${dayStamp(date, today)}<span class="day-note">Nothing planned</span></span></article>`;
  }
  const label = away ? awayReason(e).label : d ? d.title : 'Nothing planned';
  const sides = d && !away ? sidesFor(app, d.id, e) : [];
  return html`<article class="${cls}" data-date="${date}" ${!cooked && !past ? html`draggable="true"` : ''}>
    <button type="button" class="day-hit" data-action="plan:tap" data-date="${date}" aria-label="${shortDate(date)}: ${label}${cooked ? ', cooked' : ''}${app.ui.swapMode ? (picked ? ', selected for swap' : ', tap to swap') : ''}">
      ${dayStamp(date, today)}
      ${away ? html`<span class="day-ph day-ph-away">${ic('moon', { size: compact ? 20 : 26 })}</span>` : d ? dinnerPhoto(app, d, { size: compact ? 'thumb' : 'card' }) : html`<span class="day-ph">${ic('plus', { size: 22 })}</span>`}
      <span class="day-title">${label}</span>
      ${when(d && !away && !compact, () => costNote(costOf(app, d.id, e), { short: true, tag: 'span', cls: 'day-cost' }))}
      ${when(away && e.away?.note, () => html`<span class="day-note">${e.away.note}</span>`)}
      ${when(!d && !away && !past, () => html`<span class="day-note">${type === 'burger' ? 'Burger night' : type === 'pizza' ? 'Pizza night' : 'Tap to plan'}</span>`)}
      ${when(cooked, () => html`<span class="day-status">${ic('checkCircle', { size: 16 })}Cooked</span>`)}
      ${when(d && !away && !cooked && !past && isRetired(app.state, d.id), () => html`<span class="day-status day-status-warn">${ic('down_vote', { size: 16 })}Not for us: tap to change</span>`)}
      ${when(e?.manual && !away && !cooked && d && !isRetired(app.state, d.id), () => html`<span class="day-status day-status-quiet">Set by ${byLabel(e.by) || 'the family'}</span>`)}
    </button>
    ${when(sides.length && !compact, () => html`<p class="day-sides">with ${listJoin(sides.map((s) => midSentence(s.info?.title || '')))}</p>`)}
  </article>`;
}

function grid(app, range) {
  const month = app.settings.period === 'month';
  if (!month) {
    const weeks = [];
    for (let i = 0; i < range.dates.length; i += 7) weeks.push(range.dates.slice(i, i + 7));
    return weeks.map((w, i) => html`<section class="week" aria-label="Week of ${shortDate(w[0])}">
      ${when(weeks.length > 1, () => html`<h2 class="week-h">Week ${i + 1}<small>${rangeLabel(w[0], w[w.length - 1])}</small></h2>`)}
      <div class="days">${w.map((d) => dayCard(app, d))}</div>
    </section>`);
  }
  // Month: calendar on wide screens, week groups on phones (same markup, CSS decides).
  const lead = (weekday(range.start) - app.settings.weekStartsOn + 7) % 7;
  const weeks = [];
  let cur = [];
  for (const d of range.dates) {
    cur.push(d);
    if (cur.length + (weeks.length === 0 ? lead : 0) === 7) { weeks.push(cur); cur = []; }
  }
  if (cur.length) weeks.push(cur);
  const heads = Array.from({ length: 7 }, (_, i) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][(i + app.settings.weekStartsOn) % 7]);
  return html`<div class="month" style="--lead:${lead}">
    <div class="month-heads" aria-hidden="true">${heads.map((h) => html`<span>${h}</span>`)}</div>
    ${weeks.map((w) => html`<section class="week week-month" aria-label="${w.length === 1 ? shortDate(w[0]) : `Week of ${shortDate(w[0])}`}">
      <h2 class="week-h">${w.length === 1 ? shortDate(w[0]) : rangeLabel(w[0], w[w.length - 1])}</h2>
      <div class="days days-month">${w.map((d) => dayCard(app, d, { compact: true }))}</div>
    </section>`)}
  </div>`;
}

export function render(app) {
  const range = currentRange(app);
  const today = app.today();
  const s = app.settings;
  const plan = app.state.plan || {};
  const future = range.dates.filter((d) => d >= today);
  const open = future.filter((d) => isFillable(plan[d], 'fill')).length;
  const auto = future.filter((d) => plan[d]?.status === 'planned' && plan[d]?.dinner && !plan[d]?.manual).length;
  const list = buildList(app.db, app.state, { dates: range.dates });
  const planned = range.dates.filter((d) => plan[d]?.dinner && plan[d]?.status !== 'away').length;
  const away = range.dates.filter((d) => plan[d]?.status === 'away').length;
  return html`<div class="page page-plan">
    <header class="page-head">
      <div class="title-row"><h1 class="page-title">Plan</h1><a class="btn btn-small btn-secondary recipes-link" href="#/recipes">${ic('recipes', { size: 18 })}Recipes</a></div>
    </header>
    ${periodNav(app, range)}
    <div class="plan-actions">
      <button type="button" class="btn ${open ? 'btn-primary' : 'btn-secondary'} plan-ahead-btn" data-action="ahead:open" aria-haspopup="dialog">${ic('sparkle', { size: 20 })}${open ? `Plan ahead (${open} empty)` : 'Plan ahead'}</button>
      ${app.ui.swapMode
        ? html`<button type="button" class="btn btn-primary" data-action="plan:swapmode" aria-pressed="true">${ic('swap', { size: 20 })}Done swapping</button>`
        : html`<button type="button" class="btn btn-secondary plan-more-btn" data-action="plan:more" aria-haspopup="dialog">${ic('more', { size: 20 })}More</button>`}
    </div>
    ${when(app.ui.swapMode, () => html`<p class="swap-banner" role="status">${app.ui.swapPick ? html`Now tap the night to trade with <b>${shortDate(app.ui.swapPick)}</b>.` : 'Tap the first night, then the night to trade with.'}</p>`)}
    ${aheadCard(app)}
    ${grid(app, range)}
    <p class="plan-summary">${planned} ${planned === 1 ? 'dinner' : 'dinners'} planned${away ? `, ${away} ${away === 1 ? 'night' : 'nights'} away` : ''}${(() => {
      // What the food on the plates costs (docs/spec/24 §24.7), which is not what the trip costs: the list buys whole packs, lunches and extras.
      const pc = planCost(app.db, app.state, range.dates, { today });
      return pc.dinners && pc.total > 0 ? html`: ${pc.estimated ? 'about ' : ''}<b>${money(pc.perServing)}</b> a serving` : '';
    })()}. <a href="#/list">${money(list.total)} on the list</a>.</p>
    ${tripAdviceCard(app)}
    ${prepCard(app, { days: 7, title: 'Thaw & prep', countSuffix: ' this week', collapsed: true, skip: ['use'] })}
  </div>`;
}

export function mount(app, root) {
  if (!matchMedia('(pointer: fine)').matches) return;
  let from = null;
  root.querySelectorAll('.day[draggable="true"]').forEach((el) => {
    el.addEventListener('dragstart', (ev) => { from = el.dataset.date; el.classList.add('is-dragging'); ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', from); });
    el.addEventListener('dragend', () => { el.classList.remove('is-dragging'); root.querySelectorAll('.is-drop').forEach((x) => x.classList.remove('is-drop')); });
  });
  root.querySelectorAll('.day').forEach((el) => {
    el.addEventListener('dragover', (ev) => { if (from && el.dataset.date !== from && !el.classList.contains('is-cooked')) { ev.preventDefault(); el.classList.add('is-drop'); } });
    el.addEventListener('dragleave', () => el.classList.remove('is-drop'));
    el.addEventListener('drop', (ev) => {
      ev.preventDefault();
      const a = from || ev.dataTransfer.getData('text/plain');
      from = null;
      if (a && a !== el.dataset.date) app.commit(swapNightsOps(app.db, app.state, { a, b: el.dataset.date, who: app.who(), today: app.today() }));
    });
  });
}

function seedFor(app, range) {
  return range.start;
}

/** Everything on the Plan that isn't the week itself (docs/spec/29): one sheet, one tap away. */
function openMore(app) {
  openSheet({
    id: 'plan-more',
    live: true,
    title: 'More for the plan',
    render: () => {
      const s = app.settings;
      const range = currentRange(app);
      const today = app.today();
      const future = range.dates.filter((d) => d >= today);
      const plan = app.state.plan || {};
      const open = future.filter((d) => isFillable(plan[d], 'fill')).length;
      const auto = future.filter((d) => plan[d]?.status === 'planned' && plan[d]?.dinner && !plan[d]?.manual).length;
      const cov = s.planStore !== 'both' ? storeCoverage(app.db, app.state, s.planStore) : null;
      return html`
        <div class="action-list">
          <button type="button" class="action-row" data-action="ideas:open">${ic('camera')}<span><b>What can I make?</b><small>Snap the fridge and get dinner ideas.</small></span></button>
          ${when(open, () => html`<button type="button" class="action-row" data-action="plan:fill">${ic('plus')}<span><b>Fill the ${open} empty ${open === 1 ? 'night' : 'nights'}</b><small>Quick picks, no questions.</small></span></button>`)}
          <button type="button" class="action-row" data-action="plan:swapmode">${ic('swap')}<span><b>Swap two nights</b><small>Tap one night, then the other.</small></span></button>
          ${when(auto, () => html`<button type="button" class="action-row" data-action="plan:replan">${ic('refresh')}<span><b>Pick new dinners for this week</b><small>Keeps cooked nights and anything set by hand. Undo brings the old ones back.</small></span></button>`)}
        </div>
        <h3 class="sheet-h">Show</h3>
        ${segmented('period', PERIODS.map((p) => ({ id: p.id, label: p.label })), s.period, { label: 'How much of the plan to show', action: 'plan:period', small: true })}
        <h3 class="sheet-h" id="pf-l">Plan from</h3>
        ${segmented('planStore', STORE_OPTS, s.planStore, { label: 'Plan from', action: 'plan:setting', small: true })}
        ${when(cov, () => html`<p class="muted small">${cov.ok} of ${cov.total} dinners can be made from ${s.planStore === 'jewel' ? 'Jewel-Osco' : "Sam's Club"} alone.</p>`)}
        ${planPrefs(app, range, { open: true })}`;
    },
  });
}

export const actions = {
  'plan:more': (app) => openMore(app),
  // Keep the family's place if they've paged to another period; otherwise the new length
  // starts where it should (next week on a Sunday night), not pinned to today.
  'plan:period': (app, el) => { app.commit(settingOps(app.state, 'period', el.dataset.value), { quiet: true }); app.ui.swapPick = null; },
  'plan:setting': (app, el) => {
    const res = settingOps(app.state, el.dataset.name, el.dataset.value);
    app.commit(res, { quiet: true });
    if (el.dataset.name === 'planStore') toast(el.dataset.value === 'both' ? 'Planning from both stores.' : `Planning from ${el.dataset.value === 'jewel' ? 'Jewel-Osco' : "Sam's Club"} only.`);
  },
  'plan:shift': (app, el) => {
    const r = currentRange(app);
    app.ui.anchor = shiftPeriod(r.start, app.settings.period, Number(el.dataset.dir));
    app.ui.swapPick = null;
    app.ui.listSpan = null;
    app.render();
  },
  'plan:today': (app) => { app.ui.anchor = app.today(); app.ui.listSpan = null; app.render(); },
  'plan:fill': (app) => {
    closeSheet();
    const r = currentRange(app);
    app.commit(generateOps(app.db, app.state, { dates: r.dates, mode: 'fill', who: app.who(), today: app.today(), seedKey: seedFor(app, r) }));
  },
  'plan:replan': (app) => {
    closeSheet();
    const r = currentRange(app);
    // A different seed each time so "Re-plan" actually offers something new; stored entries keep phones in sync.
    const n = (app.ui.replans = (app.ui.replans || 0) + 1);
    app.commit(generateOps(app.db, app.state, { dates: r.dates, mode: 'replan', who: app.who(), today: app.today(), seedKey: `${seedFor(app, r)}#${n}` }));
  },
  'plan:swapmode': (app) => { closeSheet(); app.ui.swapMode = !app.ui.swapMode; app.ui.swapPick = null; app.render(); },
  'plan:tap': (app, el) => {
    const date = el.dataset.date;
    if (!app.ui.swapMode) { openNight(app, date); return; }
    const e = app.state.plan?.[date];
    if (e?.status === 'cooked') { toast('Cooked nights stay where they are.'); return; }
    if (!app.ui.swapPick) { app.ui.swapPick = date; app.render(); return; }
    if (app.ui.swapPick === date) { app.ui.swapPick = null; app.render(); return; }
    const res = swapNightsOps(app.db, app.state, { a: app.ui.swapPick, b: date, who: app.who(), today: app.today() });
    app.ui.swapPick = null;
    app.ui.swapMode = false;
    if (!app.commit(res)) app.render();
  },
  // ---------------------------------------------------------------- plan ahead (SPEC §16)
  'ahead:open': (app, el) => openPlanAhead(app, { pantryFirst: el?.dataset?.pantry === '1' ? true : undefined }),
  'ahead:quick': (app, el) => { if (openPlanAhead.state) openPlanAhead.state.end = clampAheadEnd(app.today(), el.dataset.end); renderSheet(); },
  'ahead:end': (app, el) => {
    if (!openPlanAhead.state || !el.value) return;
    openPlanAhead.state.end = clampAheadEnd(app.today(), el.value);
    renderSheet();
  },
  'ahead:pantry': (app) => {
    const st = openPlanAhead.state;
    if (!st) return;
    st.pantryFirst = !st.pantryFirst;
    if (!st.replanSet) st.replan = st.pantryFirst; // re-planning follows "use what we have" until it's set by hand
    renderSheet();
  },
  'ahead:replan': (app) => { const st = openPlanAhead.state; if (st) { st.replan = !st.replan; st.replanSet = true; } renderSheet(); },
  'ahead:go': (app) => {
    const st = openPlanAhead.state;
    if (!st) return;
    const today = app.today();
    const end = clampAheadEnd(today, st.end);
    const res = planAheadOps(app.db, app.state, { start: today, end, who: app.who(), today, pantryFirst: st.pantryFirst, replan: st.replan });
    closeSheet();
    app.ui.aheadLast = { end, pantryFirst: st.pantryFirst, replan: st.replan };
    // The result card is part of what's saved (state.planAhead), so Undo takes it back with the plan,
    // and it's still there after a reload. The card is the answer, with its own Undo; no toast repeats
    // its title (gauntlet r6). A press that changed nothing is still one line.
    const rec = res.ops.find((o) => o.path?.[0] === 'planAhead');
    if (!rec) { app.commit(res); app.render(); return; }
    app.ui.aheadUndo = { at: rec.value.at, undo: res.undo };
    app.ui.focusNext = 'ahead-h';
    app.commit(res, { quiet: true });
    setTimeout(() => document.getElementById('ahead-card')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 120);
  },
  'ahead:undo': (app) => {
    const u = app.ui.aheadUndo;
    if (!u) return;
    app.ui.aheadUndo = null;
    app.commit({ ops: u.undo, undo: [], message: 'Undone: the plan is back the way it was.' });
  },
  'ahead:list': (app) => {
    const a = aheadRecord(app.state, app.today());
    if (!a) return;
    // The plain list for the nights it planned; a trip is only ever started by "Just this trip?" (gauntlet r5).
    app.ui.listSpan = { end: a.end };
    app.navigate('#/list');
  },
  'ahead:close': (app) => { const ops = [del(['planAhead'])]; app.commit({ ops, undo: undoFor(app.state, ops), message: '' }, { quiet: true }); },
  // ---------------------------------------------------------------- lean and busy nights (SPEC §21.2)
  'plan:prefs': (app) => { app.ui.prefsOpen = !app.ui.prefsOpen; app.render(); },
  'plan:lean': (app) => {
    const on = !leanOn(app.state);
    app.commit({ ...settingOps(app.state, 'lean', on), message: on ? 'Lean by default is on. New plans favor lighter, high-protein dinners.' : 'Lean by default is off.' });
  },
  'plan:busy': (app, el) => {
    const day = Number(el.dataset.day);
    const cur = busyNightsOf(app.state);
    const next = cur.includes(day) ? cur.filter((d) => d !== day) : [...cur, day].sort();
    app.commit(settingOps(app.state, 'busyNights', next), { quiet: true });
  },
  // ---------------------------------------------------------------- leftovers and catch-up (SPEC §21.3)
  'catch:open': (app) => openCatchUp(app),
  'catch:cooked': (app, el) => { app.commit(markCookedOps(app.db, app.state, { date: el.dataset.date, who: app.who(), today: app.today() })); renderSheet(); },
  'catch:skip': (app, el) => { app.commit(skippedNightOps(app.db, app.state, { date: el.dataset.date })); renderSheet(); },
  'catch:lunches': (app, el) => { app.commit(lunchUsedOps(app.db, app.state, { today: app.today(), packed: el.dataset.packed !== 'no', who: app.who() })); renderSheet(); },
};

export { addDays, startOfWeek, monthOnly };

/** Eating healthier (SPEC §13): every dinner gets a vegetable or salad; one tap to add one. */
function veggieCard(app, range) {
  const today = app.today();
  const dates = range.dates.filter((d) => d >= today);
  const v = veggieCheck(app.db, app.state, dates);
  if (!v.total || !v.gaps.length) return v.total >= 3 ? html`<p class="veg-ok">${ic('leaf', { size: 18 })}<span>Every planned dinner ${range.end >= today ? 'from here on' : ''} has a vegetable or salad.</span></p>` : '';
  return html`<section class="veg-card" aria-labelledby="veg-h">
    <h2 id="veg-h" class="section-title">${ic('leaf', { size: 22 })}${v.withVeg} of ${v.total} dinners have a vegetable</h2>
    <ul class="veg-list">${v.gaps.slice(0, 6).map((g) => html`<li>
      <span><b>${g.date === today ? 'Tonight' : `${weekdayShort(g.date)} ${shortDate(g.date)}`}: ${g.dinner.title}</b><small>${g.sides.length ? `With ${listJoin(g.sides.map((t) => t.toLowerCase()))}` : 'No sides yet'}</small></span>
      <button type="button" class="btn btn-small btn-secondary" data-action="side:sub" data-date="${g.date}" data-dinner="${g.dinner.id}" data-slot="${g.slot}">${g.add ? 'Add a vegetable' : 'Swap in a vegetable'}</button>
    </li>`)}</ul>
    <p class="muted small">Frozen or canned vegetables count and keep for months, so they never go to waste.</p>
  </section>`;
}

const weekdayShort = (iso) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekday(iso)];

// ---------------------------------------------------------------- plan ahead, pantry first (SPEC §16)

const dayText = (iso, today) => (iso === today ? 'tonight' : `${weekdayName(iso)}, ${shortDate(iso)}`);
/** "Lean ground beef (93/7)" → "lean ground beef", brands keep their capitals. */
const foodName = (name) => midSentence(String(name || '').replace(/\s*\(.*?\)\s*/g, ' ').replace(/,.*$/, '').trim());
const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Choose how far ahead (a quick pick or any day up to a month out) and whether the pantry goes first. */
function openPlanAhead(app, { pantryFirst: force } = {}) {
  const today = app.today();
  const last = app.ui.aheadLast || aheadRecord(app.state, today);
  // "Plan the week from the pantry" (Cook from what you have) always puts the pantry first.
  const pantryFirst = force ?? (last ? last.pantryFirst !== false : true);
  // Unless it was used before, it plans what the Plan page is showing (gauntlet r4: "1 week" on screen,
  // "2 weeks" in the sheet planned 12 dinners nobody asked for)…
  const preferred = last && last.end >= today ? last.end : (() => { const r = currentRange(app); return r.end >= today && r.end <= aheadLimit(today) ? r.end : aheadEnd(today, 'week'); })();
  // …but never a stretch that's already planned: then the first quick choice with an empty night (gauntlet r5).
  const hasOpen = (end) => datesBetween(today, end).some((d) => isFillable(app.state.plan?.[d], 'fill'));
  const firstOpen = hasOpen(preferred) ? preferred : AHEAD_QUICK.map((q) => aheadEnd(today, q.id)).find((e) => e > preferred && hasOpen(e));
  const st = (openPlanAhead.state = {
    end: firstOpen || preferred,
    pantryFirst,
    // Re-plan the planner's own picks: on whenever the pantry goes first, unless switched by hand.
    replan: pantryFirst, replanSet: false,
  });
  openSheet({
    id: 'plan-ahead',
    title: 'Plan ahead',
    subtitle: 'Dinners and lunches from tonight on.',
    render: () => {
      const dates = datesBetween(today, st.end);
      const own = dates.filter((d) => d > today && app.state.plan?.[d]?.dinner && isFillable(app.state.plan[d], 'replan')).length; // never tonight's
      const empty = dates.filter((d) => isFillable(app.state.plan?.[d], 'fill')).length;
      // Nothing to plan: say so, and Plan it waits (gauntlet r5: it "planned" a full week with an Undo for nothing).
      // With re-planning on, a dry run (about 60 ms, once per choice) says whether it would change anything (r6).
      let idle = !empty && !(st.replan && own > 0);
      if (!empty && !idle) {
        const key = `${st.end}|${st.pantryFirst}|${st.replan}|${JSON.stringify(app.state.plan || {}).length}`;
        if (st.dryKey !== key) {
          st.dryKey = key;
          try { const r = planAheadOps(app.db, app.state, { start: today, end: clampAheadEnd(today, st.end), today, pantryFirst: st.pantryFirst, replan: st.replan, record: false }); st.dryIdle = !r.count && !(r.lunchPicks || []).length; } catch { st.dryIdle = false; }
        }
        idle = st.dryIdle;
      }
      return html`
        <h3 class="sheet-h" id="ahead-through-h">Plan through</h3>
        <div class="ahead-quick" role="group" aria-labelledby="ahead-through-h">
          ${AHEAD_QUICK.filter((q) => q.id === 'week' || q.id === 'two').map((q) => {
            const e = aheadEnd(today, q.id);
            const on = e === st.end;
            return html`<button type="button" class="chip chip-lg ${on ? 'is-on' : ''}" aria-pressed="${tf(on)}" data-action="ahead:quick" data-end="${e}">${q.label}<small>to ${weekdayShort(e)} ${shortDate(e)}</small></button>`;
          })}
        </div>
        ${(() => {
          // Two quick choices; three weeks, a month or any day are one fold away (gauntlet r4).
          const other = !AHEAD_QUICK.some((q) => (q.id === 'week' || q.id === 'two') && aheadEnd(today, q.id) === st.end);
          return html`<details class="ahead-date" ${other ? 'open' : ''}><summary>${other ? `Through ${weekdayShort(st.end)} ${shortDate(st.end)}` : 'Longer, or pick a date'}</summary>
            <div class="ahead-quick">${AHEAD_QUICK.filter((q) => q.id === 'three' || q.id === 'month').map((q) => { const e = aheadEnd(today, q.id); const on = e === st.end; return html`<button type="button" class="chip ${on ? 'is-on' : ''}" aria-pressed="${tf(on)}" data-action="ahead:quick" data-end="${e}">${q.label}<small>to ${weekdayShort(e)} ${shortDate(e)}</small></button>`; })}</div>
            <label class="field"><span class="field-label">Or the last night to plan</span>
            <input class="input" type="date" id="ahead-end" min="${today}" max="${aheadLimit(today)}" value="${st.end}" data-change="ahead:end"></label></details>`;
        })()}
        <details class="ahead-opts" ${aheadOptsOpen ? 'open' : ''}><summary>Options</summary>
        <div class="set-row ahead-switch"><span class="set-label">Use what we have first</span>${switchToggle({ on: st.pantryFirst, action: 'ahead:pantry', label: 'Use what we have first' })}</div>
        <div class="set-row ahead-switch"><span class="set-label">Let it replace dinners it picked before<small>${own ? 'Never tonight, and never one you chose.' : 'Only empty nights get planned.'}</small></span>${switchToggle({ on: st.replan && own > 0, action: 'ahead:replan', label: 'Let it replace dinners it picked before' })}</div>
        </details>
        ${idle ? html`<p class="ahead-idle" id="ahead-idle">Every night through ${weekdayName(st.end)}, ${shortDate(st.end)} is planned${own ? ', and nothing better turned up' : ''}. Pick a longer stretch to plan more.</p>` : ''}
        <button type="button" class="btn btn-primary btn-block" data-action="ahead:go" ${idle ? 'disabled aria-describedby="ahead-idle"' : ''}>${ic('sparkle', { size: 20 })}Plan it</button>`;
    },
  });
}

// The Plan ahead options fold keeps its open state while the sheet redraws.
let aheadOptsOpen = false;
if (typeof document !== 'undefined') document.addEventListener('toggle', (ev) => { if (ev.target?.classList?.contains('ahead-opts')) aheadOptsOpen = ev.target.open; }, true);

/** After planning: how far the pantry carries the plan, the old food it uses up, what still needs the store. */
function aheadCard(app) {
  const today = app.today();
  const a = aheadRecord(app.state, today);
  if (!a) return '';
  const start = a.start > today ? a.start : today;
  const s = pantryStretch(app.db, app.state, { start, end: a.end });
  // Before and after (SPEC §21.1): the plan as it stood against the plan now, over the same nights.
  const now = aheadStats(app.db, app.state, { start, end: a.end, today });
  const was = a.before && start === a.start ? a.before : null;
  const need = s.nights.filter((n) => n.dinner && n.dinnerMissing.length);
  const lunchDays = s.nights.filter((n) => n.lunchMissing.length).length;
  const oldest = s.usesUp.slice(0, 2);
  const covers = [s.dinnersCovered ? count(s.dinnersCovered, 'dinner') : '', s.lunchesCovered ? count(s.lunchesCovered, 'packed lunch', 'packed lunches') : ''].filter(Boolean);
  const gap = s.firstGap ? s.nights.find((n) => n.date === s.firstGap) : null;
  const row = (n) => html`<li><span class="cover-day">${n.date === today ? 'Tonight' : `${weekdayShort(n.date)} ${shortDate(n.date)}`}</span><span class="cover-what"><b>${n.title}</b><small>Needs ${listJoin(n.dinnerMissing.slice(0, 4).map((m) => foodName(m.name)))}${n.dinnerMissing.length > 4 ? ` and ${n.dinnerMissing.length - 4} more` : ''}</small></span></li>`;
  // Success first, one number, one next step (gauntlet r2); the pantry math is folded underneath.
  const saved = was ? Math.round((was.groceries - now.groceries) * 100) / 100 : 0;
  return html`<section class="ahead-card" id="ahead-card" aria-labelledby="ahead-h">
    <div class="ahead-head">
      <h2 id="ahead-h" class="section-title" tabindex="-1">${ic('checkCircle', { size: 22 })}<span>Planned through ${dayText(a.end, today)}</span></h2>
      ${when(app.ui.aheadUndo?.at === a.at, () => html`<button type="button" class="btn btn-small btn-quiet ahead-undo" data-action="ahead:undo">${ic('undo', { size: 18 })}Undo</button>`)}
      <button type="button" class="icon-btn" data-action="ahead:close" aria-label="Close this summary">${ic('close', { size: 20 })}</button>
    </div>
    ${when(now.dinners, () => html`<p class="ahead-big">About <b>${money(now.groceries, { whole: true })}</b> to buy${saved >= 1 ? html`<span class="ahead-save">, ${money(saved, { whole: true })} less than before</span>` : ''}</p>`)}
    ${when(oldest.length, () => html`<p class="ahead-uses">${ic('clock', { size: 18 })}<span>Uses up ${listJoin(oldest.map((u) => `the ${foodName(u.name)} from ${shortDate(u.since)}`))}.</span></p>`)}
    <button type="button" class="btn btn-primary btn-block" data-action="ahead:list">${ic('cart', { size: 20 })}See the shopping list</button>
    <details class="ahead-details"><summary>The pantry, each night and the cost</summary>
    <p class="ahead-covers"><b>${s.dinnersCovered || s.lunchesCovered ? `Your pantry covers ${listJoin(covers)}.` : 'No dinner is all in the pantry yet.'}</b></p>
    <p class="ahead-through">${s.coveredThrough
      ? html`Without a trip to the store, it carries you through <b>${dayText(s.coveredThrough, today)}</b>${s.firstGap ? '.' : ', the whole plan.'}`
      : gap?.open ? html`Nothing is planned for ${dayText(gap.date, today)} yet.`
        : html`${dayText(s.firstGap, today).replace(/^./, (c) => c.toUpperCase())} already needs ${gap?.dinnerMissing.length ? 'groceries' : 'groceries for packed lunches'}.`}</p>
    ${when(now.dinners, () => html`<div class="ahead-ba" id="ahead-ba">
      <p class="ahead-ba-now"><b>${now.fromPantry} of ${now.dinners}</b> ${now.dinners === 1 ? 'dinner' : 'dinners'} ${was && now.fromPantry > was.fromPantry ? 'now ' : ''}${now.dinners === 1 ? 'comes' : 'come'} from the pantry${was && now.fromPantry !== was.fromPantry ? html` <span class="ahead-was ${now.fromPantry > was.fromPantry ? 'is-down' : ''}">${was.hadOpen ? 'the usual plan' : 'it was'}: ${was.fromPantry}</span>` : ''}</p>
      <p class="ahead-ba-now"><b>About ${money(now.groceries)}</b> in groceries${was && Math.abs(was.groceries - now.groceries) >= 1 ? html` <span class="ahead-was ${now.groceries < was.groceries ? 'is-down' : ''}">${now.groceries < was.groceries ? `down from ${money(was.groceries)}` : `${was.hadOpen ? 'the usual plan' : 'it was'}: ${money(was.groceries)}`}</span>` : ''}</p>
      ${when(was, () => html`<p class="muted small">${aheadVerdict(was, now)}</p>`)}
    </div>`)}
    ${aheadCost(app, start, a.end)}
    <div class="cover-meter" role="img" aria-label="${s.nights.filter((n) => n.covered).length} of ${s.nights.length} days covered by the pantry">${s.nights.map((n) => html`<span class="cover-pip ${n.covered ? 'is-on' : ''} ${n.away ? 'is-away' : ''}" title="${weekdayShort(n.date)} ${shortDate(n.date)}: ${n.away ? 'away' : n.covered ? 'covered' : n.open ? 'nothing planned' : 'needs groceries'}"></span>`)}</div>
    ${need.length ? html`<h3 class="ahead-sub">Still needs groceries<span class="count">${count(need.length, 'night')}</span></h3>
      <ul class="cover-list ahead-list">${need.slice(0, 5).map(row)}</ul>
      ${when(need.length > 5, () => html`<details class="cover-more"><summary>${need.length - 5} more ${need.length - 5 === 1 ? 'night' : 'nights'}</summary><ul class="cover-list ahead-list">${need.slice(5).map(row)}</ul></details>`)}`
      : html`<p class="small">${s.dinners ? `Every planned dinner through ${dayText(a.end, today)} comes from the pantry.` : 'No dinners are planned in this stretch yet.'}</p>`}
    ${when(lunchDays, () => html`<p class="muted small">Packed lunches need something from the store on ${count(lunchDays, 'day')}.</p>`)}
    </details>
  </section>`;
}

/**
 * What the planned dinners cost (docs/spec/24 §24.7): the food on the plates, the average dinner and
 * plate, how much of it is already in the house, and what the trip for them comes to. The trip is
 * only ever named as a trip: it buys whole packs, so it is not what the dinners cost.
 */
function aheadCost(app, start, end) {
  const c = planCost(app.db, app.state, datesBetween(start, end), { today: app.today() });
  if (!c.dinners || !(c.total > 0)) return '';
  const about = c.estimated ? 'about ' : '';
  const house = c.pantryValue >= 1 ? `${money(c.pantryValue, { whole: true })} of it is already in the house; ` : '';
  const trip = c.toBuy >= 1 ? `the trip for them comes to ${about}${money(c.toBuy, { whole: true })}.` : 'nothing more to buy for them.';
  return html`<p class="ahead-cost cost-line" id="ahead-cost">${c.dinners === 1 ? 'This dinner' : `These ${c.dinners} dinners`}: ${about}<b>${money(c.total, { whole: true })}</b> of food${c.dinners > 1 ? html`, <b>${money(c.perDinner)}</b> a dinner` : ''}, <b>${money(c.perServing)}</b> a serving.
    <span class="cost-have">${(house + trip).replace(/^./, (ch) => ch.toUpperCase())}</span></p>`;
}

/** One plain sentence for the before/after. */
function aheadVerdict(was, now) {
  const more = now.fromPantry - was.fromPantry;
  const saved = Math.round((was.groceries - now.groceries) * 100) / 100;
  const base = was.hadOpen ? 'Against planning the open nights the usual way' : 'Against the plan before';
  if (more > 0 && saved >= 1) return `${base}: ${count(more, 'more dinner')} from what’s already here, and about ${money(saved)} less to buy.`;
  if (more > 0) return `${base}: ${count(more, 'more dinner')} from what’s already here.`;
  if (saved >= 1) return `${base}: about ${money(saved)} less to buy.`;
  if (saved <= -1) return `${base}: about ${money(-saved)} more to buy, because the pantry changed or nights were added since.`;
  return 'The plan already made the most of the pantry, so it stayed as it was.';
}

// ---------------------------------------------------------------- lean by default, busy nights (SPEC §21.2)

const DAY_LETTERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The two planning preferences, and how lean this period's plan is. */
function planPrefs(app, range, { open: always = false } = {}) {
  const lean = leanOn(app.state);
  const busy = busyNightsOf(app.state);
  const today = app.today();
  const sum = lean && showNutrition(app) ? leanSummary(app.db, app.state, range.dates.filter((d) => d >= today)) : null;
  // A button, not <details>: the page re-renders on every sync, and this has to stay open through it.
  const open = always || !!app.ui.prefsOpen;
  return html`<div class="plan-prefs ${open ? 'is-open' : ''}">
    ${always ? html`<h3 class="sheet-h">Planning for</h3>`
      : html`<button type="button" class="plan-prefs-head" data-action="plan:prefs" aria-expanded="${tf(open)}" aria-controls="plan-prefs-body"><span class="opt-label">Planning for</span><span class="plan-prefs-now">${lean ? 'Lean plates' : 'Any dinner'}${busy.length ? `, easy on ${listJoin(busy.map((d) => DAY_LETTERS[d]))}` : ''}</span></button>`}
    ${when(open, () => html`<div class="plan-prefs-body" id="plan-prefs-body">
    <div class="set-row"><span class="set-label">Lean by default<small>Lighter, high-protein dinners with a vegetable.</small></span>${switchToggle({ on: lean, action: 'plan:lean', label: 'Lean by default' })}</div>
    <div class="opt"><span class="opt-label" id="busy-l">Busy nights (easy dinners)</span>
      <div class="chip-grid busy-days" role="group" aria-labelledby="busy-l">${DAY_LETTERS.map((l, i) => html`<button type="button" class="chip ${busy.includes(i) ? 'is-on' : ''}" aria-pressed="${tf(busy.includes(i))}" data-action="plan:busy" data-day="${i}">${l}</button>`)}</div>
      <p class="muted small">Slow cooker or 30 minutes or less.</p></div>
    ${when(sum && sum.known >= 3, () => html`<p class="small lean-line">${ic('leaf', { size: 18 })}<span><b>${sum.lean} of ${sum.total}</b> planned ${sum.total === 1 ? 'dinner is a lean plate' : 'dinners are lean plates'}${sum.heavy ? `, ${sum.heavy} ${sum.heavy === 1 ? 'is' : 'are'} heavy` : ''}. A plate averages about ${fmtKcal(sum.kcal)} calories and ${Math.round(sum.proteinG)} g protein.</span></p>`)}
    </div>`)}
  </div>`;
}

// ---------------------------------------------------------------- the freezer watch (SPEC §21.3)

const monthsText = (days) => (days >= 60 ? `${Math.round(days / 30)} months` : `${days} days`);

/** Old freezer food is called out with the night that uses it, or a nudge to plan it. */
function freezerCard(app) {
  const today = app.today();
  const watch = freezerWatch(app.db, app.state, today);
  if (!watch.length) return '';
  const nights = plannedNights(app.db, app.state, datesBetween(today, addDays(today, 31)));
  const usedOn = (id) => nights.find((n) => (itemsForNight(app.db, app.state, n.entry.dinner, n.entry)[id] || 0) > 0);
  const rows = watch.slice(0, 6).map((w) => ({ ...w, night: usedOn(w.id) }));
  const unplanned = rows.filter((r) => !r.night).length;
  return html`<section class="freezer-card" id="freezer-card" aria-labelledby="fz-h">
    <h2 id="fz-h" class="section-title">${ic('snow', { size: 22 })}<span>In the freezer the longest</span></h2>
    <ul class="cover-list fz-list">${rows.map((w) => html`<li class="${w.past ? 'is-past' : ''}">
      <span class="cover-day">${w.unknown ? 'No date' : w.past ? 'Past its time' : monthsText(w.age)}</span>
      <span class="cover-what"><b>${foodName(w.name).replace(/^./, (c) => c.toUpperCase())}${typeof w.qty === 'number' ? html` <small class="fz-qty">${unitText(w.qty, w.unit)}</small>` : ''}</b>
        <small>${w.unknown ? 'Nobody dated it, so it counts as old. ' : `Since ${shortDate(w.since)}. `}${w.night ? `Planned: ${w.night.date === today ? 'tonight' : `${weekdayShort(w.night.date)} ${shortDate(w.night.date)}`}, ${dinnerById(app.db, app.state, w.night.entry.dinner)?.title}.` : 'Not in the plan yet.'}</small></span>
    </li>`)}</ul>
    ${when(watch.length > rows.length, () => html`<p class="muted small">And ${watch.length - rows.length} more. <a href="#/pantry">See the pantry</a></p>`)}
    ${unplanned ? html`<button type="button" class="btn btn-secondary btn-block" data-action="ahead:open" aria-haspopup="dialog">${ic('sparkle', { size: 20 })}Plan ahead uses ${unplanned === 1 ? 'it' : 'these'} first</button>` : html`<p class="muted small">Every one of them is in the plan. Nothing sits past its date without a night.</p>`}
  </section>`;
}

// ---------------------------------------------------------------- leftovers (docs/spec/22 §22.5, 21 §21.3)

/**
 * Leftovers on Plan and Pantry: the same one question Tonight asks about a cooked dinner (once it
 * is answered anywhere it is gone everywhere), and whatever is in the fridge with its choices.
 */
export function leftoversCard(app) {
  const ask = leftoversAskCard(app);
  const rows = leftoverRows(app);
  if (!ask && !rows) return '';
  return html`<div class="left-wrap">${ask}${when(rows, () => html`<section class="tcard left-fridge" aria-labelledby="left-h">
    <h2 id="left-h" class="section-title">${ic('bowl', { size: 22 })}<span>Leftovers in the fridge</span></h2>${rows}</section>`)}</div>`;
}

// ---------------------------------------------------------------- catching the pantry up (SPEC §21.3)

/**
 * The one catch-up prompt (Tonight, Plan and Pantry): dinners from the last week still marked
 * planned, and packed lunches never taken off the shelf. One missed dinner is asked about right
 * on the card; more than that, or lunches, open the catch-up sheet.
 */
export function catchUpCard(app) {
  const today = app.today();
  const c = catchUp(app.db, app.state, today);
  if (!c.total) return '';
  if (c.nights.length === 1 && !c.lunches.length) {
    const n = c.nights[0];
    const when = n.date === addDays(today, -1) ? 'Last night' : weekdayName(n.date);
    return html`<section class="forgot-card" id="catch-card" aria-labelledby="catch-h">
      <p class="forgot-q" id="catch-h"><b>${when}: ${n.title}.</b> Did you cook it?</p>
      <div class="forgot-acts">
        <button type="button" class="btn btn-small btn-primary" data-action="night:cooked" data-date="${n.date}">${ic('checkCircle', { size: 18 })}Cooked</button>
        <button type="button" class="btn btn-small btn-secondary" data-action="night:move" data-date="${n.date}" aria-haspopup="dialog">Move</button>
        <button type="button" class="btn btn-small btn-secondary" data-action="catch:skip" data-date="${n.date}">Skipped</button>
      </div>
    </section>`;
  }
  const parts = [c.nights.length ? count(c.nights.length, 'dinner') : '', c.lunches.length ? count(c.lunches.length, 'packed lunch', 'packed lunches') : ''].filter(Boolean);
  return html`<section class="catch-card" id="catch-card" aria-labelledby="catch-h">
    <span class="left-ic" aria-hidden="true">${ic('pantry', { size: 22 })}</span>
    <p class="left-text"><b id="catch-h">Is the pantry still right?</b><small>${listJoin(parts)} from the last week never came off the shelves.</small></p>
    <span class="left-acts"><button type="button" class="btn btn-small btn-primary" data-action="catch:open" aria-haspopup="dialog">Catch up</button></span>
  </section>`;
}

function openCatchUp(app) {
  openSheet({
    id: 'catch-up',
    title: 'Catch the pantry up',
    subtitle: 'Anything eaten comes off the shelves, so the list buys what’s really missing.',
    render: () => {
      const today = app.today();
      const c = catchUp(app.db, app.state, today);
      if (!c.total) return html`<p class="sheet-text">${ic('checkCircle', { size: 18 })} All caught up. The pantry matches what’s been cooked and packed.</p><div class="sheet-actions"><button type="button" class="btn btn-primary btn-block" data-action="sheet:close">Done</button></div>`;
      const days = [...new Set(c.lunches.map((l) => l.date))];
      return html`
        ${when(c.nights.length, () => html`<h3 class="sheet-h">Did these get cooked?</h3>
          <ul class="catch-list">${c.nights.map((n) => html`<li><span><b>${n.title}</b><small>${weekdayName(n.date)}, ${shortDate(n.date)}</small></span>
            <span class="catch-acts"><button type="button" class="btn btn-small btn-secondary" data-action="catch:cooked" data-date="${n.date}">Yes, cooked</button>
              <button type="button" class="btn btn-small btn-quiet" data-action="catch:skip" data-date="${n.date}">No</button></span></li>`)}</ul>
          <p class="muted small">“Yes” takes what the dinner used out of the pantry. “No” leaves the food where it is and opens the night.</p>`)}
        ${when(c.lunches.length, () => html`<h3 class="sheet-h">Packed lunches</h3>
          <p class="sheet-text">${count(c.lunches.length, 'lunch', 'lunches')} on ${listJoin(days.map((d) => weekdayShort(d)))} (${listJoin([...new Set(c.lunches.map((l) => l.name))])}) haven’t come off the shelves.</p>
          <div class="sheet-actions"><button type="button" class="btn btn-secondary btn-block" data-action="catch:lunches">They were packed: take the food off</button>
            <button type="button" class="btn btn-quiet btn-block" data-action="catch:lunches" data-packed="no">They weren’t packed</button></div>`)}`;
    },
  });
}
