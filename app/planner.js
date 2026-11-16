// Pure planning logic: periods, rotation, votes, sides, store feasibility and the
// deterministic dinner generator. No DOM, no clock (callers pass dates in).

import {
  addDays, addMonths, dateRange, datesBetween, diffDays, endOfMonth, fmtQty, monIndex, seeded, startOfMonth, startOfWeek, weekday,
} from './util.js';
import { settingsOf } from './state.js';
import { normalizeDinner } from './data.js';
// These three import this file back; every use is inside a function, so the cycle is harmless.
import { leanOn, busyNightsOf, plateLean, leanScore, busyScore, effortOf, isVegSide, HEAVY_MAX_PER_WEEK } from './health.js';
import { urgency, isMeatItem } from './freshness.js';
import { tossCounts } from './waste.js';

export const PERIODS = [
  { id: 'week', label: '1 week', short: '1 wk', days: 7 },
  { id: 'two', label: '2 weeks', short: '2 wks', days: 14 },
  { id: 'three', label: '3 weeks', short: '3 wks', days: 21 },
  { id: 'month', label: 'Month', short: 'Month', days: null },
];

/** The dates of the period that contains `anchor`. */
export function periodRange(anchor, period = 'week', weekStartsOn = 1) {
  if (period === 'month') {
    const start = startOfMonth(anchor);
    const end = endOfMonth(anchor);
    return { start, end, dates: datesBetween(start, end), period };
  }
  const n = PERIODS.find((p) => p.id === period)?.days || 7;
  const start = startOfWeek(anchor, weekStartsOn);
  const dates = dateRange(start, n);
  return { start, end: dates[dates.length - 1], dates, period };
}

/**
 * The date whose period the planner shows by default. Weeks: this week, or next week once
 * only a couple of nights are left (Sunday-night planning), for 1, 2 and 3 weeks alike, so
 * "2 weeks" on a Sunday means the next two weeks, not last week plus this one.
 * Month: this month, or next month in its last few days.
 */
export function defaultAnchor(today, period = 'week', weekStartsOn = 1) {
  if (period === 'month') {
    const r = periodRange(today, 'month', weekStartsOn);
    return diffDays(r.end, today) + 1 < 5 ? shiftPeriod(r.start, 'month', 1) : today;
  }
  const wk = periodRange(today, 'week', weekStartsOn);
  return diffDays(wk.end, today) + 1 < 3 ? addDays(wk.start, 7) : today;
}

export function shiftPeriod(start, period, dir) {
  if (period === 'month') return addMonths(start, dir);
  const n = PERIODS.find((p) => p.id === period)?.days || 7;
  return addDays(start, dir * n);
}

export function listKeyFor(range) {
  return `${range.start}+${range.dates.length}`;
}

// ---------------------------------------------------------------- dinners & rotation

export function dinnerById(db, state, id) {
  if (!id) return null;
  if (db.dinners[id]) return db.dinners[id];
  const c = state?.customDinners?.[id];
  return c ? normalizeDinner({ ...c, id, custom: true }) : null;
}

export function allDinners(db, state) {
  const out = [...db.dinnerList];
  for (const [id, c] of Object.entries(state?.customDinners || {})) {
    if (!db.dinners[id] && c) out.push(normalizeDinner({ ...c, id, custom: true }));
  }
  return out;
}

/** SPEC §9.2: one thumbs-down from anyone drops a dinner (older -1 votes count too, read lazily). */
export function hasDownVote(state, id) {
  const v = state?.votes?.[id];
  return !!v && typeof v === 'object' && Object.values(v).includes(-1);
}
/** Dropped: retired by a parent, or any thumbs-down. */
export function isRetired(state, id) { return !!state?.retired?.[id] || hasDownVote(state, id); }
export const isDropped = isRetired;
export function isPromoted(state, id) { return !!state?.promoted?.[id]; }

/** Who gave a dinner its thumbs-down(s), in family order. */
export function downVoters(state, id) {
  const v = state?.votes?.[id] || {};
  return Object.keys(v).filter((p) => v[p] === -1);
}

const implicitCache = new WeakMap();
/**
 * Thumbs-downs from before one vote dropped a dinner never brought a bench dinner in. Fill
 * those gaps here, deterministically and without writing anything: each such dinner gets the
 * bench dinner that best replaces it. → Map(benchId → droppedId)
 */
export function implicitPromotions(db, state) {
  if (!db || !state || typeof state !== 'object') return new Map();
  let byDb = implicitCache.get(state);
  if (byDb?.db === db) return byDb.map;
  const map = new Map();
  const replaced = new Set(Object.values(state.promoted || {}).map((p) => p?.replaced).filter(Boolean));
  const gaps = allDinners(db, state)
    .filter((d) => hasDownVote(state, d.id) && !state.retired?.[d.id] && !replaced.has(d.id) && (d.rotation === 'core' || isPromoted(state, d.id)))
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const d of gaps) {
    const bench = bestBenchFor(db, state, d.id, { exclude: new Set(map.keys()) });
    if (bench) map.set(bench.id, d.id);
  }
  implicitCache.set(state, { db, map });
  return map;
}

/** Custom dinners count as core unless saved as a one-off (rotation 'bench': a "What can I make?" idea or a dinner planned from a Claude chat, SPEC §15, §17). */
export function inRotation(state, d, db = null) {
  if (!d || isRetired(state, d.id)) return false;
  return d.rotation === 'core' || isPromoted(state, d.id) || (!!db && implicitPromotions(db, state).has(d.id));
}

