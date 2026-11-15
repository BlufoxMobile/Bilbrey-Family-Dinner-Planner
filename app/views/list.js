// LIST: the shopping list for the selected period — by store, then aisle — with
// per-item store/brand/price, check-off, the freezer panel, extras, and the store handoff.
import { html, ic, when, openSheet, closeSheet, toast, copyText, confirmSheet, segmented, renderSheet } from '../ui.js';
import { fmtQty, mediumDate, money, rangeLabel, relativeDay, shortWeekday, listJoin, shortDate, dayAndDate, round2 } from '../util.js';
import { listKeyFor, dinnerById } from '../planner.js';
import { buildList, formatPackQty, formatStoreList, formatFullList, unitText, OTHER } from '../shopping.js';
import {
  toggleCheckOps, doneShoppingOps, setPriceOps, clearPriceOps, notAtStoreOps, addExtraOps, removeExtraOps, setPantryOps, undoFor,
} from '../actions.js';
import { set, del } from '../state.js';
import { currentRange, periodNav } from './plan.js';

export const title = () => 'Shopping list';
const NAMES = { sams: "Sam's Club", jewel: 'Jewel-Osco' };

function current(app) {
  const range = currentRange(app);
  const listKey = listKeyFor(range);
  return { range, listKey, list: buildList(app.db, app.state, { dates: range.dates, listKey }) };
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
  if (i.brandFallback) parts.push(i.brand === 'name' ? 'only name brand listed' : 'only store brand listed');
  return parts.join('; ');
}

