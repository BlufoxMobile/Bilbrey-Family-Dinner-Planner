// What a meal costs (docs/spec/24-chicken-bulk-and-meal-cost.md). Jeff, 2026-11-15: "can you show an
// individual estimated cost per meal when we are planning these?"
//
// Three numbers answer three different questions, and each traces back to the same pack the shopping
// list would buy (the store the list would send it to, the family's own product or usual pack, a
// current price check with its sale or coupon):
//   total       the food that goes into the dinner and its sides, for the family
//               (amount used × the pack's price per unit; a 10 lb bag is not charged to one dinner);
//   pantryValue the part of that food already in the house;
//   toBuy       what this dinner adds to the next trip, in whole packs, given what's in the house.
// Pure: no DOM, no clock (pass `today` to honor a price check's dates).

import { settingsOf } from './state.js';
import { round2 } from './util.js';
import { canBuyAt, dinnerById, itemsForNight, kindOf, packFor, storeFor } from './planner.js';
import { OTHER, itemMeta, plannedNights } from './shopping.js';
import { activeDeal, applyDeal } from './deals.js';
import { priceSource } from './products.js';
import { lunchItem } from './lunch.js';
import { PLATES } from './nutrition.js';

/** Price sources that are estimates, not a price someone read or paid. */
const ESTIMATES = new Set(['est', 'none']);

/** The store the shopping list would buy an item at: the trip's store if it carries it, else the other. */
function listStoreFor(db, state, id, planStore) {
  if (planStore === 'sams' || planStore === 'jewel') {
    if (canBuyAt(db, state, id, planStore)) return planStore;
    if (canBuyAt(db, state, id, OTHER[planStore])) return OTHER[planStore];
    return planStore;
  }
  return storeFor(db, state, id, 'both');
}

/** The pack the list would buy for an item, with any current price check laid over it. → { store, pack } */
export function pricedPack(db, state, id, { today = null, store = null } = {}) {
  const planStore = store === 'sams' || store === 'jewel' ? store : settingsOf(state).planStore;
  const at = listStoreFor(db, state, id, planStore);
  const deal = activeDeal(state, at, id, today);
  const base = packFor(db, state, id, at);
  return { store: at, pack: deal ? applyDeal(base, deal) : base };
}

/** How much of an item the house can put toward a need (a pantry marked "low" counts as none). */
function onHandFor(db, state, id, need) {
  const p = state?.pantry?.[id];
  if (!p || p.low) return 0;
  if (kindOf(db, state, id) === 'staple') return p.stocked ? need : 0;
  if (p.stocked && p.qty == null) return need;
  return typeof p.qty === 'number' ? Math.min(Math.max(0, p.qty), need) : 0;
}

/**
 * The cost of a bag of ingredients ({ id: amount }).
 * → { total, items, pantryValue, toBuy, estimated, estimatedCost, unpriced }
 *   items: [{ id, name, qty, unit, cost, store, unitPrice, label, source, estimated, have, packs, buy }]
 *          (dearest first; cost is null when nothing prices the item, and it then counts as an estimate)
 */
export function itemsCost(db, state, items, opts = {}) {
  const rows = [];
  let total = 0;
  let pantryValue = 0;
  let toBuy = 0;
  let estimatedCost = 0;
  let unpriced = 0;
  for (const [id, qty] of Object.entries(items || {})) {
    if (!(qty > 0)) continue;
    const meta = itemMeta(db, state, id);
    const { store, pack } = pricedPack(db, state, id, opts);
    const source = priceSource(pack).kind;
    const estimated = ESTIMATES.has(source);
    const have = onHandFor(db, state, id, qty);
    if (!pack || !(pack.size > 0)) {
      unpriced++;
      rows.push({ id, name: meta.name, qty, unit: meta.unit, cost: null, store, unitPrice: null, label: '', source: 'none', estimated: true, have, packs: 0, buy: 0 });
      continue;
    }
    const unitPrice = pack.price / pack.size;
    const cost = qty * unitPrice;
    const short = Math.max(0, qty - have);
    const packs = short > 1e-9 ? Math.ceil(short / pack.size - 1e-9) : 0;
    total += cost;
    pantryValue += have * unitPrice;
    toBuy += packs * pack.price;
    if (estimated) estimatedCost += cost;
    rows.push({
      id, name: meta.name, qty, unit: meta.unit, cost: round2(cost), store, unitPrice,
      label: pack.label || '', source, estimated, have, packs, buy: round2(packs * pack.price),
    });
  }
  rows.sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1) || a.name.localeCompare(b.name));
  return {
    total: round2(total), items: rows, pantryValue: round2(pantryValue), toBuy: round2(toBuy),
    estimated: rows.some((r) => r.estimated), estimatedCost: round2(estimatedCost), unpriced,
  };
}

