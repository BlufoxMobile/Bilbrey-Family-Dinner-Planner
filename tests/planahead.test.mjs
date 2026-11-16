// SPEC §16: plan ahead, pantry first. Dinners the pantry covers go first (oldest and
// soonest-to-spoil food first, counted down night by night), then the usual planner; packed
// lunches use what's on hand; pantryStretch says how far the pantry carries the plan; and
// "Make the shopping list" writes a trip for the planned stretch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realDb } from './helpers.mjs';
import {
  planAheadOps, pantryStretch, shoppingTripOps, tripKeyOf, urgency, aheadEnd, clampAheadEnd, aheadLimit, FREEZER_OLD_DAYS,
} from '../app/planahead.js';
import { applyOps, settingsOf } from '../app/state.js';
import { generatePlan, itemsForNight, isBurger, nightIsRice } from '../app/planner.js';
import { lunchFor } from '../app/lunch.js';
import { buildList } from '../app/shopping.js';
import { datesBetween, startOfWeek } from '../app/util.js';
import { tripKey } from '../app/views/list.js';

const db = realDb();
const MON = '2026-11-16';
const TUE = '2026-11-17';
const WED = '2026-11-18';
const THU = '2026-11-19';
const FRI = '2026-11-20';
const NEXT_MON = '2026-11-23';
const ctx = { who: 'Jeff', at: '2026-11-17T08:00:00Z' };
const noLunches = { people: { Knox: { enabled: false }, Jeff: { enabled: false } } };

/** A well-stocked kitchen with no meat in it, plus the meat given: only the meat decides. */
function shelfWith(meat = {}) {
  const pantry = {};
  for (const ing of Object.values(db.ingredients)) {
    if (ing.meat) continue;
    pantry[ing.id] = ing.kind === 'staple' ? { qty: null, stocked: true } : { qty: 500, stocked: false };
  }
  return { ...pantry, ...meat };
}
const uses = (state, date, id) => {
  const e = state.plan?.[date];
  return e?.dinner ? (itemsForNight(db, state, e.dinner, e)[id] || 0) : 0;
};
const firstUse = (state, dates, id) => dates.find((d) => uses(state, d, id) > 0) || null;

test('pantry first: the first open night eats the oldest freezer meat, then the next oldest', () => {
  const state = {
    lunch: noLunches,
    pantry: shelfWith({
      chickenThighs: { qty: 4.5, stocked: false, since: '2026-08-20' }, // 89 days in the freezer
      beef: { qty: 3, stocked: false, since: '2026-09-10' }, // 68 days
      chicken: { qty: 5, stocked: false, since: '2026-11-12' }, // came home last week
    }),
  };
  const r = planAheadOps(db, state, { start: TUE, end: NEXT_MON, today: TUE, ...ctx });
  const s = applyOps(state, r.ops);
  const dates = datesBetween(TUE, NEXT_MON);
  for (const d of dates) assert.ok(s.plan[d]?.dinner, `${d} is planned`);
  assert.equal(r.count, dates.length);
  assert.equal(r.fromPantry[0], TUE, 'tonight comes from the pantry');
  assert.ok(uses(s, TUE, 'chickenThighs') > 0, 'and it uses the 89-day-old chicken thighs');
  const order = ['chickenThighs', 'beef', 'chicken'].map((id) => firstUse(s, r.fromPantry, id));
  assert.ok(order.every(Boolean), `each meat gets used from the pantry (${order})`);
  assert.ok(order[0] < order[1] && order[1] < order[2], `oldest first: ${order.join(' < ')}`);
  // Every planner rule still holds: burger nights (Mon, Fri), one rice night a week, no repeats.
  for (const d of [FRI, NEXT_MON]) assert.ok(isBurger(db.dinners[s.plan[d].dinner]), `${d} is a burger night`);
  for (const wk of [...new Set(dates.map((d) => startOfWeek(d, 1)))]) {
    const rice = dates.filter((d) => startOfWeek(d, 1) === wk && nightIsRice(db, s, s.plan[d].dinner, s.plan[d])).length;
    assert.ok(rice <= 1, `at most one rice night the week of ${wk}`);
  }
  assert.equal(new Set(dates.map((d) => s.plan[d].dinner)).size, dates.length, 'no dinner twice in a week');
  assert.match(r.message, /^Planned 7 dinners through Monday, Nov 23: \d+ straight from the pantry\./);
  // Undo takes it all back.
  const back = applyOps(s, r.undo);
  assert.deepEqual(back.plan || {}, {});
});

