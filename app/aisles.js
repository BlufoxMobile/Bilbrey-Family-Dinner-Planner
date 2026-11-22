// Where things are in the store, and the two ways to shop the list (docs/spec/28).
// Jeff, 2026-11-22: "this should have two options. One: a list that orders your groceries
// online... and the other is an interactive grocery list with the products we would need from
// sam's or jewell and hopefully a good picture of that product so we know what we are getting. It
// would be even cooler if it showed which aisle it was on".
//
// Aisles come from data/aisles.json (Sam's Club, read off samsclub.com for the Addison club) and
// from the family (state.aisles[store][itemId] = { aisle, by, at }), and the family's entry always
// wins: stores move things. Pure; no DOM.

import { AISLES } from './config.js';

export const LIST_MODES = [
  { id: 'store', label: 'In the store' },
  { id: 'online', label: 'Order online' },
];

/** "m 9" / "Aisle M9" / "aisle 12" → "M9" / "12"; anything else → '' (at most 8 characters). */
export function cleanAisle(text) {
  const t = String(text ?? '').trim().replace(/^aisle\s*/i, '').replace(/[\s#.-]+/g, '').toUpperCase();
  return /^[A-Z]{0,2}\d{1,3}[A-Z]?$/.test(t) ? t : '';
}

/**
 * The aisle for an item at a store → { code, label: 'Aisle M9', source: 'family'|'store', by, near }
 * or null. A family entry set to '' means "we don't know", and hides the store's code too.
 */
export function aisleFor(db, state, store, id) {
  const fam = state?.aisles?.[store]?.[id];
  if (fam && typeof fam === 'object' && 'aisle' in fam) {
    const code = cleanAisle(fam.aisle);
    return code ? { code, label: `Aisle ${code}`, source: 'family', by: fam.by || null, near: false } : null;
  }
  const s = db?.aisles?.stores?.[store]?.items?.[id];
  const code = cleanAisle(s?.aisle);
  return code ? { code, label: `Aisle ${code}`, source: 'store', by: null, near: !!s.near } : null;
}

/**
 * Sort key for an aisle code: zone letters first (Sam's "A1" … "M9"), then the number, so
 * A1 < A2 < A10 < B1; plain numbers (Jewel "7") come in number order.
 */
export function aisleKey(code) {
  const m = /^([A-Z]{0,2})(\d{1,3})([A-Z]?)$/.exec(cleanAisle(code));
  if (!m) return 'ZZZ';
  return `${m[1].padEnd(2, ' ')}${m[2].padStart(3, '0')}${m[3]}`;
}

/** The store's own product page for an item (exact product only), else null. */
export function storeProductUrl(db, store, id) {
  const s = db?.aisles?.stores?.[store]?.items?.[id];
  return s && !s.near && /^https:\/\//.test(s.url || '') ? s.url : null;
}

const sectionIndex = (a) => { const i = AISLES.indexOf(a); return i < 0 ? AISLES.length : i; };

/**
 * The in-store walk for one store's items: one stop per aisle, in aisle order. An item with no
 * aisle yet joins the first aisle that holds its section (bell peppers ride along with the produce
 * aisle), marked as a guess (`guess`: a Set of their keys), so the walk never doubles back; only a
 * section with no known aisle at all comes at the end. → [{ key, label, aisle: code|null, items, guess }]
 * Items keep their order inside a stop (the list's own order: section, then name).
 */
export function shopStops(db, state, store, items) {
  const byAisle = new Map();
  const loose = [];
  for (const it of items) {
    const a = it.freeText ? null : aisleFor(db, state, store, it.id);
    if (!a) { loose.push(it); continue; }
    if (!byAisle.has(a.code)) byAisle.set(a.code, { key: `a:${a.code}`, label: a.label, aisle: a.code, items: [], guess: new Set() });
    byAisle.get(a.code).items.push(it);
  }
  const aisles = [...byAisle.values()].sort((a, b) => aisleKey(a.aisle).localeCompare(aisleKey(b.aisle)));
  const bySection = new Map();
  for (const it of loose) {
    const sec = it.aisle || 'Snacks & Extras';
    const home = aisles.find((g) => g.items.some((x) => x.aisle === sec && !g.guess.has(x.key)));
    if (home) { home.items.push(it); home.guess.add(it.key); continue; }
    if (!bySection.has(sec)) bySection.set(sec, { key: `s:${sec}`, label: sec, aisle: null, items: [], guess: new Set() });
    bySection.get(sec).items.push(it);
  }
  const sections = [...bySection.values()].sort((a, b) => sectionIndex(a.label) - sectionIndex(b.label));
  return [...aisles, ...sections];
}

/** How many of a store's items have an aisle (family or store). */
export function aisleCoverage(db, state, store, items) {
  const real = items.filter((i) => !i.freeText);
  return { known: real.filter((i) => aisleFor(db, state, store, i.id)).length, total: real.length };
}

/** data/aisles.json → { updated, stores: { sams: { name, checked, items: { id: { aisle, product, url, near } } }, jewel } } */
export function normalizeAisles(raw) {
  const stores = {};
  for (const st of ['sams', 'jewel']) {
    const src = raw?.stores?.[st];
    const items = {};
    for (const [id, e] of Object.entries(src?.items || {})) {
      if (!e || typeof e !== 'object') continue;
      const aisle = cleanAisle(e.aisle);
      const url = typeof e.url === 'string' && /^https:\/\//.test(e.url) ? e.url : '';
      if (!aisle && !url) continue;
      items[id] = { aisle, product: typeof e.product === 'string' ? e.product : '', url, near: e.near === true };
    }
    stores[st] = { name: typeof src?.store === 'string' ? src.store : '', checked: typeof src?.checked === 'string' ? src.checked.slice(0, 10) : null, items };
  }
  return { updated: typeof raw?.updated === 'string' ? raw.updated.slice(0, 10) : null, stores };
}
