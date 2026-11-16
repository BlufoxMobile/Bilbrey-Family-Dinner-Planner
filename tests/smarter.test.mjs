// SPEC §21, smarter planning: plan ahead re-plans the planner's own picks (with a before/after),
// lean by default and busy nights, the waste log and what the planner does with it, food with no
// date, the freezer watch, leftovers, catching the pantry up, trips against the goal, the year's
// pace, trip length and the two-store split.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realDb } from './helpers.mjs';
import { buildDb } from '../app/data.js';
import { applyOps } from '../app/state.js';
import { generatePlan, itemsForNight, withVegetable, packFor, storeFor, rotationList, isBurger, isPizza, effectiveSides } from '../app/planner.js';
import {
  planAheadOps, pantryStretch, aheadStats, aheadRecord, tripAdvice, extendTripOps, tripKeyOf, TRIP_MIN_DAYS, REPLAN_MIN_SAVING,
} from '../app/planahead.js';
import {
  leanOn, busyNightsOf, plateLean, leanScore, isFried, effortOf, busyScore, isSlowCooked, leanSummary, isVegSide,
  LEAN_KCAL, LEAN_PROTEIN_G, HEAVY_KCAL, HEAVY_MAX_PER_WEEK,
} from '../app/health.js';
import {
  sinceOf, urgency, useSoon, undated, freezerWatch, keepsDays, aboutDate, isLeftover, FREEZER_OLD_DAYS,
} from '../app/freshness.js';
import {
  removeItemOps, removeWasteOps, wasteCost, wasteEntries, wasteSummary, tossCounts, isRepeatOffender, aboutSinceOps,
  leftoverAsks, leftoverChoices, leftoversOps, leftoverItemId, uncookedNights, skippedNightOps, unpackedLunches, lunchUsedOps, catchUp,
  LUNCH_SYNC_EPOCH, WASTE_WINDOW_DAYS,
} from '../app/waste.js';
import { buildList, tripsIn, tripGoal, yearPace, monthBudget, TRIP_GOAL, SPLIT } from '../app/shopping.js';
import { backups, pantryCoverage } from '../app/coverage.js';
import { prepSchedule } from '../app/prep.js';
import { markCookedOps, unmarkCookedOps } from '../app/actions.js';
import { lunchFor } from '../app/lunch.js';
import { addDays, datesBetween, round2, startOfWeek } from '../app/util.js';

const db = realDb();
const MON = '2026-11-16';
const TUE = '2026-11-17';
const WED = '2026-11-18';
const THU = '2026-11-19';
const FRI = '2026-11-20';
const SAT = '2026-11-21';
const SUN = '2026-11-22';
const NEXT_MON = '2026-11-23';
const ctx = { who: 'Jeff', at: '2026-11-17T14:00:00Z' };
const noLunches = { people: { Knox: { enabled: false }, Jeff: { enabled: false } } };
const planOps = (r) => r.ops.filter((o) => o.path[0] === 'plan');

/** A well-stocked kitchen with no meat in it, plus the meat given: only the meat decides. */
function shelfWith(meat = {}) {
  const pantry = {};
  for (const ing of Object.values(db.ingredients)) {
    if (ing.meat) continue;
    pantry[ing.id] = ing.kind === 'staple' ? { qty: null, stocked: true } : { qty: 500, stocked: false, since: '2026-11-15' };
  }
  return { ...pantry, ...meat };
}

// ---------------------------------------------------------------- a small kitchen for exact rules

const NUTRI = {
  per: {
    chicken: { kcal: 500, protein: 100 }, beef: { kcal: 1500, protein: 80 }, rice: { kcal: 100, protein: 2 }, naan: { kcal: 300, protein: 8 },
    broccoli: { kcal: 150, protein: 12 }, spinach: { kcal: 7, protein: 1 }, apples: { kcal: 230, protein: 1 }, cream: { kcal: 800, protein: 6 },
    buns: { kcal: 150, protein: 5 }, fries: { kcal: 90, protein: 1 },
  },
};
function mini({ dinners }) {
  const both = (sSize, sPrice, jSize, jPrice) => ({ sams: { generic: { size: sSize, price: sPrice, label: 's' } }, jewel: { generic: { size: jSize, price: jPrice, label: 'j' } } });
  const ing = (name, unit, aisle, storage, defaultStore, packs, extra = {}) => ({ name, unit, aisle, storage, kind: 'measured', defaultStore, aliases: [], packs, ...extra });
  const catalog = {
    ingredients: {
      // The two meats cost the same, so money never decides between them; Sam's bulk is cheaper by the pound.
      chicken: ing('Chicken breast', 'lb', 'Meat', 'freezer', 'sams', both(10, 30, 3, 12), { meat: true }),
      beef: ing('Ground beef', 'lb', 'Meat', 'freezer', 'sams', both(10, 30, 3, 12), { meat: true }),
      rice: ing('Rice', 'oz', 'Pasta & Grains', 'pantry', 'jewel', both(400, 20, 32, 3.2)), // it keeps; the bulk bag is cheaper
      naan: ing('Naan', 'pieces', 'Bakery', 'freezer', 'jewel', both(10, 6, 5, 4)),
      broccoli: ing('Frozen broccoli', 'lb', 'Frozen', 'freezer', 'sams', both(4, 6, 1, 2.5)),
      spinach: ing('Baby spinach', 'oz', 'Produce', 'fridge', 'sams', both(32, 6.4, 8, 2.5)), // fresh; a Sam's tub is 2 lb
      apples: ing('Apples', 'lb', 'Produce', 'fridge', 'jewel', both(6, 7, 3, 4)),
      cream: ing('Heavy cream', 'cups', 'Dairy & Eggs', 'fridge', 'jewel', both(4, 6, 2, 3.5)),
      buns: ing('Buns', 'buns', 'Bakery', 'freezer', 'sams', both(12, 4.5, 8, 2.3)),
      fries: ing('Frozen fries', 'oz', 'Frozen', 'freezer', 'jewel', both(80, 7, 32, 4)),
      salt: { name: 'Salt', unit: 'tsp', aisle: 'Spices & Baking', storage: 'pantry', kind: 'staple', defaultStore: 'jewel', aliases: [], packs: { jewel: { generic: { size: 120, price: 1.29, label: 'salt' } } } },
    },
  };
  const sides = [
    { id: 'rice-side', title: 'Steamed rice', kind: 'starch', items: { rice: 10 }, steps: ['Steam.'] },
    { id: 'naan-side', title: 'Warm naan', kind: 'bread', items: { naan: 5 }, steps: ['Warm.'] },
    { id: 'broc', title: 'Steamed broccoli', kind: 'vegetable', items: { broccoli: 1.25 }, steps: ['Steam.'] },
    { id: 'spin', title: 'Spinach salad', kind: 'salad', items: { spinach: 5 }, steps: ['Toss.'] },
    { id: 'apple-side', title: 'Apple slices', kind: 'fruit', items: { apples: 1.5 }, steps: ['Slice.'] },
    { id: 'fries-side', title: 'Fries', kind: 'starch', items: { fries: 32 }, steps: ['Air fry.'] },
  ];
  const D = (id, o) => ({ id, title: id, subtitle: '', category: 'Comfort', protein: 'chicken', minutes: 35, equipment: ['stovetop'], tags: [], rotation: 'core', steps: ['Cook.'], sides: ['broc', 'rice-side'], sideSlots: 2, items: { chicken: 2 }, ...o });
  return buildDb({ catalog, recipes: { dinners: dinners.map((d) => D(d.id, d)), sides }, nutrition: NUTRI });
}
/** Everything a mini kitchen cooks with is in the house, dated last week, so money and dates don't decide. */
const stocked = (over = {}) => ({
  chicken: { qty: 100, since: '2026-11-10' }, beef: { qty: 100, since: '2026-11-10' }, rice: { qty: 4000 }, naan: { qty: 100, since: '2026-11-10' },
  broccoli: { qty: 100, since: '2026-11-10' }, spinach: { qty: 1000, since: '2026-11-15' }, apples: { qty: 100, since: '2026-11-15' },
  cream: { qty: 100, since: '2026-11-15' }, buns: { qty: 100, since: '2026-11-10' }, fries: { qty: 1000, since: '2026-11-10' }, salt: { qty: null, stocked: true }, ...over,
});
const plain = { burgerNights: [], pizzaPerMonth: 0, riceMaxPerWeek: 7 };
const one = (mdb, state, date, seedKey) => generatePlan({ db: mdb, state, dates: [date], mode: 'fill', by: 'x', at: 'x', today: date, seedKey }).entries[date];
const SEEDS = Array.from({ length: 24 }, (_, i) => `seed-${i}`);

// ================================================================ 1. plan ahead really uses the pantry

