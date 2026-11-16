// Eating better and spending less (SPEC §13). Pure: no DOM, no clock (today is passed in).
//  - Vegetable check: every planned dinner should have a vegetable or a salad among its sides.
//  - Budget pace: this month's receipts plus this trip, against the monthly target.
//  - After the trip: what a receipt bought that wasn't on that trip's list.

import { dinnerById, effectiveSides, sideInfo } from './planner.js';
import { plannedNights, itemMeta, receiptsIn } from './shopping.js';
import { settingsOf } from './state.js';
import { expandLine } from './receipts.js';
import { round2, datesBetween, startOfMonth, endOfMonth } from './util.js';
import * as nutrition from './nutrition.js';

const VEG_RE = /\b(green beans?|corn|peas|carrots?|broccoli|spinach|salad|lettuce|romaine|cabbage|slaw|cucumbers?|peppers?|zucchini|squash|asparagus|brussels|cauliflower|mixed vegetables|vegetables?|veggies?|tomato(es)?|okra|kale|edamame)\b/i;

/** Is this side a vegetable (or a salad)? A shelf side counts when it's produce or a canned vegetable. */
export function isVegSide(db, state, parsed) {
  const info = sideInfo(db, state, parsed);
  if (!info) return false;
  if (info.kind === 'vegetable' || info.kind === 'salad') return true;
  if (info.shelf) {
    const m = itemMeta(db, state, parsed.id);
    return VEG_RE.test(m.name) && !/chips|fries|potato/i.test(m.name);
  }
  return false;
}

/**
 * Planned dinners without a vegetable. → { total, withVeg, gaps: [{ date, dinner, sides, slot, add }] }
 * `slot` is the side to swap for a vegetable (the starch or bread), or the empty second slot (add).
 */
export function veggieCheck(db, state, dates) {
  const gaps = [];
  let total = 0;
  for (const n of plannedNights(db, state, dates)) {
    const d = dinnerById(db, state, n.entry.dinner);
    if (!d) continue;
    total++;
    const sides = effectiveSides(db, state, d.id, n.entry).map((s) => ({ slot: s.slot, parsed: s.parsed, info: sideInfo(db, state, s.parsed) }));
    if (sides.some((s) => isVegSide(db, state, s.parsed))) continue;
    const add = (d.sideSlots === 1 || sideCount(d) < 2) && sides.length < 2;
    const swap = sides.find((s) => ['starch', 'bread', 'soup', 'fruit', 'shelf'].includes(s.info?.kind)) || sides[sides.length - 1];
    gaps.push({ date: n.date, dinner: d, sides: sides.map((s) => s.info?.title).filter(Boolean), slot: add ? sides.length : (swap?.slot ?? 0), add });
  }
  return { total, withVeg: total - gaps.length, gaps };
}
const sideCount = (d) => (Array.isArray(d.sides) ? d.sides.length : 0);

/**
 * How this trip fits the month. → { month, spent, trip, after, target, pace, left, over, ahead }
 * pace = what a steady month would have spent by today; ahead = after − pace (positive: spending fast).
 */
export function budgetPace(state, today, tripTotal) {
  const target = settingsOf(state).monthlyTarget;
  const month = today.slice(0, 7);
  const spent = round2(receiptsIn(state, month).reduce((t, r) => t + Number(r.amount), 0));
  const days = datesBetween(startOfMonth(today), endOfMonth(today)).length;
  const dayNo = Number(today.slice(8, 10));
  const after = round2(spent + (tripTotal || 0));
  const pace = round2((target * dayNo) / days);
  return { month, spent, trip: round2(tripTotal || 0), after, target, pace, left: round2(target - after), over: after > target, ahead: round2(after - pace), daysLeft: days - dayNo };
}

/**
 * What a saved receipt bought that wasn't on that trip's list (its lines matched to the catalog,
 * minus the items the list asked for). Only food the planner knows; unmatched lines are counted.
 * → { extra: [{ id, name, price }], extraTotal, unmatched, unmatchedTotal }
 */
