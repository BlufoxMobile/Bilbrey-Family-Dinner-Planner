// Turns what a family member wants ("make this tonight", "we're out Friday") into
// state ops, plus the exact ops that undo it and a plain-language message.
// Pure: (db, state, args) → { ops, undo, message, ... }. No DOM.

import { set, del, push } from './state.js';
import { clone, listJoin, round2, slugify, uid, weekdayName, shortDate, diffDays } from './util.js';
import { FAMILY } from './config.js';
import {
  bestBenchFor, dinnerById, effectiveSides, findInPlan, generatePlan, itemsForNight, sideInfo, parseSideRef, kindOf,
  voteInfo, isRetired, isPromoted,
} from './planner.js';
import { boughtToPantry } from './shopping.js';

function getPath(obj, path) {
  let o = obj;
  for (const k of path) {
    if (o === null || typeof o !== 'object' || !(k in o)) return undefined;
    o = o[k];
  }
  return o;
}

/** Ops that restore every path the given ops touch to its value in `state`. */
export function undoFor(state, ops) {
  const out = [];
  for (const op of ops) {
    const prev = getPath(state, op.path);
    out.push(prev === undefined ? del(op.path) : set(op.path, clone(prev)));
  }
  return out.reverse();
}

function result(state, ops, message, extra = {}) {
  return { ops, undo: undoFor(state, ops), message, ...extra };
}

