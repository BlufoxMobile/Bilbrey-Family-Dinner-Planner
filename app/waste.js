// Stop waste before it happens, and keep the pantry true (SPEC §21.3).
//  - The waste log: taking something off the shelf asks why. "Threw it out" is logged with what it
//    cost, the Budget page adds it up, and the planner uses repeat offenders sooner and buys less.
//  - "About when did this go in?" for food with no came-home date.
//  - Leftovers after a cooked dinner: a lunch, a leftovers night, or a dated plate on the shelf.
//  - Catch-up: dinners that were never marked cooked and packed lunches that never left the shelf
//    are how the pantry drifts from the kitchen.
// Pure: no DOM, no clock (today is passed in; `at` is a timestamp for the record only).

import { set, del } from './state.js';
import { addDays, clone, fmtQty, midSentence, money, round2, slugify, uid, weekdayName } from './util.js';
import { FAMILY } from './config.js';
import { dinnerById, kindOf, packFor, storeFor } from './planner.js';
import { itemMeta, dinnerFoodCost, unitText } from './shopping.js';
import { lunchFor } from './lunch.js';
import { ABOUT_WHEN, aboutDate } from './freshness.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const stampOf = (at) => at || new Date().toISOString();
const clean = (name) => midSentence(String(name || '').replace(/\s*\(.*?\)\s*/g, ' ').replace(/,.*$/, '').trim());

function getPath(obj, path) {
  let o = obj;
  for (const k of path) {
    if (o === null || typeof o !== 'object' || !(k in o)) return undefined;
    o = o[k];
  }
  return o;
}
/** Ops that put every path the ops touch back the way it is in `state`. */
function undoOf(state, ops) {
  return ops.map((op) => { const prev = getPath(state, op.path); return prev === undefined ? del(op.path) : set(op.path, clone(prev)); }).reverse();
}
const result = (state, ops, message, extra = {}) => ({ ops, undo: undoOf(state, ops), message, ...extra });

// ---------------------------------------------------------------- the waste log

/** Why something leaves the shelf. Only "tossed" is waste. */
export const REMOVE_REASONS = [
  { id: 'used', label: 'Used it up', note: 'We ate it. Nothing wasted.' },
  { id: 'tossed', label: 'Threw it out', note: 'It went bad or got freezer-burnt. Goes in the waste log.' },
  { id: 'wrong', label: 'Wrong count', note: 'It was never there, or it was counted twice.' },
];

/** Tossed food from the last this-many days makes an item a repeat offender. */
export const WASTE_WINDOW_DAYS = 120;

/**
 * What an amount of an item is worth: the amount × the price per unit of the product the family
 * buys. No amount on record (a stocked staple) counts as half a pack. → { cost, estimated } (cost
 * null when nothing is known about its price).
 */
export function wasteCost(db, state, id, qty) {
  const own = Number(state?.custom?.[id]?.each); // a saved plate of leftovers carries its own value
  if (own > 0 && qty > 0) return { cost: round2(own * qty), estimated: true };
  const store = storeFor(db, state, id, 'both');
  const p = packFor(db, state, id, store) || packFor(db, state, id, store === 'sams' ? 'jewel' : 'sams');
  if (!p || !(p.size > 0)) return { cost: null, estimated: true };
  if (!(qty > 0)) return { cost: round2(p.price / 2), estimated: true };
  return { cost: round2((p.price / p.size) * qty), estimated: false };
}

/** Every logged toss, newest first. → [{ key, id, name, qty, unit, cost, reason, date, by }] */
export function wasteEntries(state) {
  return Object.entries(state?.waste || {})
    .filter(([, w]) => w && typeof w === 'object' && ISO.test(String(w.date || '')))
    .map(([key, w]) => ({ key, ...w, cost: Number.isFinite(Number(w.cost)) ? Number(w.cost) : 0 }))
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.at || '').localeCompare(String(a.at || '')));
}

