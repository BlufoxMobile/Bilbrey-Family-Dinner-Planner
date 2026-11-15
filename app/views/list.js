// LIST: the shopping list for the selected period — by store, then aisle — with
// per-item store, product and price, check-off, the freezer panel, extras, and the store handoff.
import { html, ic, when, openSheet, closeSheet, toast, copyText, confirmSheet, segmented, renderSheet } from '../ui.js';
import { fmtQty, mediumDate, money, rangeLabel, relativeDay, shortWeekday, listJoin, shortDate, dayAndDate, round2, datesBetween, addDays, weekday, isISODate, weekdayName } from '../util.js';
import { listKeyFor, dinnerById } from '../planner.js';
import { buildList, formatPackQty, formatStoreList, formatFullList, unitText, OTHER, productName } from '../shopping.js';
import {
  toggleCheckOps, doneShoppingOps, setPriceOps, clearPriceOps, notAtStoreOps, addExtraOps, removeExtraOps, setPantryOps, undoFor,
} from '../actions.js';
import { set, del } from '../state.js';
import { currentRange, periodNav } from './plan.js';
import { productLabel, findItUrl, priceSource } from '../products.js';
import { openProductPicker, productSource } from './products.js';
import { openReceiptScan } from './receipts.js';

export const title = () => 'Shopping list';
const NAMES = { sams: "Sam's Club", jewel: 'Jewel-Osco' };

/** The trip in progress (SPEC §12): one store, today through the last day it shops for. */
export function activeTrip(app) {
  const t = app.settings.trip;
  return t && t.end >= app.today() ? t : null;
}
export const tripKey = (t) => `trip:${t.start}:${t.end}:${t.store}`;

function current(app) {
  const today = app.today();
  const trip = activeTrip(app);
  if (trip) {
    const start = trip.start > today ? trip.start : today;
    const range = { start, end: trip.end, dates: datesBetween(start, trip.end), trip: true };
    const listKey = tripKey(trip);
    return { range, listKey, trip, list: buildList(app.db, app.state, { dates: range.dates, listKey, store: trip.store === 'both' ? null : trip.store, today }) };
  }
  const range = currentRange(app);
  const listKey = listKeyFor(range);
  return { range, listKey, trip: null, list: buildList(app.db, app.state, { dates: range.dates, listKey, today }) };
}

const TRIP_STORES = [{ id: 'jewel', label: 'Jewel-Osco' }, { id: 'sams', label: "Sam's Club" }, { id: 'both', label: 'Both' }];
const SKIP_WHY = { stretch: 'Making do with what we have', check: 'Check at home first', have: 'We have it' };

function tripBar(app, trip, range, list) {
  const nights = list.nights.length;
  const lunches = list.lunches.length;
  return html`<div class="trip-bar">
    <span class="trip-ic">${ic('cart', { size: 22 })}</span>
    <p class="trip-what"><b>This trip: ${trip.store === 'both' ? 'Sam’s Club and Jewel-Osco' : NAMES[trip.store]}</b>
      <small>For ${rangeLabel(range.start, range.end)}${nights || lunches ? `: ${listJoin([nights ? `${nights} ${nights === 1 ? 'dinner' : 'dinners'}` : '', lunches ? `${lunches} packed ${lunches === 1 ? 'lunch' : 'lunches'}` : ''].filter(Boolean))}` : ''}</small></p>
    <span class="trip-acts">
      <button type="button" class="btn btn-small btn-quiet" data-action="trip:new">Change</button>
      <button type="button" class="btn btn-small btn-quiet" data-action="trip:end">Back to the ${app.settings.period === 'month' ? 'month' : 'week'}</button>
    </span>
  </div>`;
}

/** The last day a new trip shops for: this coming Friday (payday), or Sunday if it's already the weekend. */
export function defaultTripEnd(today) {
  const wd = weekday(today); // 0 = Sunday
  const toFri = (5 - wd + 7) % 7;
  return addDays(today, wd === 6 ? 1 : toFri);
}

function openTrip(app) {
  const t = activeTrip(app);
  const st = openTrip.state = { store: t?.store || 'jewel', end: t?.end || defaultTripEnd(app.today()) };
  openSheet({
    id: 'trip',
    title: t ? 'Change this trip' : 'Shop for one trip',
    subtitle: 'The list shows only what this trip needs: the dinners and packed lunches from today through the day you pick, minus what’s in the pantry.',
    render: () => html`
      <h3 class="sheet-h">Store</h3>
      ${segmented('tripStore', TRIP_STORES, st.store, { label: 'Store for this trip', action: 'trip:store' })}
      <form class="form" data-submit="trip:save">
        <label class="field"><span class="field-label">Shopping for meals through</span>
          <input class="input" type="date" name="end" min="${app.today()}" value="${st.end}" required></label>
        <p class="muted small">${t ? 'Changing the dates or store starts a fresh list: nothing checked, nothing skipped.' : 'Starts a fresh list: nothing checked, nothing skipped. The week or month view comes back when the trip is over.'}</p>
        <button type="submit" class="btn btn-primary btn-block">${ic('cart', { size: 20 })}${t ? 'Update the trip' : 'Start the trip list'}</button>
      </form>`,
  });
}