export function rotationList(db, state) {
  return allDinners(db, state).filter((d) => inRotation(state, d, db));
}

function rawBench(db, state) {
  return allDinners(db, state).filter((d) => d.rotation === 'bench' && !isPromoted(state, d.id) && !isRetired(state, d.id));
}

export function benchList(db, state) {
  const implicit = implicitPromotions(db, state);
  return rawBench(db, state).filter((d) => !implicit.has(d.id));
}

export function voteInfo(state, id) {
  const v = state?.votes?.[id] || {};
  let up = 0;
  let down = 0;
  for (const val of Object.values(v)) { if (val === 1) up++; else if (val === -1) down++; }
  return { up, down, byPerson: v };
}

/** Two thumbs-up (or the recipe box's own tag) make a family favorite. */
export const FAVORITE_UPS = 2;
export function isFavorite(state, d) {
  if (!d || isRetired(state, d.id)) return false; // a dropped dinner isn't anyone's favorite right now
  return voteInfo(state, d.id).up >= FAVORITE_UPS || d.tags.includes('family favorite');
}

// ---------------------------------------------------------------- side votes (§9.2)

export function sideVoteInfo(state, id) {
  const v = state?.sideVotes?.[id] || {};
  let up = 0;
  let down = 0;
  for (const val of Object.values(v)) { if (val === 1) up++; else if (val === -1) down++; }
  return { up, down, byPerson: v };
}

/** A side with any thumbs-down is dropped: never a default or a suggestion. */
export function isSideDropped(state, id) {
  const v = state?.sideVotes?.[id];
  return !!v && typeof v === 'object' && Object.values(v).includes(-1);
}

export function droppedSides(db, state) {
  return db.sideList.filter((s) => isSideDropped(state, s.id));
}

/** Sides the recipe box already serves with dinners of this category (no potstickers with burgers). */
function pairedSides(db, category) {
  const out = new Map();
  for (const x of db.dinnerList) if (x.category === category) for (const s of x.sides) out.set(s, (out.get(s) || 0) + 1);
  return out;
}

/** The dinner categories a side is served with by default. */
function sideCategories(db, sideId) {
  const out = new Set();
  for (const x of db.dinnerList) if (x.sides.includes(sideId)) out.add(x.category);
  return out;
}

export const sideFits = (db, d, alt) => ['vegetable', 'salad', 'fruit'].includes(alt.kind) || pairedSides(db, d?.category).has(alt.id);

/**
 * The side that takes a dropped side's place for a dinner: same kind, not dropped, not already
 * on the plate, one that suits the dinner; sides this kind of dinner already uses first, then
 * thumbs-up, then alphabetical. Deterministic. null when nothing fits.
 */
export function bestSideFor(db, state, d, droppedId, exclude = new Set()) {
  const was = db.sides[droppedId];
  const paired = pairedSides(db, d?.category);
  const ok = (s) => !isSideDropped(state, s.id) && !exclude.has(s.id) && s.id !== droppedId;
  const sameKind = db.sideList.filter((s) => ok(s) && s.kind === was?.kind);
  let pool = sameKind.filter((s) => sideFits(db, d, s));
  let near = null;
  if (!pool.length && was) {
    // Nothing of that kind is ever served with this kind of dinner (burgers only come with fries):
    // the same-kind side served with the most of the same kinds of dinner as the dropped one
    // (fries → potato wedges, not zucchini).
    const cats = sideCategories(db, droppedId);
    near = new Map(sameKind.map((s) => [s.id, [...sideCategories(db, s.id)].filter((c) => cats.has(c)).length]));
    pool = sameKind.filter((s) => near.get(s.id) > 0);
  }
  if (!pool.length) { near = null; pool = db.sideList.filter((s) => ok(s) && ['vegetable', 'salad'].includes(s.kind)); }
  if (!pool.length) return null;
  const score = (s) => (near ? near.get(s.id) : (paired.get(s.id) || 0)) * 2 + sideVoteInfo(state, s.id).up;
  return [...pool].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))[0];
}

export const isBurger = (d) => !!d && (d.tags.includes('burger') || d.category === 'Burgers');
export const isPizza = (d) => !!d && d.tags.includes('pizza');
export const isRice = (d) => !!d && d.tags.includes('rice');
export const isAsian = (d) => !!d && d.category === 'Asian-inspired';
export const isHealthier = (d) => !!d && (d.tags.includes('healthier') || d.tags.includes('salad'));

// ---------------------------------------------------------------- sides

/** "steamed-broccoli" | "item:greenBeans@2" | "custom:custom-rotel@1" */
export function parseSideRef(ref) {
  if (!ref || typeof ref !== 'string' || ref === 'none') return null;
  const m = /^(item|custom):([^@]+)(?:@([\d.]+))?$/.exec(ref);
  if (m) {
    const qty = Number(m[3]);
    return { type: m[1], id: m[2], qty: Number.isFinite(qty) && qty > 0 ? qty : 1 };
  }
  return { type: 'side', id: ref };
}

export function shelfRef(type, id, qty) {
  return `${type}:${id}@${Math.round((Number(qty) || 1) * 100) / 100}`;
}

export function sideSlotsFor(d) {
  return d?.sideSlots || (isBurger(d) ? 1 : 2);
}

