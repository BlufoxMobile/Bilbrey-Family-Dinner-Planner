// What the pantry covers (SPEC §12.4): walk the planned dinners in date order, take each one's
// ingredients (main and its sides, for five) out of what's on the shelf, and count the dinners
// that are fully covered. The rest show exactly what's missing, which is what the list buys.
// Then: dinners in rotation the leftovers could still make, and ready-made backups on the shelf.
// Pure: no DOM, no clock.

import { plannedNights, itemMeta } from './shopping.js';
import { itemsForNight, kindOf, rotationList, dinnerById, scaleItems, isMeat } from './planner.js';
import { placeOf } from './freshness.js';
import { isSlowCooked } from './health.js';
import { round2 } from './util.js';

/** Within 5% counts as enough: a can's worth of rounding shouldn't call a dinner short. */
export const ENOUGH = 0.95;

/** Every kitchen has these; recipes assume them unless the family marks one running low. */
export const BASICS = ['salt', 'pepper', 'oil'];

/** id → amount on hand (Infinity for stocked staples). Items marked running low don't count. */
export function onHand(db, state) {
  const rem = {};
  for (const id of BASICS) if (!state?.pantry?.[id]) rem[id] = Infinity;
  for (const [id, p] of Object.entries(state?.pantry || {})) {
    if (!p || p.low) continue;
    if (kindOf(db, state, id) === 'staple' || (p.stocked && p.qty == null)) {
      if (p.stocked) rem[id] = Infinity;
      continue;
    }
    if (typeof p.qty === 'number' && p.qty > 0) rem[id] = p.qty;
  }
  return rem;
}

function take(rem, id, need) {
  const have = rem[id] ?? 0;
  if (have === Infinity) return 0;
  rem[id] = Math.max(0, have - need);
  return Math.max(0, need - have);
}

function missingFor(db, state, rem, items) {
  const out = [];
  for (const [id, need] of Object.entries(items)) {
    const have = rem[id] ?? 0;
    if (have === Infinity || have + 1e-9 >= need * ENOUGH) continue;
    const meta = itemMeta(db, state, id);
    out.push({ id, name: meta.name, unit: meta.unit, need: round2(need), have: round2(have), short: round2(need - have) });
  }
  return out;
}

/** Ready-made backups: frozen and shelf items that are a meal on their own (burritos, soups). */
const BACKUP = /burrito|tamale|soup|bites|pizza|ramen|smashed|patties|chili|^leftover/i;
export function backups(db, state) {
  const out = [];
  for (const [id, p] of Object.entries(state?.pantry || {})) {
    if (!p || p.low || !(typeof p.qty === 'number' && p.qty > 0)) continue;
    const meta = itemMeta(db, state, id);
    if (!meta.custom || !BACKUP.test(meta.name)) continue;
    out.push({ id, name: meta.name, qty: p.qty, unit: meta.unit, storage: meta.storage });
  }
  return out.sort((a, b) => (a.storage === 'freezer' ? 0 : 1) - (b.storage === 'freezer' ? 0 : 1) || a.name.localeCompare(b.name));
}

/**
 * → { rows: [{ date, dinner, title, ready, missing }], ready, total, shortIds,
 *     extra: [{ id, title }], backups }
 */
export function pantryCoverage(db, state, { dates }) {
  const rem = onHand(db, state);
  const nights = plannedNights(db, state, dates).sort((a, b) => a.date.localeCompare(b.date));
  const rows = [];
  const short = new Set();
  for (const { date, entry } of nights) {
    const items = itemsForNight(db, state, entry.dinner, entry);
    const missing = missingFor(db, state, rem, items);
    for (const [id, need] of Object.entries(items)) take(rem, id, need);
    for (const m of missing) short.add(m.id);
    rows.push({ date, dinner: entry.dinner, title: dinnerById(db, state, entry.dinner)?.title || 'Dinner', ready: !missing.length, missing });
  }
  // Beyond the plan: what the leftovers still make, each dinner once, with its usual sides.
  const planned = new Set(nights.map((n) => n.entry.dinner));
  const extra = [];
  for (const d of rotationList(db, state)) {
    if (planned.has(d.id)) continue;
    const items = itemsForNight(db, state, d.id, null);
    if (!Object.keys(items).length || missingFor(db, state, rem, items).length) continue;
    for (const [id, need] of Object.entries(items)) take(rem, id, need);
    extra.push({ id: d.id, title: d.title });
  }
  const assumed = BASICS.filter((id) => !state?.pantry?.[id]).map((id) => itemMeta(db, state, id).name);
  return { rows, ready: rows.filter((r) => r.ready).length, total: rows.length, shortIds: [...short], extra, backups: backups(db, state), assumed };
}

/** A staple the family switched off ("we're out") or marked running low. Never recorded = in the house. */
export function stapleShort(state, id) {
  const p = state?.pantry?.[id];
  return !!p && (!!p.low || !p.stocked);
}

const plainName = (name) => String(name || '').replace(/\s*\(.*?\)\s*/g, ' ').replace(/,.*$/, '').trim();

/**
 * Can this dinner be made from what's in the house right now? (gauntlet r5: tonight's picker listed
 * 40 dinners with nothing to say which ones could actually happen.)
 * → { ready (the main is in), missing: [names], sideOut: [names], thaw: [{ name, minutes }] }
 * rem: onHand(db, state), passed in when rating many dinners at once.
 */
export function readiness(db, state, dinnerId, rem = onHand(db, state)) {
  const d = db.dinners?.[dinnerId] || state?.customDinners?.[dinnerId];
  const items = itemsForNight(db, state, dinnerId, null);
  const main = scaleItems(db, state, d?.items || {});
  const cooker = d ? isSlowCooked(d) : false;
  const missing = [];
  const sideOut = [];
  const thaw = [];
  // The short shelf name ("Chicken thighs"), as on the list.
  const nameOf = (id) => db.ingredients?.[id]?.short || plainName(itemMeta(db, state, id).name);
  for (const id of Object.keys(items)) {
    // A staple (soy sauce, paprika, oil) is in the house unless someone switched it off or marked it
    // low: Tonight's rule, so the two never disagree (gauntlet r7: every dinner "needed soy sauce").
    if (kindOf(db, state, id) === 'staple') { if (stapleShort(state, id)) missing.push(nameOf(id)); continue; }
    const have = rem[id] ?? 0;
    if (!(have === Infinity || have + 1e-9 >= items[id] * ENOUGH)) (id in main ? missing : sideOut).push(nameOf(id));
    else if (isMeat(db, id) && have !== Infinity && placeOf(db, state, id) === 'freezer' && !cooker) {
      // A cold-water thaw: about 30 minutes a pound, never less than half an hour.
      const lb = itemMeta(db, state, id).unit === 'lb' ? items[id] : 1;
      thaw.push({ name: nameOf(id), minutes: Math.max(30, Math.round(lb * 2) * 15) });
    }
  }
  return { ready: !missing.length, missing, sideOut, thaw };
}

