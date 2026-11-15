// Eating better and spending less (SPEC §13). Pure: no DOM, no clock (today is passed in).
//  - Vegetable check: every planned dinner should have a vegetable or a salad among its sides.
//  - Budget pace: this month's receipts plus this trip, against the monthly target.
//  - After the trip: what a receipt bought that wasn't on that trip's list.

import { dinnerById, effectiveSides, sideInfo } from './planner.js';
import { plannedNights, itemMeta, receiptsIn } from './shopping.js';
import { settingsOf } from './state.js';
import { expandLine } from './receipts.js';
import { round2, datesBetween, startOfMonth, endOfMonth } from './util.js';

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
