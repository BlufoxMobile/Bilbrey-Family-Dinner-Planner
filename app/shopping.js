// Pure shopping-list and budget math. Every number traces back to:
// recipe quantities × planned nights − pantry, rounded up to real pack sizes,
// priced from the family's corrections → data/prices.json → data/catalog.json.

import { AISLES } from './config.js';
import { addMonths, datesBetween, diffDays, endOfMonth, fmtQty, round2, startOfMonth, shortDate, rangeLabel } from './util.js';
import { settingsOf } from './state.js';
import {
  canBuyAt, dinnerById, itemsForNight, kindOf, packFor, storeFor, rotationList, unitPrice,
} from './planner.js';
import { lunchNeeds, lunchesIn } from './lunch.js';
import { wordFrom, defaultWord, plural } from './packages.js';
import { shownProduct, productLabel } from './products.js';
import { activeDeal, applyDeal, regularPrice } from './deals.js';
// freshness.js and waste.js import this file back; every use is inside a function.
import { keepsDays, placeOf } from './freshness.js';
import { tossCounts, wasteSummary } from './waste.js';

export const OTHER = { sams: 'jewel', jewel: 'sams' };

/** Planned (not away, not cooked) nights with a dinner among `dates`. */
export function plannedNights(db, state, dates) {
  const out = [];
  for (const date of dates) {
    const e = state?.plan?.[date];
    if (e && e.dinner && e.status === 'planned' && dinnerById(db, state, e.dinner)) out.push({ date, entry: e });
  }
  return out;
}

/** Ingredient needs for the nights, with where each amount is used. */
export function needsFor(db, state, dates) {
  const needs = {};
  const uses = {};
  const nights = plannedNights(db, state, dates);
  for (const { date, entry } of nights) {
    const items = itemsForNight(db, state, entry.dinner, entry);
    for (const [id, qty] of Object.entries(items)) {
      needs[id] = (needs[id] || 0) + qty;
      (uses[id] ||= []).push({ date, dinner: entry.dinner, qty });
    }
  }
  return { needs, uses, nights };
}

