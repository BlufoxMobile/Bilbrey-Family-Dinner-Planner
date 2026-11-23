// Plan ahead, pantry first (SPEC §16, §21.1). Pick a day up to a month out; the planner fills the
// open nights, and re-plans the nights it chose itself, with dinners the pantry already covers,
// oldest and soonest-to-spoil food first (counting the food down night by night), then the rest
// with the usual rules, cheapest to finish first. Packed lunches swap to what's on hand when the
// rotation's item isn't. pantryStretch says how far the pantry carries the plan before the store
// has to; aheadStats is the before/after; tripAdvice says when a trip list is too short.
// Pure: no DOM, no clock (today and `at` are passed in).

import { set, del, normalizeTrip, applyOps } from './state.js';
import { generatePlan, itemsForNight, dinnerById, isFillable } from './planner.js';
import { plannedNights, itemMeta, buildList } from './shopping.js';
import { onHand, ENOUGH } from './coverage.js';
import { keepsDays, placeOf, sinceOf, urgency, useFirstScore, FREEZER_OLD_DAYS } from './freshness.js';
import { lunchFor, lunchItem, personConfig, packingNames } from './lunch.js';
import { addDays, datesBetween, daysInMonth, diffDays, isISODate, money, round2, shortDate, weekdayName } from './util.js';
import { undoFor } from './actions.js';

/** Plan ahead reaches at most this many days past today. */
export const AHEAD_MAX_DAYS = 31;

/** The quick picks in the sheet. "A month" runs to the day before the same date next month. */
export const AHEAD_QUICK = [
  { id: 'week', label: '1 week', days: 7 },
  { id: 'two', label: '2 weeks', days: 14 },
  { id: 'three', label: '3 weeks', days: 21 },
  { id: 'month', label: 'A month', days: null },
];

export const aheadLimit = (today) => addDays(today, AHEAD_MAX_DAYS);