/**
 * The sides that will actually be served for a dinner on a night.
 * Precedence per slot: remembered substitution → the night's own sides → the recipe default.
 */
export function effectiveSides(db, state, dinnerId, entry) {
  const d = dinnerById(db, state, dinnerId);
  if (!d) return [];
  const subs = state?.substitutions?.[dinnerId] || {};
  let slots = sideSlotsFor(d);
  for (const k of Object.keys(subs)) { const i = Number(k); if (Number.isInteger(i) && i >= slots && i < 4) slots = i + 1; }
  const out = [];
  for (let i = 0; i < slots; i++) {
    const remembered = subs[String(i)] != null;
    const ref = remembered ? subs[String(i)] : (entry?.sides?.[i] ?? d.sides[i]);
    const parsed = parseSideRef(ref);
    if (!parsed) continue;
    out.push({ slot: i, ref, parsed, remembered, isDefault: ref === d.sides[i], added: i >= sideSlotsFor(d) });
  }
  // A dropped side (any thumbs-down) is swapped for the best same-kind side, on the fly:
  // nothing is written, so restoring the side brings it straight back everywhere.
  if (out.some((s) => s.parsed.type === 'side' && isSideDropped(state, s.parsed.id))) {
    const taken = new Set(out.filter((s) => !(s.parsed.type === 'side' && isSideDropped(state, s.parsed.id))).map((s) => s.parsed.id));
    for (const s of out) {
      if (s.parsed.type !== 'side' || !isSideDropped(state, s.parsed.id)) continue;
      const alt = bestSideFor(db, state, d, s.parsed.id, taken);
      if (!alt) { s.gone = true; continue; } // nothing left that fits: serve it without that side
      taken.add(alt.id);
      s.droppedRef = s.ref;
      s.droppedId = s.parsed.id;
      s.ref = alt.id;
      s.parsed = { type: 'side', id: alt.id };
      s.isDefault = false;
      s.replaced = true;
    }
    return out.filter((s) => !s.gone);
  }
  return out;
}

/** A shelf item's name as a side: drops pack details ("Cut green beans, 14.5 oz cans" → "Cut green beans"). */
export function shelfTitle(name) {
  const t = String(name || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/,.*$/, '').trim();
  return t || String(name || '').trim() || 'Something from the shelf';
}

/** Display info for a side ref. */
export function sideInfo(db, state, parsed) {
  if (!parsed) return null;
  if (parsed.type === 'side') {
    const s = db.sides[parsed.id];
    return s ? { title: s.title, kind: s.kind, minutes: s.minutes, steps: s.steps, items: s.items, equipment: s.equipment, recipe: s }
      : { title: 'A side from the recipe box', kind: 'vegetable', minutes: 0, steps: [], items: {}, equipment: [] };
  }
  const ing = parsed.type === 'item' ? db.ingredients[parsed.id] : state?.custom?.[parsed.id];
  const name = ing?.name || 'Something from the shelf';
  const unit = ing?.unit || '';
  // "Cut green beans, 14.5 oz cans" reads as a shopping label; on a plate it's "Cut green beans".
  const title = shelfTitle(name);
  return {
    title, kind: 'shelf', minutes: 5, equipment: ['microwave'], shelf: true, qty: parsed.qty, unit,
    steps: [`Warm or plate the ${title.toLowerCase()} (${fmtQty(parsed.qty)} ${unit}) and divide among five plates.`.replace(/ \)/, ')')],
    items: { [parsed.id]: parsed.qty },
  };
}

function addItems(into, items, mult = 1) {
  for (const [k, v] of Object.entries(items || {})) into[k] = (into[k] || 0) + v * mult;
  return into;
}

/** "Meat per dinner": scales catalog items marked meat by settings.meatScale (1 or 0.85). */
export function scaleItems(db, state, items) {
  const k = settingsOf(state).meatScale;
  if (k === 1) return { ...(items || {}) };
  const out = {};
  for (const [id, q] of Object.entries(items || {})) out[id] = db.ingredients[id]?.meat ? Math.round(q * k * 100) / 100 : q;
  return out;
}

export const isMeat = (db, id) => !!db.ingredients[id]?.meat;

/** Everything a night's dinner uses: entrée + effective sides, keyed by ingredient/custom id. */
export function itemsForNight(db, state, dinnerId, entry) {
  const d = dinnerById(db, state, dinnerId);
  if (!d) return {};
  const out = addItems({}, d.items);
  for (const s of effectiveSides(db, state, dinnerId, entry)) {
    if (s.parsed.type === 'side') addItems(out, db.sides[s.parsed.id]?.items);
    else out[s.parsed.id] = (out[s.parsed.id] || 0) + s.parsed.qty;
  }
  return scaleItems(db, state, out);
}

/** A night counts as a rice night if the dinner or any of its sides is tagged rice. */
export function nightIsRice(db, state, dinnerId, entry) {
  const d = dinnerById(db, state, dinnerId);
  if (!d) return false;
  if (isRice(d)) return true;
  return effectiveSides(db, state, dinnerId, entry).some((s) => s.parsed.type === 'side' && db.sides[s.parsed.id]?.tags?.includes('rice'));
}

function itemsForSides(db, state, refs) {
  const out = {};
  for (const ref of refs) {
    const p = parseSideRef(ref);
    if (!p) continue;
    if (p.type === 'side') addItems(out, db.sides[p.id]?.items);
    else out[p.id] = (out[p.id] || 0) + p.qty;
  }
  return out;
}