export function offList(db, state, receiptLog, listIds) {
  const want = new Set(listIds);
  const extra = [];
  let unmatched = 0;
  let unmatchedTotal = 0;
  for (const raw of receiptLog?.lines || []) {
    const l = expandLine(raw);
    if (!l) continue;
    const price = Number(l.lineTotal ?? (l.unitPrice != null ? l.unitPrice * l.qty : 0)) || 0;
    if (!l.matchId) { if (price > 0) { unmatched++; unmatchedTotal += price; } continue; }
    if (want.has(l.matchId)) continue;
    extra.push({ id: l.matchId, name: itemMeta(db, state, l.matchId).name, product: l.product, price: round2(price) });
  }
  return { extra, extraTotal: round2(extra.reduce((t, x) => t + x.price, 0)), unmatched, unmatchedTotal: round2(unmatchedTotal) };
}

// ---------------------------------------------------------------- lean by default (SPEC §21.2)

/** The family setting "Lean by default": on unless someone turns it off. */
export const leanOn = (state) => state?.settings?.lean !== false;

/** Busy weeknights (Monday = 0 … Sunday = 6, like burgerNights): these get low-effort dinners. */
export function busyNightsOf(state) {
  const b = state?.settings?.busyNights;
  return Array.isArray(b) ? [...new Set(b.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort() : [];
}

/** A plate at or under this many calories with enough protein is lean (when nutrition.js has no say). */
export const LEAN_KCAL = 750;
export const LEAN_PROTEIN_G = 30;
/** A plate at or over this is a heavy one. */
export const HEAVY_KCAL = 1100;
/** With lean on, at most this many fried or heavy dinners a week (burger and pizza nights included). */
export const HEAVY_MAX_PER_WEEK = 2;

const FRIED_TAGS = ['fried', 'deep fried', 'deep-fried', 'heavy', 'indulgent', 'comfort heavy'];
/** "Chicken-fried steak", "fried chicken": but not air-fried, stir-fried, refried beans or fried rice. */
const FRIED_RE = /(?<!air[- ])(?<!stir[- ])(?<!re)\b(deep[- ])?fried\b(?! rice)/i;

/** Is this dinner fried, by its tags or its name? */
export function isFried(d) {
  if (!d) return false;
  if ((d.tags || []).some((t) => FRIED_TAGS.includes(t))) return true;
  return FRIED_RE.test(d.title || '');
}

/**
 * How one plate of a night's dinner (with its sides) rates. Uses nutrition.js
 * `plateHealth(db, state, dinnerId, entry)` → { kcal, proteinG, vegServings, lean, why } when it's
 * there (and its `heavy`, if it gives one); otherwise calories and protein from `plateNutrition`
 * and the sides on the plate. A plate is never both lean and heavy.
 * → { kcal, proteinG, vegServings, lean, heavy, fried, known, why }
 */
export function plateLean(db, state, dinnerId, entry, { plateHealth = nutrition.plateHealth } = {}) {
  const d = dinnerById(db, state, dinnerId);
  if (!d) return null;
  const fried = isFried(d);
  const vegSides = effectiveSides(db, state, dinnerId, entry).filter((s) => isVegSide(db, state, s.parsed)).length;
  let h = null;
  if (typeof plateHealth === 'function') {
    try { h = plateHealth(db, state, dinnerId, entry); } catch { h = null; }
  }
  if (h && typeof h === 'object') {
    const kcal = Number.isFinite(Number(h.kcal)) ? Number(h.kcal) : null;
    const heavy = h.heavy !== undefined ? !!h.heavy : fried || (kcal != null && kcal >= HEAVY_KCAL);
    return {
      kcal, proteinG: Number.isFinite(Number(h.proteinG)) ? Number(h.proteinG) : null,
      vegServings: Number.isFinite(Number(h.vegServings)) ? Number(h.vegServings) : vegSides,
      lean: !!h.lean && !heavy, heavy, fried, known: kcal != null, why: h.why ? String(h.why) : '',
    };
  }
  const n = nutrition.plateNutrition(db, state, dinnerId, entry);
  const known = !!n && n.kcal > 0;
  const kcal = known ? n.kcal : null;
  const proteinG = known ? n.protein : null;
  const heavy = fried || (known && kcal >= HEAVY_KCAL);
  const lean = !heavy && known && kcal <= LEAN_KCAL && proteinG >= LEAN_PROTEIN_G;
  const why = !known ? '' : lean ? `about ${nutrition.fmtKcal(kcal)} calories and ${Math.round(proteinG)} g protein a plate`
    : heavy ? (fried ? 'fried' : `about ${nutrition.fmtKcal(kcal)} calories a plate`) : '';
  return { kcal, proteinG, vegServings: vegSides, lean, heavy, fried, known, why };
}

/**
 * What a lean week adds to a dinner's planner score: lean plates up, fried and heavy plates down,
 * a vegetable on the plate up. Small enough that favorites, variety and the comfort nights still win
 * their share (a favorite is worth 1.0, the cost of a dinner about 1.0 to 2.0). → about −1.0 … +1.1
 */
export function leanScore(h) {
  if (!h) return 0;
  let s = 0;
  if (h.lean) s += 0.8;
  else if (h.heavy) s -= 0.8;
  else if (h.known) s -= 0.5 * Math.max(0, Math.min(1, (h.kcal - LEAN_KCAL) / (HEAVY_KCAL - LEAN_KCAL)));
  s += h.vegServings > 0 ? 0.2 : -0.2;
  if (h.known && h.kcal > 0 && (h.proteinG * 4) / h.kcal >= 0.3) s += 0.1; // high protein for its calories
  return s;
}

/** The slow cooker the family owns (Ninja PossibleCooker), and what recipes might call one. */
const SLOW_EQUIPMENT = ['possible cooker', 'slow cooker', 'crockpot'];
const HANDS_OFF_TAGS = ['slow cooker', 'slow cook', 'slow-cooker', 'set and forget', 'hands-off', 'hands off', 'dump and go', 'braise'];

/** Does this dinner cook slowly in the PossibleCooker (load it earlier, walk away)? */
export function isSlowCooked(d) {
  if (!d) return false;
  const active = Number(d.activeMinutes ?? d.handsOnMinutes ?? d.active);
  if ((d.tags || []).some((t) => HANDS_OFF_TAGS.includes(t))) return true;
  return (d.equipment || []).some((e) => SLOW_EQUIPMENT.includes(e)) && (d.minutes >= 120 || (active > 0 && active <= 20));
}

/**
 * How much work a dinner is on the night: 'handsOff' (the PossibleCooker does it), 'quick'
 * (30 minutes or less at the stove), 'long' (over 45) or 'normal'.
 */
export function effortOf(d) {
  if (!d) return 'normal';
  if (isSlowCooked(d)) return 'handsOff';
  const active = Number(d.activeMinutes ?? d.handsOnMinutes ?? d.active);
  const work = active > 0 ? active : d.minutes;
  if (work > 0 && work <= 30) return 'quick';
  return work > 45 ? 'long' : 'normal';
}

/** What a busy night adds to a dinner's score: the slow cooker first, then anything quick. */
export function busyScore(d) {
  return { handsOff: 1.1, quick: 0.5, normal: -0.3, long: -0.9 }[effortOf(d)];
}

/**
 * The planned dinners on these dates, rated. → { total, lean, heavy, known, kcal (average a plate),
 *   proteinG (average), nights: [{ date, dinner, title, lean, heavy, kcal, proteinG }] }
 */
export function leanSummary(db, state, dates) {
  const nights = [];
  for (const n of plannedNights(db, state, dates)) {
    const h = plateLean(db, state, n.entry.dinner, n.entry);
    if (!h) continue;
    nights.push({ date: n.date, dinner: n.entry.dinner, title: dinnerById(db, state, n.entry.dinner).title, ...h });
  }
  const known = nights.filter((n) => n.known);
  const avg = (k) => (known.length ? known.reduce((t, n) => t + n[k], 0) / known.length : null);
  return { total: nights.length, lean: nights.filter((n) => n.lean).length, heavy: nights.filter((n) => n.heavy).length, known: known.length, kcal: avg('kcal'), proteinG: avg('proteinG'), nights };
}