test('plan ahead re-plans the nights the planner chose itself, never a hand-set, cooked or away night', () => {
  // The app planned the week before the freezer was counted: nothing in it uses the old thighs.
  const blank = { lunch: noLunches, pantry: shelfWith({}) };
  const dates = datesBetween(TUE, NEXT_MON);
  const auto = generatePlan({ db, state: blank, dates, mode: 'fill', by: 'Family', at: 'x', today: TUE, seedKey: 'before-the-freezer' }).entries;
  const cookedDinner = auto[TUE].dinner;
  const state = {
    lunch: noLunches,
    pantry: shelfWith({ chickenThighs: { qty: 9, stocked: false, since: '2026-08-20' }, beef: { qty: 6, stocked: false, since: '2026-09-10' } }),
    plan: {
      ...auto,
      [TUE]: { ...auto[TUE], status: 'cooked', cookedAt: 'x' },
      [WED]: { dinner: null, sides: [], status: 'away', away: { reason: 'Date night' }, manual: true, by: 'Jeff', at: 'x' },
      [THU]: { ...auto[THU], manual: true, by: 'Candi' },
    },
  };
  const before = pantryStretch(db, state, { start: TUE, end: NEXT_MON }).dinnersCovered;
  const r = planAheadOps(db, state, { start: TUE, end: NEXT_MON, today: TUE, ...ctx });
  const touched = planOps(r).map((o) => o.path[1]);
  for (const d of [TUE, WED, THU]) assert.ok(!touched.includes(d), `${d} (cooked, away, set by hand) is never re-planned`);
  assert.ok(touched.length > 0 && touched.every((d) => [FRI, SAT, SUN, NEXT_MON].includes(d)), 'only the planner’s own nights change');
  assert.deepEqual(r.replanned, touched, 'every changed night had a planner pick before');
  assert.equal(r.replan, true);
  const s = applyOps(state, r.ops);
  assert.equal(s.plan[TUE].dinner, cookedDinner);
  assert.equal(s.plan[THU].manual, true);
  // Before and after: more dinners straight from the pantry, never more to buy for it.
  assert.equal(r.before.fromPantry, before);
  assert.ok(r.after.fromPantry > r.before.fromPantry, `${r.after.fromPantry} from the pantry now, ${r.before.fromPantry} before`);
  assert.equal(r.after.dinners, r.before.dinners, 'the same nights are planned');
  assert.deepEqual(aheadStats(db, s, { start: TUE, end: NEXT_MON }), r.after, 'the after numbers are the plan that was written');
  assert.ok(planOps(r).some((o) => itemsForNight(db, s, o.value.dinner, o.value).chickenThighs > 0), 'an August-dated pack of thighs gets a night');
  assert.match(r.message, /^Planned \d+ dinners? through Monday, Nov 23: \d+ straight from the pantry\. (It replaces|Both replace|All \d+ replace) the planner’s earlier picks?\./);
  // The result card's record rides along, so it survives a reload, and Undo takes all of it back.
  assert.deepEqual(s.planAhead, { start: TUE, end: NEXT_MON, pantryFirst: true, replan: true, before: r.before, changed: touched.length, by: 'Jeff', at: ctx.at });
  assert.deepEqual(aheadRecord(s, TUE), s.planAhead);
  assert.equal(aheadRecord(s, addDays(NEXT_MON, 1)), null, 'the card goes once its stretch has passed');
  const back = applyOps(s, r.undo);
  assert.deepEqual(back.plan, state.plan);
  assert.equal(back.planAhead, undefined);
});

test('re-planning is the default with “use what we have first”, off without it, and can be switched off', () => {
  const blank = { lunch: noLunches, pantry: shelfWith({}) };
  const dates = datesBetween(TUE, NEXT_MON);
  const auto = generatePlan({ db, state: blank, dates: dates.slice(0, 5), mode: 'fill', by: 'Family', at: 'x', today: TUE, seedKey: 'before-the-freezer' }).entries;
  const state = { lunch: noLunches, pantry: shelfWith({ chickenThighs: { qty: 9, stocked: false, since: '2026-08-20' } }), plan: auto };
  const open = dates.slice(5);
  const off = planAheadOps(db, state, { start: TUE, end: NEXT_MON, today: TUE, replan: false, ...ctx });
  assert.deepEqual(planOps(off).map((o) => o.path[1]), open, 'replan off: only the open nights');
  assert.deepEqual(off.replanned, []);
  const usual = planAheadOps(db, state, { start: TUE, end: NEXT_MON, today: TUE, pantryFirst: false, ...ctx });
  assert.deepEqual(planOps(usual).map((o) => o.path[1]), open, 'pantry first off: the usual planner fills open nights and re-plans nothing');
  assert.equal(usual.replan, false);
  const on = planAheadOps(db, state, { start: TUE, end: NEXT_MON, today: TUE, ...ctx });
  assert.ok(on.replanned.length > 0, 'by default the planner’s picks can change');
  assert.equal(on.before.hadOpen, true, 'the before numbers fill the open nights the usual way, to compare like with like');
  assert.equal(on.before.dinners, on.after.dinners);
});

test('tonight’s dinner is never re-planned, even when the planner picked it', () => {
  const blank = { lunch: noLunches, pantry: shelfWith({}) };
  const dates = datesBetween(TUE, NEXT_MON);
  const auto = generatePlan({ db, state: blank, dates, mode: 'fill', by: 'Family', at: 'x', today: TUE, seedKey: 'before-the-freezer' }).entries;
  const state = { lunch: noLunches, pantry: shelfWith({ chickenThighs: { qty: 9, stocked: false, since: '2026-08-20' }, beef: { qty: 6, stocked: false, since: '2026-09-10' } }), plan: auto };
  const r = planAheadOps(db, state, { start: TUE, end: NEXT_MON, today: TUE, ...ctx });
  assert.ok(r.replanned.length > 0, 'later nights change');
  assert.ok(!planOps(r).some((o) => o.path[1] === TUE), 'tonight is left alone: it may be thawed or started');
  assert.deepEqual(applyOps(state, r.ops).plan[TUE], auto[TUE]);
  // An open tonight is still filled.
  const { [TUE]: _t, ...rest } = auto;
  assert.ok(planOps(planAheadOps(db, { ...state, plan: rest }, { start: TUE, end: NEXT_MON, today: TUE, ...ctx })).some((o) => o.path[1] === TUE));
});

test('pressing plan ahead again changes nothing: it only re-plans when that helps', () => {
  const state = { lunch: noLunches, pantry: shelfWith({ chickenThighs: { qty: 9, stocked: false, since: '2026-08-20' }, beef: { qty: 6, stocked: false, since: '2026-09-10' } }) };
  const first = planAheadOps(db, state, { start: TUE, end: NEXT_MON, today: TUE, ...ctx });
  const s = applyOps(state, first.ops);
  const again = planAheadOps(db, s, { start: TUE, end: NEXT_MON, today: TUE, ...ctx });
  assert.deepEqual(planOps(again), [], 'no night is written twice');
  assert.equal(again.count, 0);
  assert.equal(again.message, 'Every night through Monday, Nov 23 is already planned, and the plan already makes the most of the pantry.');
  assert.deepEqual([again.after.fromPantry, again.after.groceries, again.after.dinners], [again.before.fromPantry, again.before.groceries, again.before.dinners]);
  // A plan that can't be beaten stays exactly as it is, by/at included.
  assert.deepEqual(applyOps(s, again.ops).plan, s.plan);
  assert.ok(REPLAN_MIN_SAVING >= 1, 'a re-plan has to save real money to be worth the churn');
});

// ================================================================ 2. lean by default

test('lean is a family setting, on by default; busy nights are a list of weekdays', () => {
  assert.equal(leanOn({}), true);
  assert.equal(leanOn({ settings: { lean: true } }), true);
  assert.equal(leanOn({ settings: { lean: false } }), false);
  assert.deepEqual(busyNightsOf({}), []);
  assert.deepEqual(busyNightsOf({ settings: { busyNights: [3, 1, 1, 9, 'x'] } }), [1, 3]);
});

