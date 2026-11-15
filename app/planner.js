// Pure planning logic: periods, rotation, votes, sides, store feasibility and the
// deterministic dinner generator. No DOM, no clock (callers pass dates in).

import {
  addDays, addMonths, dateRange, datesBetween, diffDays, endOfMonth, monIndex, seeded, startOfMonth, startOfWeek, weekday,
} from './util.js';
import { settingsOf } from './state.js';
import { normalizeDinner } from './data.js';

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

export function isRetired(state, id) { return !!state?.retired?.[id]; }
export function isPromoted(state, id) { return !!state?.promoted?.[id]; }

export function inRotation(state, d) {
  if (!d || isRetired(state, d.id)) return false;
  return d.rotation === 'core' || d.custom || isPromoted(state, d.id);
}

export function rotationList(db, state) {
  return allDinners(db, state).filter((d) => inRotation(state, d));
}

export function benchList(db, state) {
  return allDinners(db, state).filter((d) => d.rotation === 'bench' && !isPromoted(state, d.id) && !isRetired(state, d.id));
}

export function voteInfo(state, id) {
  const v = state?.votes?.[id] || {};
  let up = 0;
  let down = 0;
  for (const val of Object.values(v)) { if (val === 1) up++; else if (val === -1) down++; }
  return { up, down, byPerson: v };
}

export function isFavorite(state, d) {
  if (!d) return false;
  return voteInfo(state, d.id).up >= 3 || d.tags.includes('family favorite');
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
  return out;
}

