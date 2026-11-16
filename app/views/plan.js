// PLAN: 1–3 weeks or a month, plan-from store, day cards with sides,
// two-tap swap, drag-and-drop on desktop, plan / re-plan, and plan ahead, pantry first (SPEC §16).
// Smarter planning (SPEC §21): plan ahead re-plans the planner's own picks with a before/after,
// lean by default and busy nights, the freezer watch, leftovers and pantry catch-up.
import { html, ic, when, segmented, toast, openSheet, closeSheet, renderSheet, switchToggle, tf } from '../ui.js';
import { addDays, diffDays, money, rangeLabel, shortDate, startOfWeek, monthName, weekday, monthOnly, datesBetween, weekdayName, midSentence } from '../util.js';
import { PERIODS, periodRange, shiftPeriod, dinnerById, isFillable, nightType, storeCoverage, isRetired, itemsForNight, defaultAnchor as defaultAnchorFor } from '../planner.js';
import { listJoin } from '../util.js';
import { buildList, plannedNights, unitText } from '../shopping.js';
import { generateOps, swapNightsOps, settingOps, markCookedOps, undoFor } from '../actions.js';
import { del } from '../state.js';
import { sidesFor, dinnerPhoto, awayReason, dayStamp, showNutrition, thumbs, prepCard } from './common.js';
import { plateNutrition, fmtKcal } from '../nutrition.js';
import { openNight } from './sheets.js';
import { tripAdviceCard } from './budget.js';
import { veggieCheck, leanOn, busyNightsOf, leanSummary } from '../health.js';
import { AHEAD_QUICK, aheadEnd, aheadLimit, clampAheadEnd, planAheadOps, pantryStretch, shoppingTripOps, aheadStats, aheadRecord } from '../planahead.js';
import { freezerWatch } from '../freshness.js';
import { leftoverAsks, leftoverChoices, leftoversOps, catchUp, skippedNightOps, lunchUsedOps } from '../waste.js';

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
  const label = away ? (e.away?.leftovers ? 'Leftovers night' : awayReason(e).label) : d ? d.title : 'Nothing planned';
  const sides = d && !away ? sidesFor(app, d.id, e) : [];
  return html`<article class="${cls}" data-date="${date}" ${!cooked && !past ? html`draggable="true"` : ''}>
    <button type="button" class="day-hit" data-action="plan:tap" data-date="${date}" aria-label="${shortDate(date)}: ${label}${cooked ? ', cooked' : ''}${app.ui.swapMode ? (picked ? ', selected for swap' : ', tap to swap') : ''}">
      ${dayStamp(date, today)}
      ${away ? html`<span class="day-ph day-ph-away">${ic('moon', { size: compact ? 20 : 26 })}</span>` : d ? dinnerPhoto(app, d, { size: compact ? 'thumb' : 'card' }) : html`<span class="day-ph">${ic('plus', { size: 22 })}</span>`}
      <span class="day-title">${label}</span>
      ${when(d && !away && !compact && showNutrition(app), () => { const n = plateNutrition(app.db, app.state, d.id, e); return n ? html`<span class="day-kcal">≈ ${fmtKcal(n.kcal)} cal, ${Math.round(n.protein)} g protein</span>` : ''; })}
      ${when(away && e.away?.note, () => html`<span class="day-note">${e.away.note}</span>`)}
      ${when(!d && !away && !past, () => html`<span class="day-note">${type === 'burger' ? 'Burger night' : type === 'pizza' ? 'Pizza night' : 'Open'}</span>`)}
      ${when(cooked, () => html`<span class="day-status">${ic('checkCircle', { size: 16 })}Cooked</span>`)}
      ${when(d && !away && !cooked && !past && isRetired(app.state, d.id), () => html`<span class="day-status day-status-warn">${ic('down_vote', { size: 16 })}Thumbs down: tap to swap</span>`)}
      ${when(e?.manual && !away && !cooked && d && !isRetired(app.state, d.id), () => html`<span class="day-status day-status-quiet">Set by ${e.by || 'the family'}</span>`)}
    </button>
    ${when(sides.length && !compact, () => html`<ul class="day-sides">
      ${sides.map((s) => html`<li><span class="day-side">${s.info?.title}${when(s.remembered, () => html`<span class="sr-only"> (remembered)</span>`)}</span>
        ${when(!cooked, () => html`<button type="button" class="sub-btn" data-action="side:sub" data-date="${date}" data-dinner="${d.id}" data-slot="${s.slot}" aria-label="Substitute ${s.info?.title}">Substitute</button>`)}</li>`)}
      ${when(!cooked && d.sideSlots === 1 && sides.length < 2, () => html`<li><button type="button" class="sub-btn sub-add" data-action="side:sub" data-date="${date}" data-dinner="${d.id}" data-slot="1">${ic('plus', { size: 16 })}Add a side</button></li>`)}
    </ul>`)}
    ${when(d && !away && !compact, () => html`<div class="day-foot">${thumbs(app, { kind: 'dinner', id: d.id, label: d.title, compact: true })}</div>`)}
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
      ${segmented('period', PERIODS.map((p) => ({ id: p.id, label: p.label })), s.period, { label: 'How long to plan', action: 'plan:period' })}
    </header>
    ${periodNav(app, range)}
    <div class="plan-opts">
      <div class="opt"><span class="opt-label" id="pf-l">Plan from</span>${segmented('planStore', STORE_OPTS, s.planStore, { label: 'Plan from', action: 'plan:setting', small: true })}</div>
      ${planPrefs(app, range)}
    </div>
    ${when(s.planStore !== 'both', () => {
      const cov = storeCoverage(app.db, app.state, s.planStore);
      const name = s.planStore === 'jewel' ? 'Jewel-Osco' : "Sam's Club";
      return html`<p class="hint">${ic('store', { size: 18 })}<span>${cov.ok} of ${cov.total} dinners can be made from ${name} alone (or with what’s in the pantry), so only those get planned.${cov.missing.length ? ` The others need something ${name} doesn’t carry, like ${listJoin(cov.missing.map((m) => m.toLowerCase()))}. Mark those stocked in the pantry and more dinners qualify.` : ''}${auto ? ' Re-plan to apply this to nights already planned.' : ''}</span></p>`;
    })}
    <div class="plan-actions">
      <button type="button" class="btn btn-primary" data-action="ahead:open" aria-haspopup="dialog">${ic('sparkle', { size: 20 })}Plan ahead</button>
      <button type="button" class="btn btn-secondary" data-action="ideas:open">${ic('camera', { size: 20 })}What can I make?</button>
      ${open ? html`<button type="button" class="btn btn-secondary" data-action="plan:fill">${ic('plus', { size: 20 })}Plan ${open} open ${open === 1 ? 'night' : 'nights'}</button>` : ''}
      ${auto ? html`<button type="button" class="btn btn-secondary" data-action="plan:replan">${ic('refresh', { size: 20 })}Re-plan this period</button>` : ''}
      <button type="button" class="btn ${app.ui.swapMode ? 'btn-primary' : 'btn-secondary'}" data-action="plan:swapmode" aria-pressed="${app.ui.swapMode ? 'true' : 'false'}">${ic('swap', { size: 20 })}${app.ui.swapMode ? 'Done swapping' : 'Swap two nights'}</button>
    </div>
    ${when(app.ui.swapMode, () => html`<p class="swap-banner" role="status">${app.ui.swapPick ? html`Now tap the night to trade with <b>${shortDate(app.ui.swapPick)}</b>.` : 'Tap the first night, then the night to trade with.'}</p>`)}
    ${aheadCard(app)}
    ${tripAdviceCard(app)}
    ${catchUpCard(app)}
    ${leftoversCard(app)}
    ${freezerCard(app)}
    <p class="plan-summary">${planned} ${planned === 1 ? 'dinner' : 'dinners'} planned${away ? `, ${away} ${away === 1 ? 'night' : 'nights'} away` : ''}. About <a href="#/list">${money(list.total)} in groceries</a>${list.nights.length ? `, ${money(list.perDinner)} a dinner` : ''}.</p>
    ${veggieCard(app, range)}
    ${grid(app, range)}
    ${when(auto, () => html`<p class="muted small center">Re-planning keeps cooked and away nights and anything the family set by hand.</p>`)}
    ${prepCard(app, { days: 7 })}
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

export const actions = {
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
    app.render();
  },
  'plan:today': (app) => { app.ui.anchor = app.today(); app.render(); },
  'plan:fill': (app) => {
    const r = currentRange(app);
    app.commit(generateOps(app.db, app.state, { dates: r.dates, mode: 'fill', who: app.who(), today: app.today(), seedKey: seedFor(app, r) }));
  },
  'plan:replan': (app) => {
    const r = currentRange(app);
    // A different seed each time so "Re-plan" actually offers something new; stored entries keep phones in sync.
    const n = (app.ui.replans = (app.ui.replans || 0) + 1);
    app.commit(generateOps(app.db, app.state, { dates: r.dates, mode: 'replan', who: app.who(), today: app.today(), seedKey: `${seedFor(app, r)}#${n}` }));
  },
  'plan:swapmode': (app) => { app.ui.swapMode = !app.ui.swapMode; app.ui.swapPick = null; app.render(); },
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
  'ahead:open': (app) => openPlanAhead(app),
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
    // and it's still there after a reload.
    if (!app.commit(res)) app.render();
    setTimeout(() => document.getElementById('ahead-card')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 120);
  },
  'ahead:list': (app) => {
    const a = aheadRecord(app.state, app.today());
    if (!a) return;
    app.commit(shoppingTripOps(app.state, { today: app.today(), end: a.end, who: app.who() }));
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
  'left:open': (app, el) => openLeftovers(app, el.dataset.date),
  'left:plates': (app, el) => { if (openLeftovers.state) openLeftovers.state.plates = Math.max(1, Math.min(10, openLeftovers.state.plates + Number(el.dataset.delta))); renderSheet(); },
  'left:save': (app, el) => {
    const st = openLeftovers.state;
    const res = leftoversOps(app.db, app.state, { date: el.dataset.date, use: el.dataset.use, to: el.dataset.to || null, name: el.dataset.name || null, plates: st?.plates || 2, today: app.today(), who: app.who() });
    if (app.commit(res)) closeSheet();
  },
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
function openPlanAhead(app) {
  const today = app.today();
  const last = app.ui.aheadLast || aheadRecord(app.state, today);
  const pantryFirst = last ? last.pantryFirst !== false : true;
  const st = (openPlanAhead.state = {
    end: last && last.end >= today ? last.end : aheadEnd(today, 'two'),
    pantryFirst,
    // Re-plan the planner's own picks: on whenever the pantry goes first, unless switched by hand.
    replan: pantryFirst, replanSet: false,
  });
  openSheet({
    id: 'plan-ahead',
    title: 'Plan ahead',
    subtitle: 'Dinners and packed lunches from tonight through the night you pick.',
    render: () => {
      const dates = datesBetween(today, st.end);
      const open = dates.filter((d) => isFillable(app.state.plan?.[d], 'fill')).length;
      const own = dates.filter((d) => d > today && app.state.plan?.[d]?.dinner && isFillable(app.state.plan[d], 'replan')).length; // never tonight's
      const kept = dates.length - open - own;
      return html`
        <h3 class="sheet-h" id="ahead-through-h">Plan through</h3>
        <div class="ahead-quick" role="group" aria-labelledby="ahead-through-h">
          ${AHEAD_QUICK.map((q) => {
            const e = aheadEnd(today, q.id);
            const on = e === st.end;
            return html`<button type="button" class="chip chip-lg ${on ? 'is-on' : ''}" aria-pressed="${tf(on)}" data-action="ahead:quick" data-end="${e}">${q.label}<small>to ${weekdayShort(e)} ${shortDate(e)}</small></button>`;
          })}
        </div>
        <label class="field ahead-date"><span class="field-label">Or pick the last night</span>
          <input class="input" type="date" id="ahead-end" min="${today}" max="${aheadLimit(today)}" value="${st.end}" data-change="ahead:end"></label>
        <p class="muted small ahead-count">${count(dates.length, 'night')}: ${listJoin([open ? `${open} open` : '', own ? `${own} the planner picked` : '', kept ? `${kept} staying as ${kept === 1 ? 'it is' : 'they are'}` : ''])}. Tonight’s dinner and nights set by hand, cooked or away always stay as they are.</p>
        <div class="set-row ahead-switch"><span class="set-label">Use what we have first<small>Dinners the pantry already covers go first, oldest food first, so nothing sits until it’s freezer-burnt.</small></span>${switchToggle({ on: st.pantryFirst, action: 'ahead:pantry', label: 'Use what we have first' })}</div>
        <div class="set-row ahead-switch"><span class="set-label">Re-plan the planner’s picks<small>${own ? `${count(own, 'night')} the planner chose can change when that uses more of the pantry or costs less. Tonight’s dinner stays.` : 'Nothing after tonight was picked by the planner, so only open nights get planned.'} Off: only open nights are filled.</small></span>${switchToggle({ on: st.replan && own > 0, action: 'ahead:replan', label: 'Re-plan the planner’s picks' })}</div>
        <button type="button" class="btn btn-primary btn-block" data-action="ahead:go">${ic('sparkle', { size: 20 })}Plan it</button>`;
    },
  });
}

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
  const oldest = s.usesUp.slice(0, 3);
  const covers = [s.dinnersCovered ? count(s.dinnersCovered, 'dinner') : '', s.lunchesCovered ? count(s.lunchesCovered, 'packed lunch', 'packed lunches') : ''].filter(Boolean);
  const gap = s.firstGap ? s.nights.find((n) => n.date === s.firstGap) : null;
  const row = (n) => html`<li><span class="cover-day">${n.date === today ? 'Tonight' : `${weekdayShort(n.date)} ${shortDate(n.date)}`}</span><span class="cover-what"><b>${n.title}</b><small>Needs ${listJoin(n.dinnerMissing.slice(0, 4).map((m) => foodName(m.name)))}${n.dinnerMissing.length > 4 ? ` and ${n.dinnerMissing.length - 4} more` : ''}</small></span></li>`;
  return html`<section class="ahead-card" id="ahead-card" aria-labelledby="ahead-h">
    <div class="ahead-head">
      <h2 id="ahead-h" class="section-title">${ic('pantry', { size: 22 })}<span>${s.dinnersCovered || s.lunchesCovered ? `Your pantry covers ${listJoin(covers)}` : 'The pantry doesn’t cover a whole meal yet'}</span></h2>
      <button type="button" class="icon-btn" data-action="ahead:close" aria-label="Close this summary">${ic('close', { size: 20 })}</button>
    </div>
    <p class="ahead-through">${s.coveredThrough
      ? html`Without a trip to the store, it carries you through <b>${dayText(s.coveredThrough, today)}</b>${s.firstGap ? '.' : ', the whole plan.'}`
      : gap?.open ? html`Nothing is planned for ${dayText(gap.date, today)} yet.`
        : html`${dayText(s.firstGap, today).replace(/^./, (c) => c.toUpperCase())} already needs ${gap?.dinnerMissing.length ? 'groceries' : 'groceries for packed lunches'}.`}</p>
    ${when(now.dinners, () => html`<div class="ahead-ba" id="ahead-ba">
      <p class="ahead-ba-now"><b>${now.fromPantry} of ${now.dinners}</b> ${now.dinners === 1 ? 'dinner' : 'dinners'} ${was && now.fromPantry > was.fromPantry ? 'now ' : ''}${now.dinners === 1 ? 'comes' : 'come'} from the pantry${was && now.fromPantry !== was.fromPantry ? html` <span class="ahead-was ${now.fromPantry > was.fromPantry ? 'is-down' : ''}">${was.hadOpen ? 'the usual plan' : 'it was'}: ${was.fromPantry}</span>` : ''}</p>
      <p class="ahead-ba-now"><b>About ${money(now.groceries)}</b> in groceries${was && Math.abs(was.groceries - now.groceries) >= 1 ? html` <span class="ahead-was ${now.groceries < was.groceries ? 'is-down' : ''}">${now.groceries < was.groceries ? `down from ${money(was.groceries)}` : `${was.hadOpen ? 'the usual plan' : 'it was'}: ${money(was.groceries)}`}</span>` : ''}</p>
      ${when(was, () => html`<p class="muted small">${aheadVerdict(was, now)}</p>`)}
    </div>`)}
    <div class="cover-meter" role="img" aria-label="${s.nights.filter((n) => n.covered).length} of ${s.nights.length} days covered by the pantry">${s.nights.map((n) => html`<span class="cover-pip ${n.covered ? 'is-on' : ''} ${n.away ? 'is-away' : ''}" title="${weekdayShort(n.date)} ${shortDate(n.date)}: ${n.away ? 'away' : n.covered ? 'covered' : n.open ? 'nothing planned' : 'needs groceries'}"></span>`)}</div>
    ${when(oldest.length, () => html`<p class="ahead-uses">${ic('clock', { size: 18 })}<span>Uses up ${listJoin(oldest.map((u) => `the ${foodName(u.name)} from ${shortDate(u.since)}`))}.</span></p>`)}
    ${need.length ? html`<h3 class="ahead-sub">Still needs groceries<span class="count">${count(need.length, 'night')}</span></h3>
      <ul class="cover-list ahead-list">${need.slice(0, 5).map(row)}</ul>
      ${when(need.length > 5, () => html`<details class="cover-more"><summary>${need.length - 5} more ${need.length - 5 === 1 ? 'night' : 'nights'}</summary><ul class="cover-list ahead-list">${need.slice(5).map(row)}</ul></details>`)}`
      : html`<p class="small">${s.dinners ? `Every planned dinner through ${dayText(a.end, today)} comes from the pantry.` : 'No dinners are planned in this stretch yet.'}</p>`}
    ${when(lunchDays, () => html`<p class="muted small">Packed lunches need something from the store on ${count(lunchDays, 'day')}.</p>`)}
    <button type="button" class="btn btn-primary btn-block" data-action="ahead:list">${ic('cart', { size: 20 })}Make the shopping list</button>
    <p class="muted small">One list for ${start === a.end ? shortDate(start) : rangeLabel(start, a.end)}, both stores, with only what the pantry doesn’t cover.</p>
  </section>`;
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
function planPrefs(app, range) {
  const lean = leanOn(app.state);
  const busy = busyNightsOf(app.state);
  const today = app.today();
  const sum = lean && showNutrition(app) ? leanSummary(app.db, app.state, range.dates.filter((d) => d >= today)) : null;
  // A button, not <details>: the page re-renders on every sync, and this has to stay open through it.
  const open = !!app.ui.prefsOpen;
  return html`<div class="plan-prefs ${open ? 'is-open' : ''}">
    <button type="button" class="plan-prefs-head" data-action="plan:prefs" aria-expanded="${tf(open)}" aria-controls="plan-prefs-body"><span class="opt-label">Planning for</span><span class="plan-prefs-now">${lean ? 'Lean plates' : 'Any dinner'}${busy.length ? `, easy on ${listJoin(busy.map((d) => DAY_LETTERS[d]))}` : ''}</span></button>
    ${when(open, () => html`<div class="plan-prefs-body" id="plan-prefs-body">
    <div class="set-row"><span class="set-label">Lean by default<small>New plans favor lighter, high-protein dinners with a vegetable, and keep fried and heavy ones to two a week. Burger and pizza nights stay.</small></span>${switchToggle({ on: lean, action: 'plan:lean', label: 'Lean by default' })}</div>
    <div class="opt"><span class="opt-label" id="busy-l">Busy nights</span>
      <div class="chip-grid busy-days" role="group" aria-labelledby="busy-l">${DAY_LETTERS.map((l, i) => html`<button type="button" class="chip ${busy.includes(i) ? 'is-on' : ''}" aria-pressed="${tf(busy.includes(i))}" data-action="plan:busy" data-day="${i}">${l}</button>`)}</div>
      <p class="muted small">Busy nights get a slow-cooker dinner (the PossibleCooker does the work) or one that takes 30 minutes or less.</p></div>
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

// ---------------------------------------------------------------- leftovers (SPEC §21.3)

/** A cooked dinner (tonight's or last night's) with no word on leftovers yet. */
export function leftoversCard(app) {
  const asks = leftoverAsks(app.db, app.state, app.today());
  if (!asks.length) return '';
  const today = app.today();
  return html`<section class="left-card" aria-label="Leftovers">${asks.map((a) => html`<div class="left-row">
    <span class="left-ic" aria-hidden="true">${ic('bowl', { size: 22 })}</span>
    <p class="left-text"><b>Any ${foodName(a.title)} left?</b><small>${a.date === today ? 'Tonight’s dinner' : 'Last night’s dinner'}. Say where it went and it gets eaten, not found in two weeks.</small></p>
    <span class="left-acts"><button type="button" class="btn btn-small btn-primary" data-action="left:open" data-date="${a.date}" aria-haspopup="dialog">Leftovers?</button>
      <button type="button" class="btn btn-small btn-quiet" data-action="left:save" data-date="${a.date}" data-use="none">None</button></span>
  </div>`)}</section>`;
}

function openLeftovers(app, date) {
  const today = app.today();
  const c = leftoverChoices(app.db, app.state, { date, today });
  if (!c || app.state.plan?.[date]?.status !== 'cooked') return;
  const st = (openLeftovers.state = { plates: 2 });
  const dayName = (d) => (d === today ? 'today' : d === addDays(today, 1) ? 'tomorrow' : weekdayName(d));
  openSheet({
    id: `leftovers:${date}`,
    title: `Leftovers: ${c.title}`,
    subtitle: 'Where is it going? Leftovers with a plan get eaten.',
    render: () => html`
      <div class="action-list left-choices">
        ${when(c.lunch, () => html`<button type="button" class="action-row" data-action="left:save" data-date="${date}" data-use="lunch" data-to="${c.lunch.date}" data-name="${c.lunch.name}">${ic('lunch')}<span><b>${c.lunch.name}’s lunch ${dayName(c.lunch.date)}</b><small>That packed lunch comes off the plan and the list.</small></span></button>`)}
        ${c.nights.map((n) => html`<button type="button" class="action-row" data-action="left:save" data-date="${date}" data-use="night" data-to="${n.date}">${ic('moon')}<span><b>Leftovers night ${dayName(n.date) === 'tomorrow' ? 'tomorrow' : `on ${weekdayName(n.date)}`}</b><small>${n.open ? 'That night is open.' : `Instead of ${n.title}, the planner’s pick. Its groceries come off the list.`}</small></span></button>`)}
      </div>
      <h3 class="sheet-h">Or put it away</h3>
      <div class="left-plates"><span class="set-label">How many plates?</span>
        <span class="qty-edit"><button type="button" class="stepper-btn" data-action="left:plates" data-delta="-1" aria-label="One plate less">${ic('minus', { size: 18 })}</button>
          <b class="left-n" aria-live="polite">${st.plates}</b>
          <button type="button" class="stepper-btn" data-action="left:plates" data-delta="1" aria-label="One plate more">${ic('plus', { size: 18 })}</button></span></div>
      <div class="action-list">
        <button type="button" class="action-row" data-action="left:save" data-date="${date}" data-use="fridge">${ic('clock')}<span><b>In the fridge</b><small>On the shelf list with a use-by of ${weekdayName(addDays(today, 4))}.</small></span></button>
        <button type="button" class="action-row" data-action="left:save" data-date="${date}" data-use="freezer">${ic('snow')}<span><b>In the freezer</b><small>Dated today, good for about 3 months, and listed with the quick backups.</small></span></button>
        <button type="button" class="action-row action-quiet" data-action="left:save" data-date="${date}" data-use="none">${ic('check')}<span><b>Nothing left</b></span></button>
      </div>`,
  });
}

// ---------------------------------------------------------------- catching the pantry up (SPEC §21.3)

/** Dinners never marked cooked and packed lunches never taken off the shelf: how the pantry drifts. */
export function catchUpCard(app) {
  const c = catchUp(app.db, app.state, app.today());
  if (!c.total) return '';
  const parts = [c.nights.length ? count(c.nights.length, 'dinner') : '', c.lunches.length ? count(c.lunches.length, 'packed lunch', 'packed lunches') : ''].filter(Boolean);
  return html`<section class="catch-card" id="catch-card" aria-labelledby="catch-h">
    <span class="left-ic" aria-hidden="true">${ic('pantry', { size: 22 })}</span>
    <p class="left-text"><b id="catch-h">Is the pantry still right?</b><small>${listJoin(parts)} from the last week ${c.total === 1 ? 'was' : 'were'} never taken off the shelves. If the food was eaten, the list thinks it’s still here.</small></p>
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