test('a lean plate: calories and protein from the plate, or nutrition.js plateHealth when it’s there', () => {
  // Every dinner in the recipe box, whatever the recipes say today.
  for (const d of rotationList(db, {})) {
    const h = plateLean(db, {}, d.id, null);
    assert.ok(!(h.lean && h.heavy), `${d.id} is never both`);
    if (h.lean) assert.ok(h.kcal <= LEAN_KCAL && h.proteinG >= LEAN_PROTEIN_G, `${d.id} lean: ${Math.round(h.kcal)} kcal, ${Math.round(h.proteinG)} g`);
    if (h.heavy) assert.ok(h.fried || h.kcal >= HEAVY_KCAL, `${d.id} heavy`);
    if (h.known && !h.fried) assert.equal(h.heavy, h.kcal >= HEAVY_KCAL);
    assert.equal(h.vegServings, effectiveSides(db, {}, d.id, null).filter((s) => isVegSide(db, {}, s.parsed)).length);
  }
  // nutrition.plateHealth(db, state, dinnerId, entry) → { kcal, proteinG, vegServings, lean, why } wins when present.
  const any = rotationList(db, {})[0].id;
  const seen = [];
  const h = plateLean(db, {}, any, null, { plateHealth: (...a) => { seen.push(a.length); return { kcal: 480, proteinG: 41, vegServings: 2, lean: true, why: 'grilled, with two vegetables' }; } });
  assert.deepEqual([h.kcal, h.proteinG, h.vegServings, h.lean, h.heavy, h.why], [480, 41, 2, true, false, 'grilled, with two vegetables']);
  assert.deepEqual(seen, [4]);
  assert.equal(plateLean(db, {}, any, null, { plateHealth: () => ({ kcal: 1300, proteinG: 40, vegServings: 0, lean: false, why: '' }) }).heavy, true);
  assert.equal(plateLean(db, {}, any, null, { plateHealth: () => { throw new Error('not ready'); } }).known, plateLean(db, {}, any, null, { plateHealth: null }).known, 'a broken rater falls back');
  assert.equal(plateLean(db, {}, 'no-such-dinner', null), null);
  // The score: lean up, heavy down, a vegetable up.
  assert.ok(leanScore({ lean: true, heavy: false, known: true, kcal: 600, proteinG: 50, vegServings: 1 }) > 0.9);
  assert.ok(leanScore({ lean: false, heavy: true, known: true, kcal: 1300, proteinG: 50, vegServings: 0 }) < -0.9);
  assert.ok(leanScore({ lean: false, heavy: false, known: true, kcal: 900, proteinG: 40, vegServings: 1 }) < leanScore({ lean: false, heavy: false, known: true, kcal: 800, proteinG: 40, vegServings: 1 }));
  assert.equal(leanScore(null), 0);
});

test('fried is read from tags and names, not from air-fried, stir-fried, refried or fried rice', () => {
  for (const t of ['Fried chicken sandwiches', 'Chicken-fried steak', 'Deep-fried Oreos']) assert.equal(isFried({ title: t, tags: [] }), true, t);
  for (const t of ['Air-fried chicken', 'Air fried wings', 'Stir-fried beef', 'Refried bean tostadas', 'Chicken fried rice', 'Egg fried rice', 'Crispy chicken fingers']) assert.equal(isFried({ title: t, tags: [] }), false, t);
  assert.equal(isFried({ title: 'Wings', tags: ['fried'] }), true);
});

test('with lean on the planner picks the lean plate; off, the heavy one gets its turn', () => {
  const mdb = mini({ dinners: [
    { id: 'lean-chicken', items: { chicken: 2 } }, // (1000 + 187 + 1000) / 5 ≈ 440 kcal, 43 g protein
    { id: 'creamy-beef', protein: 'beef', items: { beef: 2, cream: 3 } }, // (3000 + 2400 + 1187) / 5 ≈ 1320 kcal
  ] });
  assert.equal(plateLean(mdb, {}, 'lean-chicken', null).lean, true);
  assert.equal(plateLean(mdb, {}, 'creamy-beef', null).heavy, true);
  const on = SEEDS.map((k) => one(mdb, { pantry: stocked(), settings: plain }, SAT, k).dinner);
  const off = SEEDS.map((k) => one(mdb, { pantry: stocked(), settings: { ...plain, lean: false } }, SAT, k).dinner);
  assert.ok(on.every((d) => d === 'lean-chicken'), 'lean on: the lean plate every time');
  assert.ok(off.includes('creamy-beef') && off.includes('lean-chicken'), 'lean off: either can win');
});

test('lean caps fried and heavy dinners at two a week, and keeps the burger night', () => {
  const heavy = (id) => ({ id, protein: 'beef', category: 'Pasta', items: { beef: 2, cream: 3 } });
  const light = (id, category) => ({ id, category, items: { chicken: 2 } });
  const mdb = mini({ dinners: [
    heavy('h1'), heavy('h2'), heavy('h3'), heavy('h4'), heavy('h5'), heavy('h6'),
    light('l1', 'Grill'), light('l2', 'Comfort'), light('l3', 'Tex-Mex'), light('l4', 'Salads'), light('l5', 'Grill'), light('l6', 'Comfort'),
    { id: 'burger', category: 'Burgers', protein: 'beef', tags: ['burger'], items: { beef: 2.5, buns: 5 }, sides: ['fries-side'], sideSlots: 1 },
  ] });
  const week = datesBetween(MON, SUN);
  const heavyNights = (state, seedKey) => {
    const { entries } = generatePlan({ db: mdb, state, dates: week, mode: 'fill', by: 'x', at: 'x', today: MON, seedKey });
    assert.equal(Object.keys(entries).length, 7, 'the whole week is planned');
    assert.equal(entries[FRI].dinner, 'burger', 'Friday is still burger night');
    return week.filter((d) => plateLean(mdb, state, entries[d].dinner, entries[d]).heavy).length;
  };
  const settings = { burgerNights: [4], pizzaPerMonth: 0, riceMaxPerWeek: 7 };
  const on = SEEDS.map((k) => heavyNights({ pantry: stocked(), settings }, k));
  assert.ok(on.every((n) => n <= HEAVY_MAX_PER_WEEK), `never more than ${HEAVY_MAX_PER_WEEK} heavy dinners in a lean week (${on})`);
  const off = SEEDS.map((k) => heavyNights({ pantry: stocked(), settings: { ...settings, lean: false } }, k));
  assert.ok(Math.max(...off) > HEAVY_MAX_PER_WEEK, 'without lean, some weeks have more');
});

test('a two-side dinner with no vegetable gets one: bread goes first, then fruit; burgers and chosen sides stay', () => {
  const mdb = mini({ dinners: [
    { id: 'curry', sides: ['rice-side', 'naan-side'] },
    { id: 'pork-apples', sides: ['rice-side', 'apple-side'] },
    { id: 'two-starch', sides: ['fries-side', 'rice-side'] },
    { id: 'has-veg', sides: ['broc', 'naan-side'] },
    { id: 'burger', category: 'Burgers', tags: ['burger'], sides: ['fries-side'], sideSlots: 1 },
  ] });
  const d = (id) => mdb.dinners[id];
  const veg = (id) => ['vegetable', 'salad'].includes(mdb.sides[id]?.kind);
  const curry = withVegetable(mdb, {}, d('curry'), ['rice-side', 'naan-side']);
  assert.equal(curry[0], 'rice-side', 'the rice stays');
  assert.ok(veg(curry[1]), `the naan makes room for a vegetable (${curry[1]})`);
  const pork = withVegetable(mdb, {}, d('pork-apples'), ['rice-side', 'apple-side']);
  assert.ok(pork[0] === 'rice-side' && veg(pork[1]), 'fruit before the starch');
  const starch = withVegetable(mdb, {}, d('two-starch'), ['fries-side', 'rice-side']);
  assert.ok(starch[0] === 'fries-side' && veg(starch[1]), 'of two starches, the second one');
  assert.deepEqual(withVegetable(mdb, {}, d('has-veg'), ['broc', 'naan-side']), ['broc', 'naan-side'], 'already has one');
  assert.deepEqual(withVegetable(mdb, {}, d('burger'), ['fries-side']), ['fries-side'], 'burgers keep their fries');
  const chosen = { substitutions: { curry: { 1: 'naan-side' } } };
  assert.deepEqual(withVegetable(mdb, chosen, d('curry'), ['rice-side', 'naan-side']), ['rice-side', 'naan-side'], 'sides the family chose are left alone');
  // The one already in the house wins; a thumbs-down side is never the pick.
  assert.equal(withVegetable(mdb, { pantry: { spinach: { qty: 50 } } }, d('curry'), ['rice-side', 'naan-side'])[1], 'spin');
  assert.equal(withVegetable(mdb, { pantry: { spinach: { qty: 50 } }, sideVotes: { spin: { Knox: -1 } } }, d('curry'), ['rice-side', 'naan-side'])[1], 'broc');
  // The planner writes it into the night with lean on, and leaves the recipe's sides with lean off.
  const only = mini({ dinners: [{ id: 'curry', sides: ['rice-side', 'naan-side'] }] });
  assert.ok(veg(one(only, { pantry: stocked(), settings: plain }, SAT, 'k').sides[1]));
  assert.deepEqual(one(only, { pantry: stocked(), settings: { ...plain, lean: false } }, SAT, 'k').sides, ['rice-side', 'naan-side']);
});

