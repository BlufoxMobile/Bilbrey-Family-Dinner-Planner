// Receipts (SPEC §9.3–9.4): a scanned or imported receipt becomes state ops — the receipt
// log, the exact product the family buys per store ("My products"), price history, and the
// Budget's receipts list — without ever counting the same receipt twice.
// Pure: no DOM; the clock is only read when `at` isn't passed.
//
// Line money convention (same as POST /api/receipt): `lineTotal` is the line before any
// discount, `discount` is a positive amount taken off it (Sam's Instant Savings, Jewel
// coupons), `qty` is how many packs. What the family paid for one pack is
// (lineTotal − discount) ÷ qty, or unitPrice when there's no line total.

import { set, push, applyOps } from './state.js';
import { round2, isISODate, chicagoDay, SHARED_PROFILE } from './util.js';

export const RECEIPT_STORES = ['sams', 'jewel'];
export const HISTORY_MAX = 12;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v.replace(/[$,]/g, ''))) ? Number(v.replace(/[$,]/g, '')) : null);
const str = (v, max = 120) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const round3 = (n) => Math.round(n * 1000) / 1000;

// ---------------------------------------------------------------- sizes

/** Ounces per weight unit. */
const WEIGHT = { lb: 16, oz: 1, g: 1 / 28.349523125, kg: 35.27396195 };
/** Fluid ounces per volume unit. */
const VOLUME = { floz: 1, cups: 8, pt: 16, qt: 32, gal: 128, l: 33.8140227, ml: 0.0338140227, tbsp: 0.5, tsp: 1 / 6 };
const COUNTISH = new Set(['ct', 'pk', 'ea']);
/** Words a receipt or product name uses for counted things (and the catalog's own count units). */
const COUNT_NOUNS = new Set(['eggs', 'buns', 'slices', 'tortillas', 'pieces', 'cans', 'peppers', 'hearts', 'cucumbers', 'oranges', 'lemons',
  'limes', 'cloves', 'pizzas', 'heads', 'bunches', 'packages', 'jars', 'bottles', 'bags', 'boxes', 'loaves', 'avocados', 'bananas',
  'rolls', 'ears', 'potstickers', 'waffles', 'sticks', 'bars', 'bowls', 'pouches', 'packs', 'trays', 'containers', 'cartons',
  'clementines', 'singles', 'kits', 'wraps', 'snack cups', 'yogurt cups', 'dip cups']);

const ALIASES = {
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb', '#': 'lb',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  floz: 'floz',
  g: 'g', gm: 'g', gr: 'g', gram: 'g', grams: 'g',
  kg: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  gal: 'gal', gallon: 'gal', gallons: 'gal',
  qt: 'qt', quart: 'qt', quarts: 'qt',
  pt: 'pt', pint: 'pt', pints: 'pt',
  l: 'l', lt: 'l', ltr: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml',
  cup: 'cups', cups: 'cups', c: 'cups',
  tbsp: 'tbsp', tsp: 'tsp',
  ct: 'ct', cnt: 'ct', count: 'ct', pc: 'ct', pcs: 'ct', piece: 'ct', pieces: 'ct',
  pk: 'pk', pack: 'pk', packs: 'pk', pkg: 'pk', pkgs: 'pk',
  ea: 'ea', each: 'ea',
};

function canonUnit(u) {
  const w = String(u || '').toLowerCase().replace(/\.$/, '');
  if (ALIASES[w]) return ALIASES[w];
  if (COUNT_NOUNS.has(w)) return w;
  if (COUNT_NOUNS.has(`${w}s`)) return `${w}s`;
  return null;
}
const unitKind = (u) => (WEIGHT[u] ? 'weight' : VOLUME[u] ? 'volume' : u ? 'count' : null);
const catalogUnit = (u) => {
  const w = String(u || '').toLowerCase();
  if (w === 'cup') return 'cups';
  return w;
};

