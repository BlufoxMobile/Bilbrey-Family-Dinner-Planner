// PLAN: 1–3 weeks or a month, plan-from store, brand default, day cards with sides,
// two-tap swap, drag-and-drop on desktop, plan / re-plan.
import { html, ic, when, segmented, toast } from '../ui.js';
import { addDays, diffDays, money, rangeLabel, shortDate, startOfWeek, monthName, weekday, monthOnly } from '../util.js';
import { PERIODS, periodRange, shiftPeriod, dinnerById, isFillable, nightType, storeCoverage } from '../planner.js';
import { listJoin } from '../util.js';
import { buildList } from '../shopping.js';
import { generateOps, swapNightsOps, settingOps } from '../actions.js';
import { sidesFor, dinnerPhoto, awayReason, dayStamp } from './common.js';
import { openNight } from './sheets.js';

export const title = () => 'Plan';

/** The period to show by default: this one, or the next if only a couple of nights are left. */
export function defaultAnchor(app) {
  const today = app.today();
  const { period, weekStartsOn } = app.settings;
  const r = periodRange(today, period, weekStartsOn);
  const left = diffDays(r.end, today) + 1;
  if ((period === 'month' && left < 5) || (period !== 'month' && left < 3)) return shiftPeriod(r.start, period, 1);
  return today;
}

export function currentRange(app) {
  const anchor = app.ui.anchor || defaultAnchor(app);
  return periodRange(anchor, app.settings.period, app.settings.weekStartsOn);
}