// ---------------------------------------------------------------- pantry & stores

export function kindOf(db, state, id) {
  return db.ingredients[id]?.kind || state?.custom?.[id]?.kind || 'measured';
}

/** Does the pantry already cover `qty` of this item? */
export function pantryCovers(db, state, id, qty) {
  const p = state?.pantry?.[id];
  if (!p || p.low) return false;
  if (kindOf(db, state, id) === 'staple') return !!p.stocked;
  if (p.stocked && p.qty == null) return true;
  return typeof p.qty === 'number' && p.qty >= qty - 1e-9;
}

export function canBuyAt(db, state, id, store) {
  if (state?.availability?.[`${store}/${id}`] === false) return false;
  if (state?.prices?.[`${store}/generic/${id}`] || state?.prices?.[`${store}/name/${id}`]) return true;
  if (state?.deals?.[`${store}/${id}`]?.price != null) return true;
  if (settingsOf(state).organic && db.ingredients[id]?.organic?.[store]) return true;
  const mine = state?.myProducts?.[`${store}/${id}`];
  if (mine && Number(mine.packSize) > 0 && typeof mine.price === 'number' && mine.price >= 0) return true;
  const packs = db.ingredients[id]?.packs?.[store];
  return !!(packs && (packs.generic || packs.name)) || !!firstOption(db, store, id);
}

function itemsFeasible(db, state, items, store) {
  if (store === 'both') return true;
  for (const [id, qty] of Object.entries(items)) {
    if (!pantryCovers(db, state, id, qty) && !canBuyAt(db, state, id, store)) return false;
  }
  return true;
}

/**
 * For single-store planning: returns side refs (keeping defaults where possible)
 * such that dinner + sides can be bought at `store` or come from the pantry; null if impossible.
 */
export function feasibleSides(db, state, d, store, entry) {
  const base = effectiveSides(db, state, d.id, entry);
  if (!itemsFeasible(db, state, d.items, store)) return null;
  const refs = [];
  // A night stores the recipe's own side even when a thumbs-down swaps it on the fly (§9.2).
  for (const s of base) refs[s.slot] = s.droppedRef ?? s.ref;
  if (store === 'both') return refs;
  const used = new Set(base.map((s) => s.ref));
  for (const s of base) {
    if (itemsFeasible(db, state, itemsForSides(db, state, [s.ref]), store)) continue;
    if (s.remembered && !s.replaced) return null; // the family chose this side; don't silently change it
    const want = s.parsed.type === 'side' ? db.sides[s.parsed.id]?.kind : null;
    const alts = [...db.sideList]
      .filter((x) => !used.has(x.id) && !isSideDropped(state, x.id) && itemsFeasible(db, state, x.items, store))
      .sort((a, b) => (b.kind === want) - (a.kind === want) || a.id.localeCompare(b.id));
    if (!alts.length) return null;
    refs[s.slot] = alts[0].id;
    used.add(alts[0].id);
  }
  return refs;
}

/**
 * Lean by default (SPEC §21.2): a two-side dinner with no vegetable or salad on the plate trades
 * one side for the vegetable that suits it best. The bread goes first, then fruit, soup, and the
 * second starch; a dinner whose sides the family has chosen themselves is left alone, and burger
 * and pizza nights keep their sides. The vegetable: one already in the house first, then one this
 * kind of dinner is already served with, then one the family likes.
 * → side refs (the same ones when nothing changes)
 */
const TRADE_ORDER = ['bread', 'fruit', 'soup', 'starch'];
export function withVegetable(db, state, d, refs, store = 'both') {
  if (!d || sideSlotsFor(d) < 2 || isBurger(d) || isPizza(d)) return refs;
  const eff = effectiveSides(db, state, d.id, { sides: refs });
  if (eff.length < 2 || eff.some((s) => s.remembered || isVegSide(db, state, s.parsed))) return refs;
  let pick = null;
  for (const s of eff) {
    if (s.parsed.type !== 'side') continue;
    const rank = TRADE_ORDER.indexOf(db.sides[s.parsed.id]?.kind);
    if (rank < 0) continue;
    if (!pick || rank < pick.rank || (rank === pick.rank && s.slot > pick.s.slot)) pick = { s, rank };
  }
  if (!pick) return refs;
  const used = new Set(eff.map((s) => s.parsed.id));
  const paired = pairedSides(db, d.category);
  const onHand = (x) => Object.entries(x.items).every(([id, q]) => pantryCovers(db, state, id, q));
  const score = (x) => (onHand(x) ? 3 : 0) + Math.min(paired.get(x.id) || 0, 4) / 2 + sideVoteInfo(state, x.id).up;
  const veg = db.sideList
    .filter((x) => ['vegetable', 'salad'].includes(x.kind) && !used.has(x.id) && !isSideDropped(state, x.id) && itemsFeasible(db, state, x.items, store))
    .sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))[0];
  if (!veg) return refs;
  const out = [...refs];
  out[pick.s.slot] = veg.id;
  return out;
}

/** What the generator writes into a night's `sides`: never a remembered substitution (that lives in state.substitutions). */
function storedSides(state, d, refs) {
  const subs = state?.substitutions?.[d.id] || {};
  const n = sideSlotsFor(d);
  const out = [];
  for (let i = 0; i < n; i++) out.push(subs[String(i)] != null ? (d.sides[i] ?? null) : (refs[i] ?? d.sides[i] ?? null));
  return out;
}