function skippedSection(app, list, listKey) {
  if (!list.skipped.length) return '';
  return html`<section class="skipped" aria-labelledby="sk-h">
    <h2 id="sk-h" class="section-title">Not buying this trip (${list.skipped.length})</h2>
    <ul class="skip-list">${list.skipped.map((i) => html`<li class="skip-row">
      <span><b>${i.name}</b><small>${[SKIP_WHY[i.skip?.reason] || 'Skipped', i.skip?.note || `${unitText(i.shortfall, i.unit)} short`].filter(Boolean).join(': ')}${i.cost != null ? ` (saves ${money(i.cost)})` : ''}</small></span>
      <button type="button" class="btn btn-small btn-quiet" data-action="list:unskip" data-key="${i.id}" data-list="${listKey}">Put back</button>
    </li>`)}</ul>
  </section>`;
}

function onDaySection(app, list) {
  if (!list.onDay.length) return '';
  const today = app.today();
  return html`<section class="on-day" aria-labelledby="od-h">
    <h2 id="od-h" class="section-title">Buy fresh on the day</h2>
    <p class="muted small">Not in this trip’s cart: pick these up the morning they’re eaten.</p>
    <ul class="skip-list">${list.onDay.map((i) => {
      const days = [...new Set([...(i.lunchUses || []), ...(i.uses || [])].map((u) => u.date))].sort().map((d) => (d === today ? 'today' : shortWeekday(d)));
      const who = [...new Set((i.lunchUses || []).map((u) => u.person))];
      return html`<li class="skip-row"><span><b>${i.name}</b><small>${listJoin(days)}${who.length ? ` for ${listJoin(who)}` : ''}${i.pack ? `, ${money(i.pack.price)} each (${priceSource(i.pack).kind === 'checked' ? 'checked' : 'listed'})` : ''}</small></span><b>${i.cost != null ? money(i.cost) : ''}</b></li>`;
    })}</ul>
  </section>`;
}

function couponsToClip(app, list) {
  if (!list.coupons.length) return '';
  return html`<section class="clip-first" aria-labelledby="clip-h">
    <h2 id="clip-h" class="section-title">${ic('receipt', { size: 22 })}Clip ${list.coupons.length === 1 ? 'this coupon' : `these ${list.coupons.length} coupons`} first</h2>
    <ul class="clip-list">${list.coupons.map((c) => html`<li><b>${c.name}</b><small>${c.text}${c.expires ? `, ends ${weekdayName(c.expires)} ${shortDate(c.expires)}` : ''}</small></li>`)}</ul>
    <p class="muted small">Coupons only count once they’re clipped in your ${NAMES[list.coupons[0].store] || 'store'} account. The total above assumes you clip them.</p>
  </section>`;
}

function usesText(app, item) {
  const today = app.today();
  const days = [...new Set(item.uses.map((u) => u.date))].map((d) => (d === today ? 'tonight' : shortWeekday(d)));
  return days.length ? `for ${listJoin(days)}` : '';
}

function detail(app, i) {
  if (i.freeText) return `${i.every === 'week' ? 'Every week' : 'Every trip'}${i.cost == null ? ', add a price to count it in the budget' : ''}`;
  const parts = [];
  if (i.reasons.includes('dinners') || i.reasons.includes('lunches')) {
    const who = [...new Set((i.lunchUses || []).map((u) => u.person))];
    const forWhat = [i.reasons.includes('dinners') ? usesText(app, i) : '', who.length ? `${listJoin(who)}’s lunches` : ''].filter(Boolean);
    let t = `${unitText(i.shortfall, i.unit)} needed ${forWhat.length ? (i.reasons.includes('dinners') ? forWhat.join(' and ') : `for ${forWhat.join(' and ')}`) : ''}`.trim();
    if (i.have > 0) t += `, ${fmtQty(i.have)} on hand`;
    parts.push(t);
  }
  if (i.extraPacks) parts.push(`${i.extraPacks} for everyday`);
  if (i.reasons.includes('low')) parts.push('running low');
  if (i.leftover > 0.01 && i.kind !== 'staple' && (i.reasons.includes('dinners') || i.reasons.includes('lunches'))) parts.push(`${unitText(i.leftover, i.unit)} left over`);
  if (i.storeFallback) parts.push(`not at ${NAMES[OTHER[i.store]]}`);
  return parts.join('; ');
}

/** "paid $17.94 · Nov 12", "est.", "family price" — where an item's price comes from (SPEC §9.4). */
function priceTag(i) {
  const src = priceSource(i.pack);
  if (src.kind === 'paid') return html`<small class="paid" title="What you paid on a receipt">paid${i.pack.date ? ` ${money(i.pack.price)} · ${shortDate(i.pack.date)}` : ''}</small>`;
  if (src.kind === 'family' || src.kind === 'typed') return html`<small class="paid">your price</small>`;
  if (src.kind === 'checked') {
    if (i.regularCost != null && i.cost != null && i.regularCost > i.cost + 0.004) return html`<small class="was" title="Regular price">reg ${money(i.regularCost)}</small>`;
    return html`<small class="paid" title="Price checked on the store’s site">checked${src.date ? ` ${shortDate(src.date)}` : ''}</small>`;
  }
  if (src.kind === 'listed') return '';
  return html`<small class="est" title="Estimated price">est.</small>`;
}