const EMPTY = new Map();
const countCache = new WeakMap();
/** How many times each item was thrown out in the `days` before `ref`. → Map(id → times) */
export function tossCounts(state, ref, days = WASTE_WINDOW_DAYS) {
  if (!state?.waste || typeof state.waste !== 'object' || !ISO.test(String(ref || ''))) return EMPTY;
  let byRef = countCache.get(state.waste);
  if (!byRef) countCache.set(state.waste, (byRef = new Map()));
  const k = `${ref}|${days}`;
  if (byRef.has(k)) return byRef.get(k);
  const from = addDays(ref, -days);
  const out = new Map();
  for (const w of Object.values(state.waste)) {
    if (!w || w.reason !== 'tossed' || !ISO.test(String(w.date || '')) || w.date <= from || w.date > ref) continue;
    out.set(w.id, (out.get(w.id) || 0) + 1);
  }
  byRef.set(k, out);
  return out;
}

/** Thrown out twice or more lately: the planner buys the smaller pack and uses it sooner. */
export const isRepeatOffender = (state, id, ref) => (tossCounts(state, ref).get(id) || 0) >= 2;

/**
 * The waste log, added up. → { month, total, count, items: [entries this month], lastMonth,
 *   top: [{ id, name, times, cost, last }] (the last 90 days, most often first), yearToDate }
 */
export function wasteSummary(state, today) {
  const all = wasteEntries(state).filter((w) => w.reason === 'tossed');
  const month = today.slice(0, 7);
  const items = all.filter((w) => w.date.slice(0, 7) === month);
  const prev = addDays(`${month}-01`, -1).slice(0, 7);
  const from = addDays(today, -90);
  const by = new Map();
  for (const w of all) {
    if (w.date <= from || w.date > today) continue;
    const t = by.get(w.id) || { id: w.id, name: w.name, times: 0, cost: 0, last: w.date };
    t.times++; t.cost = round2(t.cost + w.cost);
    if (w.date > t.last) t.last = w.date;
    by.set(w.id, t);
  }
  const sum = (list) => round2(list.reduce((t, w) => t + w.cost, 0));
  return {
    month, total: sum(items), count: items.length, items,
    lastMonth: sum(all.filter((w) => w.date.slice(0, 7) === prev)),
    yearToDate: sum(all.filter((w) => w.date.slice(0, 4) === today.slice(0, 4))),
    top: [...by.values()].sort((a, b) => b.times - a.times || b.cost - a.cost || a.name.localeCompare(b.name)),
  };
}

/**
 * Take some or all of an item off the shelf, saying why (SPEC §21.3).
 *   used   – eaten: the amount drops (or the row goes); nothing is logged.
 *   tossed – thrown out: the same, and the waste log gets { id, name, qty, unit, cost, reason, date }.
 *   wrong  – it was never there, or counted twice: the amount drops (or the row goes); nothing is logged.
 * `qty` is how much (in the item's unit); leave it out for all of it.
 */
export function removeItemOps(db, state, { id, reason = 'used', qty = null, today, who, at }) {
  const p = state?.pantry?.[id];
  const m = itemMeta(db, state, id);
  if (!p) return result(state, [], `${m.name} isn’t in the pantry.`);
  const now = stampOf(at);
  const have = typeof p.qty === 'number' ? p.qty : null;
  const asked = Number(qty);
  const amount = have == null ? (asked > 0 ? asked : null) : (asked > 0 ? Math.min(asked, have) : have);
  const all = have == null || amount >= have - 1e-9;
  const ops = [];
  if (all) ops.push(del(['pantry', id]));
  else ops.push(set(['pantry', id, 'qty'], round2(have - amount)), set(['pantry', id, 'at'], now), set(['pantry', id, 'by'], who || 'Family'));
  const name = clean(m.name);
  const howMuch = amount > 0 ? `${unitText(round2(amount), m.unit)} of ` : '';
  if (reason === 'wrong') return result(state, ops, all ? `${m.name} taken off the shelf. Nothing was wasted.` : `Count fixed: ${unitText(round2(have - amount), m.unit)} of ${name}.`);
  if (reason !== 'tossed') {
    return result(state, ops, all ? `${m.name} used up. It’s off the shelf.` : `Used ${howMuch}${name}. ${unitText(round2(have - amount), m.unit)} left.`);
  }
  const { cost, estimated } = wasteCost(db, state, id, amount);
  const entry = {
    id, name: m.name, qty: amount > 0 ? round2(amount) : null, unit: m.unit, cost: cost ?? 0, reason: 'tossed', date: today || now.slice(0, 10),
    ...(estimated ? { estimated: true } : {}), ...(p.since ? { since: p.since } : {}), by: who || 'Family', at: now,
  };
  ops.push(set(['waste', uid('w')], entry));
  const times = (tossCounts(state, entry.date).get(id) || 0) + 1;
  const again = times >= 2 ? ` That’s ${times} times lately, so the planner will buy less of it and use it sooner.` : ' The planner will use it sooner next time.';
  return result(state, ops, `Logged: ${howMuch}${name} thrown out${cost ? `, about ${money(cost)}` : ''}.${again}`, { entry });
}

