// Pantry sections and "use it first" (SPEC §13): every item belongs to a place (fridge, freezer,
// pantry, counter) and a kind (meat, drinks, canned goods…), and perishables get an estimated
// use-by from when they came into the house. Estimates only: the package date always wins.
// Pure: no DOM, no clock (today is passed in).

import { itemMeta } from './shopping.js';
import { addDays, diffDays } from './util.js';

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

/** The day an item came into the house: `since` when known, else the last time it was updated. */
export function sinceOf(p) {
  const s = String(p?.since || p?.at || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/**
 * Perishables to use first: estimated use-by within `soon` days (two weeks for the freezer).
 * → [{ id, name, place, useBy, daysLeft }], soonest first.
 */
export function useSoon(db, state, today, { soon = 2, freezerSoon = 14 } = {}) {
  const out = [];
  for (const [id, p] of Object.entries(state?.pantry || {})) {
    if (!p || p.low || !(typeof p.qty === 'number' ? p.qty > 0 : p.stocked)) continue;
    const days = keepsDays(db, state, id);
    const since = sinceOf(p);
    if (days == null || !since) continue;
    const useBy = addDays(since, days);
    const left = diffDays(useBy, today);
    const place = placeOf(db, state, id);
    if (left > (place === 'freezer' ? freezerSoon : soon)) continue;
    out.push({ id, name: itemMeta(db, state, id).name, place, useBy, daysLeft: left });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft || a.name.localeCompare(b.name));
}
