// Turns what a family member wants ("make this tonight", "we're out Friday") into
// state ops, plus the exact ops that undo it and a plain-language message.
// Pure: (db, state, args) → { ops, undo, message, ... }. No DOM.

import { set, del, push, applyOps as applyOpsPure } from './state.js';
import { clone, listJoin, round2, slugify, uid, weekdayName, shortDate, diffDays, chicagoDay, midSentence, SHARED_PROFILE } from './util.js';
import { leftoverRecord, leftoversOnHand, servingsText, LEFTOVER_REASON } from './cooking.js';
import {
  bestBenchFor, dinnerById, effectiveSides, findInPlan, generatePlan, itemsForNight, sideInfo, parseSideRef, kindOf,
  isRetired, isPromoted, rotationList, isSideDropped, dinnerSignal, sideSignal, votesForSignal, SIGNALS, formerIds,
} from './planner.js';
import { boughtToPantry, readableId, dinnerFoodCost } from './shopping.js';
import { personConfig, lunchItem, swappedConfig, lunchSlots, lunchPackers, isPacker, newPackerName, packingNames, lunchFor } from './lunch.js';
import { addDays } from './util.js';

const isISO = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

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

// One shared profile: the app stamps every change "Family". `who` is only still passed by callers
// that are not a person at a screen (the Claude chat connector stamps its own name).
const stamp = (who, at) => ({ by: who || SHARED_PROFILE, at: at || new Date().toISOString() });

// ---------------------------------------------------------------- planning

export function generateOps(db, state, { dates, mode = 'fill', who, at, today, seedKey }) {
  const { entries, unfilled } = generatePlan({ db, state, dates, mode, by: who || SHARED_PROFILE, at: at || new Date().toISOString(), today, seedKey });
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
  if (displaced) {
    // The bumped dinner moves to the first open night after this one, so one tap is one decision
    // (gauntlet r8: a second "What about …?" sheet, and closing it dropped the dinner). It comes off
    // the plan only when six weeks have no open night. Undo puts everything back.
    const to = nextOpenNight(state, date, today);
    const other = titleOf(db, state, displaced.dinner);
    if (to) {
      ops.push(set(['plan', to], { dinner: displaced.dinner, sides: displaced.sides || [...(dinnerById(db, state, displaced.dinner)?.sides || [])], status: 'planned', manual: true, ...s }));
      return result(state, ops, `${d.title} is on for ${nightName(date, today)}. ${other} moved to ${nightName(to, today)}.`, { kind: 'replace', displaced, movedTo: to });
    }
    return result(state, ops, `${d.title} is on for ${nightName(date, today)}. ${other} came off the plan: no open night in the next six weeks.`, { kind: 'replace', displaced, movedTo: null });
  }
  return result(state, ops, `${d.title} is on for ${nightName(date, today)}.`, { kind: 'replace', displaced: null });
}