test('the shelf is counted down night by night: one pack never covers two nights', () => {
  const state = { lunch: noLunches, pantry: shelfWith({ chickenThighs: { qty: 2.4, stocked: false, since: '2026-08-20' } }) };
  const r = planAheadOps(db, state, { start: TUE, end: NEXT_MON, today: TUE, ...ctx });
  const s = applyOps(state, r.ops);
  assert.deepEqual(r.fromPantry, [TUE], 'the one pack of thighs covers one night, the first');
  const thighs = datesBetween(TUE, NEXT_MON).reduce((t, d) => t + (r.fromPantry.includes(d) ? uses(s, d, 'chickenThighs') : 0), 0);
  assert.ok(thighs <= 2.4 / 0.95 + 1e-9, `pantry nights draw no more than is there (${thighs} lb)`);
  const st = pantryStretch(db, s, { start: TUE, end: NEXT_MON });
  assert.equal(st.dinnersCovered, 1);
  assert.equal(st.coveredThrough, TUE);
  assert.equal(st.firstGap, WED);
  assert.equal(st.gapReason, 'short');
  assert.ok(st.nights[1].dinnerMissing.length > 0, 'Wednesday shows what it needs');
  assert.deepEqual(st.usesUp.map((u) => [u.id, u.since]), [['chickenThighs', '2026-08-20']], 'it uses up the old thighs');
});

test('cooked, away and already-planned nights are never touched, and keep their food', () => {
  const state = {
    lunch: noLunches,
    pantry: shelfWith({ chickenThighs: { qty: 2.3, stocked: false, since: '2026-08-20' } }),
    plan: {
      [TUE]: { dinner: 'classic-spaghetti', status: 'cooked', by: 'Jeff', at: 'x' },
      [WED]: { dinner: null, sides: [], status: 'away', away: { reason: 'Date night' }, manual: true, by: 'Jeff', at: 'x' },
      [THU]: { dinner: 'orange-chicken', status: 'planned', manual: true, by: 'Candi', at: 'x' }, // takes the 2.25 lb of thighs
      [FRI]: { dinner: 'smashburgers', status: 'planned', by: 'Family', at: 'x' }, // planned by the app, not by hand
    },
  };
  const r = planAheadOps(db, state, { start: TUE, end: NEXT_MON, today: TUE, ...ctx });
  const touched = new Set(r.ops.filter((o) => o.path[0] === 'plan').map((o) => o.path[1]));
  for (const d of [TUE, WED, THU, FRI]) assert.ok(!touched.has(d), `${d} left alone`);
  assert.deepEqual([...touched].sort(), ['2026-11-21', '2026-11-22', NEXT_MON], 'only the open nights');
  assert.deepEqual(r.fromPantry, [], 'Thursday’s thighs stay Thursday’s: no other night is counted as covered by them');
  const { [THU]: _thu, ...withoutThu } = state.plan;
  assert.equal(planAheadOps(db, { ...state, plan: withoutThu }, { start: TUE, end: NEXT_MON, today: TUE, ...ctx }).fromPantry.length, 1, 'without Thursday’s dinner, those thighs would make a night');
  const s = applyOps(state, r.ops);
  const st = pantryStretch(db, s, { start: TUE, end: NEXT_MON });
  assert.ok(st.nights.find((n) => n.date === THU).covered, 'Thursday is still fully stocked');
  assert.ok(st.nights.find((n) => n.date === TUE).covered && st.nights.find((n) => n.date === WED).covered, 'cooked and away nights need nothing');
});