function itemRow(app, i, listKey) {
  const qty = i.freeText ? (i.qty ? unitText(i.qty, i.unit || 'each') : '') : formatPackQty(i);
  return html`<li class="item ${i.checked ? 'is-checked' : ''}">
    <button type="button" class="check" role="checkbox" aria-checked="${i.checked ? 'true' : 'false'}" data-action="list:check" data-key="${i.key}" data-list="${listKey}" aria-label="${i.name}${i.checked ? ', in the cart' : ''}"><span class="check-box">${ic('check', { size: 18 })}</span></button>
    <button type="button" class="item-main" data-action="list:item" data-key="${i.key}">
      <span class="item-name">${i.name}</span>
      <span class="item-qty">${qty}${i.reasons.includes('lunches') ? html` <span class="tag tag-lunch">Lunch</span>` : ''}${i.pack?.source === 'family' ? html` <span class="tag">family price</span>` : ''}${i.brand === 'name' && !i.freeText ? html` <span class="tag">name brand</span>` : ''}</span>
      <span class="item-detail">${detail(app, i)}</span>
    </button>
    <span class="item-price">${i.cost == null ? html`<span class="muted">add price</span>` : html`${money(i.cost)}${i.pack?.source !== 'family' && i.pack?.confidence !== 'listed' ? html`<small class="est" title="Estimated price">est.</small>` : ''}`}</span>
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
  const { range, listKey, list } = current(app);
  const checked = list.items.filter((i) => i.checked).length;
  const pricesNote = app.db.pricesUpdated ? `Estimated prices as of ${mediumDate(app.db.pricesUpdated)}.` : 'Estimated prices from the recipe box.';
  const noNights = !list.nights.length;
  return html`<div class="page page-list">
    <header class="page-head">
      <h1 class="page-title">Shopping list</h1>
      <div class="head-tools">
        <button type="button" class="icon-btn" data-action="list:share" aria-label="Share the list">${ic('share')}</button>
        <button type="button" class="icon-btn" data-action="list:print" aria-label="Print the list">${ic('print')}</button>
      </div>
    </header>
    ${periodNav(app, range, { compact: true })}
    ${noNights && !list.lunches.length && !list.items.length ? html`<div class="empty">
        <span class="empty-ic">${ic('list', { size: 28 })}</span>
        <h3 class="empty-title">Nothing planned for ${rangeLabel(range.start, range.end)}</h3>
        <p class="empty-body">Plan these nights and the list fills itself: every ingredient for five, minus what’s already in the pantry.</p>
        <div class="empty-actions"><a class="btn btn-primary" href="#/plan">Go to the planner</a></div>
      </div>` : html`
      <section class="totals" aria-label="Estimated cost">
        <p class="total-big"><span class="total-num">${money(list.total)}</span><span class="total-label">estimated for ${listJoin([
          list.nights.length ? `${list.nights.length} ${list.nights.length === 1 ? 'dinner' : 'dinners'}` : '',
          list.lunches.length ? `${list.lunches.length} packed ${list.lunches.length === 1 ? 'lunch' : 'lunches'}` : '',
          Object.keys(app.state.extras || {}).length ? 'everyday extras' : '',
        ].filter(Boolean))}</span></p>
        ${when(list.lunches.length, () => html`<ul class="cost-lines"><li><span>Dinners</span><b>${money(list.dinnerCost)}</b></li><li><span>Lunches</span><b>${money(list.lunchCost)}</b></li>${when(list.extrasCost, () => html`<li><span>Extras</span><b>${money(list.extrasCost)}</b></li>`)}</ul>`)}
        <div class="total-split">
          ${['sams', 'jewel'].map((s) => html`<p><span>${NAMES[s]}</span><b>${money(list.stores[s].subtotal)}</b></p>`)}
        </div>
        ${when((list.nights.length || list.lunches.length) && list.leftoverValue > 1, () => html`<p class="total-used">${listJoin([
          list.nights.length ? `${money(list.usedByDinners)} goes into these ${list.nights.length} dinners (${money(list.perDinner)} each)` : '',
          list.lunches.length ? `${money(list.usedByLunches)} into the lunches` : '',
        ].filter(Boolean))}. ${money(list.leftoverValue)} is bulk packs and staples left over for later.</p>`)}
        <p class="muted small">${pricesNote} Sam’s prices were read from samsclub.com; prices marked est. are estimates and can be off by about 15%. ${list.unpriced ? `${list.unpriced} ${list.unpriced === 1 ? 'item has' : 'items have'} no price yet.` : ''} Tap any item to fix its price; the family sees your correction.</p>
        ${when(list.items.length, () => html`<div class="progress" role="img" aria-label="${checked} of ${list.items.length} in the cart"><span style="width:${Math.round((checked / list.items.length) * 100)}%"></span></div>
          <p class="muted small">${checked} of ${list.items.length} in the cart</p>`)}
      </section>
      ${couponsCard(app)}
      ${freezerPanel(app, list)}
      ${when(list.lunches.length, () => html`<div class="list-filter">${segmented('listFilter', FILTERS, activeFilter(app, list), { label: 'Show', action: 'list:filter', small: true })}</div>`)}
      ${storeSection(app, list, 'sams', listKey)}
      ${storeSection(app, list, 'jewel', listKey)}
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
      const src = !i.pack ? 'No price yet' : fam ? `Family price${i.pack.by ? ` from ${i.pack.by}` : ''}` : i.pack.confidence === 'listed' ? `Listed on the ${NAMES[i.store]} site` : 'Estimated';
      return html`
        <h3 class="item-sheet-name">${i.name}</h3>
        <p class="sheet-text">${detail(app, i) || 'On the list.'}</p>
        ${when(i.uses.length, () => html`<ul class="uses">${i.uses.map((u) => html`<li><span>${dayAndDate(u.date, app.today())}</span><span>${dinnerById(app.db, app.state, u.dinner)?.title}</span><span>${unitText(u.qty, i.unit)}</span></li>`)}</ul>`)}
        <div class="kv">
          <p><span>Buying</span><b>${formatPackQty(i)}</b></p>
          ${when(i.pack?.label, () => html`<p><span>Pack</span><b>${i.pack.label}</b></p>`)}
          <p><span>Price</span><b>${i.cost == null ? '—' : `${money(i.cost)}${i.packs > 1 ? ` (${money(i.pack.price)} each)` : ''}`}</b></p>
          <p><span>Source</span><b>${src}${i.pack?.url ? html`, <a href="${i.pack.url}" target="_blank" rel="noopener">see it</a>` : ''}</b></p>
        </div>
        <h3 class="sheet-h">Store</h3>
        ${both ? segmented('store', [{ id: 'sams', label: "Sam's Club" }, { id: 'jewel', label: 'Jewel-Osco' }], i.store, { label: 'Store for this item', action: 'item:store' })
          : html`<p class="muted small">This period is planned from ${NAMES[app.settings.planStore]} only. Switch “Plan from” to both stores to move items.</p>`}
        <h3 class="sheet-h">Brand</h3>
        ${segmented('brand', [{ id: 'generic', label: 'Store brand' }, { id: 'name', label: 'Name brand' }], app.state.brands?.[i.id] || app.settings.brand, { label: 'Brand for this item', action: 'item:brand' })}
        <h3 class="sheet-h">Fix the price</h3>
        <form class="form" data-submit="item:price" data-store="${i.store}" data-brand="${i.brand}" data-id="${i.id}">
          <div class="field-row">
            <label class="field"><span class="field-label">Pack size (${i.unit})</span><input class="input" name="size" type="number" inputmode="decimal" min="0.01" step="0.01" value="${i.pack?.size ?? ''}" required></label>
            <label class="field"><span class="field-label">Price</span><input class="input" name="price" type="number" inputmode="decimal" min="0" step="0.01" value="${i.pack?.price ?? ''}" required></label>
          </div>
          <button type="submit" class="btn btn-secondary btn-block">Save price for the family</button>
          ${when(fam, () => html`<button type="button" class="btn btn-quiet btn-block" data-action="item:price-clear" data-store="${i.store}" data-brand="${i.brand}" data-id="${i.id}">Use the estimate again</button>`)}
        </form>
        <div class="action-list">
          <button type="button" class="action-row" data-action="item:have" data-id="${i.id}">${ic('pantry')}<span><b>We already have it</b><small>Adds it to the pantry so it drops off the list.</small></span></button>
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
          return items.length ? html`<details class="more"><summary>Search each item on ${info.name}</summary><ul class="handoff-items">${items.map((i) => html`<li><span>${i.name}</span><a class="btn btn-small btn-quiet" href="${info.searchTemplate.replace('{query}', searchWords(i.name, store))}" target="_blank" rel="noopener">Search</a></li>`)}</ul></details>` : '';
        })}
        <label class="field"><span class="field-label">${ok ? 'What was copied' : 'Select and copy this'}</span><textarea class="input copy-box" readonly rows="8">${text}</textarea></label>
        <button type="button" class="btn btn-quiet btn-block" data-action="list:copy-again" data-store="${store}">${ic('copy', { size: 20 })}Copy again</button>
        ${when(info.address || info.phone, () => html`<p class="muted small">${[info.address, info.phone, info.hours].filter(Boolean).join('. ')}</p>`)}`,
    });
  });
}

export const actions = {
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
  'item:brand': (app, el) => {
    const ops = [set(['brands', itemSheet.key], el.dataset.value)];
    app.commit({ ops, undo: undoFor(app.state, ops), message: el.dataset.value === 'name' ? 'Name brand for this item.' : 'Store brand for this item.' });
    renderSheet();
  },
  'item:price': (app, form) => {
    const f = new FormData(form);
    const size = Number(f.get('size'));
    const price = Number(f.get('price'));
    if (!(size > 0) || !(price >= 0)) { toast('Enter a pack size and a price.'); return; }
    app.commit(setPriceOps(app.state, { store: form.dataset.store, brand: form.dataset.brand, id: form.dataset.id, size, price, who: app.who() }));
    renderSheet();
  },
  'item:price-clear': (app, el) => { app.commit(clearPriceOps(app.state, { store: el.dataset.store, brand: el.dataset.brand, id: el.dataset.id })); renderSheet(); },
  'item:notat': (app, el) => { app.commit(notAtStoreOps(app.db, app.state, { store: el.dataset.store, id: el.dataset.id })); closeSheet(); },
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