/** The first open night after `date` (never tonight), within six weeks; else the first one from tomorrow. */
export function nextOpenNight(state, date, today) {
  const open = (x) => { const e = state?.plan?.[x]; return !e || (e.status === 'planned' && !e.dinner); };
  const from = today && date < today ? today : date;
  for (let i = 1; i <= 42; i++) { const x = addDays(from, i); if (open(x)) return x; }
  if (today) for (let i = 1; i <= 42; i++) { const x = addDays(today, i); if (x !== date && open(x)) return x; }
  return null;
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

/** The run of consecutive away nights around `date` with the same reason (a trip). */
export function awayBlock(state, date) {
  const e = state?.plan?.[date];
  if (e?.status !== 'away') return [];
  const same = (d) => { const x = state?.plan?.[d]; return x?.status === 'away' && (x.away?.reason || '') === (e.away?.reason || '') && (x.away?.note || '') === (e.away?.note || ''); };
  let start = date;
  while (same(addDays(start, -1))) start = addDays(start, -1);
  const out = [];
  for (let d = start; same(d); d = addDays(d, 1)) out.push(d);
  return out;
}

/** One tap brings a whole trip home: every night of the block goes back to planned (or open). */
export function bringBackTripOps(db, state, { date, who, at, today }) {
  const dates = awayBlock(state, date).filter((d) => !today || d >= today);
  if (dates.length < 2) return bringBackOps(db, state, { date, who, at, today });
  const s = stamp(who, at);
  const ops = [];
  let open = 0;
  for (const d of dates) {
    const e = state.plan[d];
    if (!e.dinner) { ops.push(del(['plan', d])); open++; continue; }
    const next = { ...clone(e), status: 'planned', manual: true, ...s };
    delete next.away;
    ops.push(set(['plan', d], next));
  }
  const n = dates.length;
  return result(state, ops, `Welcome home. ${n} nights are back on the plan${open ? `; ${open} ${open === 1 ? 'is' : 'are'} open for a dinner` : ''}.`, { count: n });
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
  ops.unshift(set(['plan', date], { ...clone(e), status: 'cooked', cookedAt: at || new Date().toISOString(), cookedBy: who || SHARED_PROFILE, deducted }));
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
  // Not cooked after all: there are no leftovers from it either (and the question can be asked again).
  const left = state?.leftovers?.[date];
  if (left) {
    ops.push(del(['leftovers', date]));
    const night = left.night && state?.plan?.[left.night];
    if (night?.status === 'away' && night.away?.reason === LEFTOVER_REASON && night.away?.from === date) ops.push(...bringBackOps(db, state, { date: left.night }).ops);
  }
  return result(state, ops, `${titleOf(db, state, e.dinner)} is back to planned.`);
}

// ---------------------------------------------------------------- leftovers (SPEC §22.5)
// state.leftovers["YYYY-MM-DD" (the night it was cooked)] =
//   { dinner, title, servings (left now), saved (put away that night), useBy, by, at, night? }

/** After dinner: how many servings went in the fridge (0 = none, and the question is answered). */
export function saveLeftoversOps(db, state, { date, servings, who, at }) {
  const e = state?.plan?.[date];
  if (!e?.dinner) return result(state, [], 'Nothing was planned that night.', { error: true });
  const rec = leftoverRecord(db, state, { date, servings, who, at: at || new Date().toISOString() });
  const message = rec.servings
    ? `${rec.title}: ${servingsText(rec.servings)} of leftovers saved, good through ${weekdayName(rec.useBy)}.`
    : 'No leftovers. Nothing to keep track of.';
  return result(state, [set(['leftovers', date], rec)], message, { servings: rec.servings });
}

/** Someone ate some (a lunch, a late plate). At zero the batch is done. */
export function useLeftoverOps(db, state, { date, servings = 1 }) {
  const l = state?.leftovers?.[date];
  if (!l || !(l.servings > 0)) return result(state, [], 'Those leftovers are already gone.');
  const left = Math.max(0, l.servings - Math.max(1, Math.round(Number(servings) || 1)));
  const message = left ? `${l.title || 'Leftovers'}: ${servingsText(left)} left.` : `${l.title || 'Leftovers'}: that was the last of it.`;
  return result(state, [set(['leftovers', date, 'servings'], left)], message, { left });
}

/** All gone (eaten or tossed). */
export function clearLeftoversOps(db, state, { date }) {
  const l = state?.leftovers?.[date];
  if (!l || !(l.servings > 0)) return result(state, [], 'Those leftovers are already gone.');
  return result(state, [set(['leftovers', date, 'servings'], 0)], `${l.title || 'Leftovers'}: all gone.`);
}

/**
 * A leftover night: `night` is marked not-cooking with the reason "Leftovers", so its groceries
 * come off the list; the dinner that was planned stays on the entry and comes back with
 * "bring back". plan[night] = { …, status: 'away', away: { reason: 'Leftovers', note, from } }.
 */
export function leftoverNightOps(db, state, { from, night, who, at, today }) {
  const l = state?.leftovers?.[from];
  if (!l || !(l.servings > 0)) return result(state, [], 'Those leftovers are already gone.', { error: true });
  const prev = state?.plan?.[night];
  if (prev?.status === 'cooked') return result(state, [], 'That night is already cooked.', { error: true });
  const title = l.title || 'Leftovers';
  // The dinner planned that night moves to the next open night, as every other pick does (gauntlet r9:
  // this was the one place a dinner still left the plan). With no open night it stays with the night,
  // to bring back.
  const to = prev?.dinner && prev.status === 'planned' ? nextOpenNight(state, night, today) : null;
  const entry = {
    dinner: to ? null : prev?.dinner ?? null, sides: !to && prev?.sides ? [...prev.sides] : [], status: 'away',
    away: { reason: LEFTOVER_REASON, note: `${title}, from ${weekdayName(from)}`, from }, manual: true, ...stamp(who, at),
  };
  const ops = [set(['plan', night], entry), set(['leftovers', from, 'night'], night)];
  if (to) ops.push(set(['plan', to], { dinner: prev.dinner, sides: prev.sides ? [...prev.sides] : [...(dinnerById(db, state, prev.dinner)?.sides || [])], status: 'planned', manual: true, ...stamp(who, at) }));
  const bumped = to ? ` ${titleOf(db, state, prev.dinner)} moved to ${nightName(to, today)}.`
    : prev?.dinner && prev.status !== 'away' ? ` ${titleOf(db, state, prev.dinner)} comes off that night, and its groceries off the list.` : '';
  return result(state, ops, `${cap(nightName(night, today))} is a leftover night: ${title}.${bumped}`, { movedTo: to });
}

// Where a batch of leftovers can go besides the fridge (docs/spec/21 §21.3, folded into §22.5's one
// model): a serving as someone's packed lunch, or servings into the freezer as a dated shelf item.

/** What one serving of a night's dinner cost in food (a fifth of the dinner and its sides). */
function servingCost(db, state, date, l) {
  const e = state?.plan?.[date];
  const id = e?.dinner || l?.dinner;
  return id && dinnerById(db, state, id) ? round2(dinnerFoodCost(db, state, id, e?.dinner === id ? e : null) / 5) : 0;
}

/**
 * The packed lunches a serving of these leftovers could replace: each packer's next packed lunch
 * from tomorrow (today, when the dinner was last night's) to the leftovers' use-by day.
 * → [{ name, date }]
 */
export function leftoverLunchChoices(db, state, { from, today, after = null }) {
  const l = leftoversOnHand(state, today).find((x) => x.date === from);
  if (!l || l.daysLeft < 0) return [];
  const out = [];
  // `after`: the first day worth offering (tomorrow once today's lunch has been eaten, gauntlet r4).
  let start = from < today ? today : addDays(from, 1);
  if (after && after > start) start = after;
  for (const name of packingNames(db, state)) {
    for (let day = start; day <= l.useBy; day = addDays(day, 1)) {
      const lunch = lunchFor(db, state, name, day);
      if (lunch && !lunch.skip && !lunch.empty) { out.push({ name, date: day }); break; }
    }
  }
  return out;
}

/** One serving goes in `name`'s lunch on `to`: that packed lunch is skipped, so its groceries leave the list. */
export function leftoverLunchOps(db, state, { from, name, to, today }) {
  const l = state?.leftovers?.[from];
  if (!l || !(l.servings > 0)) return result(state, [], 'Those leftovers are already gone.', { error: true });
  if (!leftoverLunchChoices(db, state, { from, today, after: to }).some((c) => c.name === name && c.date === to)) return result(state, [], 'Pick whose lunch it is.', { error: true });
  const what = `leftover ${midSentence(l.title || 'dinner')}`;
  const left = l.servings - 1;
  const ops = [
    set(['lunch', 'days', to, name, 'skip'], true),
    set(['lunch', 'days', to, name, 'reason'], `Leftover ${midSentence(l.title || 'dinner')}`),
    set(['leftovers', from, 'servings'], left),
    set(['leftovers', from, 'lunches'], [...(Array.isArray(l.lunches) ? l.lunches : []), { name, date: to }]),
  ];
  const day = to === today ? 'today' : to === addDays(today, 1) ? 'tomorrow' : `on ${weekdayName(to)}`;
  return result(state, ops, `${name} takes a serving of the ${what} for lunch ${day}. That packed lunch is off the list.${left ? ` ${servingsText(left)} left.` : ''}`, { left });
}

/** The freezer shelf item a dinner's leftovers are kept as ("Leftover chicken fajitas", counted in plates). */
export function leftoverItemId(state, title) {
  const name = `Leftover ${midSentence(title)}`;
  const hit = Object.entries(state?.custom || {}).find(([, c]) => c?.name?.toLowerCase() === name.toLowerCase());
  return { id: hit ? hit[0] : `custom-${slugify(name)}`, name, exists: !!hit };
}

/**
 * Some or all of a batch goes in the freezer: it leaves the fridge count and becomes a shelf item
 * "Leftover …" in the freezer, counted in plates and dated, so it has a use-by (about 3 months),
 * shows with the quick backups and the freezer watch, and is logged if it's ever thrown out.
 */
export function freezeLeftoversOps(db, state, { from, servings = null, today, who, at }) {
  const l = state?.leftovers?.[from];
  if (!l || !(l.servings > 0)) return result(state, [], 'Those leftovers are already gone.', { error: true });
  const now = at || new Date().toISOString();
  const n = Math.max(1, Math.min(l.servings, Math.round(Number(servings) || l.servings)));
  const it = leftoverItemId(state, l.title || 'dinner');
  const each = servingCost(db, state, from, l);
  const prev = state?.pantry?.[it.id];
  const base = prev && !prev.low && typeof prev.qty === 'number' ? prev.qty : 0;
  // Plates already frozen and tonight's share one date: the older one, so nothing hides behind fresh food.
  const since = base > 0 && isISO(prev.since) ? prev.since : (today || chicagoDay(now));
  const ops = [];
  if (!it.exists) ops.push(set(['custom', it.id], { name: it.name, unit: 'plates', aisle: 'Frozen', kind: 'measured', storage: 'freezer', ...(each > 0 ? { each } : {}) }));
  ops.push(
    set(['pantry', it.id], { qty: base + n, stocked: false, since, place: 'freezer', by: who || SHARED_PROFILE, at: now }),
    set(['leftovers', from, 'servings'], l.servings - n),
    set(['leftovers', from, 'frozen'], (Number(l.frozen) || 0) + n),
    set(['leftovers', from, 'item'], it.id),
  );
  const left = l.servings - n;
  return result(state, ops, `${n} ${n === 1 ? 'plate' : 'plates'} of leftover ${midSentence(l.title || 'dinner')} in the freezer. It keeps about 3 months and shows with the quick backups.${left ? ` ${servingsText(left)} still in the fridge.` : ''}`, { item: it.id, left });
}

/** Thrown out (past their best): the batch is done, and the waste log gets what those servings cost. */
export function tossLeftoversOps(db, state, { date, today, who, at }) {
  const l = state?.leftovers?.[date];
  if (!l || !(l.servings > 0)) return result(state, [], 'Those leftovers are already gone.');
  const now = at || new Date().toISOString();
  const cost = round2(servingCost(db, state, date, l) * l.servings);
  const name = `Leftover ${midSentence(l.title || 'dinner')}`;
  const ops = [
    set(['leftovers', date, 'servings'], 0),
    set(['waste', uid('w')], { id: `leftover:${l.dinner || date}`, name, qty: l.servings, unit: 'servings', cost, reason: 'tossed', date: today || chicagoDay(now), estimated: true, since: date, by: who || SHARED_PROFILE, at: now }),
  ];
  return result(state, ops, `Logged: ${servingsText(l.servings)} of ${midSentence(name)} thrown out${cost ? `, about $${cost.toFixed(2)}` : ''}. Next time, a leftover night or the freezer saves it.`);
}

// ---------------------------------------------------------------- thaw & prep jobs (gauntlet r4)

/**
 * Tick a thaw or prep job off (or back on) for that day. Shared with the family, so whoever did it
 * clears it for everyone; days more than a week old are dropped as the record grows.
 */
export function prepDoneOps(state, { date, key, done = true, who = SHARED_PROFILE, at = null, today = null }) {
  if (!date || !key) return result(state, [], '');
  const ops = [done ? set(['prepDone', date, key], { by: who, at: at || new Date().toISOString() }) : del(['prepDone', date, key])];
  if (today) for (const d of Object.keys(state?.prepDone || {})) if (d < addDays(today, -7)) ops.push(del(['prepDone', d]));
  return result(state, ops, done ? 'Done for everyone.' : 'It’s back on the to-do list.');
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

/**
 * A side for one night only (gauntlet r4: one tap by a kid shouldn't change the family's side for good).
 * It is written into that night's `sides`; a remembered substitution for the slot still wins, so the
 * sheet only offers this when there isn't one.
 */
export function nightSideOps(db, state, { date, dinnerId, slot, ref }) {
  const d = dinnerById(db, state, dinnerId);
  const entry = state?.plan?.[date];
  if (!d || !parseSideRef(ref) || entry?.dinner !== dinnerId) return result(state, [], "Couldn't use that side.", { error: true });
  const before = effectiveSides(db, state, dinnerId, entry).find((s) => s.slot === slot);
  const sides = Array.isArray(entry.sides) ? [...entry.sides] : [...d.sides];
  while (sides.length <= slot) sides.push(null);
  sides[slot] = ref;
  const newTitle = sideInfo(db, state, parseSideRef(ref))?.title || 'that side';
  const oldTitle = before ? sideInfo(db, state, before.parsed)?.title : null;
  const ops = [set(['plan', date, 'sides'], sides)];
  return result(state, ops, `${weekdayName(date)} only: ${newTitle}${oldTitle && before.ref !== ref ? ` instead of ${midSentence(oldTitle)}` : ''}.`);
}

export function resetSideOps(db, state, { dinnerId, slot }) {
  const d = dinnerById(db, state, dinnerId);
  if (!state?.substitutions?.[dinnerId]?.[String(slot)]) return result(state, [], 'Already the recipe’s side.');
  const isAdded = slot >= (d?.sideSlots || 2);
  const def = d?.sides?.[slot] ? sideInfo(db, state, parseSideRef(d.sides[slot]))?.title : null;
  const message = isAdded ? `Removed the extra side from ${d?.title || 'that dinner'}.` : `${d?.title || 'That dinner'} is back to ${def || 'its usual side'}.`;
  return result(state, [del(['substitutions', dinnerId, String(slot)])], message);
}

// ---------------------------------------------------------------- the family's signal, retire, promote (docs/spec/20)

function retireBundle(db, state, { dinnerId, by, at, today }) {
  const ops = [set(['retired', dinnerId], { by: by || SHARED_PROFILE, at })];
  const bench = bestBenchFor(db, state, dinnerId);
  const d = dinnerById(db, state, dinnerId);
  let message;
  const name = d?.title || 'That dinner';
  const lead = `${name} is marked “not for us”, so it’s off the menu.`;
  if (bench) {
    ops.push(set(['promoted', bench.id], { replaced: dinnerId, at }));
    // Nights after tonight only: tonight's groceries are bought and it may be on the stove (docs/spec/29).
    const future = Object.entries(state?.plan || {}).filter(([date, e]) => e?.dinner === dinnerId && e.status === 'planned' && (!today || date > today));
    for (const [date, e] of future) ops.push(set(['plan', date], { ...clone(e), dinner: bench.id, sides: [...bench.sides] }));
    message = `${lead} ${bench.title} takes its place`;
    message += future.length ? ` in the rotation and on ${future.length === 1 ? 'its planned night' : `its ${future.length} planned nights`}.` : ' in the rotation.';
  } else {
    message = `${lead} Every bench dinner is already in the rotation, so nothing new comes in.`;
  }
  return { ops, message, promoted: bench?.id || null, replacedNights: bench ? Object.entries(state?.plan || {}).filter(([date, e]) => e?.dinner === dinnerId && e.status === 'planned' && (!today || date > today)).length : 0 };
}

/**
 * Set the family's one signal for a dinner: 'loved' | 'fine' | 'no'.
 * "Not for us" retires it (a bench dinner takes its place, on its planned nights too); moving off
 * "not for us" brings it back. The saved record is replaced whole, so thumbs left over from one
 * profile per person can't outvote what the family just said.
 */
export function rateDinnerOps(db, state, { dinnerId, signal, who, at, today }) {
  const d = dinnerById(db, state, dinnerId);
  if (!d) return result(state, [], "That dinner isn't in the recipe box.", { error: true });
  if (!SIGNALS.includes(signal)) return result(state, [], 'Pick loved, fine or not for us.', { error: true });
  const was = dinnerSignal(state, d);
  if (was === signal) return result(state, [], '', { kind: 'same' });
  const ops = [];
  const rec = votesForSignal(signal, { explicitFine: d.tags.includes('family favorite') });
  if (rec) ops.push(set(['votes', dinnerId], rec));
  else if (state?.votes?.[dinnerId] !== undefined) ops.push(del(['votes', dinnerId]));
  // A "loved" that followed the dinner from the id it replaced (planner.followRenames) is settled here.
  for (const old of formerIds(db, dinnerId)) if (state?.votes?.[old] !== undefined) ops.push(del(['votes', old]));
  if (signal === 'no') {
    const b = retireBundle(db, state, { dinnerId, by: who, at: at || new Date().toISOString(), today });
    return result(state, [...ops, ...b.ops], b.message, { retired: true, promoted: b.promoted, replacedNights: b.replacedNights, signal });
  }
  if (state?.retired?.[dinnerId]) ops.push(del(['retired', dinnerId]));
  if (was === 'no') {
    // The dinner that came in from the bench stays too.
    return result(state, ops, signal === 'loved' ? `${d.title} is back on the menu, as a family favorite.` : `${d.title} is back on the menu.`, { restored: true, favorite: signal === 'loved', signal });
  }
  if (signal === 'loved') return result(state, ops, `${d.title} is a family favorite now. It gets planned more often.`, { favorite: true, signal });
  return result(state, ops, `${d.title} is back to fine: still in the rotation, just not a favorite.`, { signal });
}

/**
 * The two-button call the screens use (the name and arguments other modules import are kept):
 * value 1 switches "loved" on or off, value -1 switches "not for us" on or off. `signal` sets one directly.
 */
export function voteOps(db, state, { dinnerId, value, signal, who, at, today }) {
  const d = dinnerById(db, state, dinnerId);
  if (!d) return result(state, [], "That dinner isn't in the recipe box.", { error: true });
  const want = signal || (value === 1 ? 'loved' : value === -1 ? 'no' : 'fine');
  const next = !signal && dinnerSignal(state, d) === want ? 'fine' : want;
  return rateDinnerOps(db, state, { dinnerId, signal: next, who, at, today });
}

// ---------------------------------------------------------------- side signal (§9.2, docs/spec/20)

/** What replaces a dropped side, for the dinners in the rotation that use it. */
function sideReplacements(db, state, sideId) {
  const out = new Map();
  for (const d of rotationList(db, state)) {
    const now = effectiveSides(db, state, d.id, null).find((s) => s.droppedId === sideId);
    if (now) out.set(d.id, now.parsed.id);
  }
  return out;
}

/** Set the family's one signal for a side: 'loved' | 'fine' | 'no' (off the menu; dinners that had it get a similar side). */
export function rateSideOps(db, state, { sideId, signal }) {
  const s = db.sides[sideId];
  if (!s) return result(state, [], 'That side isn’t in the recipe box.', { error: true });
  if (!SIGNALS.includes(signal)) return result(state, [], 'Pick loved, fine or not for us.', { error: true });
  const was = sideSignal(state, sideId);
  if (was === signal) return result(state, [], '', { kind: 'same' });
  const rec = votesForSignal(signal);
  const ops = [rec ? set(['sideVotes', sideId], rec) : del(['sideVotes', sideId])];
  let message;
  if (signal === 'no') {
    const reps = [...new Set(sideReplacements(db, applyOpsPure(state, ops), sideId).values())].map((id) => db.sides[id]?.title).filter(Boolean);
    message = `${s.title} is marked “not for us”, so it’s off the menu.`;
    if (reps.length === 1) message += ` ${reps[0]} takes its place.`;
    else if (reps.length > 1) message += ` Dinners that had it get a similar side, like ${listJoin(reps.slice(0, 2).map((x) => x.toLowerCase()))}.`;
  } else if (was === 'no') message = signal === 'loved' ? `${s.title} is back on the menu, as a favorite side.` : `${s.title} is back on the menu.`;
  else if (signal === 'loved') message = `${s.title} is a favorite side now.`;
  else message = `${s.title} is back to fine.`;
  return result(state, ops, message, { dropped: signal === 'no', signal });
}

/** The two-button call the screens use: value 1 switches "loved" on or off, value -1 switches "not for us" on or off. */
export function sideVoteOps(db, state, { sideId, value, signal }) {
  if (!db.sides[sideId]) return result(state, [], 'That side isn’t in the recipe box.', { error: true });
  const want = signal || (value === 1 ? 'loved' : value === -1 ? 'no' : 'fine');
  const next = !signal && sideSignal(state, sideId) === want ? 'fine' : want;
  return rateSideOps(db, state, { sideId, signal: next });
}

/** "Restore" from the Dropped list: the side is back on the menu, as fine. */
export function restoreSideOps(db, state, { sideId }) {
  const t = db.sides[sideId]?.title || 'That side';
  if (sideSignal(state, sideId) !== 'no') return result(state, [], `${t} is already on the menu.`);
  return result(state, [del(['sideVotes', sideId])], `${t} is back on the menu.`);
}

// ---------------------------------------------------------------- lunch thumbs (§9.2)

/** A thumbs-down on a lunch item takes it out of THAT person's lunches only (the people here are the ones who pack). */
export function lunchVoteOps(db, state, { itemId, person, value }) {
  if (!isPacker(db, state, person)) return result(state, [], 'Whose lunch is it?', { error: true });
  const it = lunchItem(db, state, itemId);
  if (!it) return result(state, [], 'That lunch item isn’t in the library.', { error: true });
  const current = state?.lunchVotes?.[itemId]?.[person];
  const clearing = current === value;
  const ops = [clearing ? del(['lunchVotes', itemId, person]) : set(['lunchVotes', itemId, person], value)];
  let message;
  if (clearing && value === -1) {
    const back = (personConfig(db, applyOpsPure(state, ops), person).slots[it.slot] || []).includes(itemId);
    message = back ? `${it.title} is back in ${person}’s lunches.` : `${it.title} can go back in ${person}’s lunches. Add it in the editor.`;
  }
  else if (clearing) message = `Cleared the thumbs up on ${it.title}.`;
  else if (value === 1) message = `${person} likes ${it.title}. It stays in the rotation.`;
  else {
    const cfg = personConfig(db, applyOpsPure(state, ops), person);
    const left = (cfg.slots[it.slot] || []).length;
    message = `${it.title} is out of ${person}’s lunches.${left ? '' : ` Pick another ${it.slot === 'main' ? 'main' : it.slot} in the editor.`}`;
  }
  return result(state, ops, message);
}

/** "Retire from the rotation" is the same thing as marking the dinner "not for us". */
export function retireOps(db, state, { dinnerId, who, at, today }) {
  if (isRetired(state, dinnerId)) return result(state, [], 'Already out of the rotation.');
  return rateDinnerOps(db, state, { dinnerId, signal: 'no', who, at, today });
}

/** "Restore" from the Dropped list: back on the menu with a fresh start (a bench dinner joins the rotation). */
export function restoreOps(db, state, { dinnerId }) {
  const d = dinnerById(db, state, dinnerId);
  const ops = [];
  if (state?.retired?.[dinnerId]) ops.push(del(['retired', dinnerId]));
  if (state?.votes?.[dinnerId] !== undefined) ops.push(del(['votes', dinnerId]));
  for (const old of formerIds(db, dinnerId)) if (state?.votes?.[old] !== undefined) ops.push(del(['votes', old]));
  if (d?.rotation === 'bench' && !isPromoted(state, dinnerId)) ops.push(set(['promoted', dinnerId], { replaced: null, at: new Date().toISOString() }));
  return result(state, ops, `${d?.title || 'That dinner'} is back on the menu, with a fresh start.`);
}

export function promoteOps(db, state, { dinnerId, at }) {
  const d = dinnerById(db, state, dinnerId);
  if (isPromoted(state, dinnerId)) return result(state, [], 'Already in the rotation.');
  return result(state, [set(['promoted', dinnerId], { replaced: null, at: at || new Date().toISOString() })], `${d?.title || 'That dinner'} joins the rotation.`);
}

// ---------------------------------------------------------------- pantry

export function setPantryOps(db, state, { id, qty, stocked, low, who, at }) {
  const prev = state?.pantry?.[id] || {};
  // Everything already on the entry is kept (label, place, bought, sinceAbout, and anything a
  // newer version adds); only the amount, the stocked switch, "running low" and the stamp change.
  const { low: wasLow, by: _by, at: _at, ...kept } = clone(prev);
  const next = { ...kept, qty: prev.qty ?? null, stocked: !!prev.stocked, ...stamp(who, at) };
  if (qty !== undefined) next.qty = qty === null ? null : Math.max(0, round2(Number(qty) || 0));
  if (stocked !== undefined) next.stocked = !!stocked;
  // "Came home" date for use-it-first (SPEC §13, §21.3): set when food arrives on an empty shelf
  // (a new item, one that had run out or was running low, a staple back in stock). More of
  // something that's already there keeps the older date, so last month's chicken doesn't look new
  // because a pound was added; with no date on the old stock it stays undated and the pantry asks.
  const had = !wasLow && (typeof prev.qty === 'number' ? prev.qty > 0 : !!prev.stocked);
  const more = typeof next.qty === 'number' && next.qty > (typeof prev.qty === 'number' && !wasLow ? prev.qty : 0);
  if ((more && !had) || (next.stocked && !prev.stocked && !had) || !prev.at) {
    next.since = chicagoDay(next.at); // the family's day, not the UTC one
    delete next.sinceAbout; // a real date now, not a rough answer
  }
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
    const since = chicagoDay(s.at); // an evening shop is dated today in Glen Ellyn, not tomorrow (UTC)
    const keep = { ...(prev.place ? { place: prev.place } : {}) };
    if (a.staple) ops.push(set(['pantry', a.id], { qty: null, stocked: true, since, ...keep, ...s }));
    else ops.push(set(['pantry', a.id], { ...keep, ...(prev.label ? { label: prev.label } : {}), qty: round2((typeof prev.qty === 'number' && !prev.low ? prev.qty : 0) + a.add), stocked: false, since, bought: { qty: a.add, on: since }, ...s }));
  }
  if (state?.checked?.[list.listKey]) ops.push(del(['checked', list.listKey]));
  return result(state, ops, adds.length ? `Put ${adds.length} ${adds.length === 1 ? 'item' : 'items'} in the pantry. The list now shows only what's still needed.` : 'Check off what you bought first.', { count: adds.length });
}

/**
 * "Fix the price": the item's one product at that store keeps its name and gets this pack size
 * and price, for the whole family (it becomes their product there). Older per-tier price fixes
 * for the item are cleared so they can't come back.
 */
export function setPriceOps(db, state, { store, id, size, price, product = null, who, at }) {
  const key = `${store}/${id}`;
  const prev = state?.myProducts?.[key];
  const name = String(prev?.name || product?.name || db?.ingredients?.[id]?.name || state?.custom?.[id]?.name || 'Item').slice(0, 120);
  const p = {
    ...(prev && typeof prev === 'object' ? prev : {}),
    name,
    packSize: Math.round(Number(size) * 1000) / 1000,
    unit: db?.ingredients?.[id]?.unit || state?.custom?.[id]?.unit || prev?.unit || '',
    price: round2(Number(price)),
    ...stamp(who, at),
    source: 'typed',
  };
  if (!prev && product?.brand) p.brand = String(product.brand).slice(0, 60);
  if (!prev && product?.url && /^https:\/\//.test(product.url)) p.url = String(product.url).slice(0, 400);
  delete p.date;
  delete p.receipt;
  const ops = [set(['myProducts', key], p), ...legacyPriceKeys(state, store, id).map((k) => del(['prices', k]))];
  return result(state, ops, 'Price saved for the whole family.');
}

/** Older price fixes were kept per brand tier: "sams/generic/chicken". Only the ones that exist. */
function legacyPriceKeys(state, store, id) {
  return [`${store}/generic/${id}`, `${store}/name/${id}`, `${store}/${id}`].filter((k) => state?.prices?.[k] !== undefined);
}

export function clearPriceOps(state, { store, id }) {
  return result(state, legacyPriceKeys(state, store, id).map((k) => del(['prices', k])), 'Back to the product’s own price.');
}

export function notAtStoreOps(db, state, { store, id }) {
  const name = db.ingredients[id]?.name || state?.custom?.[id]?.name || 'That item';
  const storeName = db.stores?.[store]?.name || store;
  return result(state, [set(['availability', `${store}/${id}`], false)], `Noted: ${storeName} doesn't carry ${name.toLowerCase()}.`);
}

export function addReceiptOps(state, { date, store, amount, note, who }) {
  const r = { id: uid('r'), date, store, amount: round2(Number(amount)), ...(note ? { note } : {}), by: who || SHARED_PROFILE };
  return { ops: [push(['receipts'], r)], undo: [set(['receipts'], clone(state?.receipts || []))], message: 'Receipt logged.' };
}

export function removeReceiptOps(state, { id }) {
  const list = (state?.receipts || []).filter((r) => r?.id !== id);
  return result(state, [set(['receipts'], list)], 'Receipt removed.');
}

export function addExtraOps(db, state, { name, item, qty = 1, unit = '', store, every = 'trip', price, once = null }) {
  const id = item ? `x-${item}` : `x-${slugify(name)}-${uid().slice(0, 4)}`;
  const x = { name: item ? db.ingredients[item]?.name || name : name, qty: Number(qty) || 1, unit, store: store || (item ? db.ingredients[item]?.defaultStore : 'jewel') || 'jewel', every, ...(item ? { item } : {}), ...(once ? { once } : {}) };
  if (!item && Number.isFinite(Number(price)) && price !== '' && price != null) x.price = round2(Number(price));
  return result(state, [set(['extras', id], x)], once ? `${x.name} added to the ${x.store === 'sams' ? 'Sam’s Club' : 'Jewel-Osco'} list.` : `${x.name} added to every ${every === 'week' ? 'week' : 'trip'}.`);
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
    .map(([id, need]) => ({ id, need, name: db.ingredients[id]?.name || state?.custom?.[id]?.name || readableId(id) }));
}

// ---------------------------------------------------------------- lunches (§8, docs/spec/20)

// Each lunch edit writes only the field it changes (see personConfig), so edits from two
// devices to different parts of the same person's lunches merge instead of overwriting.
const lunchPath = (name, ...rest) => ['lunch', 'people', name, ...rest];

/**
 * Add someone who packs a lunch: a name, the days, and what goes in each spot (slot id → lunch
 * item ids from the lunch list, in rotation order). A spot left empty simply isn't packed.
 */
export function addLunchPersonOps(db, state, { name, days = [1, 2, 3, 4, 5], slots = {}, at }) {
  const r = newPackerName(db, state, name);
  if (r.error) return result(state, [], r.error, { error: true });
  const picked = {};
  let count = 0;
  for (const sl of lunchSlots(db)) {
    // Every spot is written, empty ones too, so a returning name never gets the old defaults back.
    picked[sl.id] = [...new Set((Array.isArray(slots?.[sl.id]) ? slots[sl.id] : []).filter((id) => lunchItem(db, state, id)?.slot === sl.id))];
    count += picked[sl.id].length;
  }
  const dayList = [...new Set((Array.isArray(days) ? days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  if (!dayList.length) return result(state, [], 'Pick at least one day.', { error: true });
  const ops = [set(lunchPath(r.name), { enabled: true, added: chicagoDay(at || new Date()), days: dayList, slots: picked })];
  // A thumbs-down this name left behind would quietly take a chosen item back out.
  for (const id of Object.values(picked).flat()) if (state?.lunchVotes?.[id]?.[r.name] === -1) ops.push(del(['lunchVotes', id, r.name]));
  const message = count
    ? `${r.name}’s lunches are planned. Their groceries are on the shopping list.`
    : `${r.name} is added. Pick what goes in the lunches next.`;
  return result(state, ops, message, { name: r.name, count });
}

/** Pause: nothing is packed or bought, the picks are kept, and the person stays on the Lunch page. Resume undoes it. */
export function pauseLunchPersonOps(db, state, { name, paused = true }) {
  if (!isPacker(db, state, name)) return result(state, [], `${name || 'That person'} isn’t on the lunch plan.`, { error: true });
  if (paused) {
    return result(state, [set(lunchPath(name, 'enabled'), false), set(lunchPath(name, 'paused'), true)], `${name}’s lunches are paused. Nothing is packed, and their groceries are off the list.`);
  }
  const ops = [set(lunchPath(name, 'enabled'), true)];
  if (state?.lunch?.people?.[name]?.paused !== undefined) ops.push(del(lunchPath(name, 'paused')));
  return result(state, ops, `${name}’s lunches are back on. Their groceries are on the list.`);
}

/** Remove: off the Lunch page and their picks forgotten (Undo is on the message). Days already packed stay as they were. */
export function removeLunchPersonOps(db, state, { name }) {
  if (!isPacker(db, state, name)) return result(state, [], `${name || 'That person'} isn’t on the lunch plan.`, { error: true });
  return result(state, [set(lunchPath(name), { enabled: false, removed: true })], `${name} is off the lunch plan, and their lunch groceries are off the list.`);
}

/** The "Pack lunches for …" switch: off is a pause, on resumes. */
export function setLunchEnabledOps(db, state, { name, enabled }) {
  if (isPacker(db, state, name)) return pauseLunchPersonOps(db, state, { name, paused: !enabled });
  return result(state, [set(lunchPath(name, 'enabled'), !!enabled)], enabled ? `${name}’s lunches are on.` : `${name}’s lunches are off. Their groceries are off the list.`);
}

/** Lighter-swap ideas for one person's lunches: on for the grown-ups to start with, off for everyone else. */
export function setLunchIdeasOps(db, state, { name, on }) {
  return result(state, [set(lunchPath(name, 'ideas'), !!on)], on ? `Lighter swap ideas are on for ${name}’s lunches.` : `No more swap ideas for ${name}’s lunches.`);
}

export function toggleLunchDayOps(db, state, { name, day }) {
  const cfg = personConfig(db, state, name);
  const days = cfg.days.includes(day) ? cfg.days.filter((d) => d !== day) : [...cfg.days, day].sort();
  return result(state, [set(lunchPath(name, 'days'), days)], '');
}

/** Tap an item in the editor: adds it to the end of that slot's rotation, or takes it out. */
export function toggleLunchItemOps(db, state, { name, slot, id }) {
  const cfg = personConfig(db, state, name);
  const list = cfg.slots[slot] || [];
  const adding = !list.includes(id);
  const next = adding ? [...list, id] : list.filter((x) => x !== id);
  const ops = [set(lunchPath(name, 'slots', slot), next)];
  // Putting a thumbs-downed item back in by hand takes the thumbs-down back too.
  if (adding && state?.lunchVotes?.[id]?.[name] === -1) ops.push(del(['lunchVotes', id, name]));
  return result(state, ops, '');
}

export function skipLunchOps(db, state, { name, date, reason = 'Other', today }) {
  const ops = [set(['lunch', 'days', date, name, 'skip'], true), set(['lunch', 'days', date, name, 'reason'], reason)];
  return result(state, ops, `${name} won’t need a packed lunch ${date === today ? 'today' : `on ${weekdayName(date)}`}. Its groceries are off the list.`);
}

export function unskipLunchOps(db, state, { name, date }) {
  const ops = [del(['lunch', 'days', date, name, 'skip']), del(['lunch', 'days', date, name, 'reason'])];
  return result(state, ops, `${name}’s lunch is back on.`);
}

/** Swap one slot for one day (id null = leave it out that day). */
export function pickLunchOps(db, state, { name, date, slot, id }) {
  const item = id ? lunchItem(db, state, id) : null;
  return result(state, [set(['lunch', 'days', date, name, 'picks', slot], id || null)], item ? `${item.title} for ${name} that day.` : `Nothing in that spot for ${name} that day.`);
}

export function resetLunchPickOps(db, state, { name, date, slot }) {
  return result(state, [del(['lunch', 'days', date, name, 'picks', slot])], 'Back to the usual rotation.');
}

/** Apply a lighter lunch swap to the person's rotation (remembered for every day). */
export function applyLunchSwapOps(db, state, { name, from, to }) {
  const cfg = swappedConfig(db, state, name, from, to);
  const slot = lunchItem(db, state, from)?.slot;
  if (!cfg || !slot) return result(state, [], "That swap doesn't apply any more.", { error: true });
  const t = lunchItem(db, state, to)?.title || 'the lighter pick';
  return result(state, [set(lunchPath(name, 'slots', slot), cfg.slots[slot])], `${name}’s lunches now use ${t}.`);
}

/** A family-made lunch item: a shelf item to buy (priced later on the list) plus the lunch entry. */
export function addCustomLunchOps(db, state, { title, slot, name }) {
  const clean = String(title || '').trim();
  if (!clean) return result(state, [], 'Give it a name first.', { error: true });
  const shelf = customItemOps(state, { name: clean, unit: 'each', aisle: 'Snacks & Extras', kind: 'measured', storage: 'pantry' });
  let id = `lunch-${slugify(clean)}`;
  let n = 2;
  while (state?.lunch?.custom?.[id] || db?.lunch?.items?.[id]) id = `lunch-${slugify(clean)}-${n++}`;
  const ops = [...shelf.ops, set(['lunch', 'custom', id], { slot, title: clean, items: { [shelf.id]: 1 }, tags: ['family'] })];
  if (name) {
    const cfg = personConfig(db, state, name);
    ops.push(set(lunchPath(name, 'slots', slot), [...(cfg.slots[slot] || []), id]));
  }
  return result(state, ops, `${clean} added${name ? ` to ${name}’s lunches` : ''}. Add its price on the shopping list.`, { id });
}

// ---------------------------------------------------------------- my products (§9.5)

/** Choose the exact product for an ingredient at a store (from a receipt, products.json, or typed). */
export function setProductOps(db, state, { store, id, product, who, at }) {
  const name = String(product?.name || '').trim().slice(0, 120);
  if (!name || !['sams', 'jewel'].includes(store)) return result(state, [], 'Give the product a name first.', { error: true });
  const packSize = Number(product.packSize);
  const price = product.price === '' || product.price == null ? null : Number(product.price);
  const p = {
    name,
    packSize: packSize > 0 ? Math.round(packSize * 1000) / 1000 : null,
    unit: db.ingredients[id]?.unit || state?.custom?.[id]?.unit || '',
    price: Number.isFinite(price) && price >= 0 ? round2(price) : null,
    ...stamp(who, at),
    source: ['receipt', 'pick', 'typed'].includes(product.source) ? product.source : 'pick',
  };
  if (product.brand) p.brand = String(product.brand).slice(0, 60);
  if (product.size) p.size = String(product.size).slice(0, 40);
  if (product.url && /^https:\/\//.test(product.url)) p.url = String(product.url).slice(0, 400);
  if (product.date) p.date = product.date;
  if (product.receipt) p.receipt = product.receipt;
  if (p.packSize == null) delete p.packSize;
  if (p.price == null) delete p.price;
  const storeName = db.stores?.[store]?.name || store;
  return result(state, [set(['myProducts', `${store}/${id}`], p), ...legacyPriceKeys(state, store, id).map((k) => del(['prices', k]))], `${storeName}: ${name} from now on.`);
}

export function clearProductOps(db, state, { store, id }) {
  const name = db.ingredients[id]?.name || state?.custom?.[id]?.name || 'That item';
  return result(state, [del(['myProducts', `${store}/${id}`])], `${name} is back to the suggested product.`);
}

export { listJoin };
