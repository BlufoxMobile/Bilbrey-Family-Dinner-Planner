// LIST: the shopping list for the selected period — by store, then aisle — with
// per-item store, product and price, check-off, the freezer panel, extras, and the store handoff.
import { html, ic, when, openSheet, closeSheet, toast, copyText, confirmSheet, segmented, renderSheet } from '../ui.js';
import { fmtQty, mediumDate, money, rangeLabel, relativeDay, shortWeekday, listJoin, shortDate, dayAndDate, round2, datesBetween, addDays, weekday, isISODate, weekdayName, byLabel } from '../util.js';
import { listKeyFor, dinnerById } from '../planner.js';
import { buildList, formatPackQty, formatStoreList, formatAssistantList, formatFullList, unitText, OTHER, productName, shelfQty } from '../shopping.js';
import {
  toggleCheckOps, doneShoppingOps, setPriceOps, clearPriceOps, notAtStoreOps, addExtraOps, removeExtraOps, setPantryOps, undoFor,
} from '../actions.js';
import { set, del } from '../state.js';
import { budgetPace, offList } from '../health.js';
import { currentRange, periodNav } from './plan.js';
import { productLabel, findItUrl, priceSource } from '../products.js';
import { openProductPicker, productSource, photoImg, hydrateSheetSoon, productPhoto } from './products.js';
import { openReceiptScan } from './receipts.js';
import { itemPhoto, hydratePhotos, ensureStorePhotos } from '../photos.js';
import { LIST_MODES, aisleFor, shopStops, storeProductUrl, cleanAisle, aisleCoverage } from '../aisles.js';

export const title = () => 'Shopping list';
const NAMES = { sams: "Sam's Club", jewel: 'Jewel-Osco' };
const SHORT = { sams: "Sam's", jewel: 'Jewel' };

/** How this phone is shopping the list (docs/spec/28): 'store' (in the aisles) or 'online'. Per device. */
const MODE_KEY = 'bfdp.v2.listMode';
export function listMode(app) {
  if (!app.ui.listMode) {
    try { app.ui.listMode = localStorage.getItem(MODE_KEY) || ''; } catch { app.ui.listMode = ''; }
  }
  return LIST_MODES.some((m) => m.id === app.ui.listMode) ? app.ui.listMode : 'store';
}

/** Where an item opens online: the exact product page when we know it, else the store's search. */
export function orderUrl(app, i) {
  return storeProductUrl(app.db, i.store, i.id) || findItUrl(app.db, i.store, i.product?.chosen ? i.product : null, i.product?.name || i.name);
}

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
  // One slim line (gauntlet r2): which store, through when, Change, End.
  return html`<div class="trip-bar">
    <span class="trip-ic">${ic('cart', { size: 20 })}</span>
    <p class="trip-what"><b>Shopping through ${dayAndDate(range.end, app.today())}</b> <small>${trip.store === 'both' ? 'Sam’s Club and Jewel-Osco' : NAMES[trip.store]}</small></p>
    <span class="trip-acts">
      <button type="button" class="link-btn trip-link" data-action="trip:new">Change</button>
      <button type="button" class="link-btn trip-link" data-action="trip:end">End trip</button>
    </span>
  </div>`;
}

/** This trip against the month's target (SPEC §13): receipts so far + this trip. */
function paceLine(app, list) {
  const p = budgetPace(app.state, app.today(), list.total + (list.onDayCost || 0));
  if (!p.target) return '';
  const month = new Date(`${p.month}-15T12:00:00`).toLocaleString('en-US', { month: 'long' });
  return html`<p class="total-pace ${p.over ? 'is-over' : p.ahead > 25 ? 'is-ahead' : ''}">${ic('budget', { size: 18 })}<span>${month}: ${money(p.spent)} on receipts so far + this trip ≈ <b>${money(p.after)}</b> of your ${money(p.target)}. ${p.over ? `That’s ${money(-p.left)} over for the month.` : p.ahead > 25 ? `A little ahead of pace (a steady month is about ${money(p.pace)} by today), with ${money(p.left)} left for ${p.daysLeft} days.` : `${money(p.left)} left for the last ${p.daysLeft} days. On track.`}</span></p>`;
}

/** After the trip (SPEC §13): what the store's receipt bought that this trip's list didn't ask for. */
function afterTrip(app, trip, list) {
  const logs = Object.entries(app.state.receiptLog || {}).filter(([, r]) => r && r.date >= trip.start && r.date <= app.today() && (trip.store === 'both' || r.store === trip.store));
  if (!logs.length) return '';
  const ids = new Set([...list.items.map((i) => i.id), ...(list.skipped || []).map((i) => i.id), ...(list.onDay || []).map((i) => i.id)]);
  const all = logs.map(([, r]) => offList(app.db, app.state, r, ids));
  const extra = all.flatMap((x) => x.extra);
  const extraTotal = all.reduce((t, x) => t + x.extraTotal, 0);
  const unmatched = all.reduce((t, x) => t + x.unmatchedTotal, 0);
  if (!extra.length && unmatched < 1) return html`<p class="after-trip is-good">${ic('check', { size: 18 })}<span>The receipt matches the list: nothing extra.</span></p>`;
  return html`<details class="after-trip"><summary>${ic('receipt', { size: 18 })}After the trip: ${money(extraTotal + unmatched)} wasn’t on the list</summary>
    <ul class="cost-lines">${extra.slice(0, 12).map((x) => html`<li><span>${x.name}</span><b>${money(x.price)}</b></li>`)}${when(unmatched >= 1, () => html`<li><span>Other things on the receipt</span><b>${money(unmatched)}</b></li>`)}</ul>
    <p class="muted small">Not a scolding: some of these are fine. If one keeps showing up, add it as an everyday extra so the budget plans for it.</p>
  </details>`;
}

/** The last day a new trip shops for: this coming Friday (payday), or Sunday if it's already the weekend. */
export function defaultTripEnd(today) {
  const wd = weekday(today); // 0 = Sunday
  const toFri = (5 - wd + 7) % 7;
  return addDays(today, wd === 6 ? 1 : toFri);
}

/** How many items the full list would buy at the other store, for a one-store trip ("11 Sam's items move to Jewel"). */
function movedCount(app, store, end) {
  if (store === 'both' || !isISODate(end) || end < app.today()) return 0;
  const other = store === 'sams' ? 'jewel' : 'sams';
  const l = buildList(app.db, app.state, { dates: datesBetween(app.today(), end), listKey: 'trip-peek', today: app.today() });
  return l.stores?.[other]?.items?.length || 0;
}

function openTrip(app) {
  const t = activeTrip(app);
  const st = openTrip.state = { store: t?.store || 'jewel', end: t?.end || defaultTripEnd(app.today()) };
  openSheet({
    id: 'trip',
    title: t ? 'Change this trip' : 'Shop for one trip',
    subtitle: 'Only what this trip needs, from today through the day you pick.',
    render: () => {
      const moved = movedCount(app, st.store, st.end);
      const other = st.store === 'sams' ? 'Jewel' : 'Sam’s';
      return html`
      <h3 class="sheet-h">Store</h3>
      ${segmented('tripStore', TRIP_STORES, st.store, { label: 'Store for this trip', action: 'trip:store' })}
      ${when(moved, () => html`<p class="hint">${ic('info', { size: 18 })}<span>The ${moved} ${other} ${moved === 1 ? 'item moves' : 'items move'} to ${NAMES[st.store]} for this trip.</span></p>`)}
      <form class="form" data-submit="trip:save">
        <label class="field"><span class="field-label">Shopping for meals through</span>
          <input class="input" type="date" name="end" min="${app.today()}" value="${st.end}" required></label>
        <p class="muted small">Starts with nothing ticked.</p>
        <button type="submit" class="btn btn-primary btn-block">${ic('cart', { size: 20 })}${t ? 'Update the trip' : 'Start the trip list'}</button>
      </form>`;
    },
    onMount: (el) => {
      el.querySelector('input[name=end]')?.addEventListener('change', (ev) => { st.end = ev.target.value; renderSheet(); });
    },
  });
}

