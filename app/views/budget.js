// BUDGET: the monthly target, this month's projection from the plan, logged receipts,
// and savings against the old $1,000 month. SPEC §21.4: store trips against the 2–3 trip goal, the
// year at this rate, what was thrown out, and whether the trip list is long enough.
import { html, ic, when, toast } from '../ui.js';
import { BASELINE_MONTHLY } from '../config.js';
import { money, monthOnly, mediumDate, shortDate, round2, isISODate, byLabel, weekdayName, listJoin, shortWeekday, midSentence } from '../util.js';
import { monthBudget, buildList, SPLIT_WHY } from '../shopping.js';
import { tripAdvice, extendTripOps, tripKeyOf, TRIP_MIN_DAYS } from '../planahead.js';
import { removeWasteOps } from '../waste.js';
import { datesBetween } from '../util.js';
import { addReceiptOps, removeReceiptOps, settingOps } from '../actions.js';
import { segmented } from '../ui.js';
import { MEAT_OPTS, actions as familyActions } from './family.js';
import { receiptList, deleteReceiptOps } from '../receipts.js';
import { undoFor } from '../actions.js';
import { receiptDetails } from './receipts.js';

export const title = () => 'Budget';
const NAMES = { sams: "Sam's Club", jewel: 'Jewel-Osco', other: 'Other' };

const STORE_SHORT = { sams: 'Sam’s', jewel: 'Jewel', other: 'another store' };
const cleanName = (name) => String(name || '').replace(/\s*\(.*?\)\s*/g, ' ').replace(/,.*$/, '').trim();
const dayDate = (iso) => `${shortWeekday(iso)}, ${shortDate(iso)}`;

/** Store trips this month against the goal of two or three (SPEC §21.4). */
function tripsCard(app, b) {
  const t = b.trips;
  const month = monthOnly(app.today());
  const pips = Math.max(t.goal, t.count);
  let advice;
  if (!t.count) advice = `No receipts in ${month} yet. The goal is ${t.goal === 3 ? 'two or three' : t.goal} store trips a month, so each list should cover about ${Math.ceil(30 / t.goal)} days.`;
  else if (t.over) advice = `${t.count - t.goal} more than the goal of ${t.goal}. Quick extra runs are where the unplanned spending goes: make the next list cover the ${t.daysLeft} days left in ${month}.`;
  else if (!t.left) advice = `That’s the month’s ${t.goal}. The plan and the pantry carry the ${t.daysLeft} ${t.daysLeft === 1 ? 'day' : 'days'} left; Plan ahead shows how far the pantry goes.`;
  else advice = `${t.left} ${t.left === 1 ? 'trip' : 'trips'} left for the ${t.daysLeft} days to ${shortDate(b.end)}: ${t.left === 1 ? 'the next list should cover all of them' : `each list should cover about ${t.stretch} days`}.`;
  return html`<section class="trips-card" id="trips-card" aria-labelledby="trips-h">
    <h2 id="trips-h" class="section-title">${ic('cart', { size: 22 })}Store trips in ${month}</h2>
    <p class="trips-big ${t.over ? 'is-over' : ''}"><b>${t.count}</b><span>of ${t.goal} ${t.goal === 1 ? 'trip' : 'trips'}${t.perTrip ? html`<small>about ${money(t.perTrip)} a trip</small>` : ''}</span></p>
    <div class="trip-pips" role="img" aria-label="${t.count} of ${t.goal} trips used">${Array.from({ length: pips }, (_, i) => html`<span class="trip-pip ${i < t.count ? (i >= t.goal ? 'is-over' : 'is-on') : ''}"></span>`)}</div>
    <p class="small trips-advice">${advice}</p>
    ${when(t.count, () => html`<ul class="trips-list">${t.trips.map((x) => html`<li><span>${dayDate(x.date)}</span><span>${listJoin(x.stores.map((sid) => NAMES[sid] || sid)) || 'Store'}</span><b>${money(x.total)}</b></li>`)}</ul>`)}
    <div class="opt trips-goal"><span class="opt-label" id="tg-l">Trips a month to aim for</span>${segmented('tripGoal', [2, 3, 4].map((n) => ({ id: String(n), label: String(n) })), String(t.goal), { label: 'Trips a month to aim for', action: 'bud:trip-goal', small: true })}</div>
    <p class="muted small">Counted from receipts: each day with a receipt is one trip, so Sam’s and Jewel on the same day count once.</p>
  </section>`;
}