test('busy nights get the slow cooker or a 30-minute dinner, never a long cook', () => {
  const slow = { id: 'slow-chili', minutes: 360, equipment: ['possible cooker'], tags: ['slow cooker'] };
  assert.equal(isSlowCooked(slow), true);
  assert.equal(effortOf(slow), 'handsOff');
  assert.equal(effortOf({ minutes: 25, equipment: ['stovetop'], tags: [] }), 'quick');
  assert.equal(effortOf({ minutes: 40, equipment: ['stovetop'], tags: [] }), 'normal');
  assert.equal(effortOf({ minutes: 60, equipment: ['stovetop'], tags: [] }), 'long');
  assert.equal(effortOf({ minutes: 30, equipment: ['possible cooker'], tags: [] }), 'quick', 'a quick sauté in the PossibleCooker is just quick');
  assert.equal(effortOf({ minutes: 240, equipment: ['possible cooker'], tags: [] }), 'handsOff', 'hours in the PossibleCooker is hands-off');
  assert.equal(effortOf({ minutes: 90, activeMinutes: 15, equipment: ['possible cooker'], tags: [] }), 'handsOff');
  assert.ok(busyScore(slow) > busyScore({ minutes: 25 }) && busyScore({ minutes: 25 }) > busyScore({ minutes: 40 }) && busyScore({ minutes: 40 }) > busyScore({ minutes: 60 }));

  const mdb = mini({ dinners: [slow, { id: 'quick-chicken', minutes: 20 }, { id: 'long-roast', minutes: 60 }] });
  const busy = { pantry: stocked(), settings: { ...plain, busyNights: [5] } }; // Saturdays
  const calm = { pantry: stocked(), settings: plain };
  const onBusy = SEEDS.map((k) => one(mdb, busy, SAT, k).dinner);
  assert.ok(!onBusy.includes('long-roast'), 'a busy night never gets the hour-long cook');
  assert.ok(onBusy.filter((d) => d === 'slow-chili').length > SEEDS.length / 2, 'the slow cooker takes most busy nights');
  assert.ok(SEEDS.map((k) => one(mdb, calm, SAT, k).dinner).includes('long-roast'), 'on a calm night the long cook gets its turn');
  // A slow-cooker dinner isn't punished as a "long cook" on a weeknight.
  const wk = mini({ dinners: [slow, { id: 'long-roast', minutes: 60 }] });
  const tueSlow = SEEDS.filter((k) => one(wk, calm, TUE, k).dinner === 'slow-chili').length;
  assert.ok(tueSlow > SEEDS.length / 2, 'on a weeknight the six-hour slow cooker beats the one-hour roast more often than not');
});

test('the prep schedule says when to start the slow cooker', () => {
  const mdb = mini({ dinners: [{ id: 'slow-chili', title: 'Slow-cooker chili', minutes: 480, equipment: ['possible cooker'], tags: ['slow cooker'] }, { id: 'pot-roast', title: 'Pot roast', minutes: 240, equipment: ['possible cooker'] }] });
  const state = { pantry: stocked(), plan: { [TUE]: { dinner: 'slow-chili', status: 'planned' }, [WED]: { dinner: 'pot-roast', status: 'planned' } } };
  const tasks = prepSchedule(mdb, state, { today: TUE, days: 3 }).flatMap((d) => d.tasks.map((t) => ({ ...t, date: d.date })));
  const chili = tasks.find((t) => t.kind === 'slow' && t.date === TUE);
  assert.equal(chili.when, 'morning');
  assert.equal(chili.text, 'Start tonight’s Slow-cooker chili in the PossibleCooker by 10 AM. It cooks about 8 hours on its own.');
  assert.match(tasks.find((t) => t.kind === 'slow' && t.date === WED).text, /^Start tomorrow’s Pot roast in the PossibleCooker by 2 PM\. It cooks about 4 hours on its own\.$/);
});

test('a month planned lean has more lean plates and fewer heavy ones than the same month without', () => {
  const dates = datesBetween(MON, addDays(MON, 27));
  const plan = (lean) => {
    const state = { settings: { lean } };
    const s = { ...state, plan: generatePlan({ db, state, dates, mode: 'fill', by: 'x', at: 'x', today: MON, seedKey: MON }).entries };
    return { s, sum: leanSummary(db, s, dates) };
  };
  const on = plan(true);
  const off = plan(false);
  assert.equal(on.sum.total, 28);
  assert.ok(on.sum.lean >= off.sum.lean, `lean plates: ${on.sum.lean} with lean, ${off.sum.lean} without`);
  assert.ok(on.sum.heavy <= off.sum.heavy, `heavy plates: ${on.sum.heavy} with lean, ${off.sum.heavy} without`);
  assert.ok(on.sum.kcal <= off.sum.kcal, `average plate: ${Math.round(on.sum.kcal)} with lean, ${Math.round(off.sum.kcal)} without`);
  // The comfort nights stay: burgers on burger nights, pizza on pizza nights.
  for (const d of dates) {
    const dinner = db.dinners[on.s.plan[d].dinner];
    if (['2026-11-16', '2026-11-20', '2026-11-23', '2026-11-27'].includes(d)) assert.ok(isBurger(dinner), `${d} is a burger night`);
    if (d === '2026-11-28') assert.ok(isPizza(dinner), 'the 4th Saturday is pizza night');
  }
  // Regular nights hold the heavy cap in every week.
  for (const wk of [...new Set(dates.map((d) => startOfWeek(d, 1)))]) {
    const heavy = dates.filter((d) => startOfWeek(d, 1) === wk && !isBurger(db.dinners[on.s.plan[d].dinner]) && !isPizza(db.dinners[on.s.plan[d].dinner]) && plateLean(db, on.s, on.s.plan[d].dinner, on.s.plan[d]).heavy).length;
    assert.ok(heavy <= HEAVY_MAX_PER_WEEK, `week of ${wk}: ${heavy} heavy regular nights`);
  }
});

// ================================================================ 3. stop waste before it happens

test('threw it out: the waste log gets the item, amount, cost, reason and date; Undo puts it all back', () => {
  const state = { pantry: { eyeRoundSteak: { qty: 2.5, stocked: false, since: '2026-07-01', by: 'Candi', at: 'x' }, cornCobs: { qty: 10, since: '2026-10-20' } } };
  const r = removeItemOps(db, state, { id: 'eyeRoundSteak', reason: 'tossed', today: TUE, ...ctx });
  const s = applyOps(state, r.ops);
  assert.equal(s.pantry.eyeRoundSteak, undefined, 'it’s off the shelf');
  const [w] = wasteEntries(s);
  const pack = packFor(db, state, 'eyeRoundSteak', storeFor(db, state, 'eyeRoundSteak', 'both'));
  const cost = round2((pack.price / pack.size) * 2.5);
  assert.deepEqual({ id: w.id, name: w.name, qty: w.qty, unit: w.unit, cost: w.cost, reason: w.reason, date: w.date, since: w.since, by: w.by },
    { id: 'eyeRoundSteak', name: db.ingredients.eyeRoundSteak.name, qty: 2.5, unit: 'lb', cost, reason: 'tossed', date: TUE, since: '2026-07-01', by: 'Jeff' });
  assert.ok(cost > 0);
  assert.match(r.message, /^Logged: 2½ lb of .+ thrown out, about \$\d+\.\d\d\. The planner will use it sooner next time\.$/);
  const undone = applyOps(s, r.undo);
  assert.deepEqual(undone.pantry, state.pantry, 'Undo puts it back on the shelf');
  assert.deepEqual(wasteEntries(undone), [], 'and takes it out of the log');
  // Part of it: the rest stays on the shelf, and only that part is logged.
  const part = removeItemOps(db, state, { id: 'cornCobs', reason: 'tossed', qty: 4, today: TUE, ...ctx });
  const s2 = applyOps(state, part.ops);
  assert.equal(s2.pantry.cornCobs.qty, 6);
  assert.equal(s2.pantry.cornCobs.since, '2026-10-20', 'what’s left keeps its date');
  assert.equal(wasteEntries(s2)[0].qty, 4);
  assert.deepEqual(wasteCost(db, state, 'cornCobs', 4), { cost: wasteEntries(s2)[0].cost, estimated: false });
  // More than there is: all of it, never a negative shelf.
  assert.equal(applyOps(state, removeItemOps(db, state, { id: 'cornCobs', reason: 'tossed', qty: 99, today: TUE, ...ctx }).ops).pantry.cornCobs, undefined);
});

test('used it up and wrong count take it off the shelf and log nothing', () => {
  const state = { pantry: { cornCobs: { qty: 10, since: '2026-10-20' }, salt: { qty: null, stocked: true } } };
  for (const reason of ['used', 'wrong']) {
    const s = applyOps(state, removeItemOps(db, state, { id: 'cornCobs', reason, today: TUE, ...ctx }).ops);
    assert.equal(s.pantry.cornCobs, undefined);
    assert.equal(s.waste, undefined, `${reason}: nothing in the waste log`);
  }
  const some = removeItemOps(db, state, { id: 'cornCobs', reason: 'used', qty: 3, today: TUE, ...ctx });
  assert.equal(applyOps(state, some.ops).pantry.cornCobs.qty, 7);
  assert.match(some.message, /^Used 3 .+\. 7 .+ left\.$/);
  assert.equal(applyOps(state, removeItemOps(db, state, { id: 'cornCobs', reason: 'wrong', qty: 2, today: TUE, ...ctx }).ops).pantry.cornCobs.qty, 8, 'a miscount just fixes the number');
  // A stocked staple has no amount: tossing it counts half a pack, marked as an estimate.
  const t = removeItemOps(db, state, { id: 'salt', reason: 'tossed', today: TUE, ...ctx });
  assert.equal(t.entry.qty, null);
  assert.equal(t.entry.estimated, true);
  assert.equal(removeItemOps(db, state, { id: 'not-here', reason: 'tossed', today: TUE }).ops.length, 0);
});