const STORE_OPTS = [{ id: 'both', label: 'Both stores' }, { id: 'sams', label: "Sam's only" }, { id: 'jewel', label: 'Jewel only' }];
const BRAND_OPTS = [{ id: 'generic', label: 'Store brand' }, { id: 'name', label: 'Name brand' }];

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
  const label = away ? awayReason(e).label : d ? d.title : 'Nothing planned';
  const sides = d && !away ? sidesFor(app, d.id, e) : [];
  return html`<article class="${cls}" data-date="${date}" ${!cooked && !past ? html`draggable="true"` : ''}>
    <button type="button" class="day-hit" data-action="plan:tap" data-date="${date}" aria-label="${shortDate(date)}: ${label}${cooked ? ', cooked' : ''}${app.ui.swapMode ? (picked ? ', selected for swap' : ', tap to swap') : ''}">
      ${dayStamp(date, today)}
      ${away ? html`<span class="day-ph day-ph-away">${ic('moon', { size: compact ? 20 : 26 })}</span>` : d ? dinnerPhoto(app, d, { size: compact ? 'thumb' : 'card' }) : html`<span class="day-ph">${ic('plus', { size: 22 })}</span>`}
      <span class="day-title">${label}</span>
      ${when(away && e.away?.note, () => html`<span class="day-note">${e.away.note}</span>`)}
      ${when(!d && !away && !past, () => html`<span class="day-note">${type === 'burger' ? 'Burger night' : type === 'pizza' ? 'Pizza night' : 'Open'}</span>`)}
      ${when(cooked, () => html`<span class="day-status">${ic('checkCircle', { size: 16 })}Cooked</span>`)}
      ${when(e?.manual && !away && !cooked && d, () => html`<span class="day-status day-status-quiet">Set by ${e.by || 'the family'}</span>`)}
    </button>
    ${when(sides.length && !compact, () => html`<ul class="day-sides">
      ${sides.map((s) => html`<li><span class="day-side">${s.info?.title}${when(s.remembered, () => html`<span class="sr-only"> (remembered)</span>`)}</span>
        ${when(!cooked, () => html`<button type="button" class="sub-btn" data-action="side:sub" data-date="${date}" data-dinner="${d.id}" data-slot="${s.slot}" aria-label="Substitute ${s.info?.title}">Substitute</button>`)}</li>`)}
      ${when(!cooked && d.sideSlots === 1 && sides.length < 2, () => html`<li><button type="button" class="sub-btn sub-add" data-action="side:sub" data-date="${date}" data-dinner="${d.id}" data-slot="1">${ic('plus', { size: 16 })}Add a side</button></li>`)}
    </ul>`)}
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
    ${weeks.map((w) => html`<section class="week week-month" aria-label="Week of ${shortDate(w[0])}">
      <h2 class="week-h">${shortDate(w[0])} – ${shortDate(w[w.length - 1])}</h2>
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
      <h1 class="page-title">Plan</h1>
      ${segmented('period', PERIODS.map((p) => ({ id: p.id, label: p.label })), s.period, { label: 'How long to plan', action: 'plan:period' })}
    </header>
    ${periodNav(app, range)}
    <div class="plan-opts">
      <div class="opt"><span class="opt-label" id="pf-l">Plan from</span>${segmented('planStore', STORE_OPTS, s.planStore, { label: 'Plan from', action: 'plan:setting', small: true })}</div>
      <div class="opt"><span class="opt-label">Brands</span>${segmented('brand', BRAND_OPTS, s.brand, { label: 'Brand default', action: 'plan:setting', small: true })}</div>
    </div>
    ${when(s.planStore !== 'both', () => {
      const cov = storeCoverage(app.db, app.state, s.planStore);
      const name = s.planStore === 'jewel' ? 'Jewel-Osco' : "Sam's Club";
      return html`<p class="hint">${ic('store', { size: 18 })}<span>${cov.ok} of ${cov.total} dinners can be made from ${name} alone (or with what’s in the pantry), so only those get planned.${cov.missing.length ? ` The others need something ${name} doesn’t carry, like ${listJoin(cov.missing.map((m) => m.toLowerCase()))}. Mark those stocked in the pantry and more dinners qualify.` : ''}${auto ? ' Re-plan to apply this to nights already planned.' : ''}</span></p>`;
    })}
    <div class="plan-actions">
      ${open ? html`<button type="button" class="btn btn-primary" data-action="plan:fill">${ic('sparkle', { size: 20 })}Plan ${open} open ${open === 1 ? 'night' : 'nights'}</button>` : ''}
      ${auto ? html`<button type="button" class="btn btn-secondary" data-action="plan:replan">${ic('refresh', { size: 20 })}Re-plan this period</button>` : ''}
      <button type="button" class="btn ${app.ui.swapMode ? 'btn-primary' : 'btn-secondary'}" data-action="plan:swapmode" aria-pressed="${app.ui.swapMode ? 'true' : 'false'}">${ic('swap', { size: 20 })}${app.ui.swapMode ? 'Done swapping' : 'Swap two nights'}</button>
    </div>
    ${when(app.ui.swapMode, () => html`<p class="swap-banner" role="status">${app.ui.swapPick ? html`Now tap the night to trade with <b>${shortDate(app.ui.swapPick)}</b>.` : 'Tap the first night, then the night to trade with.'}</p>`)}
    <p class="plan-summary">${planned} ${planned === 1 ? 'dinner' : 'dinners'} planned${away ? `, ${away} ${away === 1 ? 'night' : 'nights'} away` : ''}. About <a href="#/list">${money(list.total)} in groceries</a>${list.nights.length ? `, ${money(list.perDinner)} a dinner` : ''}.</p>
    ${grid(app, range)}
    ${when(auto, () => html`<p class="muted small center">Re-planning keeps cooked and away nights and anything the family set by hand.</p>`)}
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
  'plan:period': (app, el) => { app.commit(settingOps(app.state, 'period', el.dataset.value), { quiet: true }); app.ui.anchor = app.ui.anchor || app.today(); },
  'plan:setting': (app, el) => {
    const res = settingOps(app.state, el.dataset.name, el.dataset.value);
    app.commit(res, { quiet: true });
    if (el.dataset.name === 'planStore') toast(el.dataset.value === 'both' ? 'Planning from both stores.' : `Planning from ${el.dataset.value === 'jewel' ? 'Jewel-Osco' : "Sam's Club"} only.`);
    if (el.dataset.name === 'brand') toast(el.dataset.value === 'name' ? 'Name brands by default. Change any item on the list.' : 'Store brands by default. Change any item on the list.');
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
};

export { addDays, startOfWeek, monthOnly };