/** The year at this month's rate, against 12 × the target, and what the last three months really cost. */
function yearCard(app, b) {
  const p = b.pace;
  const over = p.overYear > 0;
  return html`<section class="year-card ${over ? 'is-over' : ''}" id="year-card" aria-labelledby="year-h">
    <h2 id="year-h" class="section-title">${ic('budget', { size: 22 })}The year at this rate</h2>
    <p class="year-line">At this rate, about <b>${money(p.year, { whole: true })}</b> this year. Your target is <b>${money(p.yearTarget, { whole: true })}</b> (${money(p.target, { whole: true })} a month).${p.avg3 != null ? html` The last ${p.monthsWithData === 3 ? '3 months' : p.monthsWithData === 1 ? 'month with receipts' : `${p.monthsWithData} months with receipts`} averaged <b>${money(p.avg3, { whole: true })}</b>.` : ''}</p>
    <p class="budget-verdict ${over ? 'is-over' : 'is-under'}">${over ? `That’s about ${money(p.overYear, { whole: true })} over for the year, or ${money(p.overYear / 12, { whole: true })} a month to find.` : `That’s about ${money(-p.overYear, { whole: true })} under the year’s target.`}</p>
    ${when(p.monthsWithData, () => html`<ul class="legend year-months">${p.months.map((m) => html`<li><span class="key ${m.total > p.target ? 'key-maybe' : 'key-spent'}"></span>${monthOnly(`${m.month}-01`)}${m.total ? '' : ' (no receipts logged)'}<b>${m.total ? money(m.total) : '—'}</b></li>`)}</ul>`)}
    <p class="muted small">“This rate” is ${monthOnly(app.today())}: its receipts plus what the plan still needs, ${money(p.rate)}, times twelve.${p.avg3 == null ? ' Scan receipts for a few months and this shows what the family really averages.' : ''}</p>
  </section>`;
}

/** What went in the trash (SPEC §21.3): dollars this month, and what goes most often. */
function wasteCard(app, b) {
  const w = b.wasted;
  const month = monthOnly(app.today());
  const repeat = w.top.filter((x) => x.times >= 2);
  return html`<section class="waste-card" id="waste-card" aria-labelledby="waste-h">
    <h2 id="waste-h" class="section-title">${ic('trash', { size: 22 })}Thrown out in ${month}</h2>
    ${w.count ? html`<p class="trips-big is-over"><b>${money(w.total)}</b><span>${w.count} ${w.count === 1 ? 'thing' : 'things'} wasted${w.lastMonth ? html`<small>${money(w.lastMonth)} last month</small>` : ''}</span></p>`
      : html`<p class="small">Nothing thrown out so far${w.lastMonth ? ` (${money(w.lastMonth)} last month)` : ''}. When food goes in the trash, take it off the Pantry with “Threw it out” and it’s counted here.</p>`}
    ${when(w.top.length, () => html`<h3 class="waste-sub">What gets wasted most <small>(last 90 days)</small></h3>
      <ul class="legend waste-top">${w.top.slice(0, 5).map((x) => html`<li><span class="key ${x.times >= 2 ? 'key-maybe' : 'key-plan'}"></span>${cleanName(x.name)}: ${x.times === 1 ? 'once' : `${x.times} times`}<b>${money(x.cost)}</b></li>`)}</ul>`)}
    ${when(repeat.length, () => html`<p class="hint">${ic('leaf', { size: 18 })}<span>The planner now buys ${listJoin(repeat.slice(0, 3).map((x) => midSentence(cleanName(x.name))))} in the smaller pack and plans ${repeat.length === 1 ? 'it' : 'them'} sooner.</span></p>`)}
    ${when(w.items.length, () => html`<details class="cover-more"><summary>Every entry this month</summary>
      <ul class="receipt-list">${w.items.map((x) => html`<li class="receipt-row"><span><b>${cleanName(x.name)}</b><small>${shortDate(x.date)}${x.by ? `, by ${x.by}` : ''}${x.estimated ? ', estimated' : ''}</small></span>
        <span class="receipt-amt">${money(x.cost)}</span>
        <button type="button" class="icon-btn" data-action="bud:waste-remove" data-key="${x.key}" aria-label="Remove ${cleanName(x.name)} from the waste log">${ic('trash', { size: 20 })}</button></li>`)}</ul></details>`)}
    ${when(w.yearToDate > w.total, () => html`<p class="muted small">${money(w.yearToDate)} thrown out so far this year.</p>`)}
  </section>`;
}

