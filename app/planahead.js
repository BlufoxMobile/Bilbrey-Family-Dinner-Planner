// Plan ahead, pantry first (SPEC §16). Pick a day up to a month out; the planner fills the open
// nights with dinners the pantry already covers, oldest and soonest-to-spoil food first (counting
// the food down night by night), then fills the rest with the usual rules, cheapest to finish
// first. Packed lunches swap to what's on hand when the rotation's item isn't. pantryStretch says
// how far the pantry carries the plan before the store has to.
// Pure: no DOM, no clock (today and `at` are passed in).

import { set, del, normalizeTrip } from './state.js';
import { generatePlan, itemsForNight, dinnerById } from './planner.js';
import { plannedNights, itemMeta } from './shopping.js';
import { onHand, ENOUGH } from './coverage.js';
import { keepsDays, placeOf, sinceOf } from './freshness.js';
import { lunchFor, lunchItem, personConfig, packingNames } from './lunch.js';
import { FAMILY } from './config.js';
import { addDays, datesBetween, daysInMonth, diffDays, isISODate, round2, shortDate, weekdayName } from './util.js';
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

// ---------------------------------------------------------------- use it first

/** Anything in the freezer this long counts as "use soon" (Jeff threw out freezer-burnt steak and corn). */
export const FREEZER_OLD_DAYS = 60;

const isMeatItem = (db, state, id) => !!db.ingredients[id]?.meat || itemMeta(db, state, id).aisle === 'Meat';

/**
 * How much it matters to eat an on-hand item by the night of `date`: 0 (it keeps) and up.
 *  - Fridge and counter food by its estimated use-by (freshness.js): past it by that night 6 and
 *    more (the strong one: use it now), due that night 4, within two days 3 to 2, within a week 1.
 *  - Freezer food by age: 60+ days in the freezer is "use soon" (2, plus a point a month), younger
 *    food a fraction of that, so the oldest always goes first; past its freezer use-by adds 4.
 * Items with no came-home date, and shelf goods that keep for months, score 0.
 */
export function urgency(db, state, id, date) {
  const p = state?.pantry?.[id];
  if (!p || p.low) return 0;
  const since = sinceOf(p);
  if (!since) return 0;
  const days = keepsDays(db, state, id);
  if (placeOf(db, state, id) === 'freezer') {
    const age = Math.max(0, diffDays(date, since));
    let u = age >= FREEZER_OLD_DAYS ? 2 + (age - FREEZER_OLD_DAYS) / 30 : age / FREEZER_OLD_DAYS;
    if (days != null && addDays(since, days) < date) u += 4;
    return u;
  }
  if (days == null) return 0;
  const left = diffDays(addDays(since, days), date);
  if (left < 0) return 6 + Math.min(2, -left / 7);
  if (left === 0) return 4;
  if (left <= 2) return 4 - left;
  if (left <= 6) return 1;
  return 0.25;
}

/** How much a meal's ingredients need eating first (meat counts half again: it's the costly waste). */
export function useFirstScore(db, state, items, date) {
  let s = 0;
  for (const id of Object.keys(items || {})) s += urgency(db, state, id, date) * (isMeatItem(db, state, id) ? 1.5 : 1);
  return s;
}

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
 * Nights already planned keep their food: what a kept night is fully stocked for is set aside
 * first, so a new pantry night never takes the chicken a hand-picked night counts on. (Food a
 * kept night is short of gets bought for it anyway, so it isn't held back.)
 */
function setAsideKept(db, state, rem, dates) {
  for (const { entry } of plannedNights(db, state, dates).sort((a, b) => a.date.localeCompare(b.date))) {
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

/**
 * Plan every open night from `start` through `end`. Cooked, away and already-planned nights (by
 * hand or not) are never touched.
 *   pantryFirst: 1. nights the pantry fully covers, each night scored by how much soon-to-spoil
 *                   and oldest food it uses (urgency), with every planner rule kept (rotation and
 *                   votes, burger and pizza nights, rice limit, no repeats close together, store);
 *                   the shelf is counted down night by night so two nights never share one pack.
 *                2. the rest with the usual planner, favoring dinners with the fewest and cheapest
 *                   things to buy.
 *                3. lunch days swap a slot to what's on hand when the rotation's item isn't.
 * → { ops, undo, message, count, fromPantry: [date], lunchPicks: [...], unfilled: [date], start, end }
 */
export function planAheadOps(db, state, { start, end, who, today, at, pantryFirst = true, seedKey } = {}) {
  const day0 = today && (!start || start < today) ? today : start;
  const last = today ? clampAheadEnd(today, end) : end;
  const dates = datesBetween(day0, last);
  const by = who || 'Family';
  const stamp = at || new Date().toISOString();
  const seed = seedKey || day0;
  const common = { db, dates, mode: 'fill', by, at: stamp, today, seedKey: seed };

  let fromPantry = {};
  let rest;
  let picks = [];
  if (!pantryFirst) {
    rest = generatePlan({ ...common, state });
  } else {
    const rem = onHand(db, state);
    setAsideKept(db, state, rem, datesBetween(today && today < day0 ? today : day0, last));
    fromPantry = generatePlan({
      ...common, state, strict: true,
      accept: (date, d, items) => coversAll(rem, items),
      bonus: (date, d, items) => 2.5 * useFirstScore(db, state, items, date),
      onPlace: (date, entry, items) => { take(rem, items); },
    }).entries;
    const withPantry = { ...state, plan: { ...(state?.plan || {}), ...fromPantry } };
    rest = generatePlan({
      ...common, state: withPantry, reserve: true,
      // Twice the planner's usual weight on cost, and a nudge per thing to buy.
      bonus: (date, d, items, money) => -(money.cost / 14) - 0.12 * money.buys,
    });
    for (const e of Object.values(rest.entries)) take(rem, itemsForNight(db, withPantry, e.dinner, e));
    picks = lunchPicks(db, withPantry, rem, dates);
  }

  const entries = { ...fromPantry, ...rest.entries };
  const ops = [
    ...Object.keys(entries).sort().map((d) => set(['plan', d], entries[d])),
    ...picks.map((p) => set(['lunch', 'days', p.date, p.name, 'picks', p.slot], p.id)),
  ];
  const n = Object.keys(entries).length;
  const p = Object.keys(fromPantry).length;
  const l = picks.length;
  const open = rest.unfilled.length;
  let message;
  if (!n && !l) message = open ? 'Couldn’t find dinners that fit those rules. Try planning from both stores.' : `Every night through ${dayText(last)} is already planned.`;
  else {
    message = n ? `Planned ${n} ${n === 1 ? 'dinner' : 'dinners'} through ${dayText(last)}${pantryFirst ? (p ? `: ${p} straight from the pantry` : ', none fully from the pantry yet') : ''}.` : `Dinners through ${dayText(last)} were already planned.`;
    if (l) message += ` ${l} packed ${l === 1 ? 'lunch uses' : 'lunches use'} what’s on hand.`;
    if (open) message += ` ${open} ${open === 1 ? 'night is' : 'nights are'} still open.`;
  }
  return { ops, undo: undoFor(state, ops), message, count: n, fromPantry: Object.keys(fromPantry).sort(), lunchPicks: picks, unfilled: rest.unfilled, start: day0, end: last };
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