/** Take a mistaken entry out of the waste log. */
export function removeWasteOps(state, { key }) {
  if (!state?.waste?.[key]) return result(state, [], 'That’s already gone from the waste log.');
  return result(state, [del(['waste', key])], 'Removed from the waste log.');
}

// ---------------------------------------------------------------- about when did this go in?

/** A rough came-home date for food nobody dated: this week / this month / older. */
export function aboutSinceOps(db, state, { id, about, today }) {
  const date = aboutDate(today, about);
  const p = state?.pantry?.[id];
  if (!p || !date) return result(state, [], 'That item isn’t in the pantry.');
  const label = ABOUT_WHEN.find((a) => a.id === about).label.toLowerCase();
  const ops = [set(['pantry', id, 'since'], date), set(['pantry', id, 'sinceAbout'], about)];
  return result(state, ops, `${itemMeta(db, state, id).name}: went in ${label === 'older' ? 'a while ago' : label}. It has a use-by now.`);
}

// ---------------------------------------------------------------- leftovers

/** Nights whose dinner was cooked today or yesterday and nobody has said whether any was left. */
export function leftoverAsks(db, state, today) {
  const out = [];
  for (const date of [today, addDays(today, -1)]) {
    const e = state?.plan?.[date];
    const d = e?.status === 'cooked' && e.dinner ? dinnerById(db, state, e.dinner) : null;
    if (d && !e.leftovers) out.push({ date, dinner: d.id, title: d.title });
  }
  return out;
}

/**
 * What can be done with a cooked night's leftovers: the next packed lunch they could replace, and
 * the next nights that could become a leftovers night (never a cooked, away or hand-set night).
 * → { dinner, title, lunch: { name, date } | null, nights: [{ date, title, open }] }
 */
export function leftoverChoices(db, state, { date, today }) {
  const e = state?.plan?.[date];
  const d = e?.dinner ? dinnerById(db, state, e.dinner) : null;
  if (!d) return null;
  const from = date < today ? today : addDays(date, 1);
  let lunch = null;
  for (let k = 0; k < 3 && !lunch; k++) {
    const day = addDays(from, k);
    for (const name of FAMILY) {
      const l = lunchFor(db, state, name, day);
      if (l && !l.skip && !l.empty) { lunch = { name, date: day }; break; }
    }
  }
  const nights = [];
  for (let k = 0; k < 3; k++) {
    const day = addDays(from, k);
    if (day === date) continue;
    const x = state?.plan?.[day];
    if (x && (x.status === 'cooked' || x.status === 'away' || (x.manual && x.dinner))) continue;
    const xd = x?.dinner ? dinnerById(db, state, x.dinner) : null;
    nights.push({ date: day, title: xd?.title || '', open: !xd });
  }
  return { dinner: d.id, title: d.title, lunch, nights };
}

/** The shelf item a dinner's leftovers are kept as ("Leftover chicken fajitas", counted in plates). */
export function leftoverItemId(state, title) {
  const name = `Leftover ${midSentence(title)}`;
  const hit = Object.entries(state?.custom || {}).find(([, c]) => c?.name?.toLowerCase() === name.toLowerCase());
  return { id: hit ? hit[0] : `custom-${slugify(name)}`, name, exists: !!hit };
}

/**
 * Record what happened to a cooked night's leftovers so they get eaten (SPEC §21.3):
 *   none    – nothing left.
 *   lunch   – `name` takes them on `to`: that packed lunch is skipped, its groceries leave the list.
 *   night   – `to` becomes a leftovers night: no dinner to cook or shop for; the planner leaves it be.
 *   fridge / freezer – `plates` go on the shelf as "Leftover …" with today's date, so they get a
 *             use-by (4 days cold, 3 months frozen), show under quick backups and never sit unseen.
 */