test('packed lunches use what’s on hand first; picks and skips set by hand stay', () => {
  const week = datesBetween(MON, FRI);
  const base = {
    lunch: { people: { Knox: { enabled: false } } }, // Jeff's defaults: store salads and turkey sandwiches
    pantry: { bonduelleQuesoBowl: { qty: 1 }, bonduelleSantaFeBowl: { qty: 2 }, bonduelleBbqBowl: { qty: 1 }, bodyArmorOM: { qty: 12 } },
  };
  const SANDWICH = 'bh-salsalito-turkey-sandwich';
  const mainOf = (st, d) => lunchFor(db, st, 'Jeff', d).slots.find((x) => x.slot === 'main');
  // Monday he's buying lunch; Tuesday he asked for the sandwich himself.
  const skipped = MON;
  const byHand = TUE;
  const state = {
    ...base,
    lunch: { ...base.lunch, days: { [skipped]: { Jeff: { skip: true, reason: 'Buying lunch' } }, [byHand]: { Jeff: { picks: { main: SANDWICH } } } } },
  };
  const free = week.filter((d) => d !== skipped && d !== byHand);
  const sandwichDays = free.filter((d) => mainOf(state, d).rotation === SANDWICH);
  assert.ok(sandwichDays.length >= 1, 'a sandwich day the shelf can’t cover');
  const r = planAheadOps(db, state, { start: MON, end: FRI, today: MON, ...ctx });
  const picks = r.ops.filter((o) => o.path[0] === 'lunch');
  assert.ok(picks.length >= 1, 'at least one lunch swapped to what’s on hand');
  assert.ok(!picks.some((o) => o.path[2] === byHand || o.path[2] === skipped), 'the hand-set pick and the skipped day are left alone');
  for (const o of picks) {
    assert.deepEqual(o.path.slice(3), ['Jeff', 'picks', 'main']);
    assert.match(o.value, /^bonduelle-/, 'swapped to a salad that’s in the fridge');
    assert.equal(r.lunchPicks.find((p) => p.date === o.path[2]).instead, SANDWICH, 'instead of the sandwich the deli would have to supply');
  }
  const s = applyOps(state, r.ops);
  assert.equal(mainOf(s, byHand).id, SANDWICH, 'Tuesday is still his sandwich');
  assert.ok(lunchFor(db, s, 'Jeff', skipped).skip, 'Monday is still skipped');
  // The salads are counted down too: never more bowls eaten than are in the fridge.
  const bowls = { 'bonduelle-chicken-queso-fresco': 1, 'bonduelle-santa-fe': 2, 'bonduelle-bbq-chicken': 1 };
  const eaten = {};
  for (const d of week) {
    const l = lunchFor(db, s, 'Jeff', d);
    if (l.skip) continue;
    const main = l.slots.find((x) => x.slot === 'main').id;
    if (bowls[main]) eaten[main] = (eaten[main] || 0) + 1;
  }
  for (const [id, n] of Object.entries(eaten)) assert.ok(n <= bowls[id], `${id}: ${n} eaten, ${bowls[id]} on hand`);
  const total = Object.values(eaten).reduce((t, n) => t + n, 0);
  assert.equal(total, Math.min(4, free.length), 'the open days eat the bowls on hand before a sandwich needs the store');
  for (const d of free) assert.match(mainOf(s, d).id, /^bonduelle-/);
  assert.match(r.message, /packed lunch(es)? uses? what’s on hand/);
  // Drinks: only one in the rotation, nothing to swap to.
  assert.ok(!picks.some((o) => o.path[5] === 'drink'));
});