export function nightName(date, today) {
  if (!today) return `${weekdayName(date)}, ${shortDate(date)}`;
  const d = diffDays(date, today);
  if (d === 0) return 'tonight';
  if (d === 1) return 'tomorrow';
  if (d > 1 && d < 7) return weekdayName(date);
  return `${weekdayName(date)}, ${shortDate(date)}`;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const titleOf = (db, state, id) => dinnerById(db, state, id)?.title || 'That dinner';

const stamp = (who, at) => ({ by: who || 'Family', at: at || new Date().toISOString() });

// ---------------------------------------------------------------- planning

export function generateOps(db, state, { dates, mode = 'fill', who, at, today, seedKey }) {
  const { entries, unfilled } = generatePlan({ db, state, dates, mode, by: who || 'Family', at: at || new Date().toISOString(), today, seedKey });
  const ops = Object.entries(entries).map(([d, e]) => set(['plan', d], e));
  const n = ops.length;
  const message = n === 0
    ? (unfilled.length ? "Couldn't find dinners that fit those rules. Try planning from both stores." : 'Every night here is already planned.')
    : `Planned ${n} ${n === 1 ? 'dinner' : 'dinners'}.${unfilled.length ? ` ${unfilled.length} ${unfilled.length === 1 ? 'night' : 'nights'} still open.` : ''}`;
  return result(state, ops, message, { unfilled, count: n });
}

export function clearNightOps(db, state, { date, today }) {
  const e = state?.plan?.[date];
  if (!e) return result(state, [], 'Nothing to clear.');
  return result(state, [del(['plan', date])], `${cap(nightName(date, today))} is open now.`);
}

/** Swap everything about two nights (dinner, sides, away status). Cooked nights stay put. */
export function swapNightsOps(db, state, { a, b, who, at, today }) {
  if (a === b) return result(state, [], 'Pick two different nights.');
  const ea = state?.plan?.[a];
  const eb = state?.plan?.[b];
  if (ea?.status === 'cooked' || eb?.status === 'cooked') return result(state, [], 'Cooked nights stay where they are.', { error: true });
  if (!ea && !eb) return result(state, [], 'Both nights are empty.');
  const s = stamp(who, at);
  const ops = [];
  ops.push(eb ? set(['plan', a], { ...clone(eb), manual: true, ...s }) : del(['plan', a]));
  ops.push(ea ? set(['plan', b], { ...clone(ea), manual: true, ...s }) : del(['plan', b]));
  const ta = ea?.dinner ? titleOf(db, state, ea.dinner) : null;
  const tb = eb?.dinner ? titleOf(db, state, eb.dinner) : null;
  let message;
  if (ta && tb) message = `Swapped. ${tb} is ${nightName(a, today)}; ${ta} moves to ${nightName(b, today)}.`;
  else if (ta) message = `${ta} moved to ${nightName(b, today)}.`;
  else if (tb) message = `${tb} moved to ${nightName(a, today)}.`;
  else message = 'Swapped the two nights.';
  return result(state, ops, message);
}

/**
 * Jeff's "switch meals anytime": put `dinnerId` on `date`.
 * If it's already elsewhere in the plan, the two nights trade dinners.
 * Otherwise it replaces the night; the displaced dinner is returned so the UI can offer to move or drop it.
 */
export function placeDinnerOps(db, state, { dinnerId, date, who, at, today, fromDate }) {
  const d = dinnerById(db, state, dinnerId);
  if (!d) return result(state, [], "That dinner isn't in the recipe box.", { error: true });
  const target = state?.plan?.[date];
  if (target?.status === 'cooked') return result(state, [], `${cap(nightName(date, today))} is already marked cooked.`, { error: true });
  if (target?.dinner === dinnerId && target.status === 'planned') return result(state, [], `${d.title} is already ${nightName(date, today)}.`, { kind: 'same' });
  const s = stamp(who, at);
  const source = fromDate ?? findInPlan(state, dinnerId, { exclude: date, from: today, near: date })[0];
  if (source && state?.plan?.[source]?.dinner === dinnerId) {
    const se = state.plan[source];
    if (target?.dinner && target.status === 'planned') {
      const ops = [
        set(['plan', date], { ...clone(se), status: 'planned', manual: true, ...s }),
        set(['plan', source], { ...clone(target), manual: true, ...s }),
      ];
      return result(state, ops, `Swapped. ${d.title} is ${nightName(date, today)}; ${titleOf(db, state, target.dinner)} moves to ${nightName(source, today)}.`, { kind: 'swap', other: source });
    }
    const moved = { ...clone(se), status: 'planned', manual: true, ...s };
    delete moved.away;
    const ops = [set(['plan', date], moved), del(['plan', source])];
    return result(state, ops, `${d.title} moved to ${nightName(date, today)}. ${cap(nightName(source, today))} is open now.`, { kind: 'move', other: source });
  }
  const entry = { dinner: dinnerId, sides: [...d.sides], status: 'planned', manual: true, ...s };
  const displaced = target?.dinner && target.status === 'planned' ? { dinner: target.dinner, sides: target.sides ? [...target.sides] : undefined } : null;
  const ops = [set(['plan', date], entry)];
  const message = displaced
    ? `${d.title} is on for ${nightName(date, today)}, replacing ${titleOf(db, state, displaced.dinner)}.`
    : `${d.title} is on for ${nightName(date, today)}.`;
  return result(state, ops, message, { kind: 'replace', displaced });
}

/** Put a displaced dinner on an open night. */
export function moveDisplacedOps(db, state, { dinner, sides, toDate, who, at, today }) {
  const t = state?.plan?.[toDate];
  if (t?.dinner && t.status !== 'away') return result(state, [], 'Pick an open night.', { error: true });
  const s = stamp(who, at);
  const entry = { dinner, sides: sides || [...(dinnerById(db, state, dinner)?.sides || [])], status: 'planned', manual: true, ...s };
  return result(state, [set(['plan', toDate], entry)], `${titleOf(db, state, dinner)} moved to ${nightName(toDate, today)}.`);
}

// ---------------------------------------------------------------- not eating at home

export function markAwayOps(db, state, { dates, reason = 'Other', note = '', who, at, today, pushTo = null }) {
  const s = stamp(who, at);
  const ops = [];
  let skippedCooked = 0;
  let pushedTitle = null;
  for (const date of dates) {
    const prev = state?.plan?.[date];
    if (prev?.status === 'cooked') { skippedCooked++; continue; }
    const pushing = pushTo && dates.length === 1 && prev?.dinner;
    const entry = { dinner: pushing ? null : (prev?.dinner ?? null), sides: prev?.sides ? [...prev.sides] : [], status: 'away', away: { reason, ...(note ? { note } : {}) }, manual: true, ...s };
    ops.push(set(['plan', date], entry));
    if (pushing) {
      ops.push(set(['plan', pushTo], { dinner: prev.dinner, sides: prev.sides ? [...prev.sides] : [...(dinnerById(db, state, prev.dinner)?.sides || [])], status: 'planned', manual: true, ...s }));
      pushedTitle = titleOf(db, state, prev.dinner);
    }
  }
  const n = ops.filter((o) => o.value?.status === 'away').length;
  let message;
  if (n === 1) message = `${cap(nightName(dates.find((d) => state?.plan?.[d]?.status !== 'cooked'), today))}: ${reason === 'Big lunch' ? 'big lunch' : reason.toLowerCase()}. Its groceries are off the list.`;
  else message = `${n} nights marked ${reason === 'Big lunch' ? 'big lunch' : reason.toLowerCase()}. Their groceries are off the list.`;
  if (pushedTitle) message += ` ${pushedTitle} moved to ${nightName(pushTo, today)}.`;
  if (skippedCooked) message += ` ${skippedCooked} cooked ${skippedCooked === 1 ? 'night was' : 'nights were'} left alone.`;
  return result(state, ops, message, { count: n });
}

export function bringBackOps(db, state, { date, who, at, today }) {
  const e = state?.plan?.[date];
  if (!e || e.status !== 'away') return result(state, [], 'That night is already at home.');
  if (!e.dinner) return result(state, [del(['plan', date])], `Welcome back. ${cap(nightName(date, today))} is open, so pick a dinner.`, { open: true });
  const next = { ...clone(e), status: 'planned', manual: true, ...stamp(who, at) };
  delete next.away;
  return result(state, [set(['plan', date], next)], `${titleOf(db, state, e.dinner)} is back on for ${nightName(date, today)}.`);
}

// ---------------------------------------------------------------- cooked

export function markCookedOps(db, state, { date, who, at, today }) {
  const e = state?.plan?.[date];
  if (!e?.dinner) return result(state, [], 'Nothing planned that night.', { error: true });
  if (e.status === 'cooked') return result(state, [], 'Already marked cooked.');
  const items = itemsForNight(db, state, e.dinner, e);
  const deducted = {};
  const ops = [];
  for (const [id, need] of Object.entries(items)) {
    const p = state?.pantry?.[id];
    if (!p || typeof p.qty !== 'number' || kindOf(db, state, id) === 'staple') continue;
    const next = round2(Math.max(0, p.qty - need));
    const used = round2(p.qty - next);
    if (used <= 0) continue;
    deducted[id] = used;
    ops.push(set(['pantry', id, 'qty'], next));
    ops.push(set(['pantry', id, 'at'], at || new Date().toISOString()));
  }
  ops.unshift(set(['plan', date], { ...clone(e), status: 'cooked', cookedAt: at || new Date().toISOString(), cookedBy: who || 'Family', deducted }));
  const n = Object.keys(deducted).length;
  const message = `${titleOf(db, state, e.dinner)} marked cooked.${n ? ` Took ${n} ${n === 1 ? 'item' : 'items'} out of the pantry.` : ''}`;
  return result(state, ops, message, { deducted });
}

export function unmarkCookedOps(db, state, { date }) {
  const e = state?.plan?.[date];
  if (!e || e.status !== 'cooked') return result(state, [], 'That night isn’t marked cooked.');
  const ops = [];
  for (const [id, used] of Object.entries(e.deducted || {})) {
    const p = state?.pantry?.[id];
    if (p && typeof p.qty === 'number') ops.push(set(['pantry', id, 'qty'], round2(p.qty + used)));
  }
  const next = { ...clone(e), status: 'planned' };
  delete next.cookedAt; delete next.cookedBy; delete next.deducted;
  ops.unshift(set(['plan', date], next));
  return result(state, ops, `${titleOf(db, state, e.dinner)} is back to planned.`);
}

// ---------------------------------------------------------------- sides

export function substituteOps(db, state, { dinnerId, slot, ref }) {
  const d = dinnerById(db, state, dinnerId);
  if (!d || !parseSideRef(ref)) return result(state, [], "Couldn't use that side.", { error: true });
  const before = effectiveSides(db, state, dinnerId, null).find((s) => s.slot === slot);
  const newTitle = sideInfo(db, state, parseSideRef(ref))?.title || 'that side';
  const oldTitle = before ? sideInfo(db, state, before.parsed)?.title : null;
  const ops = [set(['substitutions', dinnerId, String(slot)], ref)];
  const message = oldTitle && before.ref !== ref
    ? `Remembered for ${d.title}: ${newTitle} instead of ${oldTitle}.`
    : `Remembered for ${d.title}: ${newTitle}.`;
  return result(state, ops, message);
}

export function resetSideOps(db, state, { dinnerId, slot }) {
  const d = dinnerById(db, state, dinnerId);
  if (!state?.substitutions?.[dinnerId]?.[String(slot)]) return result(state, [], 'Already the recipe’s side.');
  const isAdded = slot >= (d?.sideSlots || 2);
  const def = d?.sides?.[slot] ? sideInfo(db, state, parseSideRef(d.sides[slot]))?.title : null;
  const message = isAdded ? `Removed the extra side from ${d?.title || 'that dinner'}.` : `${d?.title || 'That dinner'} is back to ${def || 'its usual side'}.`;
  return result(state, [del(['substitutions', dinnerId, String(slot)])], message);
}

// ---------------------------------------------------------------- votes, retire, promote

function retireBundle(db, state, { dinnerId, by, at, today, manual }) {
  const ops = [set(['retired', dinnerId], { by: by || 'votes', at, ...(manual ? { manual: true } : {}) })];
  const bench = bestBenchFor(db, state, dinnerId);
  const d = dinnerById(db, state, dinnerId);
  let message;
  if (bench) {
    ops.push(set(['promoted', bench.id], { replaced: dinnerId, at }));
    const future = Object.entries(state?.plan || {}).filter(([date, e]) => e?.dinner === dinnerId && e.status === 'planned' && (!today || date >= today));
    for (const [date, e] of future) ops.push(set(['plan', date], { ...clone(e), dinner: bench.id, sides: [...bench.sides] }));
    message = `${bench.title} joins the rotation, replacing ${d?.title || 'that dinner'}.`;
    if (future.length) message += ` Swapped in on ${future.length} planned ${future.length === 1 ? 'night' : 'nights'}.`;
  } else {
    message = `${d?.title || 'That dinner'} is out of the rotation. No bench dinners are left to replace it.`;
  }
  return { ops, message, promoted: bench?.id || null };
}

/** Tap thumbs up/down as `who`. Tapping the same thumb again clears it. */
export function voteOps(db, state, { dinnerId, who, value, at, today }) {
  if (!FAMILY.includes(who)) return result(state, [], 'Pick who’s using this phone first.', { error: true, needsWho: true });
  const d = dinnerById(db, state, dinnerId);
  if (!d) return result(state, [], "That dinner isn't in the recipe box.", { error: true });
  const current = state?.votes?.[dinnerId]?.[who];
  const clearing = current === value;
  const ops = [clearing ? del(['votes', dinnerId, who]) : set(['votes', dinnerId, who], value)];
  const nextVotes = { ...(state?.votes?.[dinnerId] || {}) };
  if (clearing) delete nextVotes[who]; else nextVotes[who] = value;
  const down = Object.values(nextVotes).filter((v) => v === -1).length;
  const up = Object.values(nextVotes).filter((v) => v === 1).length;
  const wasUp = voteInfo(state, dinnerId).up;
  let message = clearing ? `Cleared your vote on ${d.title}.` : value === 1 ? `${who} likes ${d.title}.` : `${who} would rather skip ${d.title}.`;
  let extra = {};
  if (!clearing && value === -1 && down >= 3 && !isRetired(state, dinnerId)) {
    const t = at || new Date().toISOString();
    const b = retireBundle(db, state, { dinnerId, by: 'votes', at: t, today });
    ops.push(...b.ops);
    message = `Voted out. ${b.message}`;
    extra = { retired: true, promoted: b.promoted };
  } else if (!clearing && value === 1 && up >= 3 && wasUp < 3) {
    message = `${d.title} is now a family favorite.`;
    extra = { favorite: true };
  }
  return result(state, ops, message, extra);
}

export function retireOps(db, state, { dinnerId, who, at, today }) {
  if (isRetired(state, dinnerId)) return result(state, [], 'Already out of the rotation.');
  const b = retireBundle(db, state, { dinnerId, by: who, at: at || new Date().toISOString(), today, manual: true });
  return result(state, b.ops, b.message, { promoted: b.promoted });
}

export function restoreOps(db, state, { dinnerId }) {
  const d = dinnerById(db, state, dinnerId);
  const ops = [];
  if (isRetired(state, dinnerId)) ops.push(del(['retired', dinnerId]));
  for (const [person, v] of Object.entries(state?.votes?.[dinnerId] || {})) if (v === -1) ops.push(del(['votes', dinnerId, person]));
  if (d?.rotation === 'bench' && !isPromoted(state, dinnerId)) ops.push(set(['promoted', dinnerId], { replaced: null, at: new Date().toISOString() }));
  return result(state, ops, `${d?.title || 'That dinner'} is back in the rotation with a fresh start on votes.`);
}

export function promoteOps(db, state, { dinnerId, at }) {
  const d = dinnerById(db, state, dinnerId);
  if (isPromoted(state, dinnerId)) return result(state, [], 'Already in the rotation.');
  return result(state, [set(['promoted', dinnerId], { replaced: null, at: at || new Date().toISOString() })], `${d?.title || 'That dinner'} joins the rotation.`);
}

// ---------------------------------------------------------------- pantry

export function setPantryOps(db, state, { id, qty, stocked, low, who, at }) {
  const prev = state?.pantry?.[id] || {};
  const next = { qty: prev.qty ?? null, stocked: !!prev.stocked, ...stamp(who, at) };
  if (qty !== undefined) next.qty = qty === null ? null : Math.max(0, round2(Number(qty) || 0));
  if (stocked !== undefined) next.stocked = !!stocked;
  // Changing the amount or the stocked toggle counts as restocking, which clears "running low".
  const isLow = low !== undefined ? !!low : !!prev.low && qty === undefined && stocked === undefined;
  if (isLow) next.low = true;
  return result(state, [set(['pantry', id], next)], '');
}

export function removePantryOps(db, state, { id }) {
  const name = db.ingredients[id]?.name || state?.custom?.[id]?.name || 'Item';
  return result(state, [del(['pantry', id])], `${name} removed from the pantry.`);
}

/** Creates (or reuses) a custom shelf item. Returns its id. */
export function customItemOps(state, { name, unit = 'each', aisle = 'Canned & Jarred', kind = 'measured', storage = 'pantry' }) {
  const base = 'custom-' + slugify(name);
  const existing = Object.entries(state?.custom || {}).find(([, c]) => c?.name?.toLowerCase() === String(name).trim().toLowerCase());
  if (existing) return { id: existing[0], ops: [] };
  let id = base;
  let n = 2;
  while (state?.custom?.[id]) id = `${base}-${n++}`;
  return { id, ops: [set(['custom', id], { name: String(name).trim(), unit, aisle, kind, storage })] };
}

// ---------------------------------------------------------------- list

export function toggleCheckOps(state, { listKey, key }) {
  const on = !state?.checked?.[listKey]?.[key];
  return result(state, [on ? set(['checked', listKey, key], true) : del(['checked', listKey, key])], '');
}

export function doneShoppingOps(db, state, { list, who, at }) {
  const adds = boughtToPantry(list);
  const ops = [];
  const s = stamp(who, at);
  for (const a of adds) {
    const prev = state?.pantry?.[a.id] || {};
    if (a.staple) ops.push(set(['pantry', a.id], { qty: null, stocked: true, ...s }));
    else ops.push(set(['pantry', a.id], { qty: round2((typeof prev.qty === 'number' && !prev.low ? prev.qty : 0) + a.add), stocked: false, ...s }));
  }
  if (state?.checked?.[list.listKey]) ops.push(del(['checked', list.listKey]));
  return result(state, ops, adds.length ? `Put ${adds.length} ${adds.length === 1 ? 'item' : 'items'} in the pantry. The list now shows only what's still needed.` : 'Check off what you bought first.', { count: adds.length });
}

export function setPriceOps(state, { store, brand, id, size, price, who, at }) {
  const key = `${store}/${brand}/${id}`;
  return result(state, [set(['prices', key], { size: Number(size), price: round2(Number(price)), ...stamp(who, at) })], 'Price saved for the whole family.');
}

export function clearPriceOps(state, { store, brand, id }) {
  return result(state, [del(['prices', `${store}/${brand}/${id}`])], 'Back to the estimated price.');
}

export function notAtStoreOps(db, state, { store, id }) {
  const name = db.ingredients[id]?.name || state?.custom?.[id]?.name || 'That item';
  const storeName = db.stores?.[store]?.name || store;
  return result(state, [set(['availability', `${store}/${id}`], false)], `Noted: ${storeName} doesn't carry ${name.toLowerCase()}.`);
}

export function addReceiptOps(state, { date, store, amount, note, who }) {
  const r = { id: uid('r'), date, store, amount: round2(Number(amount)), ...(note ? { note } : {}), by: who || 'Family' };
  return { ops: [push(['receipts'], r)], undo: [set(['receipts'], clone(state?.receipts || []))], message: 'Receipt logged.' };
}

export function removeReceiptOps(state, { id }) {
  const list = (state?.receipts || []).filter((r) => r?.id !== id);
  return result(state, [set(['receipts'], list)], 'Receipt removed.');
}

export function addExtraOps(db, state, { name, item, qty = 1, unit = '', store, every = 'trip', price }) {
  const id = item ? `x-${item}` : `x-${slugify(name)}-${uid().slice(0, 4)}`;
  const x = { name: item ? db.ingredients[item]?.name || name : name, qty: Number(qty) || 1, unit, store: store || (item ? db.ingredients[item]?.defaultStore : 'jewel') || 'jewel', every, ...(item ? { item } : {}) };
  if (!item && Number.isFinite(Number(price)) && price !== '' && price != null) x.price = round2(Number(price));
  return result(state, [set(['extras', id], x)], `${x.name} added to every ${every === 'week' ? 'week' : 'trip'}.`);
}

export function removeExtraOps(state, { id }) {
  return result(state, [del(['extras', id])], 'Removed from extras.');
}

export function settingOps(state, key, value) {
  return result(state, [set(['settings', key], value)], '');
}

/** Pantry deduction preview, used by the "Mark cooked" confirmation. */
export function cookedPreview(db, state, date) {
  const e = state?.plan?.[date];
  if (!e?.dinner) return [];
  const items = itemsForNight(db, state, e.dinner, e);
  return Object.entries(items)
    .filter(([id]) => typeof state?.pantry?.[id]?.qty === 'number' && kindOf(db, state, id) !== 'staple')
    .map(([id, need]) => ({ id, need, name: db.ingredients[id]?.name || state?.custom?.[id]?.name || id }));
}

export { listJoin };
