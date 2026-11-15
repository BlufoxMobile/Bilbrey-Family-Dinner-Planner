// Pure shopping-list and budget math. Every number traces back to:
// recipe quantities × planned nights − pantry, rounded up to real pack sizes,
// priced from the family's corrections → data/prices.json → data/catalog.json.

import { AISLES } from './config.js';
import { datesBetween, endOfMonth, fmtQty, round2, startOfMonth, shortDate, rangeLabel } from './util.js';
import { settingsOf } from './state.js';
import {
  brandFor, canBuyAt, dinnerById, itemsForNight, kindOf, packFor, storeFor,
} from './planner.js';

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

export function itemMeta(db, state, id) {
  const ing = db.ingredients[id];
  if (ing) return { ...ing, custom: false };
  const c = state?.custom?.[id];
  if (c) return { id, name: c.name || id, unit: c.unit || 'each', aisle: c.aisle || 'Snacks & Extras', storage: c.storage || 'pantry', kind: c.kind === 'staple' ? 'staple' : 'measured', defaultStore: c.store || 'jewel', packs: {}, custom: true, aliases: [] };
  return { id, name: id, unit: 'each', aisle: 'Snacks & Extras', storage: 'pantry', kind: 'measured', defaultStore: 'jewel', packs: {}, custom: true, unknown: true, aliases: [] };
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
  'snack cups', 'yogurt cups', 'rolls', 'ears', 'potstickers', 'waffles', 'sticks', 'bars']);
const WEIGHT_UNITS = new Set(['lb', 'oz', 'g', 'kg']);

export function singular(unit) {
  if (!unit || ['tbsp', 'tsp', 'oz', 'lb', 'g', 'kg', 'ml', 'l'].includes(unit)) return unit || '';
  if (unit === 'loaves') return 'loaf';
  if (unit === 'boxes') return 'box';
  if (unit === 'bunches') return 'bunch';
  if (unit === 'pieces') return 'piece';
  if (unit === 'slices') return 'slice';
  return unit.endsWith('es') && /(ches|shes|xes|ses)$/.test(unit) ? unit.slice(0, -2) : unit.endsWith('s') ? unit.slice(0, -1) : unit;
}

export function unitText(n, unit) {
  return `${fmtQty(n)} ${Math.abs(n - 1) < 1e-9 ? singular(unit) : unit}`.trim();
}

function containerWord(aisle) {
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
  return `${n} × ${containerWord(item.aisle)} (about ${fmtQty(size)} ${unit})`;
}

const aisleIndex = (a) => { const i = AISLES.indexOf(a); return i < 0 ? AISLES.length : i; };

/**
 * The shopping list for a set of dates.
 * opts: { dates, listKey } — listKey keys check-offs in state.checked.
 */