function skippedSection(app, list, listKey) {
  if (!list.skipped.length) return '';
  return html`<section class="skipped" aria-labelledby="sk-h">
    <h2 id="sk-h" class="section-title">Not buying this trip (${list.skipped.length})</h2>
    <ul class="skip-list">${list.skipped.map((i) => html`<li class="skip-row">
      <span><b>${i.name}</b><small>${[SKIP_WHY[i.skip?.reason] || 'Skipped', i.skip?.note || `${unitText(i.shortfall, i.unit)} short`].filter(Boolean).join('. ')}${i.cost != null ? ` (saves ${money(i.cost)})` : ''}</small></span>
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

const COUPON_PAGE = { jewel: 'https://www.jewelosco.com/loyalty/coupons-deals.html?q={q}' };
const isIOSDevice = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const BROWSER_KEY = 'bfdp.v2.couponBrowser';
/** This phone's choice for store pages: 'chrome' (the Chrome app on iPhone) or the default browser. */
function couponBrowser() {
  try { return localStorage.getItem(BROWSER_KEY) || ''; } catch { return ''; }
}
/** A store link, opened in the Chrome app on iPhone when the family picked Chrome (googlechromes://). */
function viaBrowser(url) {
  return isIOSDevice() && couponBrowser() === 'chrome' ? url.replace(/^https:\/\//, 'googlechromes://') : url;
}

/** The store's coupon page, searched for this coupon (or the product's first words). */
function couponFindUrl(c) {
  const tpl = COUPON_PAGE[c.store];
  if (!tpl) return '';
  const q = c.q || couponTerm(c.name);
  return viaBrowser(tpl.replace('{q}', encodeURIComponent(q)));
}

const MULTI_BRANDS = ["boar's head", 'del monte', 'capri sun', "miss vickie's", 'signature select', 'signature farms', 'signature cafe', 'o organics', 'open nature', 'ball park', 'sara lee', 'old el paso', 'hidden valley', "land o'lakes", "trader joe's", 'pepperidge farm', "nature's own", "king's hawaiian", "dave's killer", "sweet baby ray's", 'jimmy dean', 'oscar mayer', 'hormel black label', 'la preferida', 'mt. olive', 'french\'s'];
const SKIP_WORDS = new Set(['fresh', 'frozen', 'large', 'small', 'sliced', 'shredded', 'organic', 'whole', 'boneless', 'lean', 'ground', 'the', 'a', 'mini', 'family', 'party', 'size']);

/** The word to search a store's coupon page with: the brand ("boar's head"), else the first real word. */
export function couponTerm(name) {
  const n = String(name || '').replace(/[’‘]/g, "'").replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const mb = MULTI_BRANDS.find((b) => n.startsWith(b));
  if (mb) return mb.replace("hormel black label", 'hormel');
  const words = n.split(/[\s,]+/).map((w) => w.replace(/[^a-z0-9'.-]/g, '')).filter(Boolean);
  const w = words.find((x) => !SKIP_WORDS.has(x) && x.length > 2) || words[0] || '';
  return w.replace(/'s$/, '');
}

/** One coupon search per brand on the store's part of the list. → [{ term, names, clipped }] */
export function couponSearches(list, store = 'jewel') {
  const items = [...(list.stores?.[store]?.items || []).filter((i) => !i.checked), ...(list.onDay || []).filter((i) => i.store === store)];
  const by = new Map();
  for (const i of items) {
    const name = productName(i) || i.name;
    const known = list.coupons.find((c) => c.id === i.id && c.store === store);
    const term = known?.q || couponTerm(name);
    if (!term) continue;
    if (!by.has(term)) by.set(term, { term, names: [], clipped: true });
    const g = by.get(term);
    g.names.push(String(name).replace(/\s*\(.*?\)\s*/g, ' ').trim());
    if (!known?.clipped) g.clipped = false;
  }
  return [...by.values()].sort((a, b) => Number(a.clipped) - Number(b.clipped) || a.term.localeCompare(b.term));
}

function couponFinder(app, list) {
  const searches = couponSearches(list, 'jewel');
  if (!searches.length) return '';
  return html`<button type="button" class="btn btn-secondary btn-block" data-action="list:find-coupons">${ic('search', { size: 20 })}Find coupons for this list <span class="chip-count">${searches.length} ${searches.length === 1 ? 'search' : 'searches'}</span></button>`;
}

function openCouponFinder(app) {
  const { list } = current(app);
  openSheet({
    id: 'coupon-finder',
    size: 'tall',
    title: 'Find Jewel coupons',
    subtitle: 'One search per brand on your list. Sign in to Jewel-Osco once in that browser, then tap Clip Coupon on any offer that matches.',
    render: () => {
      const searches = couponSearches(list, 'jewel');
      const seen = couponFinder.seen || new Set();
      return html`
        ${when(isIOSDevice(), () => html`<div class="field"><span class="field-label">Open coupon pages in</span>${segmented('coupon-browser', [{ id: 'safari', label: 'Safari' }, { id: 'chrome', label: 'Chrome' }], couponBrowser() === 'chrome' ? 'chrome' : 'safari', { label: 'Open coupon pages in', action: 'list:coupon-browser', small: true })}</div>`)}
        <ul class="finder-list">${searches.map((g) => html`<li class="${seen.has(g.term) ? 'is-seen' : ''}">
          <span><b>${g.term.replace(/(^|\s)\S/g, (c) => c.toUpperCase())}</b><small>${listJoin(g.names.slice(0, 3))}${g.names.length > 3 ? ` and ${g.names.length - 3} more` : ''}${g.clipped ? '. Already clipped' : ''}</small></span>
          <a class="btn btn-small ${g.clipped || seen.has(g.term) ? 'btn-quiet' : 'btn-secondary'}" href="${viaBrowser(COUPON_PAGE.jewel.replace('{q}', encodeURIComponent(g.term)))}" target="_blank" rel="noopener" data-action="list:finder-open" data-term="${g.term}">${seen.has(g.term) ? 'Opened' : 'Coupons'}</a>
        </li>`)}</ul>
        <a class="btn btn-quiet btn-block" href="${viaBrowser('https://www.jewelosco.com/loyalty/coupons-deals.html')}" target="_blank" rel="noopener">All Jewel coupons</a>
        <p class="muted small">Only clip what matches the brand and size on your list. Clipped coupons come off at the register when you enter your phone number or scan the Jewel app.</p>`;
    },
  });
}

function couponsToClip(app, list) {
  const finder = couponFinder(app, list);
  if (!list.coupons.length) return finder ? html`<section class="clip-first" aria-label="Coupons">${finder}</section>` : '';
  const left = list.coupons.filter((c) => !c.clipped);
  const title = left.length
    ? `Clip ${left.length === 1 ? 'this coupon' : `these ${left.length} coupons`} first`
    : `${list.coupons.length === 1 ? 'Coupon' : `All ${list.coupons.length} coupons`} clipped`;
  return html`<section class="clip-first ${left.length ? '' : 'all-clipped'}" aria-labelledby="clip-h">
    <h2 id="clip-h" class="section-title">${ic(left.length ? 'receipt' : 'check', { size: 22 })}${title}</h2>
    <ul class="clip-list">${[...left, ...list.coupons.filter((c) => c.clipped)].map((c) => html`<li class="${c.clipped ? 'is-clipped' : ''}">
      <span><b>${c.name}</b><small>${c.text}${c.expires ? `, ends ${weekdayName(c.expires)} ${shortDate(c.expires)}` : ''}</small></span>
      ${c.clipped ? html`<span class="tag tag-clipped">${ic('check', { size: 14 })}Clipped</span>`
        : when(couponFindUrl(c), () => html`<a class="btn btn-small btn-secondary" href="${couponFindUrl(c)}" target="_blank" rel="noopener">Clip it</a>`)}
    </li>`)}</ul>
    ${finder}
    <p class="muted small">${left.length ? `“Clip it” opens that coupon on ${NAMES[left[0].store] || 'the store'}’s page; sign in and tap Clip Coupon. ` : ''}Coupons only count once they’re clipped in your ${NAMES[list.coupons[0].store] || 'store'} account. The total above assumes they are.</p>
  </section>`;
}

function usesText(app, item) {
  const today = app.today();
  const days = [...new Set(item.uses.map((u) => u.date))].map((d) => (d === today ? 'tonight' : shortWeekday(d)));
  return days.length ? `for ${listJoin(days)}` : '';
}

/** "1¼ lb" as it is; 10.66 oz reads "about 11 oz" and 0.33 cup "about ¼ cup" (gauntlet r3: one way of writing amounts). */
function amt(n, unit) {
  if (Math.abs(n * 4 - Math.round(n * 4)) < 0.01) return unitText(n, unit);
  const r = n >= 4 ? Math.round(n) : Math.max(0.25, Math.round(n * 4) / 4);
  return `about ${unitText(r, unit)}`;
}

/** "1 bottle", "2 × ~3.1 lb pack", "3 lemons": what to pick up, without "(about 190 tbsp)" (gauntlet r4). */
function buyText(i) {
  return formatPackQty(i).replace(/\s*\(about [^)]*\)/, '').replace(/^1 × (?=[a-z])/, '1 ');
}

function detail(app, i) {
  if (i.freeText) return `${i.every === 'week' ? 'Every week' : 'Every trip'}${i.cost == null ? ', add a price to count it in the budget' : ''}`;
  const parts = [];
  if (i.reasons.includes('dinners') || i.reasons.includes('lunches')) {
    const who = [...new Set((i.lunchUses || []).map((u) => u.person))];
    const forWhat = [i.reasons.includes('dinners') ? usesText(app, i) : '', who.length ? `${listJoin(who)}’s lunches` : ''].filter(Boolean);
    let t = `${amt(i.shortfall, i.unit)} needed ${forWhat.length ? (i.reasons.includes('dinners') ? forWhat.join(' and ') : `for ${forWhat.join(' and ')}`) : ''}`.trim();
    if (i.have > 0) t += `, ${amt(i.have, i.unit)} on hand`;
    parts.push(t);
  }
  if (i.extraPacks) parts.push(`${i.extraPacks} for everyday`);
  if (i.reasons.includes('low')) parts.push('running low');
  if (i.leftover > 0.01 && i.kind !== 'staple' && (i.reasons.includes('dinners') || i.reasons.includes('lunches'))) parts.push(`${amt(i.leftover, i.unit)} left over`);
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

/**
 * True while the list on screen has at least one product picture: then every row keeps a square
 * for one, so the names line up. (A list with no pictures looks exactly as it did before.)
 */
let listHasPhotos = false;

/** The picture of what to pick up: the family's own photo of it, else the store's product picture. */
function itemThumb(app, i, mode = null) {
  if (!listHasPhotos && !mode) return '';
  const ph = i.freeText ? null : itemPhoto(app.state, i.id);
  // The picture is the biggest thing on the row, so it ticks too (gauntlet r2).
  return html`<span class="item-thumb ${ph ? 'has-photo' : ''}" aria-hidden="true">${ph ? photoImg(ph) : ''}</span>`;
}

// "Fix the product, price or store" stays as the family left it while the sheet redraws.
let itemFixOpen = false;
if (typeof document !== 'undefined') document.addEventListener('toggle', (ev) => { if (ev.target?.classList?.contains('item-fix')) itemFixOpen = ev.target.open; }, true);

/**
 * One line on the list (docs/spec/29): the picture, the store's own product name, "× 3" only when
 * there's more than one, and the price. A tap on the row ticks it (one thumb, cart in the other
 * hand); the › at the end opens everything else: why it's on the list, the aisle, prices, skipping.
 */
function itemRow(app, i, listKey, mode = null, { guess = false } = {}) {
  const chosen = i.product?.chosen;
  // What it is first, in the family's words; the store's product name small under it (gauntlet r2:
  // "Member's Mark Wildflower Pure…" hid that it's honey).
  const label = (!i.freeText && app.db.ingredients[i.id]?.short) || i.name;
  const product = !i.freeText && i.product?.label && i.product.label.toLowerCase() !== i.name.toLowerCase() ? i.product.label : '';
  // The size rides on the amount line ("2 × 3.1 lb"), so a cut-off product name never hides it (gauntlet r4).
  const many = i.freeText ? (i.qty > 1 ? `${fmtQty(i.qty)} of them` : '') : shelfQty(i);
  const inCart = mode === 'online' ? 'added to the cart' : 'in the cart';
  const tags = [
    i.pack?.sale ? html`<span class="tag tag-sale">Sale</span>` : '',
    i.coupon ? html`<span class="tag tag-coupon">Clip coupon</span>` : '',
  ].filter(Boolean);
  // The checkbox's name is the item; its description is the product, amount and price (gauntlet r3).
  const rid = `it-${String(i.key).replace(/[^\w-]/g, '_')}`;
  return html`<li class="item ${i.checked ? 'is-checked' : ''} has-thumb ${mode ? `is-${mode}` : ''}" data-name="${i.name}" ${i.reasons?.includes('lunches') ? 'data-lunch' : ''} ${guess ? 'data-guess' : ''}>
    <button type="button" class="check" role="checkbox" aria-checked="${i.checked ? 'true' : 'false'}" data-action="list:check" data-key="${i.key}" data-list="${listKey}" aria-label="${label}${i.checked ? `, ${inCart}` : ''}" aria-describedby="${product ? `${rid}-p ` : ''}${rid}-q"><span class="check-box">${ic('check', { size: 18 })}</span></button>
    <span class="item-thumb-hit" data-action="list:check" data-key="${i.key}" data-list="${listKey}" aria-hidden="true">${itemThumb(app, i, mode || 'store')}</span>
    <button type="button" class="item-main" data-action="list:check" data-key="${i.key}" data-list="${listKey}" tabindex="-1" aria-hidden="true">
      <span class="item-name">${label}</span>${product ? html`<span class="item-product" id="${rid}-p">${product}</span>` : ''}
      <span class="item-qty" id="${rid}-q">${many ? html`<b class="item-many">${many}</b>` : ''}${i.cost == null ? '' : html`<span class="item-price">${many ? '· ' : ''}${money(i.cost)}</span>`}${tags}</span>
    </button>
    ${when(mode === 'online' && !i.freeText, () => html`<a class="btn btn-small ${i.checked ? 'btn-quiet' : 'btn-secondary'} order-it" href="${orderUrl(app, i)}" target="_blank" rel="noopener" data-findit="${i.id}" data-order="${storeProductUrl(app.db, i.store, i.id) ? 'product' : 'search'}" aria-label="Open ${chosen ? productLabel(i.product) : i.name} on ${NAMES[i.store]}">${ic('cart', { size: 18 })}${i.checked ? 'Again' : 'Open'}</a>`)}
    <button type="button" class="item-more" data-action="list:item" data-key="${i.key}" aria-label="More about ${label}">${ic('right', { size: 20 })}</button>
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

/** The line under a store's name in "In the store": where the aisle numbers come from. */
function aisleNote(app, store, items) {
  const { known, total } = aisleCoverage(app.db, app.state, store, items);
  const src = app.db.aisles?.stores?.[store];
  if (store === 'jewel' && !known) return html`<p class="aisle-note">${ic('info', { size: 16 })}<span>Jewel-Osco’s website doesn’t show aisles, so this is in the order of the store’s sections. Tap an item to add its aisle once; everyone sees it next time.</span></p>`;
  if (!known) return '';
  return html`<p class="aisle-note">${ic('store', { size: 16 })}<span>Aisles for ${known} of ${total} ${total === 1 ? 'item' : 'items'}${store === 'sams' && src?.checked ? `, from samsclub.com for ${src.name || 'the Addison club'} on ${shortDate(src.checked)}` : ''}. Stores move things: tap an item to fix its aisle.</span></p>`;
}

function storeSection(app, list, store, listKey) {
  const s = list.stores[store];
  if (!s.items.length) return '';
  const info = app.db.stores[store];
  const f = activeFilter(app, list);
  const mode = listMode(app);
  const visibleItems = s.items.filter((i) => shown(f, i));
  const aisles = mode === 'store'
    ? shopStops(app.db, app.state, store, s.aisles.flatMap((a) => a.items.filter((i) => shown(f, i)))).map((g) => ({ aisle: g.label, stop: g.aisle, items: g.items, guess: g.guess, also: g.aisle ? [...new Set(g.items.filter((i) => !g.guess.has(i.key)).map((i) => i.aisle).filter(Boolean))].join(', ') : '' }))
    : s.aisles.map((a) => ({ ...a, items: a.items.filter((i) => shown(f, i)) })).filter((a) => a.items.length);
  if (!aisles.length) return '';
  const visible = aisles.reduce((n, a) => n + a.items.length, 0);
  const share = round2(aisles.reduce((t, a) => t + a.items.reduce((u, i) => u + filterShare(f, i), 0), 0));
  const left = s.remaining;
  return html`<section class="store-sec store-${store}" aria-labelledby="sec-${store}">
    <header class="store-head">
      <h2 id="sec-${store}" class="store-name">${info?.name || NAMES[store]}</h2>
      ${f === 'all'
        ? html`<p class="store-total"><b>${left ? `${left} left` : 'All in the cart'}</b><small>· ${money(s.subtotal)}</small></p>`
        : html`<p class="store-total"><b>${money(share)}</b><small>for ${f}: ${visible} of ${s.items.length} ${s.items.length === 1 ? 'item' : 'items'}</small></p>`}
    </header>
    ${when(store === 'jewel' && list.coupons.some((c) => c.store === 'jewel' && !c.clipped), () => { const n = list.coupons.filter((c) => c.store === 'jewel' && !c.clipped).length; return html`<button type="button" class="btn btn-small btn-quiet clip-link" data-action="list:clip">${ic('receipt', { size: 18 })}${n} ${n === 1 ? 'coupon' : 'coupons'} to clip first</button>`; })}
    ${when(mode === 'online' && store === 'jewel', () => html`<button type="button" class="btn btn-secondary btn-block store-handoff" data-action="list:handoff" data-store="${store}">${ic('copy', { size: 20 })}Copy for Jewel-Osco AI & open</button>`)}
    ${aisles.map((a) => html`<div class="aisle ${a.stop ? 'is-stop' : ''}"><h3 class="aisle-h">${a.aisle}${a.also ? html` <small>${a.also}</small>` : ''}</h3><ul class="items">${a.items.map((i) => itemRow(app, i, listKey, mode, { guess: !!a.guess?.has(i.key) }))}</ul></div>`)}
  </section>`;
}

function fzRow(f, today) {
  return html`<li class="fz-row">
    <span class="fz-name"><b>${f.name}</b><small>${[
      f.have > 0 ? `${fmtQty(f.have)} ${f.unit} already in the freezer` : '',
      f.buying > 0 ? `buying ${f.packs} × ${f.packSize ? `${fmtQty(f.packSize)} ${f.unit}` : ''} ${f.store ? `at ${f.store === 'sams' ? "Sam's" : 'Jewel'}` : ''}`.replace(/\s+/g, ' ').trim() : '',
    ].filter(Boolean).join(', ')}</small></span>
    <span class="fz-meter" aria-hidden="true">${f.uses.map((u, k) => html`<span class="fz-pip ${k < f.covers ? 'is-on' : ''}" title="${relativeDay(u.date, today)}"></span>`)}</span>
    <span class="fz-what">${f.stretch ? `Stretched over ${f.dinners} ${f.dinners === 1 ? 'dinner' : 'dinners'}` : f.covers === f.dinners ? `Covers ${f.dinners} ${f.dinners === 1 ? 'dinner' : 'dinners'}` : `Covers ${f.covers} of ${f.dinners}`}${f.leftover > 0 && !f.stretch ? html`<small>${fmtQty(f.leftover)} ${f.unit} left for next time</small>` : ''}</span>
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
    subtitle: 'Stores don’t let apps clip coupons, and the planner never holds a store password. This opens the right page; coupons on your list show Clip it or Clipped.',
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
  const extras = Object.entries(app.state.extras || {}).filter(([, x]) => !x.once); // one-offs aren't "every list"
  const have = new Set(extras.map(([, x]) => x.item).filter(Boolean));
  const quick = Object.values(app.db.ingredients).filter((i) => i.extra && !have.has(i.id)).slice(0, 8);
  return html`<section class="extras" aria-labelledby="ex-h">
    <h2 id="ex-h" class="sub-title">On every list</h2>
    ${when(extras.length, () => html`<ul class="extra-list">${extras.map(([id, x]) => html`<li class="extra-row">
      <span><b>${x.name}</b><small>${x.item ? `${x.qty} ${x.qty === 1 ? 'pack' : 'packs'}` : unitText(x.qty || 1, x.unit || 'each')} every ${x.every === 'week' ? 'week' : 'trip'}, ${x.store === 'sams' ? "Sam's" : 'Jewel'}${x.price != null ? `, ${money(x.price)} each` : ''}</small></span>
      <button type="button" class="icon-btn" data-action="list:extra-remove" data-id="${id}" aria-label="Remove ${x.name}">${ic('trash', { size: 20 })}</button>
    </li>`)}</ul>`)}
    ${when(quick.length, () => html`<div class="chip-grid">${quick.map((i) => html`<button type="button" class="chip" data-action="list:extra-quick" data-item="${i.id}">${ic('plus', { size: 16 })}${i.name}</button>`)}</div>`)}
  </section>`;
}

/** After each render: fill in the pictures, and quietly fetch any the chosen products still lack. */
export function mount(app, root) {
  hydratePhotos(root, app.store);
  ensureStorePhotos(app);
}

/** The two ways to shop the list (docs/spec/28). */
function modeSwitch(app, list, trip) {
  const mode = listMode(app);
  return html`<section class="list-mode" aria-label="How are you shopping?">
    ${segmented('listMode', LIST_MODES, mode, { label: 'How are you shopping?', action: 'list:mode' })}
  </section>`;
}

/** "Grab paper towels": one field, on this list only. */
function quickAdd(app, list, trip) {
  // The trip's store; else the store of the last item ticked (that's the aisle you're in); else the
  // first store on the page that still has something to get (gauntlet r4).
  const store = trip && trip.store !== 'both' ? trip.store
    : app.ui.addStore || ((list.stores.sams?.remaining || 0) > 0 || !(list.stores.jewel?.remaining > 0) ? 'sams' : 'jewel');
  return html`<form class="quick-add" data-submit="list:quick-add" aria-label="Add something to this list">
    <input class="input" name="name" placeholder="Add an item" maxlength="60" autocomplete="off" aria-label="Add an item to this list" required list="extra-ideas">
    <datalist id="extra-ideas">${Object.values(app.db.ingredients).filter((x) => x.extra).slice(0, 12).map((x) => html`<option value="${x.name}"></option>`)}</datalist>
    ${trip && trip.store !== 'both' ? html`<input type="hidden" name="store" value="${store}">` : html`<select class="input quick-store" name="store" aria-label="Which store" data-change="list:add-store">${['sams', 'jewel'].map((x) => html`<option value="${x}" ${x === store ? 'selected' : ''}>${x === 'sams' ? 'Sam’s Club' : 'Jewel-Osco'}</option>`)}</select>`}
    <button type="submit" class="btn btn-secondary">${ic('plus', { size: 20 })}<span class="sr-only">Add</span></button>
  </form>`;
}

export function render(app) {
  const { range, listKey, list, trip } = current(app);
  listHasPhotos = list.items.some((i) => !i.freeText && itemPhoto(app.state, i.id));
  const checked = list.items.filter((i) => i.checked).length;
  const paidCount = list.items.filter((i) => priceSource(i.pack).kind === 'paid').length;
  const noNights = !list.nights.length;
  return html`<div class="page page-list">
    <header class="page-head">
      <h1 class="page-title">List</h1>
      <div class="head-tools">
        ${trip ? '' : html`<button type="button" class="link-btn trip-link" data-action="trip:new">Just this trip?</button>`}
        <button type="button" class="icon-btn" data-action="list:share" aria-label="Share the list">${ic('share')}</button>
        <button type="button" class="icon-btn" data-action="list:print" aria-label="Print the list">${ic('print')}</button>
      </div>
    </header>
    ${trip ? html`${tripBar(app, trip, range, list)}${afterTrip(app, trip, list)}` : periodNav(app, range, { compact: true })}
    ${noNights && !list.lunches.length && !list.items.length ? html`<div class="empty">
        <span class="empty-ic">${ic('list', { size: 28 })}</span>
        <h3 class="empty-title">Nothing planned for ${rangeLabel(range.start, range.end)}</h3>
        <p class="empty-body">Plan these nights and the list fills itself: every ingredient for five, minus what’s already in the pantry.</p>
        <div class="empty-actions"><a class="btn btn-primary" href="#/plan">Go to the planner</a></div>
      </div>` : html`
      ${when(list.items.length, () => modeSwitch(app, list, trip))}
      ${when(activeFilter(app, list) !== 'all', () => html`<p class="filter-on">${ic('info', { size: 18 })}<span>Showing ${activeFilter(app, list)} only.</span><button type="button" class="link-btn" data-action="list:filter" data-value="all">Show everything</button></p>`)}
      ${quickAdd(app, list, trip)}
      ${storeSection(app, list, 'sams', listKey)}
      ${storeSection(app, list, 'jewel', listKey)}
      ${onDaySection(app, list)}
      ${skippedSection(app, list, listKey)}
      <details class="list-more" ${app.ui.listMoreOpen ? 'open' : ''}>
        <summary data-action="list:more"><span class="section-title">${ic('receipt', { size: 22 })}Cost & coupons</span><small>${money(list.total)}</small></summary>
        ${when(list.lunches.length, () => html`<div class="list-filter"><p class="field-label">Show</p>${segmented('listFilter', FILTERS, activeFilter(app, list), { label: 'Show', action: 'list:filter', small: true })}</div>`)}
        <section class="totals" aria-label="Estimated cost">
          <p class="total-big"><span class="total-num">${money(list.total)}</span><span class="total-label">estimated for ${listJoin([
            list.nights.length ? `${list.nights.length} ${list.nights.length === 1 ? 'dinner' : 'dinners'}` : '',
            list.lunches.length ? `${list.lunches.length} packed ${list.lunches.length === 1 ? 'lunch' : 'lunches'}` : '',
            Object.keys(app.state.extras || {}).length ? 'everyday extras' : '',
          ].filter(Boolean))}</span></p>
          ${trip && trip.store !== 'both' ? '' : html`<div class="total-split">
            ${['sams', 'jewel'].map((s) => html`<p><span>${NAMES[s]}</span><b>${money(list.stores[s].subtotal)}</b></p>`)}
          </div>`}
          ${when(list.lunches.length, () => html`<ul class="cost-lines"><li><span>Dinners</span><b>${money(list.dinnerCost)}</b></li><li><span>Lunches</span><b>${money(list.lunchCost)}</b></li>${when(list.extrasCost, () => html`<li><span>Extras</span><b>${money(list.extrasCost)}</b></li>`)}</ul>`)}
          ${when(list.savings > 0.5, () => html`<p class="total-save">${ic('check', { size: 18 })}<span>Saves ${money(list.savings)} on sales and coupons.</span></p>`)}
          ${when(trip, () => paceLine(app, list))}
          ${when(list.onDay.length, () => html`<p class="muted small">Plus ${money(list.onDayCost)} bought fresh on the day.</p>`)}
          <p class="muted small">${paidCount ? `${paidCount} of ${list.items.length} prices are from your receipts; the rest are estimates.` : 'Prices are estimates.'} Tap an item’s › to fix its price.</p>
        </section>
        ${couponsToClip(app, list)}
        ${couponsCard(app)}
        <nav class="list-links" aria-label="Receipts and products">
          <button type="button" class="btn btn-secondary" data-action="rcpt:scan">${ic('camera', { size: 20 })}Scan a receipt</button>
          <a class="btn btn-quiet" href="#/products">${ic('cart', { size: 20 })}My products</a>
        </nav>
        ${freezerPanel(app, list)}
        ${extrasSection(app)}
      </details>
      ${when(list.leftovers.length, () => {
        const top = list.leftovers.filter((l) => l.storage === 'freezer' || l.storage === 'fridge').slice(0, 6);
        const rest = list.leftovers.length - top.length;
        return html`<details class="leftovers"><summary class="section-title">Still in the house after these dinners</summary>
          ${when(top.length, () => html`<ul class="leftover-list">${top.map((l) => html`<li><span>${l.name}</span><b>${unitText(l.qty, l.unit)}</b></li>`)}</ul>`)}
          ${when(rest > 0, () => html`<p class="small">${top.length ? 'Plus ' : ''}${rest} pantry ${rest === 1 ? 'item' : 'items'} with some to spare.</p>`)}</details>`;
      })}
      ${when(list.covered.length, () => html`<details class="covered"><summary>Already in the pantry (${list.covered.length})</summary>
        <ul>${list.covered.map((c) => html`<li>${c.name}<small>${c.stocked ? 'stocked' : `${fmtQty(c.have)} on hand, ${fmtQty(c.need)} needed`}</small></li>`)}</ul></details>`)}
      ${when(checked, () => html`<div class="done-shopping ${checked * 2 >= list.items.length ? 'is-ready' : ''}">
        <button type="button" class="btn btn-primary btn-block" data-action="list:done">${ic('pantry', { size: 20 })}Done: move ${checked} to the pantry</button>
      </div>`)}`}
  </div>`;
}

/** The item sheet's aisle: what we know, where it came from, and a box to fix it for everyone. */
function aisleBox(app, i) {
  const a = aisleFor(app.db, app.state, i.store, i.id);
  const fam = app.state.aisles?.[i.store]?.[i.id];
  const src = app.db.aisles?.stores?.[i.store];
  const from = !a ? `Not known yet at ${NAMES[i.store]}.`
    : a.source === 'family' ? `Added by ${byLabel(fam?.by) || 'the family'}.`
      : `From samsclub.com for ${src?.name || 'the Addison club'}${src?.checked ? `, ${shortDate(src.checked)}` : ''}${a.near ? ' (for the closest product on the same shelf)' : ''}.`;
  return html`<form class="form aisle-box" data-submit="list:aisle" data-store="${i.store}" data-id="${i.id}">
    <label class="field"><span class="field-label">Aisle at ${NAMES[i.store]}</span>
      <input class="input" name="aisle" value="${a?.code || ''}" maxlength="10" autocomplete="off" autocapitalize="characters" inputmode="text" placeholder="${i.store === 'sams' ? 'Like M9' : 'Like 12'}"></label>
    <button type="submit" class="btn btn-secondary">Save</button>
    <p class="muted small">${from}</p>
    ${when(fam, () => html`<button type="button" class="btn btn-quiet btn-small" data-action="list:aisle-clear" data-store="${i.store}" data-id="${i.id}">${src?.items?.[i.id]?.aisle ? 'Use the store’s aisle again' : 'Clear it'}</button>`)}
  </form>`;
}

function itemSheet(app, key) {
  openSheet({
    id: `item:${key}`,
    live: false,
    size: 'tall',
    // The sheet is named for what it is ("Honey"), not "Item" (gauntlet r2).
    get title() { return current(app).list.items.find((x) => x.key === key)?.name || 'On the list'; },
    render: () => {
      const { list } = current(app);
      const i = list.items.find((x) => x.key === key);
      if (!i) return html`<p class="sheet-text">That item is no longer on this list.</p>`;
      if (i.freeText) {
        const once = !!app.state.extras?.[i.key]?.once;
        return html`<p class="sheet-text"><b>${i.name}</b>, ${once ? 'on this list only' : i.every === 'week' ? 'every week' : 'every trip'} at ${NAMES[i.store]}.</p>
          <button type="button" class="btn btn-quiet btn-block" data-action="list:extra-remove" data-id="${i.key}">${ic('trash', { size: 20 })}Remove it</button>`;
      }
      const both = app.settings.planStore === 'both';
      const fam = i.pack?.source === 'family';
      const ps = priceSource(i.pack);
      const src = !i.pack ? 'No price yet' : fam ? `Family price${byLabel(i.pack.by) ? ` from ${byLabel(i.pack.by)}` : ''}`
        : ps.kind === 'paid' ? (i.pack.date ? `Paid on your ${shortDate(i.pack.date)} receipt` : 'What you paid, from your receipts') : ps.kind === 'typed' ? 'The price you typed in'
          : ps.kind === 'listed' ? `Listed on the ${NAMES[i.store]} site` : 'Estimated';
      const ph = productPhoto(app.state, i.store, i.id);
      if (ph) hydrateSheetSoon(app);
      return html`
        ${ph ? photoImg(ph, 'item-sheet-photo', i.product?.label || i.name) : ''}
        ${when(i.product?.label && i.product.label !== i.name, () => html`<p class="item-sheet-product">${i.product.label}</p>`)}
        <p class="sheet-text item-buy"><b>${buyText(i)}</b>${i.cost == null ? '' : ` · ${money(i.cost)}`}</p>
        ${when(i.coupon, () => html`<p class="hint">${ic('receipt', { size: 18 })}<span><b>Clip the coupon first:</b> ${i.coupon.text}${i.coupon.expires ? `, ends ${shortDate(i.coupon.expires)}` : ''}.</span></p>`)}
        <div class="action-list">
          <button type="button" class="action-row" data-action="item:have" data-id="${i.id}">${ic('pantry')}<span><b>We have it</b><small>Off the list, into the pantry.</small></span></button>
          <button type="button" class="action-row" data-action="list:skip" data-reason="stretch" data-key="${i.id}">${ic('right')}<span><b>Not this trip</b><small>Only this list changes.</small></span></button>
          ${both
            ? html`<button type="button" class="action-row" data-action="item:store" data-value="${OTHER[i.store]}">${ic('store')}<span><b>Get it at ${NAMES[OTHER[i.store]]} instead</b></span></button>`
            : html`<button type="button" class="action-row" data-action="item:notat" data-id="${i.id}" data-store="${i.store}">${ic('store')}<span><b>${NAMES[i.store]} doesn’t carry this</b></span></button>`}
        </div>
        ${when(detail(app, i), () => html`<p class="muted small item-why">${detail(app, i)}.</p>`)}
        ${when(i.uses.length, () => html`<ul class="uses">${i.uses.map((u) => html`<li><span>${dayAndDate(u.date, app.today())}</span><span>${dinnerById(app.db, app.state, u.dinner)?.title}</span><span>${unitText(u.qty, i.unit)}</span></li>`)}</ul>`)}
        ${aisleBox(app, i)}
        <details class="item-fix" ${itemFixOpen ? 'open' : ''}>
          <summary>Fix the product, price or store</summary>
          <div class="product-box">
            <span><small>${i.product?.chosen ? `Your product at ${NAMES[i.store]}` : i.product?.usual ? `What you usually buy at ${NAMES[i.store]}` : `The product at ${NAMES[i.store]}`}</small><b>${i.product?.label || i.name}</b><small>${i.product?.chosen ? productSource(i.product) : i.product?.usual ? 'From your past receipts.' : 'Not bought yet.'}</small></span>
            <span class="product-box-acts">
              <a class="btn btn-small btn-secondary" href="${findItUrl(app.db, i.store, i.product?.chosen ? i.product : null, i.product?.name || i.name)}" target="_blank" rel="noopener" data-findit="${i.id}">${ic('search', { size: 18 })}On ${NAMES[i.store]}’s site</a>
              <button type="button" class="btn btn-small btn-quiet" data-action="item:product" data-store="${i.store}" data-id="${i.id}">Change</button>
            </span>
          </div>
          ${when(i.store === 'sams' && app.db.ingredients[i.id]?.bulk?.note, () => html`<p class="hint bulk-note">${ic('snow', { size: 18 })}<span><b>${app.db.ingredients[i.id].bulk.freezes ? 'When it comes home:' : 'Keeping it:'}</b> ${app.db.ingredients[i.id].bulk.note}</span></p>`)}
          <div class="kv">
            <p><span>Buying</span><b>${formatPackQty(i)}</b></p>
            <p><span>Price</span><b>${i.cost == null ? '—' : `${money(i.cost)}${i.packs > 1 ? ` (${money(i.pack.price)} each)` : ''}`}</b></p>
            <p><span>Source</span><b>${src}${i.pack?.url ? html`, <a href="${i.pack.url}" target="_blank" rel="noopener">see it</a>` : ''}</b></p>
          </div>
          <h3 class="sheet-h">Fix the price</h3>
          <form class="form" data-submit="item:price" data-store="${i.store}" data-id="${i.id}">
            <div class="field-row">
              <label class="field"><span class="field-label">Pack size (${i.unit})</span><input class="input" name="size" type="number" inputmode="decimal" min="0.01" step="0.01" value="${i.pack?.size ?? ''}" required></label>
              <label class="field"><span class="field-label">Price</span><input class="input" name="price" type="number" inputmode="decimal" min="0" step="0.01" value="${i.pack?.price ?? ''}" required></label>
            </div>
            <button type="submit" class="btn btn-secondary btn-block">Save price for the family</button>
            ${when(fam, () => html`<button type="button" class="btn btn-quiet btn-block" data-action="item:price-clear" data-store="${i.store}" data-id="${i.id}">Use the estimate again</button>`)}
          </form>
        </details>`;
    },
  });
  itemSheet.key = key;
}

/** Short search words for a store search URL: drop sizes and parentheticals. */
function searchWords(name, store) {
  const words = String(name).replace(/\(.*?\)/g, ' ').replace(/,.*$/, '').replace(/[^A-Za-z0-9' ]+/g, ' ').trim().split(/\s+/).slice(0, 4);
  return store === 'sams' ? words.map(encodeURIComponent).join('+') : encodeURIComponent(words.join(' '));
}

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const SHORTCUT_DEFAULT = { jewel: 'Open Jewel', sams: 'Open Sams' };
const shortcutKey = (store) => `bfdp.v2.shortcut.${store}`;
/** This phone's Shortcut that opens the store's app (set up once; links alone only reach Safari). */
function shortcutName(store) {
  try { return localStorage.getItem(shortcutKey(store)) || ''; } catch { return ''; }
}

function openAppSection(app, store, info) {
  const sc = shortcutName(store);
  const ios = isIOS();
  const host = String(info.orderUrl || info.website || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '');
  return html`
    ${sc && ios
      ? html`<a class="btn btn-primary btn-block" href="shortcuts://run-shortcut?name=${encodeURIComponent(sc)}">${ic('store', { size: 20 })}Open the ${info.name} app</a>`
      : when(ios && info.appOpenUrl, () => html`<a class="btn btn-primary btn-block" href="${info.appOpenUrl}" target="_blank" rel="noopener">${ic('store', { size: 20 })}Open the ${info.name} app</a>`)}
    <a class="btn ${ios && (sc || info.appOpenUrl) ? 'btn-quiet' : 'btn-primary'} btn-block" href="${info.orderUrl || info.website}" target="_blank" rel="noopener">${ic('store', { size: 20 })}Open ${host}</a>
    ${when(ios, () => html`<details class="more app-shortcut">
      <summary>${sc ? `Opens with the “${sc}” Shortcut` : `App button opens Safari or the App Store?`}</summary>
      <p class="muted small">${info.name}’s website links don’t open its iPhone app, so they land in Safari. A one-step iPhone Shortcut always opens the real app. Make it once (about 30 seconds):</p>
      <ol class="steps-small">
        <li>Open the Shortcuts app and tap <b>+</b>.</li>
        <li>Tap <b>Add Action</b>, search <b>Open App</b>, and pick <b>${info.name}</b>.</li>
        <li>Tap the name at the top, rename it <b>${sc || SHORTCUT_DEFAULT[store]}</b>, then tap <b>Done</b>.</li>
        <li>Come back here and tap <b>I made it</b>. The first time, iPhone asks to allow it.</li>
      </ol>
      <form class="form form-inline-card" data-submit="list:shortcut" data-store="${store}">
        <label class="field"><span class="field-label">Shortcut name</span><input class="input" name="name" value="${sc || SHORTCUT_DEFAULT[store]}" maxlength="40" autocomplete="off"></label>
        <button type="submit" class="btn btn-secondary">I made it</button>
      </form>
      ${when(sc, () => html`<button type="button" class="btn btn-quiet btn-block" data-action="list:shortcut-off" data-store="${store}">Stop using the Shortcut</button>`)}
    </details>`)}`;
}

function handoff(app, store) {
  const { list } = current(app);
  const ai = store === 'jewel' ? formatAssistantList(app.db, list, store) : [];
  const text = ai.length ? ai[0] : formatStoreList(app.db, list, store);
  const info = app.db.stores[store];
  const coupons = list.coupons.filter((c) => c.store === store);
  const left = coupons.filter((c) => !c.clipped).length;
  copyText(text).then((ok) => {
    openSheet({
      id: `handoff:${store}`,
      title: ok ? `${info.name} list copied` : `Copy the ${info.name} list`,
      subtitle: `${list.stores[store].items.filter((i) => !i.checked).length || list.stores[store].items.length} items, about ${money(list.stores[store].subtotal)}`,
      // One job (gauntlet r2): it's copied, here's where to paste it, open the app. The rest is folded.
      render: () => html`
        ${when(ai.length, () => html`<ol class="steps-small">
            <li>${ok ? 'The list is copied' : 'Copy the list (More, below)'}${ai.length > 1 ? `: part 1 of ${ai.length}` : ''}.</li>
            <li>Tap the button below, then <b>Jewel-Osco AI</b> and <b>Shop my grocery list</b>.</li>
            <li>Paste and send, then check what it picked.</li>
          </ol>`)}
        ${when(!ai.length, () => html`<ol class="steps-small">${info.handoff.filter((s, k) => !(k === 0 && /^tap copy/i.test(s))).map((s) => html`<li>${s}</li>`)}</ol>`)}
        ${openAppSection(app, store, info)}
        ${when(ai.length > 1, () => ai.slice(1).map((t, k) => html`<button type="button" class="btn btn-secondary btn-block" data-action="list:copy-ai" data-store="${store}" data-part="${k + 1}">${ic('copy', { size: 20 })}Copy part ${k + 2} of ${ai.length}</button>`))}
        <details class="more"><summary>More: copy again, coupons, each item</summary>
          ${store === 'jewel'
            ? html`<p class="hint">${ic('receipt', { size: 18 })}<span>${coupons.length && !left ? `All ${coupons.length} coupons on this list are clipped. ` : left ? `${left} ${left === 1 ? 'coupon' : 'coupons'} on this list to clip first. ` : ''}<a href="${info.coupons.url}" target="_blank" rel="noopener">Jewel coupons</a></span></p>`
            : html`<p class="hint">${ic('receipt', { size: 18 })}<span>Sam’s Instant Savings come off automatically for members. <a href="${info.coupons.url}" target="_blank" rel="noopener">See Instant Savings</a></span></p>`}
          ${when(ai.length, () => html`${ai.map((t, k) => html`<button type="button" class="btn btn-quiet btn-block" data-action="list:copy-ai" data-store="${store}" data-part="${k}">${ic('copy', { size: 20 })}${ai.length > 1 ? `Copy part ${k + 1} of ${ai.length}` : 'Copy for Jewel-Osco AI again'}</button>`)}
            <a class="btn btn-quiet btn-block" href="${info.assistantUrl || 'https://www.jewelosco.com/assistant/chat'}" target="_blank" rel="noopener">Open Jewel-Osco AI on the website</a>`)}
          ${when(info.handoffMethod, () => html`<p class="muted small">${info.handoffMethod}</p>`)}
          ${when(info.appUrl, () => html`<a class="btn btn-quiet btn-block" href="${info.appUrl}" target="_blank" rel="noopener">Get the ${info.name} app</a>`)}
          ${when(info.searchTemplate, () => {
            const items = list.stores[store].items.filter((i) => !i.checked);
            return items.length ? html`<h3 class="sheet-h">Find each item on ${info.name}</h3><ul class="handoff-items">${items.map((i) => html`<li><span>${productName(i)}</span><a class="btn btn-small btn-quiet" href="${i.freeText ? info.searchTemplate.replace(/\{q\}|\{query\}/, searchWords(i.name, store)) : findItUrl(app.db, store, i.product?.chosen ? i.product : null, i.product?.chosen ? i.product.name : productName(i))}" target="_blank" rel="noopener">Find it</a></li>`)}</ul>` : '';
          })}
          <label class="field"><span class="field-label">${ok ? 'What was copied' : 'Select and copy this'}</span><textarea class="input copy-box" readonly rows="8">${text}</textarea></label>
          <button type="button" class="btn btn-quiet btn-block" data-action="list:copy-again" data-store="${store}">${ic('copy', { size: 20 })}${ai.length ? 'Copy the full list (with pack sizes)' : 'Copy again'}</button>
        </details>
`,
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
    const moved = movedCount(app, store, end);
    app.commit({ ops, undo: undoFor(app.state, ops), message: `Trip list for ${store === 'both' ? 'both stores' : NAMES[store]}, through ${weekdayName(end)}.${moved ? ` ${moved} ${store === 'sams' ? 'Jewel' : 'Sam’s'} ${moved === 1 ? 'item moved' : 'items moved'} to it.` : ''}` });
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
  'list:check': (app, el) => {
    // The store you're ticking in is the one "Add an item" adds to (gauntlet r4).
    const it = current(app).list.items.find((x) => x.key === el.dataset.key);
    if (it?.store) app.ui.addStore = it.store;
    app.commit(toggleCheckOps(app.state, { listKey: el.dataset.list, key: el.dataset.key }), { quiet: true });
  },
  'list:item': (app, el) => itemSheet(app, el.dataset.key),
  'list:handoff': (app, el) => handoff(app, el.dataset.store),
  'list:coupons': (app, el) => openCoupons(app, el.dataset.store),
  'list:filter': (app, el) => { app.ui.listFilter = el.dataset.value; app.render(); },
  'list:mode': (app, el) => {
    app.ui.listMode = el.dataset.value === 'online' ? 'online' : 'store';
    try { localStorage.setItem(MODE_KEY, app.ui.listMode); } catch { /* private mode: this visit only */ }
    app.render();
  },
  'list:aisle': (app, form) => {
    const raw = String(new FormData(form).get('aisle') || '').trim();
    const { store, id } = form.dataset;
    const code = cleanAisle(raw);
    if (raw && !code) { toast('Type the aisle from the sign, like 12 or M9.'); return; }
    const ops = code ? [set(['aisles', store, id], { aisle: code, by: app.who() || 'Family', at: new Date().toISOString() })] : [del(['aisles', store, id])];
    app.commit({ ops, undo: undoFor(app.state, ops), message: code ? `Aisle ${code} at ${NAMES[store]}, for everyone.` : 'Aisle cleared.' });
    renderSheet();
  },
  'list:aisle-clear': (app, el) => {
    const ops = [del(['aisles', el.dataset.store, el.dataset.id])];
    app.commit({ ops, undo: undoFor(app.state, ops), message: 'Back to the store’s aisle.' });
    renderSheet();
  },
  'list:find-coupons': (app) => openCouponFinder(app),
  'list:finder-open': (app, el) => {
    // The click handler stops links with an action, so open it here (still inside the tap).
    const url = el.getAttribute('href');
    if (/^googlechromes?:/.test(url)) window.location.href = url;
    else window.open(url, '_blank', 'noopener');
    couponFinder.seen = couponFinder.seen || new Set();
    couponFinder.seen.add(el.dataset.term);
    setTimeout(() => renderSheet(), 300); // after the link opens
  },
  'list:coupon-browser': (app, el) => {
    try { if (el.dataset.value === 'chrome') localStorage.setItem(BROWSER_KEY, 'chrome'); else localStorage.removeItem(BROWSER_KEY); } catch { /* private mode */ }
    if (el.dataset.value === 'chrome') toast('Coupon pages open in the Chrome app. Sign in to Jewel-Osco there once.');
    renderSheet();
  },
  'list:copy-ai': async (app, el) => {
    const { list } = current(app);
    const parts = formatAssistantList(app.db, list, el.dataset.store);
    const k = Math.min(parts.length - 1, Number(el.dataset.part) || 0);
    const ok = await copyText(parts[k] || '');
    toast(ok ? (parts.length > 1 ? `Part ${k + 1} of ${parts.length} copied. Paste it into Jewel-Osco AI.` : 'Copied. Paste it into Jewel-Osco AI.') : 'Select the text and copy it.');
  },
  'list:shortcut': (app, form) => {
    const name = String(new FormData(form).get('name') || '').trim().slice(0, 40);
    if (!name) { toast('Type the Shortcut’s name.'); return; }
    try { localStorage.setItem(shortcutKey(form.dataset.store), name); } catch { toast('This phone won’t save it (private browsing?).'); return; }
    toast(`“Open the app” now runs your “${name}” Shortcut.`);
    renderSheet();
  },
  'list:shortcut-off': (app, el) => {
    try { localStorage.removeItem(shortcutKey(el.dataset.store)); } catch { /* nothing saved */ }
    renderSheet();
  },
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
  'list:quick-add': (app, form) => {
    const f = new FormData(form);
    const name = String(f.get('name') || '').trim();
    if (!name) return;
    const { listKey } = current(app);
    app.commit(addExtraOps(app.db, app.state, { name, qty: 1, store: f.get('store') === 'sams' ? 'sams' : 'jewel', once: listKey }));
    app.ui.focusNext = null;
  },
  'list:more': (app, el) => { app.ui.listMoreOpen = !el.parentElement.open; },
  'list:add-store': (app, el) => { app.ui.addStore = el.value === 'sams' ? 'sams' : 'jewel'; },
  'list:clip': (app) => { app.ui.listMoreOpen = true; app.render(); setTimeout(() => document.getElementById('clip-h')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); },
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