function itemRow(app, i, listKey) {
  const qty = i.freeText ? (i.qty ? unitText(i.qty, i.unit || 'each') : '') : formatPackQty(i);
  const chosen = i.product?.chosen;
  return html`<li class="item ${i.checked ? 'is-checked' : ''}">
    <button type="button" class="check" role="checkbox" aria-checked="${i.checked ? 'true' : 'false'}" data-action="list:check" data-key="${i.key}" data-list="${listKey}" aria-label="${i.name}${i.checked ? ', in the cart' : ''}"><span class="check-box">${ic('check', { size: 18 })}</span></button>
    <button type="button" class="item-main" data-action="list:item" data-key="${i.key}">
      <span class="item-name">${i.name}</span>
      ${when(!i.freeText && i.product?.label, () => html`<span class="item-product ${chosen ? '' : 'is-usual'}">${i.product.label}</span>`)}
      <span class="item-qty">${qty}${i.reasons.includes('lunches') ? html` <span class="tag tag-lunch">Lunch</span>` : ''}${i.organic ? html` <span class="tag tag-organic">Organic</span>` : ''}${i.pack?.sale ? html` <span class="tag tag-sale">Sale</span>` : ''}${i.coupon ? html` <span class="tag tag-coupon">Clip coupon</span>` : ''}${i.pack?.source === 'family' ? html` <span class="tag">family price</span>` : ''}</span>
      <span class="item-detail">${detail(app, i)}</span>
    </button>
    <span class="item-price">${i.cost == null ? html`<span class="muted">add price</span>` : html`${money(i.cost)}${priceTag(i)}`}
      ${when(!i.freeText, () => html`<a class="find-it" href="${findItUrl(app.db, i.store, i.product?.chosen ? i.product : null, i.product?.name || i.name)}" target="_blank" rel="noopener" data-findit="${i.id}" aria-label="Find ${chosen ? productLabel(i.product) : i.name} on ${NAMES[i.store]}">Find it</a>`)}</span>
  </li>`;
}

const FILTERS = [{ id: 'all', label: 'Everything' }, { id: 'dinners', label: 'Dinners' }, { id: 'lunches', label: 'Lunches' }];
/** The filter only applies while there are lunches to filter (else a leftover "Lunches" would hide everything). */
export function activeFilter(app, list) {
  const f = app.ui.listFilter || 'all';
  return list.lunches.length && FILTERS.some((x) => x.id === f) ? f : 'all';
}
function shown(f, i) {
  if (f === 'lunches') return i.reasons.includes('lunches');
  if (f === 'dinners') return i.reasons.includes('dinners') || i.reasons.includes('low');
  return true;
}
/** What a line costs for the filtered meals (a pack both dinners and lunches use is split by need). */
export function filterShare(f, i) {
  if (f === 'lunches') return i.costLunch || 0;
  if (f === 'dinners') return Math.max(0, (i.cost || 0) - (i.costLunch || 0) - (i.costExtras || 0));
  return i.cost || 0;
}

function storeSection(app, list, store, listKey) {
  const s = list.stores[store];
  if (!s.items.length) return '';
  const info = app.db.stores[store];
  const f = activeFilter(app, list);
  const aisles = s.aisles.map((a) => ({ ...a, items: a.items.filter((i) => shown(f, i)) })).filter((a) => a.items.length);
  if (!aisles.length) return '';
  const visible = aisles.reduce((n, a) => n + a.items.length, 0);
  const share = round2(aisles.reduce((t, a) => t + a.items.reduce((u, i) => u + filterShare(f, i), 0), 0));
  return html`<section class="store-sec store-${store}" aria-labelledby="sec-${store}">
    <header class="store-head">
      <h2 id="sec-${store}" class="store-name">${info?.name || NAMES[store]}</h2>
      ${f === 'all'
        ? html`<p class="store-total"><b>${money(s.subtotal)}</b><small>${s.items.length} ${s.items.length === 1 ? 'item' : 'items'}${s.remaining < s.items.length ? `, ${s.remaining} left` : ''}</small></p>`
        : html`<p class="store-total"><b>${money(share)}</b><small>for ${f}: ${visible} of ${s.items.length} ${s.items.length === 1 ? 'item' : 'items'}</small></p>`}
    </header>
    <button type="button" class="btn btn-secondary btn-block store-handoff" data-action="list:handoff" data-store="${store}">${ic('copy', { size: 20 })}Copy & open ${info?.name || NAMES[store]}</button>
    ${aisles.map((a) => html`<div class="aisle"><h3 class="aisle-h">${a.aisle}</h3><ul class="items">${a.items.map((i) => itemRow(app, i, listKey))}</ul></div>`)}
  </section>`;
}

function fzRow(f, today) {
  return html`<li class="fz-row">
    <span class="fz-name"><b>${f.name}</b><small>${[
      f.have > 0 ? `${fmtQty(f.have)} ${f.unit} already in the freezer` : '',
      f.buying > 0 ? `buying ${f.packs} × ${f.packSize ? `${fmtQty(f.packSize)} ${f.unit}` : ''} ${f.store ? `at ${f.store === 'sams' ? "Sam's" : 'Jewel'}` : ''}`.replace(/\s+/g, ' ').trim() : '',
    ].filter(Boolean).join(', ')}</small></span>
    <span class="fz-meter" aria-hidden="true">${f.uses.map((u, k) => html`<span class="fz-pip ${k < f.covers ? 'is-on' : ''}" title="${relativeDay(u.date, today)}"></span>`)}</span>
    <span class="fz-what">${f.covers === f.dinners ? `Covers ${f.dinners} ${f.dinners === 1 ? 'dinner' : 'dinners'}` : `Covers ${f.covers} of ${f.dinners}`}${f.leftover > 0 ? html`<small>${fmtQty(f.leftover)} ${f.unit} left for next time</small>` : ''}</span>
  </li>`;
}

function freezerPanel(app, list) {
  const rows = list.freezer.filter((f) => f.dinners > 0);
  if (!rows.length) return '';
  const today = app.today();
  return html`<section class="freezer" aria-labelledby="fz-h">
    <h2 id="fz-h" class="section-title">${ic('snow', { size: 22 })}From the freezer</h2>
    <p class="muted small">How far the bulk packs go this period, and what’s left after.</p>
    <ul class="fz-list">${rows.slice(0, 4).map((f) => fzRow(f, today))}</ul>
    ${when(rows.length > 4, () => html`<details class="fz-more"><summary>${rows.length - 4} more from the freezer</summary><ul class="fz-list">${rows.slice(4).map((f) => fzRow(f, today))}</ul></details>`)}
  </section>`;
}

