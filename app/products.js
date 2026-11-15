// "My products" (SPEC §9.5–9.6): the exact product the family buys for each ingredient at
// each store — learned from receipts, picked from data/products.json, or typed in — plus
// the one-tap "Find it" search on the store's site. Pure; no DOM.

import { myProduct } from './planner.js';
import { receiptList } from './receipts.js';

export const SEARCH_FALLBACK = {
  sams: 'https://www.samsclub.com/s/{q}',
  jewel: 'https://www.jewelosco.com/shop/search-results.html?q={q}',
};

/** "Member's Mark Boneless Skinless Chicken Breast, 6.5 lb" */
export function productLabel(p) {
  if (!p?.name) return '';
  const size = p.size && !p.name.toLowerCase().includes(String(p.size).toLowerCase()) ? `, ${p.size}` : '';
  return `${p.name}${size}`;
}

/**
 * A researched pack label as a product name: no notes in (nested) parentheses, no second
 * sentence, nothing after "; " or " — " ("…, 24 oz; Vienna spears also bought").
 */
export function cleanPackLabel(label) {
  let s = String(label || '');
  for (let was = null; was !== s;) { was = s; s = s.replace(/\s*\([^()]*\)/g, '').replace(/\s*\[[^[\]]*\]/g, ''); }
  return s.replace(/[()[\]]/g, '').split(/\.\s|;|\s[—–]\s/)[0].replace(/\s+/g, ' ').replace(/[.;,\s]+$/, '').trim();
}

/** A pack label with the catalog's brand in front when the label doesn't already name it. */
export function brandedLabel(label, brand) {
  if (!brand) return label || '';
  if (!label) return brand;
  const first = brand.toLowerCase().replace(/[()]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
  return first.some((w) => label.toLowerCase().includes(w)) ? label : `${brand} · ${label}`;
}

/**
 * The product shown for a list item at a store — the one product packFor resolved: the family's
 * own, else their usual (catalog `usual`, with its brand in front), else the researched option or
 * the catalog's pack. `usual` is true only for the pack the family actually buys there.
 */
export function shownProduct(state, store, id, pack, db = null) {
  const mine = myProduct(state, store, id);
  if (mine) return { ...mine, chosen: true, label: productLabel(mine) };
  const usual = pack?.kind === 'usual' && !!db?.ingredients?.[id]?.brand;
  const brand = usual ? db.ingredients[id].brand : (pack?.brandName || '');
  const name = cleanPackLabel(pack?.label);
  const label = usual ? brandedLabel(name, brand) : name;
  return label ? { name: name || label, brand, chosen: false, usual, label, url: pack?.url || null } : null;
}

/** Words to search a store's site for: brand + product name, without sizes or notes. */
export function searchQuery(text) {
  const t = cleanPackLabel(text)
    .replace(/[~≈]?\s*\d+(?:\.\d+)?\s*(?:-?\s*)(?:fl\.?\s*oz|oz|lb|lbs|ct|count|pk|pack|g|kg|ml|l|gal|qt)\b\.?/gi, ' ')
    .replace(/\b\d+\s*(?:x|×)\s*/gi, ' ')
    .replace(/[^A-Za-z0-9'&\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.split(' ').slice(0, 8).join(' ');
}

/** The store's search page for a product: stores.json `search` template ({q} or {query}), else the known URL. */
export function searchUrl(db, store, text) {
  const q = searchQuery(text);
  const tpl = db?.stores?.[store]?.searchTemplate || SEARCH_FALLBACK[store] || SEARCH_FALLBACK.jewel;
  const enc = store === 'sams' ? q.split(' ').map(encodeURIComponent).join('+') : encodeURIComponent(q);
  return tpl.replace(/\{q\}|\{query\}/g, enc);
}

/** Where "Find it" goes: the product's own page when the family saved one, else the store search. */
export function findItUrl(db, store, product, fallbackName) {
  if (product?.url && /^https:\/\//.test(product.url)) return product.url;
  return searchUrl(db, store, product?.name || fallbackName || '');
}

/** Products the family has actually bought for this ingredient at this store, newest first. */
export function learnedProducts(state, store, id) {
  const seen = new Map();
  for (const r of receiptList(state)) {
    if (r.store !== store) continue;
    for (const l of r.lines) {
      if (l.matchId !== id || !l.product || seen.has(l.product)) continue;
      const qty = l.qty;
      const gross = l.lineTotal != null ? Number(l.lineTotal) : Number(l.unitPrice) * qty;
      const price = Number.isFinite(gross) ? Math.round(((gross - (Number(l.discount) || 0)) / qty) * 100) / 100 : null;
      seen.set(l.product, { name: l.product, brand: l.brand || '', size: l.size || '', packSize: Number(l.packSize) || null, price, date: r.date, receipt: r.id, source: 'receipt' });
    }
  }
  return [...seen.values()];
}

/** data/products.json options for this ingredient at this store. */
export function researchedProducts(db, store, id) {
  return db?.products?.byId?.[id]?.[store] || [];
}

/** Every ingredient that has a chosen product, per store: [{ store, id, product }]. */
export function chosenProducts(state) {
  const out = [];
  for (const [key, p] of Object.entries(state?.myProducts || {})) {
    const [store, id] = key.split('/');
    if (!store || !id || !p?.name) continue;
    out.push({ store, id, product: p });
  }
  return out;
}

/** "paid $17.94 · Nov 12" style facts about where an item's price came from. */
export function priceSource(pack) {
  if (!pack) return { kind: 'none' };
  if (pack.source === 'family') return { kind: 'family', by: pack.by };
  if (pack.source === 'paid') return { kind: 'paid', date: pack.date };
  if (pack.source === 'typed') return { kind: 'typed' };
  if (pack.source === 'product') return { kind: 'est' };
  if (pack.confidence === 'paid') return { kind: 'paid', date: null }; // prices.json: read off the family's receipts
  return { kind: pack.confidence === 'listed' ? 'listed' : 'est' };
}