test('the waste log adds up: this month’s dollars, last month’s, and what goes most often', () => {
  const w = (id, date, cost) => ({ id, name: db.ingredients[id].name, qty: 1, unit: db.ingredients[id].unit, cost, reason: 'tossed', date });
  const state = { waste: {
    a: w('cornCobs', '2026-11-03', 3.5), b: w('cornCobs', '2026-11-12', 4), c: w('eyeRoundSteak', '2026-11-12', 21.25),
    d: w('cornCobs', '2026-10-09', 3), e: w('milk', '2026-10-30', 2), f: w('milk', '2026-06-01', 2), junk: null, bad: { id: 'x', date: 'soon' },
  } };
  const sum = wasteSummary(state, TUE);
  assert.equal(sum.month, '2026-11');
  assert.equal(sum.total, 28.75);
  assert.equal(sum.count, 3);
  assert.equal(sum.lastMonth, 5);
  assert.equal(sum.yearToDate, 35.75);
  assert.deepEqual(sum.top.map((t) => [t.id, t.times, t.cost]), [['cornCobs', 3, 10.5], ['eyeRoundSteak', 1, 21.25], ['milk', 1, 2]], 'most often first, within 90 days');
  assert.deepEqual([...tossCounts(state, TUE)].sort(), [['cornCobs', 3], ['eyeRoundSteak', 1], ['milk', 1]]);
  assert.equal(tossCounts(state, '2026-11-10').get('cornCobs'), 2, 'only tosses up to that day');
  assert.equal(tossCounts(state, addDays('2026-11-12', WASTE_WINDOW_DAYS)).get('cornCobs'), undefined, 'old tosses age out');
  assert.equal(isRepeatOffender(state, 'cornCobs', TUE), true);
  assert.equal(isRepeatOffender(state, 'eyeRoundSteak', TUE), false);
  assert.equal(wasteSummary({}, TUE).total, 0);
  const gone = applyOps(state, removeWasteOps(state, { key: 'c' }).ops);
  assert.equal(wasteSummary(gone, TUE).total, 7.5, 'a mistaken entry can be taken out');
  // The Budget's month carries it.
  assert.equal(monthBudget(db, state, TUE).wasted.total, 28.75);
});