/** How much of the rotation one store can cover, and the items most often missing there. */
export function storeCoverage(db, state, store) {
  const rot = rotationList(db, state);
  const missing = {};
  let ok = 0;
  for (const d of rot) {
    if (feasibleSides(db, state, d, store, null)) { ok++; continue; }
    const items = itemsForNight(db, state, d.id, null);
    for (const [id, q] of Object.entries(items)) {
      if (!pantryCovers(db, state, id, q) && !canBuyAt(db, state, id, store)) missing[id] = (missing[id] || 0) + 1;
    }
  }
  const top = Object.entries(missing).sort((a, b) => b[1] - a[1]).map(([id]) => db.ingredients[id]?.name || state?.custom?.[id]?.name).filter(Boolean).slice(0, 4);
  return { ok, total: rot.length, missing: top };
}

export function dinnerFeasibleAt(db, state, dinnerId, store, entry) {
  const d = dinnerById(db, state, dinnerId);
  return !!d && feasibleSides(db, state, d, store, entry) !== null;
}

// ---------------------------------------------------------------- rule helpers

/** Saturdays in the month that get pizza night: 1 → 2nd Sat; 2 → 2nd + 4th; 3 → 1st, 3rd, last; 4 → first four. */
export function pizzaDates(anyDateInMonth, perMonth) {
  const start = startOfMonth(anyDateInMonth);
  const sats = datesBetween(start, endOfMonth(anyDateInMonth)).filter((d) => weekday(d) === 6);
  const n = Math.max(0, Math.min(4, Number(perMonth) || 0));
  if (n === 0) return [];
  if (n === 1) return [sats[1]];
  if (n === 2) return [sats[1], sats[3]];
  if (n === 3) return [sats[0], sats[2], sats[sats.length - 1]];
  return sats.slice(0, 4);
}

export function nightType(date, settings) {
  if (pizzaDates(date, settings.pizzaPerMonth).includes(date)) return 'pizza';
  if (settings.burgerNights.includes(monIndex(date))) return 'burger';
  return 'regular';
}

const eaten = (e) => !!(e && e.dinner && e.status !== 'away');

/** Is a night open for the generator? */
export function isFillable(entry, mode) {
  if (!entry) return true;
  if (entry.status === 'planned' && !entry.dinner) return true;
  if (mode === 'replan' && entry.status === 'planned' && !entry.manual) return true;
  return false;
}

// ---------------------------------------------------------------- pricing helpers used by the generator

export function storeFor(db, state, id, planStore = settingsOf(state).planStore) {
  if (planStore === 'sams' || planStore === 'jewel') return planStore;
  const pref = state?.storeFor?.[id] || db.ingredients[id]?.defaultStore || 'jewel';
  if (canBuyAt(db, state, id, pref)) return pref;
  const other = pref === 'sams' ? 'jewel' : 'sams';
  return canBuyAt(db, state, id, other) ? other : pref;
}

/** The exact product the family buys for an ingredient at a store (SPEC §9.4), or null. */
export function myProduct(state, store, id) {
  const p = state?.myProducts?.[`${store}/${id}`];
  return p && typeof p === 'object' && typeof p.name === 'string' && p.name ? p : null;
}

/** data/products.json's first option at a store that can be priced, or null. */
export function firstOption(db, store, id) {
  return (db?.products?.byId?.[id]?.[store] || []).find((o) => o.packSize > 0 && o.price != null && o.price >= 0) || null;
}

/**
 * The ONE product the family buys for an item at a store, with its pack size and price
 * (Jeff, 2026-11-15: "just use the actual products we buy" — no store-brand / name-brand tiers):
 *   1. what they bought, picked or typed (myProducts) — its paid / typed price;
 *   2. the catalog's `usual` (the pack they buy, read off their receipts) at its store;
 *   3. the first researched option in data/products.json for that store;
 *   4. the catalog / prices.json pack, as a last resort.
 * An older family price correction (prices["store/tier/id"]) still applies when nothing in 1. has a
 * price. state.brands and settings.brand are old data: read by nothing here.
 * → { size, price, source, label, url, confidence, kind: 'mine'|'usual'|'option'|'catalog', product? } or null.
 */