/** The last night a quick pick plans through: 1 week from Monday → Sunday. */
export function aheadEnd(today, id) {
  const q = AHEAD_QUICK.find((x) => x.id === id) || AHEAD_QUICK[0];
  if (q.days) return addDays(today, q.days - 1);
  const [y, m, d] = today.split('-').map(Number);
  const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`;
  const same = `${next}-${String(Math.min(d, daysInMonth(`${next}-01`))).padStart(2, '0')}`;
  return clampAheadEnd(today, addDays(same, -1));
}

/** Any day from today to a month out; anything else comes back inside that window. */
export function clampAheadEnd(today, end) {
  if (!isISODate(end) || end < today) return today;
  const max = aheadLimit(today);
  return end > max ? max : end;
}

// Use it first (urgency, useFirstScore) lives in freshness.js; re-exported here for older callers.
export { urgency, useFirstScore, FREEZER_OLD_DAYS };

// ---------------------------------------------------------------- the shelf, counted down

const enough = (have, need) => have === Infinity || have + 1e-9 >= need * ENOUGH;
const coversAll = (rem, items) => Object.entries(items || {}).every(([id, need]) => enough(rem[id] ?? 0, need));

/** Takes a meal's food off the shelf (what's there; short items just run out). → what it drew. */
function take(rem, items) {
  const drew = {};
  for (const [id, need] of Object.entries(items || {})) {
    const have = rem[id] ?? 0;
    if (have === Infinity || !(need > 0)) continue;
    const got = Math.min(have, need);
    rem[id] = Math.max(0, have - need);
    if (got > 1e-9) drew[id] = got;
  }
  return drew;
}

function shortOf(db, state, rem, items) {
  const out = [];
  for (const [id, need] of Object.entries(items || {})) {
    const have = rem[id] ?? 0;
    if (enough(have, need)) continue;
    const meta = itemMeta(db, state, id);
    out.push({ id, name: meta.name, unit: meta.unit, need: round2(need), have: round2(have), short: round2(need - have) });
  }
  return out;
}

/**
 * Nights that stay as they are keep their food: what a kept night is fully stocked for is set
 * aside first, so a new pantry night never takes the chicken a hand-picked night counts on. (Food
 * a kept night is short of gets bought for it anyway, so it isn't held back.) A night the planner
 * chose itself is only "kept" when it isn't being re-planned.
 */
function setAsideKept(db, state, rem, dates, mode = 'fill') {
  for (const { entry } of plannedNights(db, state, dates).sort((a, b) => a.date.localeCompare(b.date))) {
    if (isFillable(entry, mode)) continue;
    for (const [id, need] of Object.entries(itemsForNight(db, state, entry.dinner, entry))) {
      const have = rem[id] ?? 0;
      if (have !== Infinity && enough(have, need)) rem[id] = Math.max(0, have - need);
    }
  }
}

/**
 * Packed lunches from what's on hand: on each lunch day, a slot whose rotation item the shelf
 * can't cover takes another item from that person's own list for the slot that it can (the one
 * that most needs eating first, else the list's order). Picks and skips the family set by hand
 * are never changed. → [{ date, name, slot, id, instead }]
 */
function lunchPicks(db, state, rem, dates) {
  const out = [];
  for (const date of dates) {
    for (const name of packingNames(db, state)) {
      const l = lunchFor(db, state, name, date);
      if (!l || l.skip) continue;
      const cfg = personConfig(db, state, name);
      for (const s of l.slots) {
        if (!s.item) continue;
        if (s.override || coversAll(rem, s.item.items)) { take(rem, s.item.items); continue; }
        const alts = [...new Set(cfg.slots[s.slot] || [])]
          .filter((id) => id !== s.id)
          .map((id, k) => ({ it: lunchItem(db, state, id), k }))
          .filter((a) => a.it && coversAll(rem, a.it.items))
          .map((a) => ({ ...a, u: useFirstScore(db, state, a.it.items, date) }))
          .sort((a, b) => b.u - a.u || a.k - b.k);
        if (!alts.length) { take(rem, s.item.items); continue; }
        const pick = alts[0].it;
        out.push({ date, name, slot: s.slot, id: pick.id, instead: s.id });
        take(rem, pick.items);
      }
    }
  }
  return out;
}

const dayText = (d) => `${weekdayName(d)}, ${shortDate(d)}`;

/** Same dinner with the same sides? (Who planned it and when don't matter.) */
const sameNight = (a, b) => !!a && !!b && a.dinner === b.dinner && a.status === b.status
  && JSON.stringify((a.sides || []).map((x) => x ?? null)) === JSON.stringify((b.sides || []).map((x) => x ?? null));

/** The state as it would be with these nights and lunch picks written (nothing else is copied). */
function withPlan(state, entries, picks = []) {
  const next = { ...state, plan: { ...(state?.plan || {}), ...entries } };
  if (picks.length) {
    const days = { ...(state?.lunch?.days || {}) };
    for (const p of picks) {
      days[p.date] = { ...(days[p.date] || {}) };
      days[p.date][p.name] = { ...(days[p.date][p.name] || {}), picks: { ...(days[p.date][p.name]?.picks || {}), [p.slot]: p.id } };
    }
    next.lunch = { ...(state?.lunch || {}), days };
  }
  return next;
}

/**
 * The plan for a stretch in three numbers (the before and after of plan ahead):
 * → { dinners (planned), fromPantry (fully stocked, counted down night by night), groceries
 *     (the list's total for the stretch), open (nights with nothing planned) }
 */
export function aheadStats(db, state, { start, end, today = null }) {
  const s = pantryStretch(db, state, { start, end });
  const list = buildList(db, state, { dates: datesBetween(start, end), today });
  return { dinners: s.dinners, fromPantry: s.dinnersCovered, groceries: list.total, open: s.nights.filter((n) => n.open).length };
}

/** One planning pass. mode 'fill' touches open nights only; 'replan' also the planner's own. */
function planPass(db, state, { dates, mode, pantryFirst, by, stamp, today, seed, day0, last }) {
  const common = { db, dates, mode, by, at: stamp, today, seedKey: seed };
  if (!pantryFirst) {
    const rest = generatePlan({ ...common, state });
    return { entries: rest.entries, fromPantry: [], picks: [], unfilled: rest.unfilled };
  }
  const rem = onHand(db, state);
  setAsideKept(db, state, rem, datesBetween(today && today < day0 ? today : day0, last), mode);
  const first = generatePlan({
    ...common, state, strict: true,
    accept: (date, d, items) => coversAll(rem, items),
    bonus: (date, d, items) => 2.5 * useFirstScore(db, state, items, date),
    onPlace: (date, entry, items) => { take(rem, items); },
  }).entries;
  // The second pass keeps the pantry nights (it sees them as set, though they're written as the planner's).
  const held = Object.fromEntries(Object.entries(first).map(([d, e]) => [d, { ...e, manual: true }]));
  const withPantry = { ...state, plan: { ...(state?.plan || {}), ...held } };
  const rest = generatePlan({
    ...common, state: withPantry, reserve: true,
    // Twice the planner's usual weight on cost, and a nudge per thing to buy.
    bonus: (date, d, items, money) => -(money.cost / 14) - 0.12 * money.buys,
  });
  for (const e of Object.values(rest.entries)) take(rem, itemsForNight(db, withPantry, e.dinner, e));
  const entries = { ...first, ...rest.entries };
  const picks = lunchPicks(db, withPlan(state, entries), rem, dates);
  return { entries, fromPantry: Object.keys(first).sort(), picks, unfilled: rest.unfilled };
}

/** Re-planning has to earn it: more dinners from the pantry, or at least this much less to buy. */
export const REPLAN_MIN_SAVING = 3;

/**
 * Plan from `start` through `end`. Cooked and away nights and nights the family set by hand are
 * never touched.
 *   replan (default: on with pantryFirst): also re-plan the nights the planner chose itself, from
 *     tomorrow on (tonight's dinner may already be thawed or started, so it stays). The
 *     app has usually planned weeks ahead already, so without this there is nothing left to fill
 *     and the pantry never gets a say. It only happens when it helps: more dinners straight from
 *     the pantry, or a smaller grocery bill; otherwise those nights stay as they are.
 *   pantryFirst: 1. nights the pantry fully covers, each night scored by how much soon-to-spoil
 *                   and oldest food it uses (urgency), with every planner rule kept (rotation and
 *                   votes, burger and pizza nights, rice limit, no repeats close together, store);
 *                   the shelf is counted down night by night so two nights never share one pack.
 *                2. the rest with the usual planner, favoring dinners with the fewest and cheapest
 *                   things to buy.
 *                3. lunch days swap a slot to what's on hand when the rotation's item isn't.
 * Nights that come out the same as they already are aren't written again.
 * → { ops, undo, message, count, fromPantry: [date], replanned: [date], lunchPicks: [...],
 *     unfilled: [date], start, end, replan (did it), before, after }
 * `before` is the plan as it stood (open nights filled the usual way, so the grocery numbers
 * compare like with like); `after` is the plan this writes. Both are aheadStats.
 */
export function planAheadOps(db, state, { start, end, who, today, at, pantryFirst = true, replan = pantryFirst, seedKey, record = true } = {}) {
  const day0 = today && (!start || start < today) ? today : start;
  const last = today ? clampAheadEnd(today, end) : end;
  const dates = datesBetween(day0, last);
  const by = who || 'Family';
  const stamp = at || new Date().toISOString();
  const seed = seedKey || day0;
  const plan = state?.plan || {};
  const ctx = { dates, pantryFirst, by, stamp, today, seed, day0, last };
  const span = { start: day0, end: last, today };
  // Tonight's dinner is never re-planned: by now it may be thawed, started, or shopped for.
  const own = dates.filter((d) => (!today || d > today) && plan[d]?.dinner && isFillable(plan[d], 'replan'));
  const hadOpen = dates.some((d) => (!today || d >= today) && isFillable(plan[d], 'fill'));

  let pass = planPass(db, state, { ...ctx, mode: 'fill' });
  let after = aheadStats(db, withPlan(state, pass.entries, pass.picks), span);
  let did = false;
  if (replan && own.length) {
    const tonight = today && plan[today]?.dinner && isFillable(plan[today], 'replan') ? { ...state, plan: { ...plan, [today]: { ...plan[today], manual: true } } } : state;
    const re = planPass(db, tonight, { ...ctx, mode: 'replan' });
    const reAfter = aheadStats(db, withPlan(state, re.entries, re.picks), span);
    if (reAfter.fromPantry > after.fromPantry || (reAfter.fromPantry === after.fromPantry && reAfter.groceries < after.groceries - REPLAN_MIN_SAVING)) {
      pass = re; after = reAfter; did = true;
    }
  }
  // Before: the plan as it stood, its open nights filled the way "Plan open nights" would.
  const usual = hadOpen ? generatePlan({ db, state, dates, mode: 'fill', by, at: stamp, today, seedKey: seed }).entries : {};
  const before = { ...aheadStats(db, withPlan(state, usual), span), hadOpen };

  const changed = Object.keys(pass.entries).sort().filter((d) => !sameNight(plan[d], pass.entries[d]));
  const replanned = changed.filter((d) => plan[d]?.dinner);
  const ops = [
    ...changed.map((d) => set(['plan', d], pass.entries[d])),
    ...pass.picks.map((p) => set(['lunch', 'days', p.date, p.name, 'picks', p.slot], p.id)),
  ];
  const n = changed.length;
  const p = pass.fromPantry.length;
  const l = pass.picks.length;
  const open = pass.unfilled.length;
  let message;
  if (!n && !l) {
    message = open ? 'Couldn’t find dinners that fit those rules. Try planning from both stores.'
      : `Every night through ${dayText(last)} is already planned${replan && pantryFirst && own.length ? ', and the plan already makes the most of the pantry' : ''}.`;
  } else {
    // One line (gauntlet r2: the toast was five lines of numbers); the result card has the rest.
    message = n ? `Planned ${n} ${n === 1 ? 'dinner' : 'dinners'} through ${dayText(last)}.` : `Dinners through ${dayText(last)} were already planned.`;
    if (open) message += ` ${open} ${open === 1 ? 'night is' : 'nights are'} still open.`;
  }
  // The result card reads this, so it's there after a reload and on the family's other screens.
  if (record) ops.push(set(['planAhead'], { start: day0, end: last, pantryFirst: !!pantryFirst, replan: !!replan, before, changed: n, by, at: stamp }));
  return { ops, undo: undoFor(state, ops), message, count: n, fromPantry: pass.fromPantry, replanned, lunchPicks: pass.picks, unfilled: pass.unfilled, start: day0, end: last, replan: did, before, after };
}

/** The saved result of the last plan ahead (state.planAhead), or null once its stretch has passed. */
export function aheadRecord(state, today) {
  const a = state?.planAhead;
  if (!a || typeof a !== 'object' || !isISODate(a.start) || !isISODate(a.end) || a.end < today) return null;
  return a;
}

// ---------------------------------------------------------------- how far the pantry carries the plan

/**
 * Walks the days from `start` through `end`, each day's packed lunches and then its dinner taking
 * their food off the shelf (the same counting as "What the pantry covers"). A day is covered when
 * every planned dinner and packed lunch that day is fully stocked; an away or cooked night needs
 * nothing; an open night (nothing planned) ends the run, since the plan stops there.
 * → { coveredThrough: date|null, firstGap: date|null, gapReason: 'short'|'open'|null,
 *     dinnersCovered, dinners, lunchesCovered, lunches,
 *     nights: [{ date, covered, missing, dinnerMissing, lunchMissing, dinner, title, lunches, open, away, cooked }],
 *     usesUp: [{ id, name, since, place, date }] }  (tracked food it eats, oldest first)
 */
export function pantryStretch(db, state, { start, end }) {
  const rem = onHand(db, state);
  const nights = [];
  let dinners = 0; let dinnersCovered = 0; let lunches = 0; let lunchesCovered = 0;
  let coveredThrough = null; let firstGap = null; let gapReason = null;
  const used = new Map();
  const note = (drew, date) => {
    for (const id of Object.keys(drew)) {
      if (used.has(id)) continue;
      const p = state?.pantry?.[id];
      const since = sinceOf(p);
      const place = placeOf(db, state, id);
      // Only food that spoils is worth calling out (frozen, or fresh with a use-by).
      if (!since || (place !== 'freezer' && keepsDays(db, state, id) == null)) continue;
      used.set(id, { id, name: itemMeta(db, state, id).name, since, place, date });
    }
  };
  for (const date of datesBetween(start, end)) {
    const lunchMissing = [];
    let n = 0;
    for (const name of packingNames(db, state)) {
      const l = lunchFor(db, state, name, date);
      if (!l || l.skip || l.empty) continue;
      n++; lunches++;
      const miss = shortOf(db, state, rem, l.items);
      note(take(rem, l.items), date);
      if (miss.length) lunchMissing.push(...miss.map((m) => ({ ...m, person: name })));
      else lunchesCovered++;
    }
    const e = state?.plan?.[date];
    const d = e?.dinner ? dinnerById(db, state, e.dinner) : null;
    const away = e?.status === 'away';
    const cooked = e?.status === 'cooked';
    const planned = !!d && e.status === 'planned';
    const open = !away && !cooked && !planned;
    let dinnerMissing = [];
    if (planned) {
      dinners++;
      const items = itemsForNight(db, state, e.dinner, e);
      dinnerMissing = shortOf(db, state, rem, items);
      note(take(rem, items), date);
      if (!dinnerMissing.length) dinnersCovered++;
    }
    const covered = !open && !dinnerMissing.length && !lunchMissing.length;
    const missing = [...dinnerMissing];
    for (const m of lunchMissing) if (!missing.some((x) => x.id === m.id)) missing.push(m);
    nights.push({ date, covered, missing, dinnerMissing, lunchMissing, dinner: planned ? e.dinner : null, title: planned ? d.title : '', lunches: n, open, away, cooked });
    if (firstGap) continue;
    if (covered) coveredThrough = date;
    else { firstGap = date; gapReason = open ? 'open' : 'short'; }
  }
  const usesUp = [...used.values()].sort((a, b) => a.since.localeCompare(b.since) || a.name.localeCompare(b.name));
  return { coveredThrough, firstGap, gapReason, dinnersCovered, dinners, lunchesCovered, lunches, nights, usesUp };
}

// ---------------------------------------------------------------- the list for the time frame

/** Same key the List uses for a trip's check-offs and skips (views/list.js tripKey). */
export const tripKeyOf = (t) => `trip:${t.start}:${t.end}:${t.store}`;

/**
 * "Make the shopping list": a trip list (SPEC §12.1) from today through the planned day, both
 * stores, so it buys only what the pantry doesn't cover. A trip in progress starts fresh.
 */
export function shoppingTripOps(state, { today, end, who, at, store = 'both' }) {
  const trip = { start: today, end: end < today ? today : end, store, by: who || 'Family', at: at || new Date().toISOString() };
  const ops = [set(['settings', 'trip'], trip)];
  // A different trip's check-offs and skips go (as when the List starts a trip); the same trip keeps them.
  const prev = normalizeTrip(state?.settings?.trip);
  const k = prev ? tripKeyOf(prev) : null;
  if (k && k !== tripKeyOf(trip)) {
    if (state?.checked?.[k]) ops.push(del(['checked', k]));
    if (state?.skips?.[k]) ops.push(del(['skips', k]));
  }
  const where = { sams: 'Sam’s Club', jewel: 'Jewel-Osco' }[store] || 'both stores';
  return { ops, undo: undoFor(state, ops), message: `Shopping list for ${where}, through ${dayText(trip.end)}: only what the pantry doesn’t cover.` };
}

// ---------------------------------------------------------------- fewer trips (SPEC §21.4)

/** A trip list should cover at least this many days: three trips a month, not one every few days. */
export const TRIP_MIN_DAYS = 10;

const tripList = (db, state, trip, today) => {
  const start = trip.start > today ? trip.start : today;
  return buildList(db, state, { dates: datesBetween(start, trip.end), listKey: tripKeyOf(trip), store: trip.store === 'both' ? null : trip.store, split: trip.store === 'both', today });
};

/** The ops that stretch the trip in progress to `days` days from today, planning its open nights. */
function extension(db, state, { today, days, who, at }) {
  const trip = normalizeTrip(state?.settings?.trip);
  if (!trip || trip.end < today) return null;
  const end = clampAheadEnd(today, addDays(today, days - 1));
  if (end <= trip.end) return null;
  const stamp = at || new Date().toISOString();
  const fill = planAheadOps(db, state, { start: addDays(trip.end, 1), end, who, today, at: stamp, pantryFirst: true, replan: false, record: false });
  const next = { ...trip, end, by: who || trip.by || 'Family', at: stamp };
  const ops = [...fill.ops, set(['settings', 'trip'], next)];
  // What's already checked off or skipped comes along to the longer list.
  const from = tripKeyOf(trip);
  const to = tripKeyOf(next);
  for (const k of ['checked', 'skips']) {
    if (state?.[k]?.[from]) ops.push(set([k, to], state[k][from]), del([k, from]));
  }
  return { ops, trip, next, planned: fill.count, unfilled: fill.unfilled.length };
}

/**
 * Is the trip list in progress long enough to skip the next store run? A list that covers fewer
 * than 10 days means another trip within the week. → null when there's no trip, else
 * { trip, days (it covers, from today), short, more (days to add), newEnd, open (nights in the
 *   extra days with nothing planned yet), total (this list), longer (the list if extended, open
 *   nights planned pantry first), added (longer − total) }
 */
export function tripAdvice(db, state, { today, min = TRIP_MIN_DAYS }) {
  const trip = normalizeTrip(state?.settings?.trip);
  if (!trip || trip.end < today) return null;
  const days = diffDays(trip.end, today) + 1;
  const total = tripList(db, state, trip, today).total;
  if (days >= min) return { trip, days, short: false, more: 0, newEnd: trip.end, open: 0, total, longer: total, added: 0 };
  const x = extension(db, state, { today, days: min, who: null, at: 'x' });
  if (!x) return { trip, days, short: false, more: 0, newEnd: trip.end, open: 0, total, longer: total, added: 0 };
  const longer = tripList(db, applyOps(state, x.ops), x.next, today).total;
  const extra = datesBetween(addDays(trip.end, 1), x.next.end);
  const open = extra.filter((d) => isFillable(state?.plan?.[d], 'fill')).length;
  return { trip, days, short: true, more: extra.length, newEnd: x.next.end, open, total, longer, added: round2(longer - total) };
}

/** "Extend the trip": the list grows to 10 days, and any open night in them gets planned (pantry first). */
export function extendTripOps(db, state, { today, who, at, days = TRIP_MIN_DAYS }) {
  const x = extension(db, state, { today, days, who, at });
  if (!x) return { ops: [], undo: [], message: 'This trip already covers that many days.' };
  const n = diffDays(x.next.end, today) + 1;
  return {
    ops: x.ops, undo: undoFor(state, x.ops), end: x.next.end,
    message: `The trip now shops through ${dayText(x.next.end)}: ${n} days of food in one run.${x.planned ? ` Planned ${x.planned} more ${x.planned === 1 ? 'dinner' : 'dinners'}, pantry first.` : ''}`,
  };
}