test('pantryStretch: each day’s lunches then dinner take from the shelf; the run stops at the first short day', () => {
  const night = (dinner) => ({ dinner, status: 'planned', by: 'Jeff', at: 'x' });
  const pantry = {
    beef: { qty: 2.1, since: '2026-10-02' }, chiliBeans: { qty: 2 }, tomatoes: { qty: 1 }, paprika: { stocked: true, qty: null }, cajunSeasoning: { stocked: true, qty: null },
    oil: { stocked: true, qty: null }, cheese: { qty: 8 }, cannedCorn: { qty: 4 }, carrots: { qty: 5 }, butter: { qty: 10 }, pepper: { stocked: true, qty: null }, salt: { stocked: true, qty: null }, ranch: { stocked: true, qty: null },
  };
  const state = { lunch: noLunches, pantry, plan: { [TUE]: night('pantry-beef-chili'), [WED]: night('pantry-beef-chili'), [THU]: { dinner: null, status: 'away', away: { reason: 'Eating out' } } } };
  const st = pantryStretch(db, state, { start: TUE, end: FRI });
  assert.deepEqual([st.coveredThrough, st.firstGap, st.gapReason], [TUE, WED, 'short']);
  assert.deepEqual([st.dinnersCovered, st.dinners, st.lunchesCovered, st.lunches], [1, 2, 0, 0]);
  assert.deepEqual(st.nights.map((n) => n.covered), [true, false, true, false], 'Tue stocked, Wed short of beef, Thu away, Fri open');
  assert.ok(st.nights[1].missing.some((m) => m.id === 'beef'));
  assert.equal(st.nights[3].open, true);
  assert.equal(st.usesUp[0].id, 'beef');
  assert.equal(st.usesUp[0].since, '2026-10-02');
  // Enough beef: covered all the way to the open night, which is where the plan stops.
  const more = pantryStretch(db, { ...state, pantry: { ...pantry, beef: { qty: 5, since: '2026-10-02' }, chiliBeans: { qty: 4 }, tomatoes: { qty: 2 } } }, { start: TUE, end: FRI });
  assert.deepEqual([more.coveredThrough, more.firstGap, more.gapReason, more.dinnersCovered], [THU, FRI, 'open', 2]);
  // Packed lunches count too: Jeff's Tuesday salad is in the fridge, Wednesday's sandwich isn't.
  const withLunch = { ...state, lunch: { people: { Knox: { enabled: false } } }, pantry: { ...pantry, bonduelleQuesoBowl: { qty: 3 }, bonduelleSantaFeBowl: { qty: 3 }, bonduelleBbqBowl: { qty: 3 }, bodyArmorOM: { qty: 6 } } };
  const lunchDays = datesBetween(TUE, FRI).filter((d) => lunchFor(db, withLunch, 'Jeff', d));
  const l = pantryStretch(db, withLunch, { start: TUE, end: FRI });
  assert.equal(l.lunches, lunchDays.length);
  const sandwich = lunchDays.filter((d) => lunchFor(db, withLunch, 'Jeff', d).slots.some((x) => x.id === 'bh-salsalito-turkey-sandwich'));
  assert.equal(l.lunchesCovered, lunchDays.length - sandwich.length, 'salad days covered, sandwich days need the deli');
  for (const d of sandwich) assert.ok(l.nights.find((n) => n.date === d).lunchMissing.some((m) => m.id === 'bhSalsalitoTurkey' && m.person === 'Jeff'));
});

test('“Make the shopping list” writes a trip for the planned stretch, both stores', () => {
  const prev = { start: '2026-11-15', end: FRI, store: 'jewel' };
  const state = {
    settings: { trip: prev },
    checked: { [tripKey(prev)]: { buns: true } },
    skips: { [tripKey(prev)]: { chicken: { reason: 'check' } } },
    plan: { [TUE]: { dinner: 'pantry-beef-chili', status: 'planned', by: 'Jeff', at: 'x' } },
  };
  const r = shoppingTripOps(state, { today: TUE, end: '2026-11-29', ...ctx });
  assert.deepEqual(r.ops[0], { op: 'set', path: ['settings', 'trip'], value: { start: TUE, end: '2026-11-29', store: 'both', by: 'Jeff', at: ctx.at } });
  const s = applyOps(state, r.ops);
  assert.deepEqual(settingsOf(s).trip, { start: TUE, end: '2026-11-29', store: 'both', by: 'Jeff', at: ctx.at });
  assert.equal(s.checked[tripKey(prev)], undefined, 'the old trip’s check-offs go');
  assert.equal(s.skips[tripKey(prev)], undefined, 'and its skips');
  assert.equal(tripKeyOf(settingsOf(s).trip), tripKey(settingsOf(s).trip), 'the same key the List uses');
  assert.match(r.message, /both stores, through Sunday, Nov 29/);
  // The List for that trip buys only what the pantry doesn't cover.
  const list = buildList(db, s, { dates: datesBetween(TUE, '2026-11-29'), listKey: tripKey(settingsOf(s).trip), today: TUE });
  assert.equal(list.nights.length, 1);
  // Making the list again for the same stretch keeps what's already in the cart.
  const again = shoppingTripOps({ ...s, checked: { [tripKey(settingsOf(s).trip)]: { beef: true } } }, { today: TUE, end: '2026-11-29', ...ctx });
  assert.equal(again.ops.length, 1);
  assert.deepEqual(applyOps(s, r.undo).settings.trip, prev, 'Undo brings the old trip back');
});