export function packFor(db, state, id, store) {
  if (state?.availability?.[`${store}/${id}`] === false) return null;
  const ing = db.ingredients[id];
  const mine = myProduct(state, store, id);
  const packs = ing?.packs?.[store] || {};
  const withMine = (p) => (p && mine ? { ...p, product: mine } : p);
  // v2.5 organic produce: the store's organic version wins over a conventional usual or receipt
  // product (a receipt product that's already organic stays).
  const org = organicPackFor(db, state, id, store);
  if (org && !(mine && /organic/i.test(String(mine.name)))) return org;
  if (mine && Number(mine.packSize) > 0 && typeof mine.price === 'number' && Number.isFinite(mine.price) && mine.price >= 0) {
    const src = mine.source === 'receipt' ? 'paid' : mine.source === 'typed' ? 'typed' : 'product';
    const base = (ing?.usual?.store === store && packs[ing.usual.tier]) || packs.generic || packs.name;
    return withMine({ size: Number(mine.packSize), price: Number(mine.price), source: src, store, label: mine.name, url: mine.url || base?.url, date: mine.date || null, by: mine.by, kind: 'mine' });
  }
  let base = null;
  let tier = null;
  if (ing?.usual?.store === store && packs[ing.usual.tier]) {
    tier = ing.usual.tier;
    base = { ...packs[tier], store, kind: 'usual' };
  } else {
    const o = firstOption(db, store, id);
    if (o) {
      tier = o.tier === 'name' ? 'name' : 'generic';
      base = { size: o.packSize, price: o.price, source: 'option', store, label: o.size && !o.name.toLowerCase().includes(o.size.toLowerCase()) ? `${o.name}, ${o.size}` : o.name, url: o.url || null, confidence: o.confidence || 'listed', brandName: o.brand || '', kind: 'option' };
    } else if (packs.generic || packs.name) {
      tier = packs.generic ? 'generic' : 'name';
      base = { ...packs[tier], store, kind: 'catalog' };
    }
  }
  const fam = state?.prices?.[`${store}/${tier || 'generic'}/${id}`] || state?.prices?.[`${store}/${tier === 'name' ? 'generic' : 'name'}/${id}`];
  if (fam && Number(fam.size) > 0 && Number(fam.price) >= 0) {
    return withMine({ ...(base || { store, kind: 'catalog' }), size: Number(fam.size), price: Number(fam.price), source: 'family', at: fam.at, by: fam.by });
  }
  return withMine(base);
}

/** The organic pack for produce when the family buys organic, or null. */
export function organicPackFor(db, state, id, store) {
  const ing = db?.ingredients?.[id];
  const o = ing?.organic?.[store];
  if (!o || !settingsOf(state).organic) return null;
  return { ...o, store, kind: 'organic', organic: true };
}

export function unitPrice(db, state, id, planStore) {
  const store = storeFor(db, state, id, planStore);
  const p = packFor(db, state, id, store);
  return p ? p.price / p.size : 0;
}

class Ledger {
  constructor(db, state, planStore, ref = '') {
    this.db = db;
    this.state = state;
    this.planStore = planStore;
    // Food the family has thrown out lately (the waste log): opening a new pack of it costs more.
    this.tossed = tossCounts(state, ref);
    this.rem = {};
    for (const [id, p] of Object.entries(state?.pantry || {})) {
      if (typeof p?.qty === 'number' && p.qty > 0 && !p.low) this.rem[id] = p.qty;
    }
  }

  /**
   * Money view of one more dinner: `cost` = food it uses that isn't already on hand,
   * `reuse` = value of leftovers/pantry it uses up, `waste` = value of new pack it would leave unused.
   */
  evaluate(items) {
    let cost = 0;
    let reuse = 0;
    let waste = 0;
    let buys = 0; // how many different things it sends to the store
    for (const [id, need] of Object.entries(items)) {
      const kind = kindOf(this.db, this.state, id);
      const up = unitPrice(this.db, this.state, id, this.planStore);
      if (kind === 'staple') {
        if (!pantryCovers(this.db, this.state, id, need)) { cost += need * up; buys++; }
        continue;
      }
      const have = this.rem[id] || 0;
      const fromHave = Math.min(have, need);
      reuse += fromHave * up;
      const short = need - fromHave;
      if (short > 1e-9) {
        cost += short * up;
        buys++;
        const store = storeFor(this.db, this.state, id, this.planStore);
        const p = packFor(this.db, this.state, id, store);
        if (p) {
          // Frozen and shelf-stable leftovers keep for next week; fresh ones are the real waste.
          const storage = this.db.ingredients[id]?.storage || this.state?.custom?.[id]?.storage || 'pantry';
          const perish = ({ freezer: 0.2, pantry: 0.15, fridge: 0.7, counter: 0.8 }[storage] ?? 0.5) * (1 + (this.tossed.get(id) || 0));
          const packs = Math.ceil(short / p.size - 1e-9);
          waste += (packs * p.size - short) * up * perish;
        }
      }
    }
    return { cost, reuse, waste, buys };
  }

  consume(items) {
    for (const [id, need] of Object.entries(items)) {
      if (kindOf(this.db, this.state, id) === 'staple') continue;
      const have = this.rem[id] || 0;
      if (have >= need - 1e-9) { this.rem[id] = have - need; continue; }
      const store = storeFor(this.db, this.state, id, this.planStore);
      const p = packFor(this.db, this.state, id, store);
      if (!p) { this.rem[id] = 0; continue; }
      const short = need - have;
      const packs = Math.ceil(short / p.size - 1e-9);
      this.rem[id] = have + packs * p.size - need;
    }
  }
}

// ---------------------------------------------------------------- the generator

/**
 * The generator's rule levels, strictest first; it uses the first level that leaves a candidate.
 * The first three keep the night's type (burger, pizza), the rice limit and the Asian cap.
 */
const LEVELS = [
  { type: true, repeat: 14, rice: true, cap: true, force: true, heavy: true },
  { type: true, repeat: 14, rice: true, cap: true, force: false, heavy: true },
  { type: true, repeat: 7, rice: true, cap: true, force: false, heavy: true },
  { type: true, repeat: 7, rice: true, cap: false, force: false, heavy: true },
  { type: false, repeat: 7, rice: true, cap: false, force: false, heavy: true },
  { type: false, repeat: 2, rice: false, cap: false, force: false, heavy: false },
];