/**
 * What one dinner costs: the entrée and the sides as they would be served that night (`entry.sides`,
 * remembered swaps, the meat setting), exactly the food the shopping list counts for it.
 *   dinnerCost(db, state, dinnerId, entry?, { today?, store?, servings? })
 *   → { total, perServing, servings, items: [{ id, name, qty, unit, cost, store, … }],
 *       pantryValue, toBuy, estimated, estimatedCost, unpriced }   or null for a dinner that isn't there
 * `total` is the food used; `pantryValue` the part already in the house; `toBuy` what the next trip
 * would cost for this dinner alone, in whole packs; `estimated` is true when any price is an estimate
 * (`estimatedCost` says how many of the dollars rest on estimates).
 */
export function dinnerCost(db, state, dinnerId, entry = null, opts = {}) {
  if (!dinnerById(db, state, dinnerId)) return null;
  const servings = opts.servings > 0 ? opts.servings : PLATES;
  const c = itemsCost(db, state, itemsForNight(db, state, dinnerId, entry), opts);
  return { ...c, perServing: round2(c.total / servings), servings };
}

/** What one packed-lunch item costs (one lunch for one person). `item` is an id or the item itself. Same shape as dinnerCost. */
export function lunchCost(db, state, item, opts = {}) {
  const it = typeof item === 'string' ? lunchItem(db, state, item) : item;
  if (!it || !it.items) return null;
  const c = itemsCost(db, state, it.items, opts);
  return { ...c, perServing: c.total, servings: 1 };
}

/**
 * The planned dinners among `dates`, costed together.
 * → { total, perDinner, perServing, dinners, servings, nights: [{ date, dinner, title, total, perServing, estimated }],
 *     pantryValue, toBuy, estimated, estimatedCost, unpriced }
 * `total` adds up each night's food; `perDinner` is the average dinner and `perServing` the average
 * plate. `pantryValue` and `toBuy` are worked out once for all the nights together, because nights
 * share packs and the pantry: two chicken dinners buy one bag, and a pound in the freezer is only
 * used once. (The trip's own total, with lunches and extras, is buildList's.)
 */
export function planCost(db, state, dates, opts = {}) {
  const servings = opts.servings > 0 ? opts.servings : PLATES;
  const nights = [];
  const all = {};
  let total = 0;
  for (const { date, entry } of plannedNights(db, state, dates || [])) {
    const items = itemsForNight(db, state, entry.dinner, entry);
    for (const [id, q] of Object.entries(items)) all[id] = (all[id] || 0) + q;
    const c = itemsCost(db, state, items, opts);
    total += c.total;
    nights.push({ date, dinner: entry.dinner, title: dinnerById(db, state, entry.dinner)?.title || '', total: c.total, perServing: round2(c.total / servings), estimated: c.estimated });
  }
  const together = itemsCost(db, state, all, opts);
  const n = nights.length;
  return {
    total: round2(total), perDinner: n ? round2(total / n) : 0, perServing: n ? round2(total / n / servings) : 0,
    dinners: n, servings, nights,
    pantryValue: together.pantryValue, toBuy: together.toBuy,
    estimated: together.estimated, estimatedCost: together.estimatedCost, unpriced: together.unpriced,
  };
}

/**
 * Dinners with their cost, cheapest plate first (a dinner nothing can price goes last). For the
 * recipe box's "cheapest first" sort: `cheapestFirst(db, state, allDinners(db, state))`.
 * → [{ dinner, cost }]
 */
export function cheapestFirst(db, state, dinners, opts = {}) {
  return (dinners || [])
    .map((dinner) => ({ dinner, cost: dinnerCost(db, state, dinner.id, null, opts) }))
    .sort((a, b) => {
      const pa = a.cost && a.cost.total > 0 ? a.cost.perServing : Infinity;
      const pb = b.cost && b.cost.total > 0 ? b.cost.perServing : Infinity;
      return pa - pb || String(a.dinner.title).localeCompare(String(b.dinner.title));
    });
}

const dollars = (n) => `$${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`;

/**
 * A cost in words, for a card: "about $3.40 a serving · $17.00 for five". Every catalog price is an
 * estimate until a receipt or a price check replaces it, so the line says "about" whenever one is.
 * `short` gives just "about $3.40 a serving".
 */
export function costLine(cost, { short = false } = {}) {
  if (!cost || !(cost.total > 0)) return '';
  const about = cost.estimated ? 'about ' : '';
  const n = cost.servings;
  const each = `${about}${dollars(cost.perServing)} ${n === 1 ? 'a lunch' : 'a serving'}`;
  if (short || n === 1) return each;
  const group = n === 5 ? 'five' : String(n);
  return `${each} · ${dollars(cost.total)} for ${group}`;
}