/** Coupons can't be clipped by the app (no store API, no store passwords here): this opens the right pages. */
function couponsCard(app) {
  const j = app.db.stores.jewel.coupons;
  const sm = app.db.stores.sams.coupons;
  return html`<section class="coupons" aria-label="Coupons">
    <button type="button" class="btn btn-secondary" data-action="list:coupons" data-store="jewel">${ic('receipt', { size: 20 })}${j?.label || 'Clip Jewel coupons'}</button>
    <button type="button" class="btn btn-quiet" data-action="list:coupons" data-store="sams">${sm?.label || "Sam's Instant Savings"} (automatic)</button>
  </section>`;
}

function openCoupons(app, focus) {
  const j = app.db.stores.jewel;
  const sm = app.db.stores.sams;
  openSheet({
    id: 'coupons',
    title: 'Coupons and savings',
    subtitle: 'The planner can’t clip coupons for you: there’s no store API, and it never holds a store password. This opens the right page.',
    render: () => html`
      <section class="coupon-store ${focus === 'jewel' ? 'is-focus' : ''}">
        <h3 class="sheet-h">${j.name}: clip before you shop</h3>
        <p class="sheet-text">${j.coupons.clipAll ? 'Sign in, then Clip All.' : 'Takes a minute or two: sign in to Jewel-Osco (for U) and tap Clip on each coupon you’ll use. There’s no Clip All button.'} Coupons only count once they’re clipped.</p>
        ${when(j.coupons.steps?.length, () => html`<ol class="steps-small">${j.coupons.steps.map((x) => html`<li>${x}</li>`)}</ol>`)}
        <a class="btn btn-primary btn-block" href="${j.coupons.url}" target="_blank" rel="noopener" data-coupons="jewel">${ic('receipt', { size: 20 })}Clip Jewel coupons</a>
      </section>
      <section class="coupon-store ${focus === 'sams' ? 'is-focus' : ''}">
        <h3 class="sheet-h">${sm.name}: nothing to clip</h3>
        <p class="sheet-text">Instant Savings come off automatically for members, online and in the club, so the price on Sam’s site or shelf already includes them. The planner’s estimates use Sam’s regular prices, so a sale only makes the trip a little cheaper.</p>
        <a class="btn btn-secondary btn-block" href="${sm.coupons.url}" target="_blank" rel="noopener" data-coupons="sams">See this month’s Instant Savings</a>
      </section>`,
  });
}

function extrasSection(app) {
  const extras = Object.entries(app.state.extras || {});
  const have = new Set(extras.map(([, x]) => x.item).filter(Boolean));
  const quick = Object.values(app.db.ingredients).filter((i) => i.extra && !have.has(i.id)).slice(0, 8);
  return html`<section class="extras" aria-labelledby="ex-h">
    <h2 id="ex-h" class="section-title">Everyday extras</h2>
    <p class="muted small">Milk, bread, eggs and anything else, so one list covers the trip. They count in the budget.</p>
    ${when(extras.length, () => html`<ul class="extra-list">${extras.map(([id, x]) => html`<li class="extra-row">
      <span><b>${x.name}</b><small>${x.item ? `${x.qty} ${x.qty === 1 ? 'pack' : 'packs'}` : unitText(x.qty || 1, x.unit || 'each')} every ${x.every === 'week' ? 'week' : 'trip'}, ${x.store === 'sams' ? "Sam's" : 'Jewel'}${x.price != null ? `, ${money(x.price)} each` : ''}</small></span>
      <button type="button" class="icon-btn" data-action="list:extra-remove" data-id="${id}" aria-label="Remove ${x.name}">${ic('trash', { size: 20 })}</button>
    </li>`)}</ul>`)}
    ${when(quick.length, () => html`<div class="chip-grid">${quick.map((i) => html`<button type="button" class="chip" data-action="list:extra-quick" data-item="${i.id}">${ic('plus', { size: 16 })}${i.name}</button>`)}</div>`)}
    <form class="form form-inline-card" data-submit="list:extra-add">
      <p class="field-label">Something else</p>
      <input class="input" name="name" placeholder="Paper towels" required maxlength="60" aria-label="Item">
      <div class="field-row">
        <input class="input" name="qty" type="number" inputmode="decimal" min="1" step="1" value="1" aria-label="How many">
        <input class="input" name="price" type="number" inputmode="decimal" min="0" step="0.01" placeholder="Price each" aria-label="Price each, optional">
      </div>
      <div class="field-row">
        <select class="input" name="store" aria-label="Store"><option value="jewel">Jewel-Osco</option><option value="sams">Sam's Club</option></select>
        <select class="input" name="every" aria-label="How often"><option value="trip">Every trip</option><option value="week">Every week</option></select>
      </div>
      <button type="submit" class="btn btn-secondary btn-block">Add to extras</button>
    </form>
  </section>`;
}

