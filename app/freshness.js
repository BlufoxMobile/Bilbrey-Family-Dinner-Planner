// Pantry sections and "use it first" (SPEC §13): every item belongs to a place (fridge, freezer,
// pantry, counter) and a kind (meat, drinks, canned goods…), and perishables get an estimated
// use-by from when they came into the house. Estimates only: the package date always wins.
// Pure: no DOM, no clock (today is passed in).

import { itemMeta } from './shopping.js';
import { addDays, diffDays } from './util.js';
import { tossCounts } from './waste.js';

export const PLACES = [
  { id: 'fridge', label: 'In the fridge' },
  { id: 'freezer', label: 'In the freezer' },
  { id: 'pantry', label: 'In the pantry' },
  { id: 'counter', label: 'On the counter' },
];

export const KINDS = [
  { id: 'meat', label: 'Meat & protein' },
  { id: 'dairy', label: 'Dairy & eggs' },
  { id: 'produce', label: 'Fruits & vegetables' },
  { id: 'meals', label: 'Frozen meals & sides' },
  { id: 'bread', label: 'Bread & bakery' },
  { id: 'drinks', label: 'Drinks' },
  { id: 'canned', label: 'Canned & jarred goods' },
  { id: 'grains', label: 'Pasta, rice & grains' },
  { id: 'sauces', label: 'Sauces & condiments' },
  { id: 'spices', label: 'Spices & baking' },
  { id: 'snacks', label: 'Snacks & sweets' },
];

const AISLE_KIND = {
  Meat: 'meat', 'Dairy & Eggs': 'dairy', Produce: 'produce', Frozen: 'meals', Bakery: 'bread',
  'Canned & Jarred': 'canned', 'Pasta & Grains': 'grains', 'Condiments & Sauces': 'sauces',
  'Spices & Baking': 'spices', 'Snacks & Extras': 'snacks',
};
const DRINK_RE = /\b(juice|drinks?|soda|water|tea|coffee|bodyarmor|capri ?sun|yoo-?hoo|lemonade|gatorade|sparkling|chamomile)\b/i;
const SOUP_RE = /\b(soup|chili)\b/i;

/** Which kind of food an item is, for the pantry's sections. */
export function kindOfItem(db, state, id) {
  const m = itemMeta(db, state, id);
  if (DRINK_RE.test(m.name) && m.aisle !== 'Dairy & Eggs') return 'drinks';
  if (m.custom && SOUP_RE.test(m.name)) return 'canned';
  if (m.aisle === 'Meat' || db.ingredients[id]?.meat) return 'meat';
  return AISLE_KIND[m.aisle] || 'snacks';
}

/** Where an item is kept (the catalog's storage, or the shelf item's own). */
export function placeOf(db, state, id) {
  const own = state?.pantry?.[id]?.place; // the family moved it ("we keep the ranch in the fridge")
  if (PLACES.some((p) => p.id === own)) return own;
  const s = itemMeta(db, state, id).storage;
  return PLACES.some((p) => p.id === s) ? s : 'pantry';
}

/**
 * Typical days an item keeps once it's in the house (opened or not), by place and kind. null =
 * it keeps for months (shelf goods, spices) and isn't tracked.
 */