test('food thrown out before is planned sooner and bought in the pack that leaves the least', () => {
  const state = { pantry: { milk: { qty: 8, since: '2026-11-15' }, cornCobs: { qty: 10, since: '2026-11-10' } } };
  const tossed = (id, n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${id}${i}`, { id, name: id, qty: 1, cost: 2, reason: 'tossed', date: addDays('2026-11-01', i) }]));
  const calm = urgency(db, state, 'cornCobs', TUE);
  const once = urgency(db, { ...state, waste: tossed('cornCobs', 1) }, 'cornCobs', TUE);
  const twice = urgency(db, { ...state, waste: tossed('cornCobs', 2) }, 'cornCobs', TUE);
  assert.ok(calm < 1.5 && once >= 1.5 * 1.5 && twice > once, `sooner each time: ${calm} → ${once} → ${twice}`);
  assert.equal(urgency(db, { ...state, waste: tossed('milk', 2) }, 'cornCobs', TUE), calm, 'only the item that was wasted');

  // The list: a repeat offender moves to whichever store's pack leaves less unused.
  const mdb = mini({ dinners: [{ id: 'greens', sides: ['spin', 'rice-side'] }] });
  const plan = { [TUE]: { dinner: 'greens', status: 'planned' } };
  const base = buildList(mdb, { plan }, { dates: [TUE], today: TUE });
  const spin = base.items.find((i) => i.id === 'spinach');
  assert.deepEqual([spin.store, spin.packs, spin.leftover], ['sams', 1, 27], 'normally the 2 lb tub from Sam’s: 27 oz left over');
  const logged = { plan, waste: { a: { id: 'spinach', reason: 'tossed', date: '2026-11-02', cost: 3 }, b: { id: 'spinach', reason: 'tossed', date: '2026-11-10', cost: 3 } } };
  const after = buildList(mdb, logged, { dates: [TUE], today: TUE });
  const spin2 = after.items.find((i) => i.id === 'spinach');
  assert.deepEqual([spin2.store, spin2.packs, spin2.leftover, spin2.storeWhy], ['jewel', 1, 3, 'wasted'], 'after two tosses: the 8 oz bag from Jewel');
  assert.deepEqual(after.split.moved, [{ id: 'spinach', name: 'Baby spinach', from: 'sams', to: 'jewel', why: 'wasted', saves: 3.9 }]);
  assert.equal(buildList(mdb, { ...logged, waste: { a: logged.waste.a } }, { dates: [TUE], today: TUE }).items.find((i) => i.id === 'spinach').store, 'sams', 'once isn’t a pattern');
  assert.equal(buildList(mdb, { ...logged, storeFor: { spinach: 'sams' } }, { dates: [TUE], today: TUE }).items.find((i) => i.id === 'spinach').store, 'sams', 'the family’s own store choice wins');
});

test('no came-home date: the pantry asks, freezer meat counts as old, and a rough answer gives a use-by', () => {
  const state = { pantry: {
    beef: { qty: 3, at: '2026-11-16T22:00:00Z' }, // an older scan: edited yesterday, never dated
    milk: { qty: 8, at: '2026-11-16T22:00:00Z' },
    chicken: { qty: 5, since: '2026-11-12' },
    spaghetti: { qty: 32 }, // keeps for months: nothing to ask
    cornCobs: { qty: 0 }, // none left
  } };
  assert.equal(sinceOf(state.pantry.beef), null, 'when it was last edited is not when it came home');
  assert.equal(sinceOf(state.pantry.chicken), '2026-11-12');
  assert.equal(sinceOf({ since: 'last week' }), null);
  assert.deepEqual(undated(db, state).map((u) => [u.id, u.place, u.meat]), [['beef', 'freezer', true], ['milk', 'fridge', false]]);
  assert.deepEqual(useSoon(db, state, TUE).map((u) => u.id), [], 'no date, no use-by');
  assert.equal(urgency(db, state, 'beef', TUE), 3, 'undated freezer meat is treated as old');
  assert.ok(urgency(db, state, 'beef', TUE) > urgency(db, state, 'chicken', TUE));
  assert.equal(urgency(db, state, 'milk', TUE), 0.5);
  // This week / this month / older.
  assert.deepEqual(['week', 'month', 'older'].map((a) => aboutDate(TUE, a)), ['2026-11-14', '2026-10-28', '2026-08-19']);
  assert.equal(aboutDate(TUE, 'someday'), null);
  const r = aboutSinceOps(db, state, { id: 'beef', about: 'older', today: TUE });
  const s = applyOps(state, r.ops);
  assert.deepEqual([s.pantry.beef.since, s.pantry.beef.sinceAbout, s.pantry.beef.qty], ['2026-08-19', 'older', 3]);
  assert.ok(urgency(db, s, 'beef', TUE) >= 2, '“older” lands past the 60-day mark: use soon');
  assert.deepEqual(undated(db, s).map((u) => u.id), ['milk']);
  const m = applyOps(state, aboutSinceOps(db, state, { id: 'milk', about: 'month', today: TUE }).ops);
  assert.deepEqual(useSoon(db, m, TUE).map((u) => [u.id, u.daysLeft < 0]), [['milk', true]], 'milk from “this month” is past its week');
  assert.deepEqual(applyOps(s, r.undo), state);
});

test('the freezer watch: 60 days in, past its keep time, or meat nobody dated, worst first', () => {
  const state = { pantry: {
    eyeRoundSteak: { qty: 2.5, since: '2026-06-01' }, // 169 days: past the 4 months meat keeps
    chickenThighs: { qty: 4.5, since: '2026-09-03' }, // 75 days: use soon
    chicken: { qty: 5, since: '2026-11-12' }, // new
    beef: { qty: 3 }, // no date
    broccoli: { qty: 2 }, // undated vegetables aren't called out here
    cornCobs: { qty: 0, since: '2026-01-01' }, // none left
  } };
  const w = freezerWatch(db, state, TUE);
  assert.deepEqual(w.map((x) => [x.id, x.past, x.unknown, x.age]), [['eyeRoundSteak', true, false, 169], ['beef', false, true, null], ['chickenThighs', false, false, 75]]);
  assert.equal(w[0].useBy, '2026-09-29');
  assert.equal(FREEZER_OLD_DAYS, 60);
  assert.deepEqual(freezerWatch(db, { pantry: { chicken: { qty: 5, since: '2026-11-12' } } }, TUE), []);
  // It's also called out in today's prep jobs, so nothing sits past its date silently.
  const tasks = prepSchedule(db, state, { today: TUE, days: 2 }).flatMap((d) => d.tasks);
  const use = tasks.find((t) => t.kind === 'use');
  assert.match(use.text, /^In the freezer too long: the .+\. Plan ahead puts it first\.$/);
  assert.deepEqual(use.action, { name: 'nav', label: 'Plan it', data: { href: '#/plan' } });
});

test('the planner itself (not only plan ahead) cooks the oldest freezer meat first', () => {
  const mdb = mini({ dinners: [{ id: 'chicken-night', items: { chicken: 2 } }, { id: 'beef-night', protein: 'beef', items: { beef: 2 } }] });
  const settings = { ...plain, lean: false };
  const oldChicken = { pantry: stocked({ chicken: { qty: 100, since: '2026-05-01' }, beef: { qty: 100, since: '2026-11-10' } }), settings };
  const oldBeef = { pantry: stocked({ chicken: { qty: 100, since: '2026-11-10' }, beef: { qty: 100, since: '2026-05-01' } }), settings };
  const undatedBeef = { pantry: stocked({ chicken: { qty: 100, since: '2026-11-10' }, beef: { qty: 100 } }), settings };
  for (const k of SEEDS) {
    assert.equal(one(mdb, oldChicken, SAT, k).dinner, 'chicken-night');
    assert.equal(one(mdb, oldBeef, SAT, k).dinner, 'beef-night');
    assert.equal(one(mdb, undatedBeef, SAT, k).dinner, 'beef-night', 'meat nobody dated goes before last week’s');
  }
});

// ---------------------------------------------------------------- cooked, leftovers, catching up

test('marking a dinner cooked takes exactly what it used off the shelf, never below zero, and unmarking puts it back', () => {
  const dinner = 'tikka-masala' in db.dinners ? 'tikka-masala' : rotationList(db, {})[0].id;
  const entry = { dinner, sides: [...db.dinners[dinner].sides], status: 'planned', by: 'Jeff', at: 'x' };
  const used = itemsForNight(db, {}, dinner, entry);
  const measured = Object.keys(used).filter((id) => db.ingredients[id]?.kind !== 'staple');
  const [short, ...rest] = measured;
  const pantry = Object.fromEntries(rest.map((id) => [id, { qty: round2(used[id] + 3), stocked: false, since: '2026-11-10' }]));
  pantry[short] = { qty: round2(used[short] / 2), stocked: false, since: '2026-11-10' }; // only half of this one is here
  for (const id of Object.keys(used)) if (db.ingredients[id]?.kind === 'staple') pantry[id] = { qty: null, stocked: true };
  const state = { pantry, plan: { [TUE]: entry } };
  const r = markCookedOps(db, state, { date: TUE, today: TUE, ...ctx });
  const s = applyOps(state, r.ops);
  for (const id of rest) assert.equal(s.pantry[id].qty, 3, `${id} drops by what the recipe used`);
  assert.equal(s.pantry[short].qty, 0, 'what wasn’t there can’t go negative');
  assert.equal(s.plan[TUE].deducted[short], round2(used[short] / 2), 'and only what was taken is remembered');
  for (const id of Object.keys(used)) if (db.ingredients[id]?.kind === 'staple') assert.deepEqual(s.pantry[id], pantry[id], 'staples stay stocked');
  for (const id of rest) assert.equal(s.pantry[id].since, '2026-11-10', 'what’s left keeps the day it came home');
  assert.equal(pantryCoverage(db, s, { dates: [TUE] }).total, 0, 'a cooked night needs nothing more');
  const back = applyOps(s, unmarkCookedOps(db, s, { date: TUE }).ops);
  for (const id of measured) assert.equal(back.pantry[id].qty, pantry[id].qty, `${id} is back`);
  // Cooking doesn't make old food look new: the came-home date decides, not the last edit.
  assert.equal(sinceOf(s.pantry[rest[0]]), '2026-11-10');
});

test('leftovers get a plan: a lunch, a leftovers night, or a dated plate on the shelf', () => {
  const dinner = rotationList(db, {})[0];
  const other = rotationList(db, {})[1];
  const state = {
    plan: {
      [TUE]: { dinner: dinner.id, sides: [...dinner.sides], status: 'cooked', cookedAt: 'x', by: 'Jeff', at: 'x' },
      [WED]: { dinner: other.id, sides: [...other.sides], status: 'planned', by: 'Family', at: 'x' }, // the planner's pick
      [THU]: { dinner: other.id, sides: [...other.sides], status: 'planned', manual: true, by: 'Candi', at: 'x' }, // set by hand
    },
  };
  assert.deepEqual(leftoverAsks(db, state, TUE), [{ date: TUE, dinner: dinner.id, title: dinner.title }]);
  assert.deepEqual(leftoverAsks(db, state, WED).map((a) => a.date), [TUE], 'still asked the next morning');
  assert.deepEqual(leftoverAsks(db, state, THU), [], 'then it’s dropped');
  const c = leftoverChoices(db, state, { date: TUE, today: TUE });
  assert.equal(c.title, dinner.title);
  assert.deepEqual(c.nights, [{ date: WED, title: other.title, open: false }, { date: FRI, title: '', open: true }], 'the planner’s night and an open one; never the hand-set Thursday');
  const jeff = lunchFor(db, state, 'Jeff', WED);
  if (jeff && !jeff.skip) assert.deepEqual(c.lunch, { name: 'Jeff', date: WED });

  // None.
  const none = applyOps(state, leftoversOps(db, state, { date: TUE, use: 'none', today: TUE, ...ctx }).ops);
  assert.deepEqual(none.plan[TUE].leftovers, { use: 'none', by: 'Jeff', at: ctx.at });
  assert.deepEqual(leftoverAsks(db, none, TUE), [], 'answered: not asked again');
  // A lunch: that packed lunch is skipped, so its groceries leave the list.
  const lunch = applyOps(state, leftoversOps(db, state, { date: TUE, use: 'lunch', to: WED, name: 'Jeff', today: TUE, ...ctx }).ops);
  assert.equal(lunch.lunch.days[WED].Jeff.skip, true);
  assert.match(lunch.lunch.days[WED].Jeff.reason, /^Leftover /);
  assert.equal(lunchFor(db, lunch, 'Jeff', WED)?.skip ?? true, true);
  // A leftovers night: no dinner to cook or shop for, and the planner leaves it alone.
  const night = leftoversOps(db, state, { date: TUE, use: 'night', to: WED, today: TUE, ...ctx });
  const n = applyOps(state, night.ops);
  assert.deepEqual([n.plan[WED].status, n.plan[WED].dinner, n.plan[WED].manual, n.plan[WED].away.leftovers], ['away', null, true, { from: TUE, dinner: dinner.id }]);
  assert.match(n.plan[WED].away.note, /^Leftovers: .+ from Tuesday$/);
  assert.match(night.message, /^Wednesday is a leftovers night: .+\. .+ comes off the plan, and its groceries off the list\.$/);
  assert.equal(buildList(db, n, { dates: [WED] }).nights.length, 0, 'nothing to buy for it');
  assert.deepEqual(planOps(planAheadOps(db, n, { start: TUE, end: WED, today: TUE, ...ctx })), [], 'plan ahead never re-plans it');
  assert.equal(leftoversOps(db, state, { date: TUE, use: 'night', to: THU, today: TUE, ...ctx }).error, true, 'a hand-set night can’t be taken');
  assert.deepEqual(applyOps(n, night.undo), state);
  // The freezer: a dated shelf item, counted in plates, that shows as a backup and gets a use-by.
  const fz = leftoversOps(db, state, { date: TUE, use: 'freezer', plates: 3, today: TUE, ...ctx });
  const f = applyOps(state, fz.ops);
  const it = leftoverItemId(state, dinner.title);
  assert.equal(fz.item, it.id);
  assert.deepEqual(f.pantry[it.id], { qty: 3, stocked: false, since: TUE, place: 'freezer', by: 'Jeff', at: ctx.at });
  assert.equal(f.custom[it.id].unit, 'plates');
  assert.ok(isLeftover(f.custom[it.id].name));
  assert.equal(keepsDays(db, f, it.id), 90);
  assert.ok(backups(db, f).some((b) => b.id === it.id), 'listed with the quick backups');
  assert.deepEqual(freezerWatch(db, f, addDays(TUE, 61)).map((x) => x.id), [it.id], 'and called out when it’s been there two months');
  // The fridge: four days. A second night's plates join the first, under the older date.
  const fr = applyOps(state, leftoversOps(db, state, { date: TUE, use: 'fridge', plates: 2, today: TUE, ...ctx }).ops);
  assert.equal(keepsDays(db, fr, it.id), 4);
  assert.deepEqual(useSoon(db, fr, FRI).map((u) => [u.id, u.daysLeft]), [[it.id, 1]]);
  const again = { ...fr, plan: { ...fr.plan, [THU]: { dinner: dinner.id, sides: [...dinner.sides], status: 'cooked', by: 'Jeff', at: 'x' } } };
  const more = applyOps(again, leftoversOps(db, again, { date: THU, use: 'fridge', plates: 1, today: THU, ...ctx }).ops);
  assert.deepEqual([more.pantry[it.id].qty, more.pantry[it.id].since], [3, TUE]);
  // Thrown-out leftovers are worth a plate's food each.
  const tossed = removeItemOps(db, f, { id: it.id, reason: 'tossed', qty: 2, today: FRI, ...ctx });
  assert.equal(tossed.entry.cost, round2(f.custom[it.id].each * 2));
  assert.ok(tossed.entry.cost > 0);
  // Only a cooked night has leftovers.
  assert.equal(leftoversOps(db, state, { date: WED, use: 'none', today: TUE, ...ctx }).error, true);
  // And the evening's prep jobs ask.
  const ask = prepSchedule(db, state, { today: TUE, days: 2 }).flatMap((d) => d.tasks).find((t) => t.kind === 'leftovers');
  assert.deepEqual(ask.action, { name: 'left:open', label: 'Leftovers?', data: { date: TUE } });
});

test('catching up: dinners never marked cooked, and packed lunches that never left the shelf', () => {
  const dinner = rotationList(db, {})[0];
  const used = itemsForNight(db, {}, dinner.id, null);
  const mine = Object.keys(used).find((id) => db.ingredients[id]?.kind !== 'staple');
  const jeffTue = lunchFor(db, {}, 'Jeff', TUE);
  assert.ok(jeffTue && !jeffTue.skip, 'Jeff packs a lunch on Tuesdays');
  const lunchIds = [...new Set([...Object.keys(jeffTue.items), ...Object.keys(lunchFor(db, {}, 'Jeff', MON).items)])];
  const pantry = { [mine]: { qty: round2(used[mine] + 1), since: '2026-11-10' } };
  for (const id of lunchIds) pantry[id] = { qty: 50, since: '2026-11-10' };
  const state = {
    lunch: { people: { Knox: { enabled: false } }, days: { [WED]: { Jeff: { skip: true, reason: 'Buying lunch' } } } },
    pantry,
    plan: {
      [MON]: { dinner: dinner.id, status: 'planned', by: 'Family', at: 'x' }, // never marked
      [TUE]: { dinner: dinner.id, status: 'cooked', by: 'Jeff', at: 'x' },
      [WED]: { dinner: null, sides: [], status: 'away', away: { reason: 'Eating out' } },
      [THU]: { dinner: dinner.id, status: 'planned', by: 'Family', at: 'x' }, // today: not "missed" yet
    },
  };
  assert.deepEqual(uncookedNights(db, state, THU), [{ date: MON, dinner: dinner.id, title: dinner.title }]);
  assert.deepEqual(uncookedNights(db, state, addDays(MON, 8)).map((n) => n.date), [THU], 'only the last week');
  // Yes, it was cooked: the usual deduction. No: the night opens and the food stays.
  assert.equal(applyOps(state, markCookedOps(db, state, { date: MON, today: THU, ...ctx }).ops).pantry[mine].qty, 1);
  const no = applyOps(state, skippedNightOps(db, state, { date: MON }).ops);
  assert.equal(no.plan[MON], undefined);
  assert.equal(no.pantry[mine].qty, pantry[mine].qty);
  // Lunches: Monday and Tuesday were packed (Wednesday was skipped); nothing before the feature began.
  assert.equal(LUNCH_SYNC_EPOCH, '2026-11-16');
  const owed = unpackedLunches(db, state, THU);
  assert.deepEqual(owed.map((l) => [l.date, l.name]), [[MON, 'Jeff'], [TUE, 'Jeff']]);
  assert.deepEqual(unpackedLunches(db, state, MON), [], 'days before Nov 16 are never taken off');
  assert.deepEqual(catchUp(db, state, THU).total, 3);
  const r = lunchUsedOps(db, state, { today: THU, ...ctx });
  const s = applyOps(state, r.ops);
  const want = {};
  for (const l of owed) for (const [id, q] of Object.entries(l.items)) want[id] = (want[id] || 0) + q;
  for (const [id, q] of Object.entries(want)) {
    const staple = db.ingredients[id]?.kind === 'staple';
    assert.equal(s.pantry[id].qty, staple ? 50 : round2(50 - q), staple ? `${id} is a staple: stocked until low, never counted down` : `${id} drops by both lunches`);
  }
  assert.equal(s.pantry[mine].qty, pantry[mine].qty, 'dinner food is untouched');
  assert.deepEqual(Object.keys(s.lunchUsed).sort(), [MON, TUE]);
  assert.deepEqual(unpackedLunches(db, s, THU), [], 'each lunch is settled once');
  assert.equal(lunchUsedOps(db, s, { today: THU, ...ctx }).ops.length, 0);
  assert.match(r.message, /^2 packed lunches taken off the shelves \(\d+ items?\)\.$/);
  const undone = applyOps(s, r.undo);
  assert.deepEqual(undone.pantry, state.pantry, 'Undo puts the food back');
  assert.equal(unpackedLunches(db, undone, THU).length, 2, 'and the lunches are owed again');
  // They weren't packed: settled, and the shelves stay.
  const not = applyOps(state, lunchUsedOps(db, state, { today: THU, packed: false, ...ctx }).ops);
  for (const id of lunchIds) assert.equal(not.pantry[id].qty, 50);
  assert.deepEqual(unpackedLunches(db, not, THU), []);
  // Old markers are cleared as it goes.
  const old = { ...state, lunchUsed: { '2026-10-01': { Jeff: { at: 'x' } } } };
  assert.equal(applyOps(old, lunchUsedOps(db, old, { today: THU, ...ctx }).ops).lunchUsed['2026-10-01'], undefined);
  // And today's prep jobs point at the dinner that was never marked.
  const job = prepSchedule(db, state, { today: THU, days: 2 }).flatMap((d) => d.tasks).find((t) => t.kind === 'catchup');
  assert.match(job.text, /^Was Monday’s .+ cooked\? Its food is still counted in the pantry\.$/);
  assert.equal(job.action.name, 'catch:open');
});

// ================================================================ 4. fewer trips, a visible goal

test('store trips this month are counted from receipts: one a day, however many stores', () => {
  const state = { receipts: [
    { id: 'a', date: '2026-11-01', store: 'sams', amount: 212.4 },
    { id: 'b', date: '2026-11-01', store: 'jewel', amount: 61.1 }, // the same run
    { id: 'c', date: '2026-11-09', store: 'jewel', amount: 18.75 }, // a quick top-up is still a trip
    { id: 'd', date: '2026-11-14', store: 'jewel', amount: 96 },
    { id: 'd', date: '2026-11-14', store: 'jewel', amount: 96 }, // a duplicate entry
    { id: 'e', date: '2026-10-28', store: 'sams', amount: 300 }, // last month
  ] };
  assert.deepEqual(tripsIn(state, '2026-11'), [
    { date: '2026-11-01', stores: ['jewel', 'sams'].sort((x, y) => (x === 'sams' ? -1 : 1)), total: 273.5, receipts: 2 },
    { date: '2026-11-09', stores: ['jewel'], total: 18.75, receipts: 1 },
    { date: '2026-11-14', stores: ['jewel'], total: 96, receipts: 1 },
  ]);
  const g = tripGoal(state, TUE);
  assert.deepEqual([g.count, g.goal, g.left, g.over, g.last, g.daysSince, g.daysLeft, g.perTrip], [3, TRIP_GOAL, 0, false, '2026-11-14', 3, 14, 129.42]);
  assert.equal(TRIP_GOAL, 3);
  const two = tripGoal({ receipts: state.receipts.slice(0, 2) }, TUE);
  assert.deepEqual([two.count, two.left, two.stretch], [1, 2, 7], 'two trips left for 14 days: a week each');
  const over = tripGoal({ ...state, settings: { tripGoal: 2 } }, TUE);
  assert.deepEqual([over.goal, over.over, over.left], [2, true, 0]);
  assert.equal(tripGoal({ ...state, settings: { tripGoal: 99 } }, TUE).goal, 3, 'a silly goal is ignored');
  assert.deepEqual([tripGoal({}, TUE).count, tripGoal({}, TUE).last, tripGoal({}, TUE).perTrip], [0, null, null]);
  assert.equal(monthBudget(db, state, TUE).trips.count, 3);
});

test('the year at this rate, against twelve times the target, and the last three months’ real average', () => {
  const state = { receipts: [
    { id: 'a', date: '2026-08-10', store: 'sams', amount: 700 },
    { id: 'b', date: '2026-09-12', store: 'sams', amount: 820 },
    { id: 'c', date: '2026-10-03', store: 'jewel', amount: 400 }, { id: 'd', date: '2026-10-20', store: 'sams', amount: 480 },
    { id: 'e', date: '2026-11-02', store: 'sams', amount: 300 },
  ] };
  const p = yearPace(state, TUE, 770);
  assert.deepEqual(p, {
    target: 650, yearTarget: 7800, rate: 770, year: 9240, overYear: 1440,
    months: [{ month: '2026-08', total: 700 }, { month: '2026-09', total: 820 }, { month: '2026-10', total: 880 }], monthsWithData: 3, avg3: 800,
  });
  const few = yearPace({ receipts: state.receipts.slice(1, 2), settings: { monthlyTarget: 700 } }, TUE, 600);
  assert.deepEqual([few.yearTarget, few.year, few.overYear, few.monthsWithData, few.avg3], [8400, 7200, -1200, 1, 820], 'months with no receipts are left out of the average');
  assert.equal(yearPace({}, TUE, 500).avg3, null);
  assert.equal(yearPace(state, TUE).rate, 300, 'with no projection, this month’s receipts');
  const b = monthBudget(db, state, TUE);
  assert.equal(b.pace.rate, b.ifPlanned, 'the Budget’s rate is this month’s receipts plus what the plan still needs');
  assert.equal(b.pace.year, round2(b.ifPlanned * 12));
  assert.equal(b.pace.avg3, 800);
});

test('a trip list under 10 days says how many more days would skip the next run, and extends', () => {
  const pantry = shelfWith({});
  const dates = datesBetween(TUE, addDays(TUE, 6)); // the planner has a week planned
  const base = { lunch: noLunches, pantry, plan: generatePlan({ db, state: { lunch: noLunches, pantry }, dates, mode: 'fill', by: 'Family', at: 'x', today: TUE, seedKey: TUE }).entries };
  assert.equal(tripAdvice(db, base, { today: TUE }), null, 'no trip, no advice');
  const trip = { start: TUE, end: SAT, store: 'both', by: 'Jeff', at: 'x' };
  const key = tripKeyOf(trip);
  const state = { ...base, settings: { trip }, checked: { [key]: { chicken: true } }, skips: { [key]: { beef: { reason: 'stretch' } } } };
  const a = tripAdvice(db, state, { today: TUE });
  assert.equal(TRIP_MIN_DAYS, 10);
  assert.deepEqual([a.days, a.short, a.more, a.newEnd, a.open], [5, true, 5, addDays(TUE, 9), 3], 'five days now; five more reach ten; three of those nights are open');
  assert.equal(a.total, buildList(db, state, { dates: datesBetween(TUE, SAT), listKey: key, today: TUE }).total);
  assert.ok(a.longer >= a.total && a.added === round2(a.longer - a.total), 'what the longer list costs today');
  const r = extendTripOps(db, state, { today: TUE, ...ctx });
  const s = applyOps(state, r.ops);
  assert.deepEqual([s.settings.trip.start, s.settings.trip.end, s.settings.trip.store], [TUE, addDays(TUE, 9), 'both']);
  for (const d of datesBetween(TUE, addDays(TUE, 9))) assert.ok(s.plan[d]?.dinner, `${d} has a dinner to shop for`);
  for (const d of dates) assert.deepEqual(s.plan[d], state.plan[d], 'nights already planned are left as they were');
  const nk = tripKeyOf(s.settings.trip);
  assert.deepEqual([s.checked[nk], s.checked[key], s.skips[nk], s.skips[key]], [{ chicken: true }, undefined, { beef: { reason: 'stretch' } }, undefined], 'check-offs and skips come along');
  assert.equal(s.planAhead, undefined, 'extending a trip isn’t a plan-ahead result');
  assert.match(r.message, /^The trip now shops through Thursday, Nov 26: 10 days of food in one run\. Planned 3 more dinners, pantry first\.$/);
  assert.equal(buildList(db, s, { dates: datesBetween(TUE, addDays(TUE, 9)), listKey: nk, today: TUE }).total, a.longer, 'the advice quoted the list it leads to');
  const b = tripAdvice(db, s, { today: TUE });
  assert.deepEqual([b.days, b.short, b.more], [10, false, 0], 'ten days: long enough');
  assert.equal(extendTripOps(db, s, { today: TUE, ...ctx }).ops.length, 0);
  assert.deepEqual(applyOps(s, r.undo), state);
  // A trip that's over gives no advice.
  assert.equal(tripAdvice(db, state, { today: addDays(SAT, 1) }), null);
});

test('a two-store trip splits sensibly: fresh and small at Jewel, what keeps in bulk at Sam’s, no stop for one small thing', () => {
  const mdb = mini({ dinners: [
    { id: 'greens', sides: ['spin', 'rice-side'], items: { chicken: 2 } },
    { id: 'rice-bowl', sides: ['broc', 'rice-side'], items: { chicken: 2, rice: 30 } },
  ] });
  const item = (list, id) => list.items.find((i) => i.id === id);
  const one = { plan: { [TUE]: { dinner: 'greens', status: 'planned' } } };
  const plainList = buildList(mdb, one, { dates: [TUE], today: TUE });
  assert.equal(item(plainList, 'spinach').store, 'sams', 'without a split, the catalog’s usual store');
  assert.equal(plainList.split.on, false);
  const split = buildList(mdb, one, { dates: [TUE], today: TUE, split: true });
  // Fresh: 5 oz needed. The 32 oz tub would leave 84% unused (over the 40% line); the 8 oz bag costs less.
  assert.deepEqual([item(split, 'spinach').store, item(split, 'spinach').storeWhy], ['jewel', 'fresh']);
  assert.ok(27 / 32 > SPLIT.freshLeftover);
  // Meat freezes, so the bulk pack stays at Sam's even for one dinner.
  assert.equal(item(split, 'chicken').store, 'sams');
  // Things that keep: 10 oz of rice is cheaper as one small bag, so it stays at Jewel…
  assert.equal(item(split, 'rice').store, 'jewel');
  // …and a big need flips to the bulk bag, which is cheaper for the amount and by the ounce.
  const big = { plan: Object.fromEntries(datesBetween(TUE, addDays(TUE, 9)).map((d) => [d, { dinner: 'rice-bowl', status: 'planned' }])) };
  const bigSplit = buildList(mdb, big, { dates: datesBetween(TUE, addDays(TUE, 9)), today: TUE, split: true });
  assert.deepEqual([item(bigSplit, 'rice').store, item(bigSplit, 'rice').storeWhy, item(bigSplit, 'rice').packs], ['sams', 'bulk', 1], '400 oz needed: one 400 oz bag for $20, not 13 small ones for $41.60');
  assert.ok(bigSplit.split.moved.some((m) => m.id === 'rice' && m.why === 'bulk' && m.saves === 21.6));
  assert.ok(bigSplit.total < buildList(mdb, big, { dates: datesBetween(TUE, addDays(TUE, 9)), today: TUE, split: false }).total, 'the split trip costs less');
  // The family's own choice of store is never changed.
  assert.equal(item(buildList(mdb, { ...one, storeFor: { spinach: 'sams' } }, { dates: [TUE], today: TUE, split: true }), 'spinach').store, 'sams');
  // One stop: with the chicken already home, Sam's would be a drive for broccoli alone; Jewel has it.
  const stop = { pantry: { chicken: { qty: 10 } }, plan: { [TUE]: { dinner: 'rice-bowl', status: 'planned' } }, extras: { x1: { name: 'Milk', qty: 1, store: 'jewel', price: 3.5 } } };
  const noSplit = buildList(mdb, stop, { dates: [TUE], today: TUE, split: false });
  assert.deepEqual(noSplit.stores.sams.items.map((i) => i.id), ['broccoli']);
  const oneStop = buildList(mdb, stop, { dates: [TUE], today: TUE, split: true });
  assert.deepEqual(oneStop.stores.sams.items, [], 'no Sam’s stop for one bag of broccoli');
  assert.deepEqual([item(oneStop, 'broccoli').store, item(oneStop, 'broccoli').storeWhy], ['jewel', 'one-stop']);
  assert.ok(oneStop.total - noSplit.total <= SPLIT.stopExtra, 'and it costs at most a few dollars more');
  // A list keyed as a two-store trip splits by default; a week's list and a one-store trip don't.
  assert.equal(buildList(mdb, one, { dates: [TUE], today: TUE, listKey: `trip:${TUE}:${SAT}:both` }).split.on, true);
  assert.equal(buildList(mdb, one, { dates: [TUE], today: TUE, listKey: `${TUE}+7` }).split.on, false);
  assert.equal(buildList(mdb, one, { dates: [TUE], today: TUE, listKey: `trip:${TUE}:${SAT}:jewel`, store: 'jewel' }).split.on, false);
  assert.equal(buildList(mdb, { ...one, settings: { planStore: 'jewel' } }, { dates: [TUE], today: TUE, split: true }).split.on, false, 'a one-store plan has nothing to split');
});