/** Display info for a side ref. */
export function sideInfo(db, state, parsed) {
  if (!parsed) return null;
  if (parsed.type === 'side') {
    const s = db.sides[parsed.id];
    return s ? { title: s.title, kind: s.kind, minutes: s.minutes, steps: s.steps, items: s.items, equipment: s.equipment, recipe: s }
      : { title: parsed.id, kind: 'vegetable', minutes: 0, steps: [], items: {}, equipment: [] };
  }
  const ing = parsed.type === 'item' ? db.ingredients[parsed.id] : state?.custom?.[parsed.id];
  const name = ing?.name || parsed.id;
  const unit = ing?.unit || '';
  return {
    title: name, kind: 'shelf', minutes: 5, equipment: ['microwave'], shelf: true, qty: parsed.qty, unit,
    steps: [`Warm or plate ${name.toLowerCase()} (${parsed.qty} ${unit}) and divide among five plates.`],
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
  const packs = db.ingredients[id]?.packs?.[store];
  return !!(packs && (packs.generic || packs.name));
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
  for (const s of base) refs[s.slot] = s.ref;
  if (store === 'both') return refs;
  const used = new Set(base.map((s) => s.ref));
  for (const s of base) {
    if (itemsFeasible(db, state, itemsForSides(db, state, [s.ref]), store)) continue;
    if (s.remembered) return null; // the family chose this side; don't silently change it
    const want = s.parsed.type === 'side' ? db.sides[s.parsed.id]?.kind : null;
    const alts = [...db.sideList]
      .filter((x) => !used.has(x.id) && itemsFeasible(db, state, x.items, store))
      .sort((a, b) => (b.kind === want) - (a.kind === want) || a.id.localeCompare(b.id));
    if (!alts.length) return null;
    refs[s.slot] = alts[0].id;
    used.add(alts[0].id);
  }
  return refs;
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
  const top = Object.entries(missing).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => db.ingredients[id]?.name || state?.custom?.[id]?.name || id);
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

export function brandFor(state, id) {
  return state?.brands?.[id] || settingsOf(state).brand;
}

export function storeFor(db, state, id, planStore = settingsOf(state).planStore) {
  if (planStore === 'sams' || planStore === 'jewel') return planStore;
  const pref = state?.storeFor?.[id] || db.ingredients[id]?.defaultStore || 'jewel';
  if (canBuyAt(db, state, id, pref)) return pref;
  const other = pref === 'sams' ? 'jewel' : 'sams';
  return canBuyAt(db, state, id, other) ? other : pref;
}

/** Best pack for an item at a store/brand: family correction → prices.json → catalog; falls back to the other brand. */
export function packFor(db, state, id, store, brand) {
  if (state?.availability?.[`${store}/${id}`] === false) return null;
  const tryBrand = (b) => {
    const fam = state?.prices?.[`${store}/${b}/${id}`];
    const base = db.ingredients[id]?.packs?.[store]?.[b];
    if (fam && Number(fam.size) > 0 && Number(fam.price) >= 0) {
      return { ...(base || {}), size: Number(fam.size), price: Number(fam.price), source: 'family', brand: b, store, at: fam.at, by: fam.by };
    }
    return base ? { ...base, brand: b, store } : null;
  };
  const first = tryBrand(brand);
  if (first) return first;
  const other = tryBrand(brand === 'name' ? 'generic' : 'name');
  return other ? { ...other, brandFallback: true } : null;
}

function unitPrice(db, state, id, planStore) {
  const store = storeFor(db, state, id, planStore);
  const p = packFor(db, state, id, store, brandFor(state, id));
  return p ? p.price / p.size : 0;
}

class Ledger {
  constructor(db, state, planStore) {
    this.db = db;
    this.state = state;
    this.planStore = planStore;
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
    for (const [id, need] of Object.entries(items)) {
      const kind = kindOf(this.db, this.state, id);
      const up = unitPrice(this.db, this.state, id, this.planStore);
      if (kind === 'staple') {
        if (!pantryCovers(this.db, this.state, id, need)) cost += need * up;
        continue;
      }
      const have = this.rem[id] || 0;
      const fromHave = Math.min(have, need);
      reuse += fromHave * up;
      const short = need - fromHave;
      if (short > 1e-9) {
        cost += short * up;
        const store = storeFor(this.db, this.state, id, this.planStore);
        const p = packFor(this.db, this.state, id, store, brandFor(this.state, id));
        if (p) {
          // Frozen and shelf-stable leftovers keep for next week; fresh ones are the real waste.
          const storage = this.db.ingredients[id]?.storage || this.state?.custom?.[id]?.storage || 'pantry';
          const perish = { freezer: 0.2, pantry: 0.15, fridge: 0.7, counter: 0.8 }[storage] ?? 0.5;
          const packs = Math.ceil(short / p.size - 1e-9);
          waste += (packs * p.size - short) * up * perish;
        }
      }
    }
    return { cost, reuse, waste };
  }

  consume(items) {
    for (const [id, need] of Object.entries(items)) {
      if (kindOf(this.db, this.state, id) === 'staple') continue;
      const have = this.rem[id] || 0;
      if (have >= need - 1e-9) { this.rem[id] = have - need; continue; }
      const store = storeFor(this.db, this.state, id, this.planStore);
      const p = packFor(this.db, this.state, id, store, brandFor(this.state, id));
      if (!p) { this.rem[id] = 0; continue; }
      const short = need - have;
      const packs = Math.ceil(short / p.size - 1e-9);
      this.rem[id] = have + packs * p.size - need;
    }
  }
}

// ---------------------------------------------------------------- the generator

/**
 * Fills (mode "fill") or re-plans (mode "replan") the given dates.
 * Keeps away/cooked nights and anything the family set by hand. Never touches past nights.
 * Deterministic: the same state + dates + seedKey always produce the same plan.
 * Returns { entries: { date: entry }, unfilled: [date] }.
 */
export function generatePlan({ db, state, dates, mode = 'fill', by = 'Family', at = '', seedKey, today }) {
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
  const ledger = new Ledger(db, state, planStore);
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
      if (eaten(e)) ledger.consume(itemsForNight(db, state, e.dinner, e));
      continue;
    }
    const type = nightType(date, st);
    const weekStart = startOfWeek(date, st.weekStartsOn);
    const week = dateRange(weekStart, 7);
    const weekDinners = week.filter((d) => d !== date && eaten(merged[d])).map((d) => dinnerById(db, state, merged[d].dinner)).filter(Boolean);
    const riceCount = week.filter((d) => d !== date && eaten(merged[d]) && nightIsRice(db, state, merged[d].dinner, merged[d])).length;
    const asianCount = weekDinners.filter(isAsian).length;
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
      const sides = feasibleSides(db, state, d, planStore, null);
      if (sides) feasible.push({ d, sides });
    }

    const typeOk = (d) => (type === 'pizza' ? isPizza(d) : type === 'burger' ? isBurger(d) && !isPizza(d) : !isBurger(d) && !isPizza(d));
    const levels = [
      { type: true, repeat: 14, rice: true, cap: true, force: true },
      { type: true, repeat: 14, rice: true, cap: true, force: false },
      { type: true, repeat: 7, rice: true, cap: true, force: false },
      { type: true, repeat: 7, rice: true, cap: false, force: false },
      { type: false, repeat: 7, rice: true, cap: false, force: false },
      { type: false, repeat: 2, rice: false, cap: false, force: false },
    ];
    let candidates = [];
    for (const L of levels) {
      candidates = feasible.filter(({ d, sides }) => {
        if (L.type && !typeOk(d)) return false;
        if (!L.type && type === 'regular' && isPizza(d)) return false;
        if (lastUse(d.id, date, L.repeat) !== null) return false;
        if (L.rice && riceCount >= st.riceMaxPerWeek && nightIsRice(db, state, d.id, { sides: sides })) return false;
        if (L.cap && isAsian(d) && asianCount >= 3) return false;
        if (L.force && mustAsian && !isAsian(d)) return false;
        return true;
      });
      if (candidates.length) break;
    }
    if (!candidates.length) { unfilled.push(date); continue; }

    let best = null;
    for (const c of candidates) {
      const { d } = c;
      const items = itemsForNight(db, state, d.id, { sides: c.sides });
      const { cost, reuse, waste } = ledger.evaluate(items);
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
      if (monIndex(date) < 4 && d.minutes > 45) score -= 0.3;
      if (lastUse(d.id, date, 28) !== null) score -= 0.6;
      if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && d.id < best.c.d.id)) best = { score, c };
    }
    const entry = { dinner: best.c.d.id, sides: storedSides(state, best.c.d, best.c.sides), status: 'planned', by, at };
    entries[date] = entry;
    merged[date] = entry;
    ledger.consume(itemsForNight(db, state, entry.dinner, entry));
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
export function bestBenchFor(db, state, retiredId) {
  const r = dinnerById(db, state, retiredId);
  const bench = benchList(db, state).filter((d) => d.id !== retiredId);
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