/**
 * Fills (mode "fill") or re-plans (mode "replan") the given dates.
 * Keeps away/cooked nights and anything the family set by hand. Never touches past nights.
 * Deterministic: the same state + dates + seedKey always produce the same plan.
 * Returns { entries: { date: entry }, unfilled: [date] }.
 *
 * Smarter planning (SPEC §21), read from the family's state:
 *   lean (settings.lean, on by default): lean plates score higher, fried and heavy ones lower, at
 *     most two heavy dinners a week, and a two-side dinner with no vegetable gets one;
 *   busy nights (settings.busyNights): the slow cooker or a 30-minute dinner;
 *   use it first: food on the shelf that's old or near its date pulls its dinners forward, and
 *     food the family has thrown out before pulls harder.
 *
 * Optional hooks (SPEC §16, plan ahead; leaving them out changes nothing):
 *   accept(date, dinner, items) → false keeps a candidate out (e.g. "the pantry doesn't cover it")
 *   bonus(date, dinner, items, { cost, reuse, waste, buys }) → added to its score
 *   onPlace(date, entry, items) after each night is placed
 *   strict: only the levels that keep night types, the rice limit and the Asian cap (a night with
 *           no such candidate is left open rather than bending a rule)
 *   reserve: count every kept night's food first, so an open night never "uses" food a later
 *            kept night needs
 */
export function generatePlan({ db, state, dates, mode = 'fill', by = 'Family', at = '', seedKey, today, accept = null, bonus = null, onPlace = null, strict = false, reserve = false }) {
  const st = settingsOf(state);
  const plan = state?.plan || {};
  const planStore = st.planStore;
  const sorted = [...dates].sort();
  const seed = seedKey || sorted[0] || '';
  const fillable = new Set(sorted.filter((d) => (!today || d >= today) && isFillable(plan[d], mode)));
  const merged = { ...plan };
  for (const d of fillable) delete merged[d];
  const pool = rotationList(db, state).sort((a, b) => a.id.localeCompare(b.id));
  const dateSet = new Set(sorted);
  const ref = today || sorted[0] || '';
  const ledger = new Ledger(db, state, planStore, ref);
  const lean = leanOn(state);
  const busy = busyNightsOf(state);
  const rated = new Map();
  /** One plate of this dinner with these sides, rated once. */
  const rate = (id, sides) => {
    const k = `${id}|${(sides || []).join(',')}`;
    if (!rated.has(k)) rated.set(k, plateLean(db, state, id, sides ? { sides } : null));
    return rated.get(k);
  };
  if (reserve) for (const d of sorted) if (!fillable.has(d) && eaten(merged[d])) ledger.consume(itemsForNight(db, state, merged[d].dinner, merged[d]));
  const entries = {};
  const unfilled = [];

  const lastUse = (id, date, within) => {
    for (let k = 1; k < within; k++) {
      for (const x of [addDays(date, -k), addDays(date, k)]) {
        const e = merged[x];
        if (eaten(e) && e.dinner === id) return k;
      }
    }
    return null;
  };

  for (const date of sorted) {
    if (!fillable.has(date)) {
      const e = merged[date];
      if (eaten(e) && !reserve) ledger.consume(itemsForNight(db, state, e.dinner, e));
      continue;
    }
    const type = nightType(date, st);
    const weekStart = startOfWeek(date, st.weekStartsOn);
    const week = dateRange(weekStart, 7);
    const weekDinners = week.filter((d) => d !== date && eaten(merged[d])).map((d) => dinnerById(db, state, merged[d].dinner)).filter(Boolean);
    const riceCount = week.filter((d) => d !== date && eaten(merged[d]) && nightIsRice(db, state, merged[d].dinner, merged[d])).length;
    const asianCount = weekDinners.filter(isAsian).length;
    const heavyCount = lean ? week.filter((d) => d !== date && eaten(merged[d]) && rate(merged[d].dinner, merged[d].sides)?.heavy).length : 0;
    const busyNight = busy.includes(monIndex(date));
    const known = week.filter((d) => dateSet.has(d) || merged[d]).length;
    const floor = known >= 5 ? 2 : known >= 3 ? 1 : 0;
    const openAfter = week.filter((d) => d > date && fillable.has(d) && nightType(d, st) === 'regular').length;
    const mustAsian = type === 'regular' && floor - asianCount > openAfter;
    const prev = merged[addDays(date, -1)];
    const prevD = eaten(prev) ? dinnerById(db, state, prev.dinner) : null;
    const prev2 = merged[addDays(date, -2)];
    const prev2D = eaten(prev2) ? dinnerById(db, state, prev2.dinner) : null;

    const feasible = [];
    for (const d of pool) {
      let sides = feasibleSides(db, state, d, planStore, null);
      if (!sides) continue;
      if (lean) {
        // A vegetable on the plate, unless that would take a dinner the caller accepts as it is (plan
        // ahead: "the pantry covers it") and make it one it doesn't.
        const v = withVegetable(db, state, d, sides, planStore);
        if (v !== sides && (!accept || accept(date, d, itemsForNight(db, state, d.id, { sides: v })))) sides = v;
      }
      if (accept && !accept(date, d, itemsForNight(db, state, d.id, { sides }))) continue;
      feasible.push({ d, sides });
    }

    const typeOk = (d) => (type === 'pizza' ? isPizza(d) : type === 'burger' ? isBurger(d) && !isPizza(d) : !isBurger(d) && !isPizza(d));
    const levels = strict ? LEVELS.slice(0, 3) : LEVELS;
    let candidates = [];
    for (const L of levels) {
      candidates = feasible.filter(({ d, sides }) => {
        if (L.type && !typeOk(d)) return false;
        if (!L.type && type === 'regular' && isPizza(d)) return false;
        if (lastUse(d.id, date, L.repeat) !== null) return false;
        if (L.rice && riceCount >= st.riceMaxPerWeek && nightIsRice(db, state, d.id, { sides: sides })) return false;
        if (L.cap && isAsian(d) && asianCount >= 3) return false;
        if (L.force && mustAsian && !isAsian(d)) return false;
        // Lean: the week's fried and heavy dinners are capped; burger and pizza nights stay what they are.
        if (L.heavy && lean && type === 'regular' && heavyCount >= HEAVY_MAX_PER_WEEK && rate(d.id, sides)?.heavy) return false;
        return true;
      });
      if (candidates.length) break;
    }
    if (!candidates.length) { unfilled.push(date); continue; }

    let best = null;
    for (const c of candidates) {
      const { d } = c;
      const items = itemsForNight(db, state, d.id, { sides: c.sides });
      const money = ledger.evaluate(items);
      const { cost, reuse, waste } = money;
      const v = voteInfo(state, d.id);
      let score = seeded(`${seed}|${planStore}|${date}|${d.id}`) * 0.8;
      if (isFavorite(state, d)) score += 1.0;
      score += 0.25 * v.up - 0.35 * v.down;
      if (isHealthier(d)) score += 0.25;
      // Bulk packs: favor dinners that use up what's open or in the pantry; avoid opening a big pack for a little.
      score += (reuse / 14) * 1.1;
      score -= cost / 14;
      score -= (waste / 14) * 0.9;
      if (type === 'regular' && isAsian(d) && asianCount < 2) score += 0.6;
      if (prevD && prevD.category === d.category) score -= 0.8;
      if (prev2D && prev2D.category === d.category) score -= 0.3;
      if (prevD && prevD.protein === d.protein && !isBurger(d)) score -= 0.5;
      // Keep the week varied: burgers count half toward the beef tally.
      const sameProteinWeek = weekDinners.reduce((n, x) => n + (x.protein === d.protein ? (isBurger(x) ? 0.5 : 1) : 0), 0);
      if (!isBurger(d) && sameProteinWeek > 1) score -= 0.45 * (sameProteinWeek - 1);
      if (monIndex(date) < 4 && effortOf(d) === 'long') score -= 0.3; // a long cook on a weeknight (the slow cooker isn't one)
      if (lastUse(d.id, date, 28) !== null) score -= 0.6;
      if (lean) score += leanScore(rate(d.id, c.sides));
      if (busyNight) score += busyScore(d);
      // Use it first: what's on the shelf and old, near its date, or thrown out before.
      let first = 0;
      for (const id of Object.keys(items)) if ((ledger.rem[id] || 0) > 0) first += urgency(db, state, id, date) * (isMeatItem(db, state, id) ? 1.5 : 1);
      score += 0.6 * Math.min(8, first);
      if (bonus) score += bonus(date, d, items, money) || 0;
      if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && d.id < best.c.d.id)) best = { score, c };
    }
    const entry = { dinner: best.c.d.id, sides: storedSides(state, best.c.d, best.c.sides), status: 'planned', by, at };
    entries[date] = entry;
    merged[date] = entry;
    const used = itemsForNight(db, state, entry.dinner, entry);
    ledger.consume(used);
    onPlace?.(date, entry, used);
  }
  return { entries, unfilled };
}