const adviceCache = new WeakMap();
/**
 * Is the trip list long enough? (SPEC §21.4) A list under 10 days means another run within the
 * week: this says how many more days would skip it and what they cost, and offers to extend.
 * Shown on the List (during a trip) and here.
 */
export function tripAdviceCard(app, list = null) {
  const today = app.today();
  let a = adviceCache.get(app.state);
  if (a === undefined || a?.today !== today) {
    a = tripAdvice(app.db, app.state, { today });
    if (a) a.today = today;
    adviceCache.set(app.state, a);
  }
  if (!a) return '';
  const l = list || buildList(app.db, app.state, { dates: datesBetween(a.trip.start > today ? a.trip.start : today, a.trip.end), listKey: tripKeyOf(a.trip), store: a.trip.store === 'both' ? null : a.trip.store, split: a.trip.store === 'both', today });
  const moved = (l.split?.moved || []).slice(0, 4);
  const splitLine = a.trip.store === 'both' && l.stores.sams.items.length + l.stores.jewel.items.length > 0
    ? html`<p class="small trip-split"><b>${STORE_SHORT.sams}</b> ${l.stores.sams.items.length ? `${money(l.stores.sams.subtotal)} for ${l.stores.sams.items.length} ${l.stores.sams.items.length === 1 ? 'thing' : 'things'} (bulk and freezer)` : 'nothing this trip'}; <b>${STORE_SHORT.jewel}</b> ${l.stores.jewel.items.length ? `${money(l.stores.jewel.subtotal)} for ${l.stores.jewel.items.length} (fresh and small packs)` : 'nothing this trip'}.${moved.length ? ` Moved for this trip: ${listJoin(moved.map((m) => `${midSentence(cleanName(m.name))} to ${STORE_SHORT[m.to]} (${SPLIT_WHY[m.why] || m.why})`))}.` : ''}</p>` : '';
  if (!a.short) {
    return html`<section class="trip-advice is-good" id="trip-advice" aria-label="This trip">
      <p class="trip-advice-line">${ic('check', { size: 18 })}<span>This list covers <b>${a.days} days</b>, through ${dayDate(a.trip.end)}: one run, then no store until then.</span></p>
      ${splitLine}
    </section>`;
  }
  return html`<section class="trip-advice" id="trip-advice" aria-label="This trip">
    <p class="trip-advice-line">${ic('info', { size: 18 })}<span>This trip covers <b>${a.days} ${a.days === 1 ? 'day' : 'days'}</b>. <b>${a.more} more</b> (about ${money(Math.max(0, a.added), { whole: true })}) skips the next store run.</span></p>
    <button type="button" class="btn btn-secondary btn-block" data-action="trip:extend">${ic('plus', { size: 20 })}Extend the trip to ${dayDate(a.newEnd)} (${TRIP_MIN_DAYS} days)</button>
    ${splitLine}
  </section>`;
}