/**
 * "6.5 lb" → { count: 1, each: 6.5, unit: 'lb' }; "2 x 3 lb" → { count: 2, each: 3, unit: 'lb' };
 * "24 pk 16.9 fl oz" → { count: 24, each: 16.9, unit: 'floz' }; "22 oz × 2" → { count: 2, each: 22, unit: 'oz' };
 * "18 ct" → { count: 18, each: null, unit: 'ct' }.
 * null when there's no size in the text.
 */
export function parseSize(text) {
  if (!text) return null;
  const t = String(text).toLowerCase()
    .replace(/fl\.?\s*oz\.?/g, 'floz').replace(/×/g, 'x').replace(/(\d),(\d{3})\b/g, '$1$2')
    .replace(/(\d)\s*-\s*(?=[a-z])/g, '$1 ');
  const pairs = [];
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*([a-z#]+(?: cups)?)/g)) {
    const u = canonUnit(m[2]);
    if (u && Number(m[1]) > 0) pairs.push({ n: Number(m[1]), u });
  }
  const measure = pairs.find((p) => unitKind(p.u) !== 'count');
  const count = pairs.find((p) => unitKind(p.u) === 'count');
  const multi = /(\d+(?:\.\d+)?)\s*(?:x|\/)\s*(\d+(?:\.\d+)?)\s*([a-z#]+)/.exec(t);
  if (multi) {
    const u = canonUnit(multi[3]);
    if (u && unitKind(u) !== 'count') return { count: Number(multi[1]), each: Number(multi[2]), unit: u };
  }
  // The other way round, as the recipe box's own pack labels write it: "22 oz × 2", "4 oz sticks × 6".
  // A count named outright still wins for counted things: "20 oz × 2 (~40 slices)" is 40 slices.
  const rev = /(\d+(?:\.\d+)?)\s*([a-z#]+)(?:\s+[a-z]+)?\s*x\s*(\d+)(?![\d.])(?!\s*(?:floz|oz|lbs?|g|kg|ml|l|qt|gal)\b)/.exec(t);
  if (rev) {
    const u = canonUnit(rev[2]);
    const total = Number(rev[1]) * Number(rev[3]);
    if (u && unitKind(u) !== 'count') return count ? { count: count.n, each: total / count.n, unit: u, countUnit: count.u } : { count: Number(rev[3]), each: Number(rev[1]), unit: u };
  }
  if (measure && count) return { count: count.n, each: measure.n, unit: measure.u, countUnit: count.u };
  if (measure) return { count: 1, each: measure.n, unit: measure.u };
  if (count) return { count: count.n, each: null, unit: count.u };
  return null;
}

/** A parsed size in the catalog's unit for an ingredient, or null when it can't be converted. */
export function convertSize(parsed, toUnit) {
  if (!parsed) return null;
  const to = catalogUnit(toUnit);
  const toKind = WEIGHT[to] ? 'weight' : VOLUME[to] ? 'volume' : 'count';
  const from = parsed.unit;
  const fromKind = unitKind(from);
  const total = (parsed.count || 1) * (parsed.each || 0);
  if (toKind === 'weight') {
    if (fromKind === 'weight' && parsed.each) return round3((total * WEIGHT[from]) / WEIGHT[to]);
    // Liquids sold by the fluid ounce in a catalog that counts ounces: close enough to price by.
    if (from === 'floz' && to === 'oz') return round3(total);
    return null;
  }
  if (toKind === 'volume') {
    if (fromKind === 'volume' && parsed.each) return round3((total * VOLUME[from]) / VOLUME[to]);
    if (from === 'oz' && parsed.each) return round3((total * VOLUME.floz) / VOLUME[to]); // "32 oz" broth means fluid ounces
    return null;
  }
  // Counted things: "8 x 15 oz" cans → 8; "40 ct" tortillas → 40; "12 buns" → 12.
  if (fromKind === 'count') return parsed.count > 0 ? parsed.count : null;
  if (parsed.countUnit || parsed.count > 1) return parsed.count;
  return null;
}

/** Default pack size for an ingredient at a store: the family's product, then the researched pack. */
export function defaultPackSize(db, state, store, id) {
  const mp = state?.myProducts?.[`${store}/${id}`];
  if (Number(mp?.packSize) > 0) return Number(mp.packSize);
  const packs = db?.ingredients?.[id]?.packs?.[store] || db?.ingredients?.[id]?.packs?.[store === 'sams' ? 'jewel' : 'sams'];
  const p = packs?.generic || packs?.name;
  return Number(p?.size) > 0 ? Number(p.size) : null;
}

/** { packSize, how: 'given'|'converted'|'default'|null } for a receipt line matched to `id`. */
export function packSizeFor(db, state, store, id, line) {
  const given = num(line?.packSize);
  if (given > 0) return { packSize: given, how: 'given' };
  const unit = db?.ingredients?.[id]?.unit || state?.custom?.[id]?.unit;
  if (unit) {
    for (const text of [line?.size, line?.product, line?.text]) {
      const c = convertSize(parseSize(text), unit);
      if (c > 0) return { packSize: c, how: 'converted' };
    }
  }
  const d = defaultPackSize(db, state, store, id);
  return d ? { packSize: d, how: 'default' } : { packSize: null, how: null };
}

/** What one pack cost on this line, after discounts. null when the line has no price. */
export function linePaid(line) {
  const qty = num(line?.qty) > 0 ? num(line.qty) : 1;
  const lt = num(line?.lineTotal);
  const up = num(line?.unitPrice);
  const gross = lt != null ? lt : up != null ? up * qty : null;
  if (gross == null) return null;
  const disc = num(line?.discount) > 0 ? num(line.discount) : 0;
  const paid = gross - disc;
  return paid >= 0 ? round2(paid / qty) : null;
}

// ---------------------------------------------------------------- receipts

export function normalizeStore(s) {
  const v = String(s || '').toLowerCase();
  if (v === 'sams' || v.includes("sam's") || v.includes('sams club') || v === 'sam') return 'sams';
  if (v === 'jewel' || v.includes('jewel')) return 'jewel';
  return 'other';
}

/** Cleans a receipt from the scanner, the review screen or an import. */
export function normalizeReceipt(raw, { today = null } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const lines = (Array.isArray(r.lines) ? r.lines : []).filter((l) => l && typeof l === 'object').map((l) => {
    const out = {
      text: str(l.text, 80),
      product: str(l.product || l.name, 120),
      brand: str(l.brand, 60),
      size: str(l.size, 40),
      qty: num(l.qty) > 0 ? num(l.qty) : 1,
      unitPrice: num(l.unitPrice),
      lineTotal: num(l.lineTotal ?? l.total ?? l.price),
      discount: num(l.discount) > 0 ? round2(num(l.discount)) : 0,
      matchId: typeof l.matchId === 'string' && l.matchId ? l.matchId : null,
      packSize: num(l.packSize) > 0 ? num(l.packSize) : null,
      skip: !!l.skip,
      confidence: num(l.confidence),
    };
    if (out.unitPrice != null) out.unitPrice = round2(out.unitPrice);
    if (out.lineTotal != null) out.lineTotal = round2(out.lineTotal);
    if (!out.product) out.product = out.text || 'Item';
    return out;
  });
  const tax = num(r.tax);
  const linesSum = round2(lines.filter((l) => !l.skip).reduce((t, l) => t + (linePaid(l) ?? 0) * l.qty, 0));
  const totalRaw = num(r.total);
  return {
    store: normalizeStore(r.store),
    date: isISODate(r.date) ? r.date : today,
    total: totalRaw > 0 ? round2(totalRaw) : round2(linesSum + (tax > 0 ? tax : 0)),
    subtotal: num(r.subtotal),
    tax: tax != null ? round2(tax) : null,
    savings: num(r.savings) > 0 ? round2(num(r.savings)) : null,
    lines,
    linesSum,
  };
}

const cents = (n) => Math.round(Number(n) * 100);
/** Same store + date + total = the same receipt (two photos of it, or the import seeing it again). */
export function receiptId(r) {
  return `${r.store}-${r.date}-${cents(r.total)}`;
}

export function findDuplicate(state, r) {
  const log = state?.receiptLog || {};
  const id = receiptId(r);
  if (log[id]) return id;
  for (const [k, x] of Object.entries(log)) if (x && x.store === r.store && x.date === r.date && cents(x.total) === cents(r.total)) return k;
  return null;
}

/**
 * Receipt lines are stored compactly (a few months of history is hundreds of lines and the
 * family's state must stay under 1 MB): p product, b brand (when the name doesn't already
 * start with it), s size, q qty (when not 1), t line total, u unit price (only without a
 * total), d discount, m matchId, k pack size in the catalog unit. expandLine() reads both
 * this and the long form.
 */
export function compactLine(l) {
  const o = { p: l.product };
  if (l.brand && !String(l.product || '').toLowerCase().startsWith(l.brand.toLowerCase())) o.b = l.brand;
  if (l.size) o.s = l.size;
  if (l.qty != null && l.qty !== 1) o.q = l.qty;
  if (l.lineTotal != null) o.t = l.lineTotal;
  else if (l.unitPrice != null) o.u = l.unitPrice;
  if (l.discount) o.d = l.discount;
  if (l.matchId) o.m = l.matchId;
  if (l.matchId && Number(l.packSize) > 0) o.k = round3(Number(l.packSize));
  return o;
}

export function expandLine(l) {
  if (!l || typeof l !== 'object') return null;
  const product = l.p ?? l.product ?? l.text ?? 'Item';
  const brand = l.b ?? l.brand ?? '';
  const qty = Number(l.q ?? l.qty) > 0 ? Number(l.q ?? l.qty) : 1;
  const lineTotal = l.t ?? l.lineTotal ?? null;
  const unitPrice = l.u ?? l.unitPrice ?? (lineTotal != null ? round2(lineTotal / qty) : null);
  return {
    product, brand, size: l.s ?? l.size ?? '', qty, unitPrice, lineTotal,
    discount: Number(l.d ?? l.discount) || 0, matchId: l.m ?? l.matchId ?? null, packSize: Number(l.k ?? l.packSize) || null,
  };
}

const validId = (db, state, id) => !!id && (!db || !!db.ingredients?.[id] || !!state?.custom?.[id]);

/**
 * SPEC §9.4: the ops that save one receipt. Returns an array of ops (empty for a duplicate or
 * an empty receipt) carrying `id`, `duplicate`, `matched`, `learned`, `counted`, `store`,
 * `date`, `total` and `error` as extra properties.
 * opts: { by, source: 'scan'|'import', db (to validate matches and convert sizes), at, today }
 */
export function importReceipt(state, receipt, { by = SHARED_PROFILE, source = null, db = null, at = null, today = null } = {}) {
  const now = at || new Date().toISOString();
  const r = normalizeReceipt(receipt, { today: today || chicagoDay(now) }); // the family's day, not the UTC one
  const src = source || (receipt?.source === 'scan' ? 'scan' : 'import');
  const meta = { id: null, duplicate: false, matched: 0, matchedLines: 0, lines: 0, learned: 0, products: [], counted: false, store: r.store, date: r.date, total: r.total, error: null };
  if (!(r.total > 0) || !r.date) return Object.assign([], meta, { error: 'A receipt needs a date and a total.' });
  const id = receiptId(r);
  meta.id = id;
  const dupe = findDuplicate(state, r);
  if (dupe) return Object.assign([], meta, { id: dupe, duplicate: true });

  const ops = [];
  const store = r.store;
  const productStore = RECEIPT_STORES.includes(store);
  const kept = r.lines.filter((l) => !l.skip);
  // Group matched lines by ingredient: two lines of the same thing are one purchase of qty packs.
  const groups = new Map();
  for (const l of kept) {
    if (!validId(db, state, l.matchId)) { l.matchId = null; continue; }
    if (!groups.has(l.matchId)) groups.set(l.matchId, []);
    groups.get(l.matchId).push(l);
    meta.matchedLines++;
  }
  meta.lines = kept.length;
  const packOf = new Map();
  for (const [mid, ls] of groups) {
    const main = [...ls].sort((a, b) => b.qty - a.qty || (b.lineTotal || 0) - (a.lineTotal || 0))[0];
    const same = ls.filter((l) => l.product === main.product);
    const qty = same.reduce((t, l) => t + l.qty, 0);
    const paid = same.reduce((t, l) => t + (linePaid(l) ?? NaN) * l.qty, 0);
    const price = Number.isFinite(paid) && qty > 0 ? round2(paid / qty) : null;
    const { packSize } = packSizeFor(db, state, productStore ? store : 'jewel', mid, main);
    packOf.set(mid, packSize);
    meta.matched++;
    if (!productStore || !(packSize > 0) || price == null) continue;
    const key = `${store}/${mid}`;
    const prev = state?.myProducts?.[key];
    const prevDate = prev?.date || (typeof prev?.at === 'string' ? chicagoDay(prev.at) : '');
    const unit = db?.ingredients?.[mid]?.unit || state?.custom?.[mid]?.unit || prev?.unit || '';
    if (!prev || r.date >= prevDate) {
      const p = { name: main.product, packSize: round3(packSize), unit, price, at: now, by, source: 'receipt', date: r.date, receipt: id };
      if (main.brand) p.brand = main.brand;
      if (main.size) p.size = main.size;
      if (prev?.url && prev.name === main.product) p.url = prev.url;
      ops.push(set(['myProducts', key], p));
      meta.learned++;
      meta.products.push(key);
    }
    const hist = Array.isArray(state?.priceHistory?.[key]) ? state.priceHistory[key].filter((h) => h && h.receipt !== id) : [];
    hist.push({ price, packSize: round3(packSize), date: r.date, receipt: id });
    hist.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    ops.push(set(['priceHistory', key], hist.slice(-HISTORY_MAX)));
  }

  const log = { store, date: r.date, total: r.total, by, at: now, source: src };
  if (r.savings) log.savings = r.savings;
  if (r.tax != null) log.tax = r.tax;
  log.lines = kept.map((l) => compactLine({ ...l, packSize: l.matchId ? packOf.get(l.matchId) : null }));
  ops.unshift(set(['receiptLog', id], log));

  // The Budget's receipts: never count the same trip twice. A scan matches a hand-logged total
  // exactly; an imported receipt's total is food only, so any hand-logged receipt from the same
  // store that day already counts the trip.
  const hand = (Array.isArray(state?.receipts) ? state.receipts : []).filter((x) => x && normalizeStore(x.store) === store && x.date === r.date);
  const logged = src === 'import' ? hand.length > 0 : hand.some((x) => cents(x.amount) === cents(r.total));
  if (!logged) {
    ops.splice(1, 0, push(['receipts'], { id, date: r.date, store, amount: r.total, note: src === 'scan' ? 'Scanned receipt' : 'Imported from purchase history', by, receiptId: id }));
    meta.counted = true;
  }
  return Object.assign(ops, meta);
}

/**
 * Many receipts at once (the purchase-history import): each sees the ones before it, so
 * repeats inside the batch are caught, and later writes to the same path replace earlier ones.
 * → { ops, results: [{ id, duplicate, matched, learned, counted, store, date, total, error }], state }
 */
export function importReceipts(state, list, opts = {}) {
  let s = state || {};
  const all = [];
  const results = [];
  for (const r of Array.isArray(list) ? list : [list]) {
    const o = importReceipt(s, r, opts);
    results.push({ id: o.id, duplicate: o.duplicate, lines: o.lines, matched: o.matchedLines, ingredients: o.matched, learned: o.learned, products: o.products, counted: o.counted, store: o.store, date: o.date, total: o.total, error: o.error });
    if (o.length) { s = applyOps(s, o); all.push(...o); }
  }
  // Keep only the last `set` to any path; pushes keep their order.
  const last = new Map();
  all.forEach((op, i) => { if (op.op === 'set') last.set(JSON.stringify(op.path), i); });
  const ops = all.filter((op, i) => op.op !== 'set' || last.get(JSON.stringify(op.path)) === i);
  return { ops, results, state: s };
}

/** Ops that delete a saved receipt: its log entry, its Budget line, and what it taught. */
export function deleteReceiptOps(state, id) {
  const ops = [];
  if (state?.receiptLog?.[id]) ops.push({ op: 'del', path: ['receiptLog', id] });
  const list = Array.isArray(state?.receipts) ? state.receipts : [];
  if (list.some((x) => x?.receiptId === id || x?.id === id)) ops.push(set(['receipts'], list.filter((x) => x?.receiptId !== id && x?.id !== id)));
  for (const [key, h] of Object.entries(state?.priceHistory || {})) {
    if (Array.isArray(h) && h.some((x) => x?.receipt === id)) ops.push(set(['priceHistory', key], h.filter((x) => x?.receipt !== id)));
  }
  for (const [key, p] of Object.entries(state?.myProducts || {})) {
    if (p?.receipt !== id) continue;
    // Fall back to the newest price still on record for that product, else forget it.
    const h = (state.priceHistory?.[key] || []).filter((x) => x?.receipt !== id);
    const prev = h[h.length - 1];
    const prevLog = prev ? state.receiptLog?.[prev.receipt] : null;
    const line = (prevLog?.lines || []).map(expandLine).find((l) => l?.matchId === key.split('/')[1]);
    if (prev && line) ops.push(set(['myProducts', key], { ...p, name: line.product, brand: line.brand || undefined, size: line.size || undefined, price: prev.price, packSize: prev.packSize, date: prev.date, receipt: prev.receipt }));
    else ops.push({ op: 'del', path: ['myProducts', key] });
  }
  return ops.map((op) => (op.op === 'set' && op.value && typeof op.value === 'object' && !Array.isArray(op.value) ? { ...op, value: JSON.parse(JSON.stringify(op.value)) } : op));
}

/** Saved receipts, newest first: [{ id, ...log }]. */
export function receiptList(state) {
  return Object.entries(state?.receiptLog || {})
    .filter(([, r]) => r && typeof r === 'object' && typeof r.date === 'string')
    .map(([id, r]) => ({ id, ...r, lines: (Array.isArray(r.lines) ? r.lines : []).map(expandLine).filter(Boolean) }))
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.at || '').localeCompare(String(a.at || '')));
}

// ---------------------------------------------------------------- matching

const STOP = new Set(['the', 'and', 'with', 'for', 'of', 'a', 'an', 'mm', 'members', 'mark', 'signature', 'select', 'select', 'ct', 'oz', 'lb', 'lbs', 'pk', 'fl', 'each', 'ea', 'value', 'pack', 'count', 'fresh', 'original', 'family', 'size']);
const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w) && !/^\d/.test(w));
const stem = (w) => w.replace(/(ies)$/, 'y').replace(/(es|s)$/, '');

/**
 * Best catalog matches for a receipt line, by shared words with the ingredient's name and
 * aliases (the scanner usually sends its own matchId; this backs it up in the review screen).
 * → [{ id, name, score }] best first.
 */
export function suggestMatches(db, state, line, limit = 5) {
  const text = [line?.product, line?.text, line?.brand].filter(Boolean).join(' ');
  const ws = new Set(words(text).map(stem));
  if (!ws.size) return [];
  const out = [];
  const consider = (id, name, aliases) => {
    let best = 0;
    for (const a of [name, ...(aliases || [])]) {
      const aw = words(a).map(stem);
      if (!aw.length) continue;
      const hit = aw.filter((w) => ws.has(w)).length;
      if (!hit) continue;
      const score = hit / aw.length + (hit === aw.length ? 0.5 : 0) + hit * 0.1;
      if (score > best) best = score;
    }
    if (best > 0) out.push({ id, name, score: best });
  };
  for (const ing of Object.values(db?.ingredients || {})) consider(ing.id, ing.name, ing.aliases);
  for (const [id, c] of Object.entries(state?.custom || {})) consider(id, c?.name || id, []);
  return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
}

// ---------------------------------------------------------------- v2.5: receipts → pantry

/** How recent a receipt still is when its groceries are likely all still in the house. */
export const PANTRY_SYNC_DAYS = 14;

/**
 * What one saved receipt adds to the pantry: each line matched to a grocery adds its pack size ×
 * quantity (a staple is just marked stocked). → [{ id, add, staple, name }]
 */
export function receiptPantryAdds(db, state, log) {
  const adds = new Map();
  for (const raw of log?.lines || []) {
    const l = expandLine(raw);
    if (!l?.matchId || !validId(db, state, l.matchId)) continue;
    const staple = (db?.ingredients?.[l.matchId]?.kind || state?.custom?.[l.matchId]?.kind) === 'staple';
    const size = Number(l.packSize) > 0 ? Number(l.packSize) : null;
    if (!staple && !size) continue;
    const prev = adds.get(l.matchId) || { id: l.matchId, add: 0, staple, name: db?.ingredients?.[l.matchId]?.name || state?.custom?.[l.matchId]?.name || l.product };
    if (!staple) prev.add = round3(prev.add + size * (l.qty || 1));
    adds.set(l.matchId, prev);
  }
  return [...adds.values()];
}

/** The ops that put a saved receipt's groceries in the pantry, once (the log remembers). */
export function receiptPantryOps(db, state, receiptId, { who = SHARED_PROFILE, at = null } = {}) {
  const log = state?.receiptLog?.[receiptId];
  if (!log || log.pantry) return [];
  const now = at || new Date().toISOString();
  const ops = [];
  for (const a of receiptPantryAdds(db, state, log)) {
    const prev = state?.pantry?.[a.id] || {};
    const since = /^\d{4}-\d{2}-\d{2}$/.test(String(log.date || '')) ? log.date : chicagoDay(now);
    const keep = { ...(prev.place ? { place: prev.place } : {}) };
    if (a.staple) ops.push(set(['pantry', a.id], { qty: null, stocked: true, since, ...keep, by: who, at: now }));
    else {
      const base = typeof prev.qty === 'number' && !prev.low ? prev.qty : 0;
      ops.push(set(['pantry', a.id], { ...keep, ...(prev.label ? { label: prev.label } : {}), qty: round2(base + a.add), stocked: false, since, bought: { qty: a.add, on: since }, by: who, at: now }));
    }
  }
  ops.push(set(['receiptLog', receiptId, 'pantry'], now));
  return ops;
}

/** Saved receipts from the last two weeks whose groceries aren't in the pantry yet. */
export function unsyncedReceipts(db, state, today) {
  const out = [];
  for (const [id, log] of Object.entries(state?.receiptLog || {})) {
    if (!log || log.pantry || !isISODate(log.date) || !today) continue;
    const days = (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${log.date}T12:00:00Z`)) / 86400000;
    if (days < 0 || days > PANTRY_SYNC_DAYS) continue;
    const adds = receiptPantryAdds(db, state, log);
    if (adds.length) out.push({ id, store: log.store, date: log.date, total: log.total, adds });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