/** "bhBlackForestHam" / "custom-rotel-2" → "Bh black forest ham" / "Rotel 2": words, never an id. */
export function readableId(id) {
  const words = String(id || '').replace(/^custom-/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Item';
}

export function itemMeta(db, state, id) {
  const ing = db.ingredients[id];
  if (ing) return { ...ing, custom: false };
  const c = state?.custom?.[id];
  if (c) return { id, name: c.name || readableId(id), unit: c.unit || 'each', aisle: c.aisle || 'Snacks & Extras', storage: c.storage || 'pantry', kind: c.kind === 'staple' ? 'staple' : 'measured', defaultStore: c.store || 'jewel', packs: {}, custom: true, aliases: [] };
  // Not in this phone's copy of the catalog (e.g. a moment after an update): never show the raw id.
  const lunchUse = db.lunch?.itemList?.find((x) => x.items?.[id] != null);
  return { id, name: lunchUse?.title || readableId(id), unit: 'each', aisle: 'Snacks & Extras', storage: 'pantry', kind: 'measured', defaultStore: 'jewel', packs: {}, custom: true, unknown: true, aliases: [] };
}

function listStore(db, state, id, planStore) {
  if (planStore === 'sams' || planStore === 'jewel') {
    if (canBuyAt(db, state, id, planStore)) return { store: planStore, fallback: false };
    if (canBuyAt(db, state, id, OTHER[planStore])) return { store: OTHER[planStore], fallback: true };
    return { store: planStore, fallback: false };
  }
  return { store: storeFor(db, state, id, 'both'), fallback: false };
}

const COUNT_UNITS = new Set(['eggs', 'buns', 'slices', 'tortillas', 'pieces', 'cans', 'peppers', 'hearts', 'cucumbers', 'oranges', 'lemons',
  'limes', 'cloves', 'pizzas', 'each', 'count', 'heads', 'bunches', 'packages', 'jars', 'bottles', 'bags', 'boxes', 'loaves', 'avocados', 'bananas',
  'snack cups', 'yogurt cups', 'rolls', 'ears', 'potstickers', 'waffles', 'sticks', 'bars',
  'bowls', 'pouches', 'packs', 'trays', 'dip cups', 'containers', 'cartons', 'clementines', 'singles', 'kits', 'wraps']);
const WEIGHT_UNITS = new Set(['lb', 'oz', 'g', 'kg']);

export function singular(unit) {
  if (!unit || ['tbsp', 'tsp', 'oz', 'lb', 'g', 'kg', 'ml', 'l'].includes(unit)) return unit || '';
  if (unit === 'loaves') return 'loaf';
  if (unit === 'boxes') return 'box';
  if (unit === 'bunches') return 'bunch';
  if (unit === 'pieces') return 'piece';
  if (unit === 'pouches') return 'pouch';
  if (unit === 'slices') return 'slice';
  return unit.endsWith('es') && /(ches|shes|xes|ses)$/.test(unit) ? unit.slice(0, -2) : unit.endsWith('s') ? unit.slice(0, -1) : unit;
}

/** "2 cups", "1 cup", "½ cup" (a fraction of one takes the singular too). */
export function unitText(n, unit) {
  return `${fmtQty(n)} ${n > 0 && n < 1 + 1e-9 ? singular(unit) : unit}`.trim();
}

function containerWord({ aisle, name = '', product, pack }) {
  // A multipack on the shelf ("Chicken Broth, 32 oz., 6 pk.") is picked up as one pack.
  if (/\b\d+\s*(pk|pack|ct)\b/i.test(`${product?.label || ''} ${pack?.label || ''}`)) return 'pack';
  if (/\bmilk\b/i.test(name) && pack?.size >= 12) return 'jug';
  if (/\b(oil|vinegar|sauce|dressing|ketchup|mustard|honey|syrup)\b/i.test(name)) return 'bottle';
  if (/\b(broth|stock|milk|cream|creamer|juice)\b/i.test(name)) return 'carton';
  if (/\b(flour|sugar|rice|oats)\b/i.test(name)) return 'bag';
  if (/starch/i.test(name)) return 'box';
  if (aisle === 'Spices & Baking') return 'jar';
  if (aisle === 'Condiments & Sauces') return 'bottle';
  if (aisle === 'Dairy & Eggs') return 'carton';
  if (aisle === 'Pasta & Grains') return 'bag';
  if (aisle === 'Canned & Jarred') return 'jar';
  return 'container';
}

/** "1 × ~10 lb pack", "3 lemons", "1 × 8-can pack", "1 × bottle (about 64 tbsp)" */
export function formatPackQty(item) {
  const { unit } = item;
  if (!item.pack) return unitText(item.shortfall || item.qty || 0, unit);
  const n = item.packs;
  const size = item.pack.size;
  if (WEIGHT_UNITS.has(unit)) return `${n} × ${unit === 'lb' ? '~' : ''}${fmtQty(size)} ${unit} pack`;
  if (COUNT_UNITS.has(unit)) {
    if (Math.abs(size - 1) < 1e-9) return unitText(n, unit);
    if (unit === 'cans') return `${n} × ${fmtQty(size)}-can pack`;
    return `${n} × ${fmtQty(size)}-count pack`;
  }
  return `${n} × ${containerWord(item)} (about ${fmtQty(size)} ${unit})`;
}

/** What goes in the cart: "bag", "bottle", "bulb", "pack" (a multipack), or null for meat sold by the pound. */
// Brand names that hold a package word ("Boar's Head" is not a head of anything; gauntlet r6).
const BRANDS = /\b(boar['’]s head|head country|bag balm)\b/gi;

function cartWord(item) {
  const { unit, aisle } = item;
  const name = String(item.name || '').replace(BRANDS, ' ');
  const label = `${item.product?.label || ''} ${item.pack?.label || ''}`.replace(BRANDS, ' ');
  const weight = WEIGHT_UNITS.has(unit);
  const meat = /\b(pork|chicken|beef|turkey|sausages?|steaks?|roasts?|bacon|chorizo)\b/i.test(name);
  const both = `${label} ${name}`;
  let w;
  if (/\bpiece\b/i.test(label) && weight) w = 'piece';
  // Several packages sold as one ("16 oz × 6", "12 pk", "2 × 16 oz"): you pick up one pack.
  // Counted things that come in a known package keep its word ("1 bag (8 buns)"), as the pantry says (gauntlet r7).
  else if (/\b\d+\s*(pk|ct|count)\b|×\s*\d|\d\s*×|\b\d+[\s-]*pack\b/i.test(label)) w = COUNT_UNITS.has(unit) && !/×/.test(label) && defaultWord(name, unit) !== 'pack' ? defaultWord(name, unit) : 'pack';
  else if (/\bcereal\b/i.test(both)) w = 'box';
  else if (/\b(yogurt|cream cheese|sour cream|cottage cheese|hummus)\b/i.test(name) && !COUNT_UNITS.has(unit)) w = 'tub';
  else if (/\b(juice|creamer)\b/i.test(name) && !COUNT_UNITS.has(unit)) w = 'carton';
  else if (/\bshredded\b/i.test(both) && weight) w = 'bag';
  else if (!meat && /\b(grated|coffee|oats|panko|bread crumbs|crispy fried onions)\b/i.test(both) && weight) w = 'canister';
  else {
    w = wordFrom(label) || wordFrom(name);
    // "Garlic Bulbs, 2 lb": the word is the thing inside; the bag (or pack) is what you pick up.
    if (w && new RegExp(`\\b${w}(e?s)\\b`, 'i').test(label) && !new RegExp(`\\b${w}\\b`, 'i').test(label)) w = aisle === 'Produce' ? 'bag' : 'pack';
    // With no word on the label, a weight is shown as it is ("18.37 oz") rather than a guessed "pack".
    if (!w) w = weight ? (aisle === 'Produce' ? 'bag' : meat || defaultWord(name, unit) === 'pack' ? null : defaultWord(name, unit)) : COUNT_UNITS.has(unit) ? (aisle === 'Produce' ? 'bag' : defaultWord(name, unit)) : containerWord(item);
  }
  if (!w) return null;
  // "1 box (40 boxes)" says nothing: the thing around them is a case, or a box.
  if (w === singular(unit)) w = w === 'box' ? 'case' : 'box';
  // Meat in a single store pack is bought by its weight ("2 × 3.1 lb").
  return weight && meat && w === 'pack' && !/×|\bpk\b/i.test(label) ? null : w;
}

/**
 * The amount line on a list row (gauntlet r5): what goes in the cart, then what's inside when it helps.
 * "4 cans", "3 packs", "1 bag (10 lb)", "1 box (40 pouches)", "1 bulb (10 cloves)", "2 × 3.1 lb",
 * and the container for spoon and cup amounts ("1 bottle", never "190 tbsp").
 */
export function shelfQty(item) {
  const { unit } = item;
  if (!item.pack) return unitText(item.shortfall || item.qty || 0, unit);
  const n = item.packs || 1;
  const sizeN = Math.round((item.pack.size || 0) * 100) / 100;
  const volume = !WEIGHT_UNITS.has(unit) && !COUNT_UNITS.has(unit);
  if (COUNT_UNITS.has(unit) && (!(sizeN > 0) || Math.abs(sizeN - 1) < 1e-9)) return unitText(n, unit);
  const w = cartWord(item);
  // A count that isn't whole ("4.58 cans" of 20-oz cans in a box of six 15-oz ones) says nothing useful.
  if (volume || !(sizeN > 0) || (COUNT_UNITS.has(unit) && Math.abs(sizeN - Math.round(sizeN)) > 0.05)) return `${n} ${plural(w || 'pack', n)}`;
  const size = unitText(sizeN, unit);
  // Deli meat is asked for by weight at the counter: "1 lb, sliced", never "1 head (1 lb)".
  if (WEIGHT_UNITS.has(unit) && /deli-sliced|sliced at|shaved|ask for|per lb\W+ask/i.test(`${item.name || ''} ${item.product?.label || ''} ${item.pack?.label || ''}`)) return `${n > 1 ? `${n} × ` : ''}${size}, sliced`;
  if (!w) return n > 1 ? `${n} × ${size}` : size;
  return n > 1 ? `${n} ${plural(w, n)} (${size} each)` : `1 ${w} (${size})`;
}

const aisleIndex = (a) => { const i = AISLES.indexOf(a); return i < 0 ? AISLES.length : i; };

/** Splitting a two-store trip (SPEC §21.4). */
export const SPLIT = {
  /** A fresh item moves to the smaller pack when the usual one would leave this share unused… */
  freshLeftover: 0.4,
  /** …and the smaller pack costs no more than this much extra. */
  freshExtra: 1.15,
  /** A store with this few things, worth less than `stopMax`, isn't worth the stop. */
  stopItems: 2,
  stopMax: 15,
  /** Buying them at the other store may cost this much more. */
  stopExtra: 5,
};
export const SPLIT_WHY = {
  fresh: 'fresh, so the smaller pack',
  bulk: 'it keeps, and the bulk pack is cheaper',
  cheaper: 'cheaper there for what’s needed',
  wasted: 'thrown out before, so the smaller pack',
  'one-stop': 'saves a stop',
};

/**
 * The shopping list for a set of dates.
 * opts: { dates, listKey, store, today, split }
 *   listKey keys check-offs in state.checked; store 'sams' | 'jewel' shops one store (a trip);
 *   split: true splits a two-store trip sensibly (SPEC §21.4; the default for a list whose listKey
 *   is a two-store trip's, false turns it off): fresh food in Jewel's small packs
 *   when the bulk pack would mostly go unused, things that keep at Sam's when the bulk pack is the
 *   cheaper way to buy what's needed, and no stop at a store for one or two small things. A store
 *   the family chose for an item (state.storeFor) is never changed. With or without `split`, food
 *   the family has thrown out twice lately is bought in the pack that leaves the least over.
 */
export function buildList(db, state, { dates, listKey = '', store: tripStore = null, today = null, split = null } = {}) {
  // A list keyed as a two-store trip ("trip:start:end:both", SPEC §12.1) splits unless told otherwise.
  const smart = split ?? /^trip:[^:]+:[^:]+:both$/.test(listKey);
  const st = settingsOf(state);
  // A trip (SPEC §12) shops one store: everything that store carries is bought there.
  const planStore = tripStore === 'sams' || tripStore === 'jewel' ? tripStore : st.planStore;
  const skips = (listKey && state?.skips?.[listKey]) || {};
  const skipped = [];
  const onDay = [];
  const dinner = needsFor(db, state, dates);
  const lunch = lunchNeeds(db, state, dates);
  const { uses, nights } = dinner;
  const { lunches } = lunch;
  const needs = { ...dinner.needs };
  for (const [id, q] of Object.entries(lunch.needs)) needs[id] = (needs[id] || 0) + q;
  const weeks = Math.max(1, Math.round(dates.length / 7));
  const checked = state?.checked?.[listKey] || {};
  const pantry = state?.pantry || {};
  const extras = state?.extras || {};

  const extraPacks = {};
  const freeExtras = [];
  for (const [key, x] of Object.entries(extras)) {
    if (!x) continue;
    if (x.once && x.once !== listKey) continue; // a one-off ("grab paper towels") belongs to one list
    const mult = !x.once && x.every === 'week' ? weeks : 1;
    const qty = (Number(x.qty) > 0 ? Number(x.qty) : 1) * mult;
    if (x.item && (db.ingredients[x.item] || state?.custom?.[x.item])) {
      extraPacks[x.item] = (extraPacks[x.item] || 0) + qty;
    } else {
      const store = x.store === 'sams' ? 'sams' : 'jewel';
      const price = Number(x.price);
      freeExtras.push({
        key, id: key, name: x.name || 'Extra item', unit: x.unit || '', aisle: 'Snacks & Extras', kind: 'extra', freeText: true,
        store, qty, every: x.every || 'trip', pack: null, packs: qty, cost: Number.isFinite(price) && price >= 0 ? round2(price * qty) : null,
        checked: !!checked[key], reasons: ['extra'], uses: [], lunchUses: [], dinnerNeed: 0, lunchNeed: 0,
      });
    }
  }

  const ids = new Set([...Object.keys(needs), ...Object.keys(extraPacks)]);
  for (const [id, p] of Object.entries(pantry)) if (p?.low) ids.add(id);

  const items = [];
  const covered = [];
  const moved = [];
  const swappable = new Map(); // id → the same item bought at the other store
  const offenders = tossCounts(state, today || dates?.[0] || '');
  for (const id of ids) {
    const meta = itemMeta(db, state, id);
    const need = needs[id] || 0;
    const p = pantry[id];
    const kind = kindOf(db, state, id);
    const low = !!p?.low;
    let have = 0;
    let stocked = false;
    if (p && !low) {
      if (kind === 'staple' || (p.stocked && p.qty == null)) stocked = !!p.stocked;
      if (typeof p.qty === 'number') have = Math.max(0, p.qty);
    }
    const shortfall = stocked ? 0 : Math.max(0, need - have);
    const xp = extraPacks[id] || 0;
    if (shortfall <= 1e-9 && !xp && !low) {
      if (need > 0) covered.push({ id, name: meta.name, unit: meta.unit, need, have, stocked, kind });
      continue;
    }
    const dinnerNeed = dinner.needs[id] || 0;
    const lunchNeed = lunch.needs[id] || 0;
    const reasons = [];
    if (shortfall > 1e-9 && dinnerNeed > 0) reasons.push('dinners');
    if (shortfall > 1e-9 && lunchNeed > 0) reasons.push('lunches');
    if (xp) reasons.push('extra');
    if (low) reasons.push('low');
    /** This item bought at one store: the pack, how many, what it costs and what's left over. */
    const at = (store, fallback = false, why = null) => {
      const deal = activeDeal(state, store, id, today);
      const pack = deal ? applyDeal(packFor(db, state, id, store), deal) : packFor(db, state, id, store);
      let packs = 0;
      if (pack) {
        packs = Math.ceil(shortfall / pack.size - 1e-9);
        if (low && packs === 0 && !xp) packs = 1;
        packs += xp;
      }
      const bought = pack ? packs * pack.size : 0;
      const leftover = pack ? Math.max(0, bought - shortfall) : 0;
      const cost = pack ? round2(packs * pack.price) : null;
      // Money split three ways for the budget: extras' own packs, then the rest by how much
      // the dinners and the lunches each need.
      const extrasPart = pack && xp ? xp * pack.price : 0;
      const mealPart = Math.max(0, (cost || 0) - extrasPart);
      const lunchShare = need > 0 ? lunchNeed / need : 0;
      const usedTotal = pack ? pack.price * Math.min(packs, shortfall / pack.size) : 0;
      return {
        key: id, id, name: meta.name, unit: meta.unit, aisle: meta.aisle, storage: meta.storage, kind, custom: meta.custom, unknown: !!meta.unknown,
        need, have, stocked, low, shortfall, extraPacks: xp,
        store, storeFallback: fallback, ...(why ? { storeWhy: why } : {}),
        pack, packs, bought, leftover, cost,
        // The one product the family buys there (their own, their usual, or the researched one) — SPEC §9.5.
        product: shownProduct(state, store, id, pack, db),
        // The share of the cost the planned meals actually use (the rest is leftovers for later).
        usedCost: pack ? round2(usedTotal) : null,
        usedDinner: pack ? round2(usedTotal * (1 - lunchShare)) : null,
        usedLunch: pack ? round2(usedTotal * lunchShare) : null,
        dinnerNeed, lunchNeed,
        costLunch: round2(mealPart * lunchShare),
        costExtras: round2(extrasPart),
        uses: (uses[id] || []).slice().sort((x, y) => x.date.localeCompare(y.date)),
        lunchUses: (lunch.uses[id] || []).slice().sort((x, y) => x.date.localeCompare(y.date)),
        reasons, checked: !!checked[id],
        regularCost: pack ? round2(packs * (regularPrice(pack) ?? pack.price)) : null,
        coupon: pack?.coupon || null,
        organic: !!(pack?.organic || it_organic(pack)),
      };
    };
    const { store, fallback } = listStore(db, state, id, planStore);
    let it = at(store, fallback);
    // Which store, when both carry it and the family hasn't said (never on a one-store plan).
    const free = planStore === 'both' && !state?.storeFor?.[id] && kind !== 'staple' && shortfall > 1e-9 && !it.checked
      && it.pack && canBuyAt(db, state, id, OTHER[store]);
    if (free) {
      const alt = at(OTHER[store]);
      if (alt.pack) {
        const pick = pickStore(db, state, id, it, alt, { split: smart, tossed: offenders.get(id) || 0 });
        if (pick) { moved.push({ id, name: meta.name, from: store, to: alt.store, why: pick, saves: round2((it.cost || 0) - (alt.cost || 0)) }); it = { ...alt, storeWhy: pick }; }
        else swappable.set(id, alt);
      }
    }
    if (meta.buyOnDay) { onDay.push(it); continue; }
    if (skips[id]) { skipped.push({ ...it, skip: skips[id] }); continue; }
    items.push(it);
  }
  // One stop: a store left with one or two small things isn't worth the drive when the other has them.
  if (smart && planStore === 'both') {
    for (const s of ['sams', 'jewel']) {
      const here = [...items, ...freeExtras].filter((i) => i.store === s);
      const there = [...items, ...freeExtras].filter((i) => i.store === OTHER[s]);
      if (!here.length || here.length > SPLIT.stopItems || there.length <= here.length) continue; // the other store is the real trip
      const alts = here.map((i) => swappable.get(i.id));
      if (alts.some((x) => !x)) continue;
      const cost = here.reduce((t, i) => t + (i.cost || 0), 0);
      const extra = alts.reduce((t, x) => t + (x.cost || 0), 0) - cost;
      if (cost >= SPLIT.stopMax || extra > SPLIT.stopExtra) continue;
      for (const i of here) {
        const alt = swappable.get(i.id);
        moved.push({ id: i.id, name: i.name, from: s, to: OTHER[s], why: 'one-stop', saves: round2((i.cost || 0) - (alt.cost || 0)) });
        items[items.indexOf(i)] = { ...alt, storeWhy: 'one-stop' };
      }
      break;
    }
  }
  items.push(...freeExtras);
  items.sort((a, b) => aisleIndex(a.aisle) - aisleIndex(b.aisle) || a.name.localeCompare(b.name));

  const stores = {};
  for (const s of ['sams', 'jewel']) {
    const its = items.filter((i) => i.store === s);
    const aisles = [];
    for (const it of its) {
      let g = aisles.find((a) => a.aisle === it.aisle);
      if (!g) aisles.push((g = { aisle: it.aisle, items: [] }));
      g.items.push(it);
    }
    stores[s] = {
      items: its,
      aisles,
      subtotal: round2(its.reduce((t, i) => t + (i.cost || 0), 0)),
      unpriced: its.filter((i) => i.cost == null).length,
      remaining: its.filter((i) => !i.checked).length,
    };
  }

  const meal = (i) => i.reasons.includes('dinners') || i.reasons.includes('lunches');
  const leftovers = items
    .filter((i) => i.pack && i.kind !== 'staple' && i.leftover > 1e-6 && meal(i))
    .map((i) => ({ id: i.id, name: i.name, unit: i.unit, qty: round2(i.leftover), storage: i.storage }));

  const freezer = [];
  for (const id of Object.keys(needs)) {
    const meta = itemMeta(db, state, id);
    if (meta.storage !== 'freezer' || kindOf(db, state, id) === 'staple') continue;
    const it = items.find((i) => i.id === id);
    const pantryQty = typeof pantry[id]?.qty === 'number' && !pantry[id]?.low ? Math.max(0, pantry[id].qty) : 0;
    const buying = it ? it.bought : 0;
    const total = pantryQty + buying;
    let left = total;
    const u = (uses[id] || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    const coveredUses = [];
    for (const x of u) { if (left + 1e-9 >= x.qty) { left -= x.qty; coveredUses.push(x); } else break; }
    // Skipped this trip to make do with what's in the freezer: it covers its dinners, stretched.
    const stretch = skips[id]?.reason === 'stretch' && pantryQty > 0;
    if (stretch) { coveredUses.length = 0; coveredUses.push(...u); left = 0; }
    freezer.push({ stretch,
      id, name: meta.name, unit: meta.unit, have: round2(pantryQty), buying: round2(buying), packs: it?.packs || 0, packSize: it?.pack?.size || null,
      store: it?.store || null, label: it?.pack?.label || '', uses: u, covers: coveredUses.length, dinners: u.length,
      leftover: round2(Math.max(0, total - u.reduce((t, x) => t + x.qty, 0))),
    });
  }
  freezer.sort((a, b) => b.dinners - a.dinners || a.name.localeCompare(b.name));

  const total = round2(stores.sams.subtotal + stores.jewel.subtotal);
  const usedByDinners = round2(items.reduce((t, i) => t + (i.usedDinner || 0), 0));
  const usedByLunches = round2(items.reduce((t, i) => t + (i.usedLunch || 0), 0));
  const leftoverValue = round2(items.filter(meal).reduce((t, i) => t + Math.max(0, (i.cost || 0) - (i.usedCost || 0) - (i.costExtras || 0)), 0));
  // Everyday extras: free-text lines plus the extra packs added to catalog items.
  const extrasCost = round2(items.reduce((t, i) => t + (i.freeText ? (i.cost || 0) : (i.costExtras || 0)), 0));
  const lunchCost = round2(items.reduce((t, i) => t + (i.costLunch || 0), 0));
  // Sales and coupons from a price check (SPEC §12.3): what the regular prices would have been.
  const regularTotal = round2(items.reduce((t, i) => t + (i.regularCost ?? i.cost ?? 0), 0));
  const coupons = items.filter((i) => i.coupon).map((i) => ({ id: i.id, name: i.product?.label || i.name, store: i.store, text: i.coupon.text, expires: i.coupon.expires, packs: i.packs, clipped: !!i.coupon.clipped, q: i.coupon.q || '' }));
  const checkedDates = items.map((i) => (i.pack?.kind === 'deal' ? i.pack.date : null)).filter(Boolean).sort();
  return {
    listKey, dates, nights, lunches, items, covered, stores, leftovers, freezer, total,
    skipped, onDay, coupons, regularTotal, savings: round2(Math.max(0, regularTotal - total)),
    onDayCost: round2(onDay.reduce((t, i) => t + (i.cost || 0), 0)),
    checkedCount: checkedDates.length, checkedOn: checkedDates.length ? checkedDates[checkedDates.length - 1] : null,
    usedByDinners, usedByLunches, leftoverValue, extrasCost, lunchCost,
    // Dinners get the rest, so the three lines always add up to the total.
    dinnerCost: round2(total - extrasCost - lunchCost),
    // What one dinner costs in food it actually uses (pack leftovers excluded).
    perDinner: nights.length ? round2(usedByDinners / nights.length) : 0,
    perLunch: lunches.length ? round2(usedByLunches / lunches.length) : 0,
    weeks, planStore, pricesUpdated: db.pricesUpdated,
    unpriced: items.filter((i) => i.cost == null).length,
    // Items bought somewhere other than their usual store, and why (SPEC §21.4).
    split: { on: !!smart && planStore === 'both', moved, saved: round2(moved.reduce((t, m) => t + m.saves, 0)) },
  };
}

/**
 * Should this item be bought at the other store instead? `usual` and `alt` are the item priced at
 * each. → the reason ('wasted' | 'fresh' | 'bulk' | 'cheaper'), or null to leave it where it is.
 */
function pickStore(db, state, id, usual, alt, { split, tossed }) {
  const less = alt.leftover < usual.leftover - 1e-9;
  // Thrown out twice lately: the pack that leaves the least over, whatever the trip.
  if (tossed >= 2 && less) return 'wasted';
  if (!split) return null;
  const fresh = keepsDays(db, state, id) != null && placeOf(db, state, id) !== 'freezer' && !db.ingredients[id]?.meat;
  if (fresh) {
    const unused = usual.bought > 0 ? usual.leftover / usual.bought : 0;
    return unused > SPLIT.freshLeftover && less && (alt.cost || 0) <= (usual.cost || 0) * SPLIT.freshExtra ? 'fresh' : null;
  }
  // It keeps (freezer, shelf, or meat to portion and freeze): the other store only when it's cheaper
  // for what's needed and no dearer by the unit.
  const unit = (x) => x.pack.price / x.pack.size;
  return (alt.cost || 0) < (usual.cost || 0) - 0.5 && unit(alt) <= unit(usual) * 1.1 ? (alt.store === 'sams' ? 'bulk' : 'cheaper') : null;
}

/**
 * What to call a list item in Copy & open and "Find each item": its one product by exact name —
 * the family's own, their usual, or the researched product at that store — so the store's search
 * finds that one. A rough catalog estimate ("Store-brand or …") falls back to the item's name.
 */
function it_organic(pack) { return /\borganic\b/i.test(String(pack?.label || '')); }

export function productName(i) {
  if (i?.product?.chosen) return productLabel(i.product);
  if (i?.product?.label && (i.pack?.kind === 'usual' || i.pack?.kind === 'option' || i.pack?.confidence === 'paid')) return i.product.label;
  return i?.name || '';
}

/** Clean, store-formatted text to paste into the store's app. */
export function formatStoreList(db, list, store, { includeChecked = false, title = '' } = {}) {
  const s = list.stores[store];
  const name = db.stores?.[store]?.name || (store === 'sams' ? "Sam's Club" : 'Jewel-Osco');
  const lines = [];
  const its = s.items.filter((i) => includeChecked || !i.checked);
  const use = its.length ? its : s.items;
  lines.push(title || `${name} list${list.dates.length ? ` for ${rangeLabel(list.dates[0], list.dates[list.dates.length - 1])}` : ''}`);
  lines.push('');
  for (const i of use) {
    const name = productName(i);
    const label = i.freeText ? `${i.name}${i.qty ? ` — ${unitText(i.qty, i.unit || 'each')}` : ''}` : `${name} — ${formatPackQty(i)}`;
    lines.push(label);
  }
  return lines.join('\n');
}

/** A product name trimmed for a store's AI search: no sizes after " - ", no notes in brackets. */
export function shortProductName(name) {
  return String(name || '').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s*\(.*?\)/g, '')
    .replace(/\s+-\s+[\d.]+.*$/, '').replace(/,\s*\d+(\.\d+)?\s*(ct|count|oz|lb|fl oz|pk|pack)\b.*$/i, '').replace(/\s+/g, ' ').trim();
}

const FRACTIONS = { '½': '1/2', '¼': '1/4', '¾': '3/4', '⅓': '1/3', '⅔': '2/3', '⅛': '1/8' };
const plainNum = (n) => String(fmtQty(n)).replace(/(\d)([½¼¾⅓⅔⅛])/g, '$1 $2').replace(/[½¼¾⅓⅔⅛]/g, (f) => FRACTIONS[f]);

/** One list item as a plain line a store's AI understands: "2 Bonduelle Chicken BLT Bowl", "Ham, 1 lb". */
function plainLine(item) {
  const name = shortProductName(productName(item)).replace(/,\s*per (lb|pound)\b/i, '').replace(/,\s*$/, '');
  const { unit } = item;
  if (!item.pack) {
    const q = item.shortfall || item.qty;
    return q ? `${name}, ${unitText(q, unit || 'each').replace(/[½¼¾⅓⅔⅛]/g, (f) => ` ${FRACTIONS[f]}`).replace(/\s+/g, ' ').trim()}` : name;
  }
  const n = item.packs || 1;
  const size = item.pack.size;
  if (unit === 'lb') return `${name}, ${plainNum(Math.round(n * size * 100) / 100)} lb`;
  const bare = name.replace(/,\s*[\d½¼¾.\s]+(oz|fl oz|ct|count)\b.*$/i, '');
  if (WEIGHT_UNITS.has(unit) || /^(fl oz|ml|l|qt|gal)$/.test(unit)) return `${n} ${bare} (${plainNum(size)} ${unit})`;
  return `${n} ${bare}`;
}

/**
 * The list for a store's AI shopping assistant (Jewel-Osco AI: "Paste or type your grocery list").
 * Plain lines ("2 Bonduelle Chicken BLT Salad Bowl", "1 lb Boar's Head Black Forest Ham"), split
 * into parts that fit the assistant's 2,000-character box. → [string]
 */
export function formatAssistantList(db, list, store, { limit = 1900 } = {}) {
  const s = list.stores[store];
  const its = s.items.filter((i) => !i.checked);
  const use = its.length ? its : s.items;
  const lines = use.map((i) => (i.freeText
    ? `${shortProductName(i.name)}${i.qty ? `, ${unitText(i.qty, i.unit || 'each')}` : ''}`
    : plainLine(i)));
  const parts = [];
  let cur = [];
  const head = (k, n) => (n > 1 ? `Shop my grocery list (part ${k} of ${n}):` : 'Shop my grocery list:');
  const room = limit - 40;
  for (const l of lines) {
    if (cur.length && [...cur, l].join('\n').length > room) { parts.push(cur); cur = []; }
    cur.push(l);
  }
  if (cur.length) parts.push(cur);
  return parts.map((p, k) => `${head(k + 1, parts.length)}\n${p.join('\n')}`);
}

/** Whole-trip text for Share/Print: both stores. */
export function formatFullList(db, list) {
  const parts = [];
  for (const s of ['sams', 'jewel']) if (list.stores[s].items.length) parts.push(formatStoreList(db, list, s, { includeChecked: true }));
  return parts.join('\n\n');
}

/** Ops-free description of what "Done shopping" would put in the pantry. */
export function boughtToPantry(list) {
  const out = [];
  for (const i of list.items) {
    if (!i.checked || i.freeText) continue;
    if (i.kind === 'staple') out.push({ id: i.id, staple: true });
    else if (i.pack) out.push({ id: i.id, add: i.bought });
  }
  return out;
}

// ---------------------------------------------------------------- budget

/** Food a dinner actually uses, priced per unit (pantry and pack leftovers ignored). */
export function dinnerFoodCost(db, state, dinnerId, entry = null) {
  const items = itemsForNight(db, state, dinnerId, entry);
  let t = 0;
  for (const [id, q] of Object.entries(items)) t += q * unitPrice(db, state, id, settingsOf(state).planStore);
  return round2(t);
}

/** Food a packed lunch uses, priced per unit. */
export function lunchFoodCost(db, state, lunch) {
  let t = 0;
  for (const [id, q] of Object.entries(lunch?.items || {})) t += q * unitPrice(db, state, id, settingsOf(state).planStore);
  return round2(t);
}

/** Average food cost of a dinner in the family's rotation, with remembered sides. */
export function rotationAverage(db, state) {
  const rot = rotationList(db, state);
  if (!rot.length) return 0;
  return round2(rot.reduce((t, d) => t + dinnerFoodCost(db, state, d.id, null), 0) / rot.length);
}

/** Everyday extras for a month: weekly items × 52/12 weeks (trip items counted as one trip a week). */
export function extrasPerMonth(db, state) {
  let t = 0;
  let unpriced = 0;
  for (const x of Object.values(state?.extras || {})) {
    if (!x || x.once) continue; // one-offs aren't part of a typical month
    const qty = Number(x.qty) > 0 ? Number(x.qty) : 1;
    let each = null;
    if (x.item && db.ingredients[x.item]) {
      const store = x.store === 'sams' || x.store === 'jewel' ? x.store : storeFor(db, state, x.item);
      const p = packFor(db, state, x.item, store) || packFor(db, state, x.item, OTHER[store]);
      each = p ? p.price : null;
    } else if (Number.isFinite(Number(x.price))) each = Number(x.price);
    if (each == null) { unpriced++; continue; }
    t += each * qty * (52 / 12);
  }
  return { total: round2(t), unpriced };
}

/** The family wants two or three store trips a month, not one every few days. */
export const TRIP_GOAL = 3;

/**
 * Store trips in a month, from its receipts: each day with a receipt is one trip (Sam's and Jewel on
 * the same day is one run). → [{ date, stores: [id], total, receipts }], oldest first.
 */
export function tripsIn(state, month) {
  const days = new Map();
  for (const r of receiptsIn(state, month)) {
    const t = days.get(r.date) || { date: r.date, stores: [], total: 0, receipts: 0 };
    if (r.store && !t.stores.includes(r.store)) t.stores.push(r.store);
    t.total = round2(t.total + Number(r.amount));
    t.receipts++;
    days.set(r.date, t);
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * This month's trips against the goal. → { month, trips, count, goal, left, over, last,
 *   daysSince (the last trip), daysLeft (in the month, today included), perTrip (average spent),
 *   stretch (days each trip still allowed has to cover to make it to the end of the month) }
 */
export function tripGoal(state, today) {
  const month = today.slice(0, 7);
  const trips = tripsIn(state, month);
  const g = Number(state?.settings?.tripGoal);
  const goal = Number.isInteger(g) && g >= 1 && g <= 8 ? g : TRIP_GOAL;
  const count = trips.length;
  const last = count ? trips[count - 1].date : null;
  const daysLeft = diffDays(endOfMonth(today), today) + 1;
  const left = Math.max(0, goal - count);
  return {
    month, trips, count, goal, left, over: count > goal, last,
    daysSince: last ? diffDays(today, last) : null, daysLeft,
    perTrip: count ? round2(trips.reduce((t, x) => t + x.total, 0) / count) : null,
    stretch: left ? Math.ceil(daysLeft / left) : daysLeft,
  };
}

/**
 * The year at this rate. `rate` is what this month looks like costing (its receipts plus what's
 * still to buy); the last three calendar months are averaged from their receipts (months with none
 * are left out, and said so). → { target, yearTarget, rate, year, overYear, months: [{ month,
 *   total }], monthsWithData, avg3 (null without data) }
 */
export function yearPace(state, today, rate) {
  const target = settingsOf(state).monthlyTarget;
  const months = [3, 2, 1].map((k) => addMonths(startOfMonth(today), -k).slice(0, 7))
    .map((month) => ({ month, total: round2(receiptsIn(state, month).reduce((t, r) => t + Number(r.amount), 0)) }));
  const withData = months.filter((m) => m.total > 0);
  const thisRate = round2(Number.isFinite(rate) ? rate : receiptsIn(state, today.slice(0, 7)).reduce((t, r) => t + Number(r.amount), 0));
  return {
    target, yearTarget: round2(target * 12), rate: thisRate, year: round2(thisRate * 12), overYear: round2(thisRate * 12 - target * 12),
    months, monthsWithData: withData.length,
    avg3: withData.length ? round2(withData.reduce((t, m) => t + m.total, 0) / withData.length) : null,
  };
}

export function receiptsIn(state, month) {
  const seen = new Set();
  return (Array.isArray(state?.receipts) ? state.receipts : [])
    .filter((r) => r && typeof r.date === 'string' && r.date.slice(0, 7) === month && Number.isFinite(Number(r.amount)))
    .filter((r) => { const k = r.id || `${r.date}|${r.store}|${r.amount}|${r.note || ''}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Month budget. projected = receipts logged this month + groceries still to buy for
 * this month's remaining planned dinners (today → month end, same math as the List).
 */
export function monthBudget(db, state, today, { baseline = 1000 } = {}) {
  const st = settingsOf(state);
  const month = today.slice(0, 7);
  const start = startOfMonth(today);
  const end = endOfMonth(today);
  const all = datesBetween(start, end);
  const remaining = datesBetween(today, end);
  const receipts = receiptsIn(state, month);
  const spent = round2(receipts.reduce((t, r) => t + Number(r.amount), 0));
  const list = buildList(db, state, { dates: remaining, listKey: `budget-${month}` });
  const stillToBuy = list.total;
  const plannedRemaining = list.nights.length;
  const unplanned = remaining.filter((d) => { const e = state?.plan?.[d]; return !e || (e.status === 'planned' && !e.dinner); }).length;
  const away = all.filter((d) => state?.plan?.[d]?.status === 'away').length;
  const cooked = all.filter((d) => state?.plan?.[d]?.status === 'cooked').length;
  const extras = list.extrasCost || 0;
  const lunchesToBuy = list.lunchCost || 0;
  const projected = round2(spent + stillToBuy);
  const monthLunches = lunchesIn(db, state, all);
  const lunchesMonth = round2(monthLunches.reduce((t, l) => t + lunchFoodCost(db, state, l), 0));
  const average = rotationAverage(db, state);
  const ifPlanned = round2(projected + average * unplanned);
  const nights = all.length;
  const ex = extrasPerMonth(db, state);
  const typical = {
    perDinner: average, nights, dinners: round2(average * nights), extras: ex.total, extrasUnpriced: ex.unpriced,
    lunches: lunchesMonth, lunchCount: monthLunches.length,
    total: round2(average * nights + ex.total + lunchesMonth),
  };
  const target = st.monthlyTarget;
  return {
    month, start, end, target, receipts, spent, stillToBuy, plannedRemaining, unplanned, away, cooked,
    perDinner: list.perDinner, average, typical, projected, ifPlanned, extras, lunchesToBuy, lunchesRemaining: list.lunches.length,
    dinnersToBuy: round2(stillToBuy - extras - lunchesToBuy), meatScale: st.meatScale,
    left: round2(target - projected), leftIfPlanned: round2(target - ifPlanned), baseline,
    // Compared with a whole $1,000 month, so it counts the not-yet-planned nights at the rotation's
    // average; comparing a half-planned month against a full one would overstate the savings.
    savings: round2(baseline - ifPlanned),
    byStore: { sams: list.stores.sams.subtotal, jewel: list.stores.jewel.subtotal },
    pricesUpdated: db.pricesUpdated,
    label: `${shortDate(today)} – ${shortDate(end)}`,
    // SPEC §21: trips against the goal, the year at this rate, and what was thrown out.
    trips: tripGoal(state, today),
    pace: yearPace(state, today, ifPlanned),
    wasted: wasteSummary(state, today),
  };
}