export function render(app) {
  const today = app.today();
  const b = monthBudget(app.db, app.state, today, { baseline: BASELINE_MONTHLY });
  const scale = Math.max(b.target, b.projected, b.ifPlanned, 1) * 1.08;
  const pct = (n) => `${Math.max(0, Math.min(100, (n / scale) * 100)).toFixed(2)}%`;
  // One number everywhere (docs/spec/29): where the month is heading, open nights at the usual cost
  // included. The Weekly check-in says the same number.
  const heading = b.unplanned ? b.ifPlanned : b.projected;
  const over = heading > b.target + 0.004;
  const month = monthOnly(today);
  return html`<div class="page page-budget">
    <header class="page-head"><h1 class="page-title">Budget</h1><a class="text-link" href="#/checkin">Weekly check-in</a></header>
    <section class="budget-card" aria-labelledby="bud-h">
      <h2 id="bud-h" class="budget-month">${month} groceries</h2>
      <!-- The answer first (gauntlet r2), then the number it comes from. -->
      <p class="budget-answer ${over ? 'is-over' : 'is-under'}">${over ? `About ${money(heading - b.target, { whole: true })} over` : `About ${money(b.target - heading, { whole: true })} under`}<small>the ${money(b.target, { whole: true })} target</small></p>
      <p class="budget-big"><span class="budget-of">Heading for</span> <span class="budget-num">${money(heading)}</span></p>
      <div class="meter" role="img" aria-label="${money(b.spent)} spent, ${money(b.stillToBuy)} still to buy, target ${money(b.target)}">
        <span class="meter-spent" style="width:${pct(b.spent)}"></span>
        <span class="meter-plan" style="left:${pct(b.spent)};width:${pct(b.stillToBuy)}"></span>
        ${when(b.unplanned && b.ifPlanned > b.projected, () => html`<span class="meter-maybe" style="left:${pct(b.projected)};width:${pct(b.ifPlanned - b.projected)}"></span>`)}
        <span class="meter-target" style="left:${pct(b.target)}"><span>Target</span></span>
      </div>
      <details class="budget-break"><summary>What that’s made of</summary>
      <ul class="legend">
        <li><span class="key key-spent"></span>Spent so far<b>${money(b.spent)}</b></li>
        <li><span class="key key-plan"></span>Dinners: still to buy for ${b.plannedRemaining} planned ${b.plannedRemaining === 1 ? 'dinner' : 'dinners'}<b>${money(b.dinnersToBuy)}</b></li>
        ${when(b.lunchesRemaining || b.lunchesToBuy, () => html`<li><span class="key key-plan"></span>Lunches: still to buy for ${b.lunchesRemaining} packed ${b.lunchesRemaining === 1 ? 'lunch' : 'lunches'}<b>${money(b.lunchesToBuy)}</b></li>`)}
        ${when(b.extras, () => html`<li><span class="key key-plan"></span>Extras: everyday items for the rest of the month<b>${money(b.extras)}</b></li>`)}
        ${when(b.unplanned, () => html`<li><span class="key key-maybe"></span>${b.unplanned} ${b.unplanned === 1 ? 'night' : 'nights'} not planned yet, at ${money(b.average)} a dinner (your rotation’s average)<b>+${money(round2(b.ifPlanned - b.projected))}</b></li>`)}
      </ul></details>
    </section>

    ${tripAdviceCard(app)}

    <details class="budget-more" ${app.ui.budgetMoreOpen ? 'open' : ''}>
      <summary><span>Trips, waste and the year</span></summary>
      <p class="muted small">${money(b.spent)} on receipts so far + ${money(b.stillToBuy)} still on the list for the rest of ${month}${b.unplanned ? ` + ${b.unplanned} open ${b.unplanned === 1 ? 'night' : 'nights'} at the usual ${money(b.average)}` : ''}. Prices ${app.db.pricesUpdated ? `estimated as of ${mediumDate(app.db.pricesUpdated)}` : 'are estimates'}.</p>
    ${tripsCard(app, b)}
    ${yearCard(app, b)}
    ${wasteCard(app, b)}

    <section class="typical" aria-labelledby="ty-h">
      <h2 id="ty-h" class="section-title">A typical month</h2>
      <p class="muted small">What a month costs once the pantry is stocked: the food each dinner and packed lunch actually uses, without the extra you pay up front for bulk packs that carry into the next week.</p>
      <ul class="legend">
        <li><span class="key key-plan"></span>Dinners: ${b.typical.nights} at ${money(b.typical.perDinner)}<b>${money(b.typical.dinners)}</b></li>
        ${when(b.typical.lunchCount, () => html`<li><span class="key key-plan"></span>Lunches: ${b.typical.lunchCount} packed this month<b>${money(b.typical.lunches)}</b></li>`)}
        <li><span class="key key-maybe"></span>Extras${b.typical.extrasUnpriced ? ` (${b.typical.extrasUnpriced} without a price)` : ''}<b>${money(b.typical.extras)}</b></li>
        <li><span class="key key-spent"></span><strong>Total</strong><b>${money(b.typical.total)}</b></li>
      </ul>
      <p class="budget-verdict ${b.typical.total > b.target ? 'is-over' : 'is-under'}">${b.typical.total > b.target ? `${money(b.typical.total - b.target)} over the ${money(b.target, { whole: true })} target. Try Lighter meat, cheaper products for a few items, or a Jewel-only week.` : `${money(b.target - b.typical.total)} under the ${money(b.target, { whole: true })} target.`}</p>
    </section>

    </details>
    <details class="target log-by-hand"><summary>Change the monthly target (${money(b.target, { whole: true })})</summary>
      <form class="form form-row" data-submit="bud:target">
        <label class="field field-money"><span class="sr-only">Monthly target in dollars</span><span class="prefix" aria-hidden="true">$</span><input class="input" name="target" type="number" inputmode="decimal" min="50" step="10" value="${b.target}"></label>
        <button type="submit" class="btn btn-secondary">Save target</button>
      </form>
    </details>

    <section class="receipts" aria-labelledby="r-h">
      <h2 id="r-h" class="section-title">Receipts this month</h2>
      <div class="rcpt-cta">
        <button type="button" class="btn btn-primary" data-action="rcpt:scan">${ic('camera', { size: 20 })}Scan a receipt</button>
        <p class="muted small">A photo of the receipt, or screenshots from the store’s app.</p>
      </div>
      ${(() => {
        const scanned = receiptList(app.state).filter((r) => r.date.slice(0, 7) === b.month);
        return scanned.length ? html`<div class="rcpt-list">${scanned.map((r) => receiptDetails(app, r))}</div>` : '';
      })()}
      ${when(receiptList(app.state).length, () => html`<a class="text-link" href="#/receipts">All saved receipts (${receiptList(app.state).length})</a>`)}
      <details class="log-by-hand"><summary>No receipt? Log a total by hand</summary>
      <form class="form form-inline-card" data-submit="bud:receipt">
        <div class="field-row">
          <label class="field"><span class="field-label">Date</span><input class="input" type="date" name="date" value="${today}" max="${today}" required></label>
          <label class="field field-money"><span class="field-label">Total</span><span class="prefix" aria-hidden="true">$</span><input class="input" type="number" name="amount" inputmode="decimal" min="0.01" step="0.01" placeholder="0.00" required></label>
        </div>
        <fieldset class="field"><legend class="field-label">Store</legend><div class="chip-grid">
          ${['sams', 'jewel', 'other'].map((s, i) => html`<label class="chip chip-radio"><input type="radio" name="store" value="${s}" ${i === 1 ? 'checked' : ''}>${NAMES[s]}</label>`)}
        </div></fieldset>
        <label class="field"><span class="field-label">Note <small>(optional)</small></span><input class="input" name="note" maxlength="60" placeholder="Big Sam’s run"></label>
        <button type="submit" class="btn btn-primary btn-block">${ic('receipt', { size: 20 })}Log receipt</button>
      </form></details>
      ${b.receipts.filter((r) => !r.receiptId || !app.state.receiptLog?.[r.receiptId]).length ? html`<ul class="receipt-list">${b.receipts.filter((r) => !r.receiptId || !app.state.receiptLog?.[r.receiptId]).map((r) => html`<li class="receipt-row">
          <span><b>${NAMES[r.store] || r.store}</b><small>${shortDate(r.date)}${r.note ? `, ${r.note}` : ''}${byLabel(r.by) ? `, by ${byLabel(r.by)}` : ''}</small></span>
          <span class="receipt-amt">${money(Number(r.amount))}</span>
          ${when(r.id, () => html`<button type="button" class="icon-btn" data-action="bud:remove" data-id="${r.id}" aria-label="Remove receipt">${ic('trash', { size: 20 })}</button>`)}
        </li>`)}</ul>`
        : b.receipts.length ? '' : html`<p class="muted small">No receipts logged for ${month} yet.</p>`}
    </section>
  </div>`;
}