export function keepsDays(db, state, id) {
  const m = itemMeta(db, state, id);
  const ing = db.ingredients[id] || {};
  const place = placeOf(db, state, id);
  const kind = kindOfItem(db, state, id);
  const n = m.name.toLowerCase();
  // Leftovers the family saved after a dinner (SPEC §21.3): four days cold, three months frozen.
  if (isLeftover(m.name)) return place === 'freezer' ? 90 : place === 'fridge' ? 4 : null;
  if (place === 'freezer') return kind === 'meat' ? 120 : 180;
  if (place === 'fridge') {
    if (kind === 'meat') {
      if (/sausage|kielbasa|hot dog|frank/.test(n)) return 10; // sealed, fully cooked: about a week once opened
      if (/deli|boar|sliced at|lunch meat|salami|ham\b|turkey breast|roast beef/.test(n)) return 5;
      if (ing.cooked || /cooked|pulled|rotisserie|grilled chicken|bacon/.test(n)) return /bacon/.test(n) ? 30 : 4;
      return 2;
    }
    if (kind === 'produce') {
      if (/salad|bowl|spinach|spring mix|lettuce|romaine|cilantro|berries/.test(n)) return 5;
      if (/carrot|cabbage|slaw|apple|orange|lemon|lime|clementine/.test(n)) return 21;
      return 7;
    }
    if (kind === 'dairy') {
      if (/milk/.test(n)) return 7;
      if (/yogurt/.test(n)) return 14;
      if (/egg/.test(n)) return 30;
      if (/butter/.test(n)) return 60;
      return 21; // cheese
    }
    if (kind === 'bread') return 10;
    return null; // sauces, drinks, jars keep for weeks
  }
  if (place === 'counter') {
    if (/banana/.test(n)) return 5;
    if (/tomato|avocado/.test(n)) return 5;
    if (kind === 'bread') return 6;
    if (kind === 'produce') return 10;
    return null;
  }
  return null;
}

/** A saved plate of leftovers on the shelf ("Leftover chicken fajitas"). */
export const isLeftover = (name) => /^leftovers?\b/i.test(String(name || ''));

/**
 * The day an item came into the house, when the family or a receipt said so (`since`). The last
 * time the amount was edited (`at`) is not that day: cooking from a bag would make September's
 * chicken look new. No `since` means the date isn't known (SPEC §21.3): the pantry asks.
 */