export function leftoversOps(db, state, { date, use, to = null, name = null, plates = 2, today, who, at }) {
  const e = state?.plan?.[date];
  const d = e?.dinner ? dinnerById(db, state, e.dinner) : null;
  if (!d || e.status !== 'cooked') return result(state, [], 'That night isn’t marked cooked.', { error: true });
  const now = stampOf(at);
  const by = who || 'Family';
  const mark = (extra = {}) => set(['plan', date, 'leftovers'], { use, ...extra, by, at: now });
  const from = `${date === today ? 'tonight' : weekdayName(date)}`;
  if (use === 'none') return result(state, [mark()], `No leftovers from ${d.title}. Noted.`);
  if (use === 'lunch') {
    if (!FAMILY.includes(name) || !ISO.test(String(to || ''))) return result(state, [], 'Pick whose lunch it is.', { error: true });
    const ops = [mark({ to, name }), set(['lunch', 'days', to, name, 'skip'], true), set(['lunch', 'days', to, name, 'reason'], `Leftover ${midSentence(d.title)}`)];
    return result(state, ops, `${name} takes the leftover ${midSentence(d.title)} for lunch ${to === addDays(today, 1) ? 'tomorrow' : to === today ? 'today' : `on ${weekdayName(to)}`}. That packed lunch is off the list.`);
  }
  if (use === 'night') {
    const x = state?.plan?.[to];
    if (!ISO.test(String(to || '')) || x?.status === 'cooked' || x?.status === 'away' || (x?.manual && x?.dinner)) return result(state, [], 'Pick an open night.', { error: true });
    const was = x?.dinner ? dinnerById(db, state, x.dinner) : null;
    const entry = { dinner: null, sides: [], status: 'away', away: { reason: 'Other', note: `Leftovers: ${midSentence(d.title)} from ${from === 'tonight' ? weekdayName(date) : from}`, leftovers: { from: date, dinner: d.id } }, manual: true, by, at: now };
    return result(state, [mark({ to }), set(['plan', to], entry)], `${weekdayName(to)} is a leftovers night: ${midSentence(d.title)}.${was ? ` ${was.title} comes off the plan, and its groceries off the list.` : ''}`);
  }
  if (use === 'fridge' || use === 'freezer') {
    const n = Math.max(1, Math.min(10, Math.round(Number(plates) || 2)));
    const it = leftoverItemId(state, d.title);
    const prev = state?.pantry?.[it.id];
    const each = round2(dinnerFoodCost(db, state, d.id, e) / 5);
    const ops = [mark({ plates: n, item: it.id })];
    if (!it.exists) ops.push(set(['custom', it.id], { name: it.name, unit: 'plates', aisle: 'Frozen', kind: 'measured', storage: use, ...(each > 0 ? { each } : {}) }));
    const base = prev && !prev.low && typeof prev.qty === 'number' ? prev.qty : 0;
    // Yesterday's plates and tonight's share one date: the older one, so nothing hides behind fresh food.
    const since = base > 0 && ISO.test(String(prev.since || '')) ? prev.since : (today || now.slice(0, 10));
    ops.push(set(['pantry', it.id], { qty: base + n, stocked: false, since, place: use, by, at: now }));
    const keep = use === 'freezer' ? 'It keeps about 3 months, and shows under quick backups.' : `Eat it by ${weekdayName(addDays(since, 4))}.`;
    return result(state, ops, `${fmtQty(n)} ${n === 1 ? 'plate' : 'plates'} of leftover ${midSentence(d.title)} in the ${use}. ${keep}`, { item: it.id });
  }
  return result(state, [], 'Pick what happened to the leftovers.', { error: true });
}

// ---------------------------------------------------------------- catching the pantry up

/** Packed lunches from before this day were never tracked: nothing older is taken off the shelf. */
export const LUNCH_SYNC_EPOCH = '2026-11-16';
/** How far back catch-up looks. */
export const CATCH_UP_DAYS = 7;