export function render(app) {
  const { range, listKey, list, trip } = current(app);
  const checked = list.items.filter((i) => i.checked).length;
  const paidCount = list.items.filter((i) => priceSource(i.pack).kind === 'paid').length;
  const estNote = app.db.pricesUpdated ? `estimated as of ${mediumDate(app.db.pricesUpdated)}` : 'estimated from the recipe box';
  const pricesNote = paidCount
    ? `${paidCount} of ${list.items.length} prices are what you actually paid, from your receipts; the rest are ${estNote}.`
    : `Prices ${estNote}.`;
  const noNights = !list.nights.length;
  return html`<div class="page page-list">
    <header class="page-head">
      <h1 class="page-title">Shopping list</h1>
      <div class="head-tools">
        <button type="button" class="icon-btn" data-action="list:share" aria-label="Share the list">${ic('share')}</button>
        <button type="button" class="icon-btn" data-action="list:print" aria-label="Print the list">${ic('print')}</button>
      </div>
    </header>
    ${trip ? tripBar(app, trip, range, list) : html`${periodNav(app, range, { compact: true })}
      <button type="button" class="btn btn-secondary btn-block trip-start" data-action="trip:new">${ic('cart', { size: 20 })}Shopping today? Make a list for just this trip</button>`}
    ${noNights && !list.lunches.length && !list.items.length ? html`<div class="empty">
        <span class="empty-ic">${ic('list', { size: 28 })}</span>
        <h3 class="empty-title">Nothing planned for ${rangeLabel(range.start, range.end)}</h3>
        <p class="empty-body">Plan these nights and the list fills itself: every ingredient for five, minus what’s already in the pantry.</p>
        <div class="empty-actions"><a class="btn btn-primary" href="#/plan">Go to the planner</a></div>
      </div>` : html`
      <section class="totals" aria-label="Estimated cost">
        <p class="total-big"><span class="total-num">${money(list.total)}</span><span class="total-label">${list.checkedCount ? 'after sales and coupons, ' : ''}estimated for ${listJoin([
          list.nights.length ? `${list.nights.length} ${list.nights.length === 1 ? 'dinner' : 'dinners'}` : '',
          list.lunches.length ? `${list.lunches.length} packed ${list.lunches.length === 1 ? 'lunch' : 'lunches'}` : '',
          Object.keys(app.state.extras || {}).length ? 'everyday extras' : '',
        ].filter(Boolean))}</span></p>
        ${when(list.lunches.length, () => html`<ul class="cost-lines"><li><span>Dinners</span><b>${money(list.dinnerCost)}</b></li><li><span>Lunches</span><b>${money(list.lunchCost)}</b></li>${when(list.extrasCost, () => html`<li><span>Extras</span><b>${money(list.extrasCost)}</b></li>`)}</ul>`)}
        ${when(list.savings > 0.5, () => html`<p class="total-save">${ic('check', { size: 18 })}<span>Saves ${money(list.savings)} on sales and coupons (regular prices: ${money(list.regularTotal)}).</span></p>`)}
        ${trip && trip.store !== 'both' ? '' : html`<div class="total-split">
          ${['sams', 'jewel'].map((s) => html`<p><span>${NAMES[s]}</span><b>${money(list.stores[s].subtotal)}</b></p>`)}
        </div>`}
        ${when(list.onDay.length, () => html`<p class="muted small">Plus ${money(list.onDayCost)} bought fresh on the day (below).</p>`)}
        ${when((list.nights.length || list.lunches.length) && list.leftoverValue > 1, () => html`<p class="total-used">${listJoin([
          list.nights.length ? `${money(list.usedByDinners)} goes into these ${list.nights.length} dinners (${money(list.perDinner)} each)` : '',
          list.lunches.length ? `${money(list.usedByLunches)} into the lunches` : '',
        ].filter(Boolean))}. ${money(list.leftoverValue)} is bulk packs and staples left over for later.</p>`)}
        ${when(list.checkedCount, () => html`<p class="muted small">${list.checkedCount} ${list.checkedCount === 1 ? 'price was' : 'prices were'} checked on the store’s site ${list.checkedOn ? shortDate(list.checkedOn) : ''}, with that week’s sales and coupons. Tax isn’t included.</p>`)}
        <p class="muted small">${pricesNote} Sam’s prices were read from samsclub.com; prices marked est. are estimates and can be off by about 15%. ${list.unpriced ? `${list.unpriced} ${list.unpriced === 1 ? 'item has' : 'items have'} no price yet.` : ''} Tap any item to fix its price; the family sees your correction.</p>
        ${when(list.items.length, () => html`<div class="progress" role="img" aria-label="${checked} of ${list.items.length} in the cart"><span style="width:${Math.round((checked / list.items.length) * 100)}%"></span></div>
          <p class="muted small">${checked} of ${list.items.length} in the cart</p>`)}
      </section>
      ${couponsToClip(app, list)}
      ${couponsCard(app)}
      <nav class="list-links" aria-label="Receipts and products">
        <button type="button" class="btn btn-secondary" data-action="rcpt:scan">${ic('camera', { size: 20 })}Scan a receipt</button>
        <a class="btn btn-quiet" href="#/products">${ic('cart', { size: 20 })}My products</a>
      </nav>
      ${freezerPanel(app, list)}
      ${when(list.lunches.length, () => html`<div class="list-filter">${segmented('listFilter', FILTERS, activeFilter(app, list), { label: 'Show', action: 'list:filter', small: true })}</div>`)}
      ${storeSection(app, list, 'sams', listKey)}
      ${storeSection(app, list, 'jewel', listKey)}
      ${onDaySection(app, list)}
      ${skippedSection(app, list, listKey)}
      ${when(list.leftovers.length, () => {
        const top = list.leftovers.filter((l) => l.storage === 'freezer' || l.storage === 'fridge').slice(0, 6);
        const rest = list.leftovers.length - top.length;
        return html`<section class="leftovers"><h2 class="section-title">Left over for next week</h2>
          ${when(top.length, () => html`<ul class="leftover-list">${top.map((l) => html`<li><span>${l.name}</span><b>${unitText(l.qty, l.unit)}</b></li>`)}</ul>`)}
          ${when(rest > 0, () => html`<p class="small">${top.length ? 'Plus ' : ''}${rest} pantry ${rest === 1 ? 'item' : 'items'} with some to spare.</p>`)}
          <p class="muted small">Tap “Done shopping” after the trip and these carry into the pantry, so next week’s list is smaller.</p></section>`;
      })}
      ${when(list.covered.length, () => html`<details class="covered"><summary>Already in the pantry (${list.covered.length})</summary>
        <ul>${list.covered.map((c) => html`<li>${c.name}<small>${c.stocked ? 'stocked' : `${fmtQty(c.have)} on hand, ${fmtQty(c.need)} needed`}</small></li>`)}</ul></details>`)}
      <div class="done-shopping">
        <button type="button" class="btn btn-primary btn-block" data-action="list:done" ${checked ? '' : 'disabled'}>${ic('pantry', { size: 20 })}Done shopping: put checked items in the pantry</button>
      </div>`}
    ${extrasSection(app)}
    <p class="muted small honest">Sam’s Club and Jewel-Osco don’t offer a way for apps to fill your cart, so “Copy & open” copies the list and opens the store. You check out in their app.</p>
  </div>`;
}