/** Where else a dinner sits in the plan (planned, not past), nearest to `near` first. */
export function findInPlan(state, dinnerId, { exclude, from, near } = {}) {
  const hits = Object.entries(state?.plan || {})
    .filter(([date, e]) => e && e.dinner === dinnerId && e.status === 'planned' && date !== exclude && (!from || date >= from))
    .map(([date]) => date);
  if (near) hits.sort((a, b) => Math.abs(diffDays(a, near)) - Math.abs(diffDays(b, near)) || a.localeCompare(b));
  else hits.sort();
  return hits;
}

/** Next nights (from `from`) that have nothing planned, up to `limit`, looking `horizon` days ahead. */
export function openNights(state, from, { limit = 10, horizon = 42, exclude = [] } = {}) {
  const out = [];
  for (let i = 0; i < horizon && out.length < limit; i++) {
    const d = addDays(from, i);
    if (exclude.includes(d)) continue;
    const e = state?.plan?.[d];
    if (!e || (e.status === 'planned' && !e.dinner)) out.push(d);
  }
  return out;
}

/** Bench dinner that best replaces a retired one: same category, then protein, then votes. */
export function bestBenchFor(db, state, retiredId, { exclude = null } = {}) {
  const r = dinnerById(db, state, retiredId);
  // `exclude` is only passed while working out implicit promotions (which can't call benchList).
  const bench = (exclude ? rawBench(db, state).filter((d) => !exclude.has(d.id)) : benchList(db, state)).filter((d) => d.id !== retiredId);
  if (!bench.length) return null;
  const score = (d) => {
    let s = 0;
    if (r && d.category === r.category) s += 2;
    if (r && d.protein === r.protein) s += 1.5;
    if (r && isBurger(r) === isBurger(d)) s += 1;
    const v = voteInfo(state, d.id);
    s += 0.3 * v.up - 0.5 * v.down;
    return s;
  };
  return [...bench].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))[0];
}

export function daysUntil(date, today) {
  return diffDays(date, today);
}