/** Past nights still marked "planned": cooked and never marked, or skipped. → [{ date, dinner, title }] */
export function uncookedNights(db, state, today, { days = CATCH_UP_DAYS } = {}) {
  const out = [];
  for (let k = days; k >= 1; k--) {
    const date = addDays(today, -k);
    const e = state?.plan?.[date];
    const d = e?.status === 'planned' && e.dinner ? dinnerById(db, state, e.dinner) : null;
    if (d) out.push({ date, dinner: d.id, title: d.title });
  }
  return out;
}

/** "We didn't make it": the night goes back to open, and its food stays on the shelf. */
export function skippedNightOps(db, state, { date }) {
  const e = state?.plan?.[date];
  if (!e) return result(state, [], 'Nothing was planned that night.');
  const t = e.dinner ? dinnerById(db, state, e.dinner)?.title : null;
  return result(state, [del(['plan', date])], `${t || 'That dinner'} wasn’t made ${weekdayName(date)}. Its food is still on the shelf.`);
}

/**
 * Packed lunches on past days (up to a week back) whose food is still counted on the shelf.
 * → [{ date, name, items: { id: qty } }]
 */
export function unpackedLunches(db, state, today, { days = CATCH_UP_DAYS } = {}) {
  const out = [];
  for (let k = days; k >= 1; k--) {
    const date = addDays(today, -k);
    if (date < LUNCH_SYNC_EPOCH) continue;
    for (const name of FAMILY) {
      if (state?.lunchUsed?.[date]?.[name]) continue;
      const l = lunchFor(db, state, name, date);
      if (!l || l.skip || l.empty) continue;
      // Only lunches that would actually change the shelf.
      const hits = Object.keys(l.items).some((id) => typeof state?.pantry?.[id]?.qty === 'number' && state.pantry[id].qty > 0 && kindOf(db, state, id) !== 'staple');
      if (hits) out.push({ date, name, items: l.items });
    }
  }
  return out;
}

/**
 * Take those lunches' food off the shelf (`packed` true), or just note they weren't packed. Each
 * lunch is settled once (`lunchUsed[date][name]`); settled days older than three weeks are cleared.
 */
export function lunchUsedOps(db, state, { today, packed = true, who, at, days = CATCH_UP_DAYS }) {
  const lunches = unpackedLunches(db, state, today, { days });
  if (!lunches.length) return result(state, [], 'Packed lunches are already off the shelves.');
  const now = stampOf(at);
  const rem = {};
  const touched = new Set();
  const ops = [];
  for (const l of lunches) {
    const took = {};
    if (packed) {
      for (const [id, need] of Object.entries(l.items)) {
        const p = state?.pantry?.[id];
        if (!p || typeof p.qty !== 'number' || kindOf(db, state, id) === 'staple') continue;
        const have = rem[id] ?? p.qty;
        const used = round2(Math.min(have, need));
        if (used <= 0) continue;
        rem[id] = round2(have - used);
        took[id] = used;
        touched.add(id);
      }
    }
    ops.push(set(['lunchUsed', l.date, l.name], packed ? { at: now, by: who || 'Family', took } : { at: now, by: who || 'Family', skipped: true }));
  }
  for (const id of touched) ops.push(set(['pantry', id, 'qty'], rem[id]), set(['pantry', id, 'at'], now));
  const old = addDays(today, -21);
  for (const d of Object.keys(state?.lunchUsed || {})) if (ISO.test(d) && d < old) ops.push(del(['lunchUsed', d]));
  const n = lunches.length;
  const message = packed
    ? `${n} packed ${n === 1 ? 'lunch' : 'lunches'} taken off the shelves (${touched.size} ${touched.size === 1 ? 'item' : 'items'}).`
    : `Noted: ${n === 1 ? 'that lunch wasn’t' : `those ${n} lunches weren’t`} packed. The shelves stay as they are.`;
  return result(state, ops, message, { count: n, items: touched.size });
}

/** Everything the pantry is behind on. → { nights, lunches, total } */
export function catchUp(db, state, today) {
  const nights = uncookedNights(db, state, today);
  const lunches = unpackedLunches(db, state, today);
  return { nights, lunches, total: nights.length + lunches.length };
}