/** "How it’s worked out" stays open through redraws once opened. */
export function mount(app, main) {
  main.querySelector('.budget-more')?.addEventListener('toggle', (ev) => { app.ui.budgetMoreOpen = ev.target.open; });
}

export const actions = {
  'bud:target': (app, form) => {
    const v = Number(new FormData(form).get('target'));
    if (!(v >= 50 && v <= 5000)) { toast('Enter a target between $50 and $5,000.'); return; }
    app.commit({ ...settingOps(app.state, 'monthlyTarget', Math.round(v)), message: `Monthly target set to ${money(Math.round(v), { whole: true })}.` });
  },
  'bud:receipt': (app, form) => {
    const f = new FormData(form);
    const date = String(f.get('date') || '');
    const amount = Number(f.get('amount'));
    if (!isISODate(date) || !(amount > 0)) { toast('Enter the date and the receipt total.'); return; }
    app.commit({ ...addReceiptOps(app.state, { date, store: String(f.get('store') || 'jewel'), amount, note: String(f.get('note') || '').trim(), who: app.who() }), message: `Logged ${money(amount)}.` });
  },
  'bud:remove': (app, el) => app.commit(removeReceiptOps(app.state, { id: el.dataset.id })),
  'bud:trip-goal': (app, el) => {
    const n = Number(el.dataset.value);
    if (![2, 3, 4].includes(n)) return;
    app.commit({ ...settingOps(app.state, 'tripGoal', n), message: `Aiming for ${n} store trips a month.` });
  },
  'bud:waste-remove': (app, el) => app.commit(removeWasteOps(app.state, { key: el.dataset.key })),
  'trip:extend': (app) => app.commit(extendTripOps(app.db, app.state, { today: app.today(), who: app.who() })),
};