test('“Use what we have first” off: the usual planner, no lunch swaps', () => {
  const state = { pantry: { chickenThighs: { qty: 9, since: '2026-08-20' }, bonduelleSantaFeBowl: { qty: 5 } } };
  const r = planAheadOps(db, state, { start: TUE, end: NEXT_MON, today: TUE, pantryFirst: false, ...ctx });
  const plain = generatePlan({ db, state, dates: datesBetween(TUE, NEXT_MON), mode: 'fill', by: 'Jeff', at: ctx.at, today: TUE, seedKey: TUE });
  assert.deepEqual(Object.fromEntries(r.ops.map((o) => [o.path[1], o.value])), plain.entries);
  assert.ok(!r.ops.some((o) => o.path[0] === 'lunch'));
  assert.deepEqual(r.fromPantry, []);
});

test('how far ahead: quick picks, and never more than a month out', () => {
  assert.equal(aheadEnd(MON, 'week'), '2026-11-22', '1 week from Monday runs through Sunday');
  assert.equal(aheadEnd(MON, 'two'), '2026-11-29');
  assert.equal(aheadEnd(MON, 'three'), '2026-12-06');
  assert.equal(aheadEnd(MON, 'month'), '2026-12-15', 'a month: the day before the same date next month');
  assert.equal(aheadEnd('2026-12-20', 'month'), '2027-01-19');
  assert.equal(aheadLimit(MON), '2026-12-17');
  assert.equal(clampAheadEnd(MON, '2027-02-01'), '2026-12-17', 'at most 31 days out');
  assert.equal(clampAheadEnd(MON, '2026-11-01'), MON, 'never before today');
  assert.equal(clampAheadEnd(MON, 'soon'), MON);
  const r = planAheadOps(db, { lunch: noLunches }, { start: MON, end: '2027-03-01', today: MON, ...ctx });
  assert.equal(r.end, '2026-12-17');
  assert.ok(r.ops.every((o) => o.path[1] <= '2026-12-17'));
});

test('use it first: how urgent each thing on the shelf is', () => {
  const state = {
    pantry: {
      chickenThighs: { qty: 3, since: '2026-08-20' },
      beef: { qty: 3, since: '2026-11-10' },
      pulledChicken: { qty: 2, since: '2026-11-14' }, // cooked, in the fridge: about 4 days
      spaghetti: { qty: 32, since: '2026-11-01' },
    },
  };
  assert.ok(urgency(db, state, 'chickenThighs', TUE) >= 2, `${FREEZER_OLD_DAYS}+ days in the freezer is "use soon"`);
  assert.ok(urgency(db, state, 'chickenThighs', TUE) > urgency(db, state, 'beef', TUE), 'older freezer food first');
  assert.ok(urgency(db, state, 'beef', TUE) < 1, 'a week in the freezer is no hurry');
  assert.equal(urgency(db, state, 'pulledChicken', TUE), 3, 'due in a day');
  assert.ok(urgency(db, state, 'pulledChicken', '2026-11-20') >= 6, 'past its use-by by that night: the strong one');
  assert.equal(urgency(db, state, 'spaghetti', TUE), 0, 'shelf goods keep');
  assert.equal(urgency(db, { pantry: { beef: { qty: 3 } } }, 'beef', TUE), 0, 'no came-home date, no guess');
});