export function sinceOf(p) {
  const s = String(p?.since || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** Is there some of it? (An amount, or a stocked item with no amount.) */
const onShelf = (p) => !!p && !p.low && (typeof p.qty === 'number' ? p.qty > 0 : !!p.stocked);

export const isMeatItem = (db, state, id) => !!db.ingredients[id]?.meat || itemMeta(db, state, id).aisle === 'Meat';

/** Anything in the freezer this long counts as "use soon" (Jeff threw out freezer-burnt steak and corn). */
export const FREEZER_OLD_DAYS = 60;

/** "About when did this go in?" (SPEC §21.3): the quick answers, and the day each stands for. */
export const ABOUT_WHEN = [
  { id: 'week', label: 'This week', days: 3 },
  { id: 'month', label: 'This month', days: 20 },
  { id: 'older', label: 'Older', days: 90 },
];
export function aboutDate(today, about) {
  const a = ABOUT_WHEN.find((x) => x.id === about);
  return a ? addDays(today, -a.days) : null;
}

/**
 * Perishables with no came-home date (older scans): they can't get a use-by until someone says
 * about when they went in. → [{ id, name, place, meat }], freezer meat first.
 */
export function undated(db, state) {
  const out = [];
  for (const [id, p] of Object.entries(state?.pantry || {})) {
    if (!onShelf(p) || sinceOf(p) || keepsDays(db, state, id) == null) continue;
    out.push({ id, name: itemMeta(db, state, id).name, place: placeOf(db, state, id), meat: isMeatItem(db, state, id) });
  }
  const rank = (x) => (x.place === 'freezer' ? 0 : 1) + (x.meat ? 0 : 0.5);
  return out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/**
 * How much it matters to eat an on-hand item by the night of `date`: 0 (it keeps) and up.
 *  - Fridge and counter food by its estimated use-by: past it by that night 6 and more (the strong
 *    one: use it now), due that night 4, within two days 3 to 2, within a week 1.
 *  - Freezer food by age: 60+ days in the freezer is "use soon" (2, plus a point a month), younger
 *    food a fraction of that, so the oldest always goes first; past its freezer use-by adds 4.
 *  - No came-home date: meat counts as old (3: nobody remembers when it went in, which is how the
 *    steak got freezer-burnt); other perishables get a small nudge (½) until someone dates them.
 *  - Food the family has thrown out before (the waste log) gets half again for each time, and at
 *    least 1.5 while it's a perishable on the shelf: it gets planned sooner.
 * Shelf goods that keep for months score 0.
 */
export function urgency(db, state, id, date) {
  const p = state?.pantry?.[id];
  if (!p || p.low) return 0;
  const days = keepsDays(db, state, id);
  const place = placeOf(db, state, id);
  const since = sinceOf(p);
  let u;
  if (!since) {
    if (days == null) return 0;
    u = isMeatItem(db, state, id) ? 3 : 0.5;
  } else if (place === 'freezer') {
    const age = Math.max(0, diffDays(date, since));
    u = age >= FREEZER_OLD_DAYS ? 2 + (age - FREEZER_OLD_DAYS) / 30 : age / FREEZER_OLD_DAYS;
    if (days != null && addDays(since, days) < date) u += 4;
  } else {
    if (days == null) return 0;
    const left = diffDays(addDays(since, days), date);
    if (left < 0) u = 6 + Math.min(2, -left / 7);
    else if (left === 0) u = 4;
    else if (left <= 2) u = 4 - left;
    else if (left <= 6) u = 1;
    else u = 0.25;
  }
  const tossed = tossCounts(state, date).get(id) || 0;
  if (tossed) u = Math.max(u, 1.5) * (1 + 0.5 * Math.min(tossed, 4));
  return u;
}

/** How much a meal's ingredients need eating first (meat counts half again: it's the costly waste). */
export function useFirstScore(db, state, items, date) {
  let s = 0;
  for (const id of Object.keys(items || {})) s += urgency(db, state, id, date) * (isMeatItem(db, state, id) ? 1.5 : 1);
  return s;
}

/**
 * Perishables to use first: estimated use-by within `soon` days (two weeks for the freezer).
 * → [{ id, name, place, useBy, daysLeft }], soonest first.
 */
export function useSoon(db, state, today, { soon = 2, freezerSoon = 14 } = {}) {
  const out = [];
  for (const [id, p] of Object.entries(state?.pantry || {})) {
    if (!onShelf(p)) continue;
    const days = keepsDays(db, state, id);
    const since = sinceOf(p);
    if (days == null || !since) continue;
    const useBy = addDays(since, days);
    const left = diffDays(useBy, today);
    const place = placeOf(db, state, id);
    if (left > (place === 'freezer' ? freezerSoon : soon)) continue;
    out.push({ id, name: itemMeta(db, state, id).name, place, useBy, daysLeft: left, since });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft || a.name.localeCompare(b.name));
}

/**
 * The freezer, oldest first (SPEC §21.3): everything in it for 60 days or more, past its keep
 * time, or meat nobody dated. Nothing sits past its date silently.
 * → [{ id, name, qty, unit, since, age, useBy, past, unknown, meat }]
 */
export function freezerWatch(db, state, today) {
  const out = [];
  for (const [id, p] of Object.entries(state?.pantry || {})) {
    if (!onShelf(p) || placeOf(db, state, id) !== 'freezer') continue;
    const m = itemMeta(db, state, id);
    const meat = isMeatItem(db, state, id);
    const since = sinceOf(p);
    const days = keepsDays(db, state, id);
    if (!since) {
      if (meat) out.push({ id, name: m.name, qty: p.qty ?? null, unit: m.unit, since: null, age: null, useBy: null, past: false, unknown: true, meat });
      continue;
    }
    const age = diffDays(today, since);
    const useBy = days != null ? addDays(since, days) : null;
    const past = !!useBy && useBy < today;
    if (age < FREEZER_OLD_DAYS && !past) continue;
    out.push({ id, name: m.name, qty: p.qty ?? null, unit: m.unit, since, age, useBy, past, unknown: false, meat });
  }
  const rank = (x) => (x.past ? 0 : x.unknown ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b) || (b.age ?? 0) - (a.age ?? 0) || a.name.localeCompare(b.name));
}