function itemSheet(app, key) {
  openSheet({
    id: `item:${key}`,
    live: false,
    size: 'tall',
    get title() { return 'Item'; },
    render: () => {
      const { list } = current(app);
      const i = list.items.find((x) => x.key === key);
      if (!i) return html`<p class="sheet-text">That item is no longer on this list.</p>`;
      if (i.freeText) {
        return html`<p class="sheet-text"><b>${i.name}</b>, ${i.every === 'week' ? 'every week' : 'every trip'} at ${NAMES[i.store]}.</p>
          <button type="button" class="btn btn-quiet btn-block" data-action="list:extra-remove" data-id="${i.key}">${ic('trash', { size: 20 })}Remove from extras</button>`;
      }
      const both = app.settings.planStore === 'both';
      const fam = i.pack?.source === 'family';
      const ps = priceSource(i.pack);
      const src = !i.pack ? 'No price yet' : fam ? `Family price${i.pack.by ? ` from ${i.pack.by}` : ''}`
        : ps.kind === 'paid' ? (i.pack.date ? `Paid on your ${shortDate(i.pack.date)} receipt` : 'What you paid, from your receipts') : ps.kind === 'typed' ? 'The price you typed in'
          : ps.kind === 'listed' ? `Listed on the ${NAMES[i.store]} site` : 'Estimated';
      return html`
        <h3 class="item-sheet-name">${i.name}</h3>
        ${when(i.coupon, () => html`<p class="hint">${ic('receipt', { size: 18 })}<span><b>Clip the coupon first:</b> ${i.coupon.text}${i.coupon.expires ? `, ends ${shortDate(i.coupon.expires)}` : ''}.</span></p>`)}
        <p class="sheet-text">${detail(app, i) || 'On the list.'}</p>
        ${when(i.uses.length, () => html`<ul class="uses">${i.uses.map((u) => html`<li><span>${dayAndDate(u.date, app.today())}</span><span>${dinnerById(app.db, app.state, u.dinner)?.title}</span><span>${unitText(u.qty, i.unit)}</span></li>`)}</ul>`)}
        <div class="product-box">
          <span><small>${i.product?.chosen ? `Your product at ${NAMES[i.store]}` : i.product?.usual ? `What you usually buy at ${NAMES[i.store]}` : `The product at ${NAMES[i.store]}`}</small><b>${i.product?.label || i.name}</b><small>${i.product?.chosen ? productSource(i.product) : i.product?.usual ? 'From your past receipts. Change it any time.' : 'Not bought yet. Scan a receipt, or tap Change to pick yours.'}</small></span>
          <span class="product-box-acts">
            <a class="btn btn-small btn-secondary" href="${findItUrl(app.db, i.store, i.product?.chosen ? i.product : null, i.product?.name || i.name)}" target="_blank" rel="noopener" data-findit="${i.id}">${ic('search', { size: 18 })}Find it</a>
            <button type="button" class="btn btn-small btn-quiet" data-action="item:product" data-store="${i.store}" data-id="${i.id}">Change</button>
          </span>
        </div>
        <div class="kv">
          <p><span>Buying</span><b>${formatPackQty(i)}</b></p>
          <p><span>Price</span><b>${i.cost == null ? '—' : `${money(i.cost)}${i.packs > 1 ? ` (${money(i.pack.price)} each)` : ''}`}</b></p>
          <p><span>Source</span><b>${src}${i.pack?.url ? html`, <a href="${i.pack.url}" target="_blank" rel="noopener">see it</a>` : ''}</b></p>
        </div>
        <h3 class="sheet-h">Store</h3>
        ${both ? segmented('store', [{ id: 'sams', label: "Sam's Club" }, { id: 'jewel', label: 'Jewel-Osco' }], i.store, { label: 'Store for this item', action: 'item:store' })
          : html`<p class="muted small">This period is planned from ${NAMES[app.settings.planStore]} only. Switch “Plan from” to both stores to move items.</p>`}
        <h3 class="sheet-h">Fix the price</h3>
        <form class="form" data-submit="item:price" data-store="${i.store}" data-id="${i.id}">
          <div class="field-row">
            <label class="field"><span class="field-label">Pack size (${i.unit})</span><input class="input" name="size" type="number" inputmode="decimal" min="0.01" step="0.01" value="${i.pack?.size ?? ''}" required></label>
            <label class="field"><span class="field-label">Price</span><input class="input" name="price" type="number" inputmode="decimal" min="0" step="0.01" value="${i.pack?.price ?? ''}" required></label>
          </div>
          <button type="submit" class="btn btn-secondary btn-block">Save price for the family</button>
          ${when(fam, () => html`<button type="button" class="btn btn-quiet btn-block" data-action="item:price-clear" data-store="${i.store}" data-id="${i.id}">Use the estimate again</button>`)}
        </form>
        <div class="action-list">
          <button type="button" class="action-row" data-action="item:have" data-id="${i.id}">${ic('pantry')}<span><b>We already have it</b><small>Adds it to the pantry so it drops off the list.</small></span></button>
          <button type="button" class="action-row" data-action="list:skip" data-reason="stretch" data-key="${i.id}">${ic('check')}<span><b>Skip it this trip: we’ll make do</b><small>Stretch what’s at home. Only this list changes.</small></span></button>
          <button type="button" class="action-row" data-action="list:skip" data-reason="check" data-key="${i.id}">${ic('info')}<span><b>Check at home first</b><small>Moves it to “Not buying this trip” until you put it back.</small></span></button>
          <button type="button" class="action-row" data-action="item:notat" data-id="${i.id}" data-store="${i.store}">${ic('store')}<span><b>${NAMES[i.store]} doesn’t carry this</b><small>${both ? `Moves it to ${NAMES[OTHER[i.store]]}.` : 'Planning from one store will skip dinners that need it.'}</small></span></button>
        </div>`;
    },
  });
  itemSheet.key = key;
}