export function buildList(db, state, { dates, listKey = '' } = {}) {
  const st = settingsOf(state);
  const planStore = st.planStore;
  const { needs, uses, nights } = needsFor(db, state, dates);
  const weeks = Math.max(1, Math.round(dates.length / 7));
  const checked = state?.checked?.[listKey] || {};
  const pantry = state?.pantry || {};
  const extras = state?.extras || {};

  const extraPacks = {};
  const freeExtras = [];
  for (const [key, x] of Object.entries(extras)) {
    if (!x) continue;
    const mult = x.every === 'week' ? weeks : 1;
    const qty = (Number(x.qty) > 0 ? Number(x.qty) : 1) * mult;
    if (x.item && (db.ingredients[x.item] || state?.custom?.[x.item])) {
      extraPacks[x.item] = (extraPacks[x.item] || 0) + qty;
    } else {
      const store = x.store === 'sams' ? 'sams' : 'jewel';
      const price = Number(x.price);
      freeExtras.push({
        key, id: key, name: x.name || 'Extra item', unit: x.unit || '', aisle: 'Snacks & Extras', kind: 'extra', freeText: true,
        store, qty, every: x.every || 'trip', pack: null, packs: qty, cost: Number.isFinite(price) && price >= 0 ? round2(price * qty) : null,
        checked: !!checked[key], reasons: ['extra'], uses: [],
      });
    }
  }

  const ids = new Set([...Object.keys(needs), ...Object.keys(extraPacks)]);
  for (const [id, p] of Object.entries(pantry)) if (p?.low) ids.add(id);

  const items = [];
  const covered = [];
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
    const { store, fallback } = listStore(db, state, id, planStore);
    const brand = brandFor(state, id);
    const pack = packFor(db, state, id, store, brand);
    let packs = 0;
    if (pack) {
      packs = Math.ceil(shortfall / pack.size - 1e-9);
      if (low && packs === 0 && !xp) packs = 1;
      packs += xp;
    }
    const bought = pack ? packs * pack.size : 0;
    const leftover = pack ? Math.max(0, bought - shortfall) : 0;
    const reasons = [];
    if (shortfall > 1e-9) reasons.push('dinners');
    if (xp) reasons.push('extra');
    if (low) reasons.push('low');
    items.push({
      key: id, id, name: meta.name, unit: meta.unit, aisle: meta.aisle, storage: meta.storage, kind, custom: meta.custom, unknown: !!meta.unknown,
      need, have, stocked, low, shortfall, extraPacks: xp,
      store, storeFallback: fallback, brand: pack?.brand || brand, brandFallback: !!pack?.brandFallback,
      pack, packs, bought, leftover, cost: pack ? round2(packs * pack.price) : null,
      // The share of the cost the planned dinners actually use (the rest is leftovers for later).
      usedCost: pack ? round2(pack.price * Math.min(packs, shortfall / pack.size)) : null,
      uses: (uses[id] || []).slice().sort((a, b) => a.date.localeCompare(b.date)),
      reasons, checked: !!checked[id],
    });
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

  const leftovers = items
    .filter((i) => i.pack && i.kind !== 'staple' && i.leftover > 1e-6 && i.reasons.includes('dinners'))
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
    freezer.push({
      id, name: meta.name, unit: meta.unit, have: round2(pantryQty), buying: round2(buying), packs: it?.packs || 0, packSize: it?.pack?.size || null,
      store: it?.store || null, label: it?.pack?.label || '', uses: u, covers: coveredUses.length, dinners: u.length,
      leftover: round2(Math.max(0, total - u.reduce((t, x) => t + x.qty, 0))),
    });
  }
  freezer.sort((a, b) => b.dinners - a.dinners || a.name.localeCompare(b.name));

  const total = round2(stores.sams.subtotal + stores.jewel.subtotal);
  const usedByDinners = round2(items.filter((i) => i.reasons.includes('dinners')).reduce((t, i) => t + (i.usedCost || 0), 0));
  const leftoverValue = round2(items.filter((i) => i.reasons.includes('dinners')).reduce((t, i) => t + Math.max(0, (i.cost || 0) - (i.usedCost || 0) - (i.extraPacks && i.pack ? i.extraPacks * i.pack.price : 0)), 0));
  return {
    listKey, dates, nights, items, covered, stores, leftovers, freezer, total,
    usedByDinners, leftoverValue,
    // Everyday extras: free-text lines plus the extra packs added to catalog items.
    extrasCost: round2(items.reduce((t, i) => t + (i.freeText ? (i.cost || 0) : (i.extraPacks && i.pack ? i.extraPacks * i.pack.price : 0)), 0)),
    // What one dinner costs in food it actually uses (pack leftovers excluded).
    perDinner: nights.length ? round2(usedByDinners / nights.length) : 0,
    weeks, planStore, pricesUpdated: db.pricesUpdated,
    unpriced: items.filter((i) => i.cost == null).length,
  };
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
    const label = i.freeText ? `${i.name}${i.qty ? ` — ${unitText(i.qty, i.unit || 'each')}` : ''}` : `${i.name} — ${formatPackQty(i)}`;
    lines.push(label);
  }
  return lines.join('\n');
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
  const projected = round2(spent + stillToBuy);
  const ifPlanned = round2(projected + (list.perDinner || 0) * unplanned);
  const target = st.monthlyTarget;
  return {
    month, start, end, target, receipts, spent, stillToBuy, plannedRemaining, unplanned, away, cooked,
    perDinner: list.perDinner, projected, ifPlanned, extras, dinnersToBuy: round2(stillToBuy - extras), meatScale: st.meatScale,
    left: round2(target - projected), baseline, savings: round2(baseline - projected),
    byStore: { sams: list.stores.sams.subtotal, jewel: list.stores.jewel.subtotal },
    pricesUpdated: db.pricesUpdated,
    label: `${shortDate(today)} – ${shortDate(end)}`,
  };
}