/** Short search words for a store search URL: drop sizes and parentheticals. */
function searchWords(name, store) {
  const words = String(name).replace(/\(.*?\)/g, ' ').replace(/,.*$/, '').replace(/[^A-Za-z0-9' ]+/g, ' ').trim().split(/\s+/).slice(0, 4);
  return store === 'sams' ? words.map(encodeURIComponent).join('+') : encodeURIComponent(words.join(' '));
}

function handoff(app, store) {
  const { list } = current(app);
  const text = formatStoreList(app.db, list, store);
  const info = app.db.stores[store];
  copyText(text).then((ok) => {
    openSheet({
      id: `handoff:${store}`,
      title: ok ? `${info.name} list copied` : `Copy the ${info.name} list`,
      subtitle: `${list.stores[store].items.filter((i) => !i.checked).length || list.stores[store].items.length} items, about ${money(list.stores[store].subtotal)}`,
      render: () => html`
        ${store === 'jewel'
          ? html`<p class="hint">${ic('receipt', { size: 18 })}<span>Clip coupons first: sign in to Jewel-Osco and tap Clip on each one you’ll use (there’s no Clip All). <a href="${info.coupons.url}" target="_blank" rel="noopener">Clip Jewel coupons</a></span></p>`
          : html`<p class="hint">${ic('receipt', { size: 18 })}<span>Sam’s Instant Savings come off automatically at checkout for members. <a href="${info.coupons.url}" target="_blank" rel="noopener">See Instant Savings</a></span></p>`}
        <ol class="steps-small">${info.handoff.filter((s, k) => !(k === 0 && /^tap copy/i.test(s))).map((s) => html`<li>${s}</li>`)}</ol>
        ${when(info.handoffMethod, () => html`<p class="muted small">${info.handoffMethod}</p>`)}
        <a class="btn btn-primary btn-block" href="${info.orderUrl || info.website}" target="_blank" rel="noopener">${ic('store', { size: 20 })}Open ${info.name}</a>
        ${when(info.appUrl, () => html`<a class="btn btn-quiet btn-block" href="${info.appUrl}" target="_blank" rel="noopener">Get the ${info.name} app</a>`)}
        ${when(info.searchTemplate, () => {
          const items = list.stores[store].items.filter((i) => !i.checked);
          return items.length ? html`<details class="more"><summary>Find each item on ${info.name}</summary><ul class="handoff-items">${items.map((i) => html`<li><span>${productName(i)}</span><a class="btn btn-small btn-quiet" href="${i.freeText ? info.searchTemplate.replace(/\{q\}|\{query\}/, searchWords(i.name, store)) : findItUrl(app.db, store, i.product?.chosen ? i.product : null, i.product?.chosen ? i.product.name : productName(i))}" target="_blank" rel="noopener">Find it</a></li>`)}</ul></details>` : '';
        })}
        <label class="field"><span class="field-label">${ok ? 'What was copied' : 'Select and copy this'}</span><textarea class="input copy-box" readonly rows="8">${text}</textarea></label>
        <button type="button" class="btn btn-quiet btn-block" data-action="list:copy-again" data-store="${store}">${ic('copy', { size: 20 })}Copy again</button>
        ${when(info.address || info.phone, () => html`<p class="muted small">${[info.address, info.phone, info.hours].filter(Boolean).join('. ')}</p>`)}`,
    });
  });
}

export const actions = {
  'trip:new': (app) => openTrip(app),
  'trip:store': (app, el) => { if (openTrip.state) openTrip.state.store = el.dataset.value; renderSheet(); },
  'trip:save': (app, form) => {
    const end = String(new FormData(form).get('end') || '');
    const today = app.today();
    if (!isISODate(end) || end < today) { toast('Pick today or a later day.'); return; }
    const store = openTrip.state?.store || 'jewel';
    const prev = activeTrip(app);
    const trip = { start: today, end, store, by: app.who() || 'Family', at: new Date().toISOString() };
    const ops = [set(['settings', 'trip'], trip)];
    if (prev) ops.push(del(['checked', tripKey(prev)]), del(['skips', tripKey(prev)]));
    app.commit({ ops, undo: undoFor(app.state, ops), message: `Trip list for ${store === 'both' ? 'both stores' : NAMES[store]}, through ${weekdayName(end)}.` });
    closeSheet();
  },
  'trip:end': (app) => {
    const t = app.settings.trip;
    const ops = [del(['settings', 'trip'])];
    if (t) ops.push(del(['checked', tripKey(t)]), del(['skips', tripKey(t)]));
    app.commit({ ops, undo: undoFor(app.state, ops), message: 'Back to the full list.' });
  },
  'list:skip': (app, el) => {
    const { listKey } = current(app);
    const ops = [set(['skips', listKey, el.dataset.key], { reason: el.dataset.reason === 'check' ? 'check' : 'stretch', by: app.who() || 'Family', at: new Date().toISOString() })];
    app.commit({ ops, undo: undoFor(app.state, ops), message: el.dataset.reason === 'check' ? 'Check at home first. It’s under “Not buying this trip.”' : 'Skipped for this trip.' });
    closeSheet();
  },
  'list:unskip': (app, el) => {
    const ops = [del(['skips', el.dataset.list, el.dataset.key])];
    app.commit({ ops, undo: undoFor(app.state, ops), message: 'Back on the list.' });
  },
  'list:check': (app, el) => app.commit(toggleCheckOps(app.state, { listKey: el.dataset.list, key: el.dataset.key }), { quiet: true }),
  'list:item': (app, el) => itemSheet(app, el.dataset.key),
  'list:handoff': (app, el) => handoff(app, el.dataset.store),
  'list:coupons': (app, el) => openCoupons(app, el.dataset.store),
  'list:filter': (app, el) => { app.ui.listFilter = el.dataset.value; app.render(); },
  'list:copy-again': async (app, el) => {
    const { list } = current(app);
    const ok = await copyText(formatStoreList(app.db, list, el.dataset.store));
    toast(ok ? 'Copied.' : 'Select the text and copy it.');
  },
  'list:share': async (app) => {
    const { list, range } = current(app);
    const text = formatFullList(app.db, list);
    if (!text.trim()) { toast('The list is empty.'); return; }
    if (navigator.share) {
      try { await navigator.share({ title: `Groceries ${rangeLabel(range.start, range.end)}`, text }); } catch { /* cancelled */ }
    } else {
      toast((await copyText(text)) ? 'List copied. Paste it anywhere.' : 'Sharing isn’t available here.');
    }
  },
  'list:print': () => window.print(),
  'list:done': async (app) => {
    const { list } = current(app);
    const n = list.items.filter((i) => i.checked && !i.freeText).length;
    const ok = await confirmSheet({ title: 'Done shopping?', body: `Put ${n} checked ${n === 1 ? 'item' : 'items'} in the pantry, so leftovers carry to next week and the list shows only what’s still needed.`, confirm: 'Put them in the pantry' });
    if (ok) app.commit(doneShoppingOps(app.db, app.state, { list, who: app.who() }));
  },
  'list:extra-quick': (app, el) => app.commit(addExtraOps(app.db, app.state, { item: el.dataset.item, qty: 1, every: 'week' })),
  'list:extra-remove': (app, el) => { app.commit(removeExtraOps(app.state, { id: el.dataset.id })); if (itemSheet.key === el.dataset.id) closeSheet(); },
  'list:extra-add': (app, form) => {
    const f = new FormData(form);
    const name = String(f.get('name') || '').trim();
    if (!name) return;
    app.commit(addExtraOps(app.db, app.state, { name, qty: Number(f.get('qty')) || 1, store: f.get('store'), every: f.get('every'), price: f.get('price') === '' ? null : f.get('price') }));
  },
  'item:store': (app, el) => {
    const ops = [set(['storeFor', itemSheet.key], el.dataset.value)];
    app.commit({ ops, undo: undoFor(app.state, ops), message: `Moved to ${NAMES[el.dataset.value]}.` });
    renderSheet();
  },
  'item:price': (app, form) => {
    const f = new FormData(form);
    const size = Number(f.get('size'));
    const price = Number(f.get('price'));
    if (!(size > 0) || !(price >= 0)) { toast('Enter a pack size and a price.'); return; }
    const { list } = current(app);
    const it = list.items.find((x) => x.id === form.dataset.id && x.store === form.dataset.store);
    app.commit(setPriceOps(app.db, app.state, { store: form.dataset.store, id: form.dataset.id, size, price, product: it?.product, who: app.who() }));
    renderSheet();
  },
  'item:price-clear': (app, el) => { app.commit(clearPriceOps(app.state, { store: el.dataset.store, id: el.dataset.id })); renderSheet(); },
  'item:notat': (app, el) => { app.commit(notAtStoreOps(app.db, app.state, { store: el.dataset.store, id: el.dataset.id })); closeSheet(); },
  'item:product': (app, el) => openProductPicker(app, { store: el.dataset.store, id: el.dataset.id }),
  'item:have': (app, el) => {
    const id = el.dataset.id;
    const { list } = current(app);
    const i = list.items.find((x) => x.id === id);
    const res = i?.kind === 'staple'
      ? setPantryOps(app.db, app.state, { id, stocked: true, low: false, who: app.who() })
      : setPantryOps(app.db, app.state, { id, qty: Math.max(i?.need || 0, app.state.pantry?.[id]?.qty || 0), low: false, who: app.who() });
    res.message = `${i?.name || 'It'} is in the pantry now.`;
    app.commit(res);
    closeSheet();
  },
};

export { renderSheet, del };
