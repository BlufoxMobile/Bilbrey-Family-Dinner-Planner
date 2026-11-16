// app/cost.js (docs/spec/24-chicken-bulk-and-meal-cost.md): what a meal costs. Exact math on the tiny
// hand-made db, then the real recipe box, so the numbers on a plan card are the shopping list's numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, realDb, tinyDb } from './helpers.mjs';
import { dinnerCost, lunchCost, planCost, itemsCost, pricedPack, cheapestFirst, costLine } from '../app/cost.js';
import { buildList, dinnerFoodCost, lunchFoodCost } from '../app/shopping.js';
import { allDinners } from '../app/planner.js';

const tiny = tinyDb();
const real = realDb();
const near = (a, b, eps = 0.011) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);
const plan = (...pairs) => Object.fromEntries(pairs.map(([d, dinner, extra]) => [d, { dinner, status: 'planned', ...(extra || {}) }]));
// tinyDb prices: chicken $30 / 10 lb at Sam's ($3.00/lb), $12 / 3 lb at Jewel; broccoli $6.50 / 4 lb;
// green beans $8.49 / 8 cans; pasta $1.50 / 16 oz at Jewel (its usual store); salt $1.29 / 120 tsp (a staple).
const CHIX_GRILL = 2.5 * 3 + 1.25 * (6.5 / 4) + 2 * (8.49 / 8); // 11.65375

// ---------------------------------------------------------------- one dinner

test('dinnerCost: amount × the unit price of the pack the list would buy, for five', () => {
  const c = dinnerCost(tiny, {}, 'chix-grill');
  assert.equal(c.total, 11.65);
  assert.equal(c.servings, 5);
  assert.equal(c.perServing, 2.33);
  assert.equal(c.pantryValue, 0);
  assert.equal(c.unpriced, 0);
  assert.deepEqual(c.items.map((i) => i.id), ['chicken', 'beans', 'broc'].map((x) => ({ beans: 'greenBeans', broc: 'broccoli' }[x] || x)), 'dearest first');
  const chicken = c.items[0];
  assert.deepEqual({ id: chicken.id, name: chicken.name, qty: chicken.qty, unit: chicken.unit, cost: chicken.cost, store: chicken.store }, { id: 'chicken', name: 'Chicken breast', qty: 2.5, unit: 'lb', cost: 7.5, store: 'sams' });
  near(c.items.reduce((t, i) => t + i.cost, 0), c.total, 0.02);
});

test('toBuy is whole packs: a 10 lb bag is bought for 2.5 lb, but only 2.5 lb is charged to the dinner', () => {
  const c = dinnerCost(tiny, {}, 'chix-grill');
  assert.equal(c.toBuy, 44.99); // $30 bag + $6.50 broccoli + $8.49 case of beans
  assert.deepEqual(c.items.map((i) => [i.id, i.packs, i.buy]), [['chicken', 1, 30], ['greenBeans', 1, 8.49], ['broccoli', 1, 6.5]]);
  assert.ok(c.toBuy > c.total, 'the trip costs more than the food this one dinner uses');
});

test('pantryValue is the part already in the house, and it comes off the trip', () => {
  const some = dinnerCost(tiny, { pantry: { chicken: { qty: 1 } } }, 'chix-grill');
  assert.equal(some.total, 11.65, 'the food costs what it costs wherever it comes from');
  assert.equal(some.pantryValue, 3);
  assert.equal(some.toBuy, 44.99, '1 lb on hand still needs a bag for the other 1.5 lb');

  const all = dinnerCost(tiny, { pantry: { chicken: { qty: 6 }, broccoli: { qty: 4 } } }, 'chix-grill');
  assert.equal(all.pantryValue, 9.53); // 7.50 + 2.03
  assert.equal(all.toBuy, 8.49, 'only the beans');
  assert.equal(all.items.find((i) => i.id === 'chicken').have, 2.5, 'no more than the dinner needs');

  const low = dinnerCost(tiny, { pantry: { chicken: { qty: 6, low: true } } }, 'chix-grill');
  assert.equal(low.pantryValue, 0, 'marked low: the list buys it, so it does not count as on hand');
  const stocked = dinnerCost(tiny, { pantry: { chicken: { stocked: true } } }, 'chix-grill');
  assert.equal(stocked.pantryValue, 7.5, '"we have it" with no amount covers the dinner');
});

test('staples: a pinch of salt costs a pinch, and a bottle is only bought when the shelf has none', () => {
  const none = dinnerCost(tiny, {}, 'chix-pasta');
  const salt = none.items.find((i) => i.id === 'salt');
  assert.equal(salt.cost, 0.01);
  assert.equal(salt.buy, 1.29);
  const have = dinnerCost(tiny, { pantry: { salt: { stocked: true } } }, 'chix-pasta');
  assert.equal(have.items.find((i) => i.id === 'salt').buy, 0);
  near(none.toBuy - have.toBuy, 1.29);
  near(have.pantryValue, 1.29 / 120);
});

test('the store, the family’s own price and a price check all change the number the way they change the list', () => {
  // A Jewel-only trip buys the 3 lb Jewel pack: $4.00/lb instead of $3.00.
  const jewel = dinnerCost(tiny, { settings: { planStore: 'jewel' } }, 'chix-grill');
  assert.equal(jewel.items.find((i) => i.id === 'chicken').store, 'jewel');
  assert.equal(jewel.items.find((i) => i.id === 'chicken').cost, 10);
  assert.equal(dinnerCost(tiny, {}, 'chix-grill', null, { store: 'jewel' }).total, jewel.total, 'a trip’s store can be passed in');
  // Something Jewel doesn't carry falls back to Sam's, like the list.
  assert.equal(dinnerCost(tiny, { settings: { planStore: 'jewel' } }, 'naan-chicken').items.find((i) => i.id === 'samsOnly').store, 'sams');

  // The family typed what they pay.
  const fam = dinnerCost(tiny, { prices: { 'sams/generic/chicken': { size: 10, price: 20 } } }, 'chix-grill');
  assert.equal(fam.items.find((i) => i.id === 'chicken').cost, 5);
  assert.equal(fam.items.find((i) => i.id === 'chicken').source, 'family');

  // A price check with a sale, good on the day; stale two weeks later.
  const deals = { 'sams/chicken': { label: 'Chicken, 10 lb', size: 10, price: 25, was: 30, checked: '2026-11-15' } };
  assert.equal(dinnerCost(tiny, { deals }, 'chix-grill', null, { today: '2026-11-16' }).items.find((i) => i.id === 'chicken').cost, 6.25);
  assert.equal(dinnerCost(tiny, { deals }, 'chix-grill', null, { today: '2026-12-20' }).items.find((i) => i.id === 'chicken').cost, 7.5);
  assert.equal(pricedPack(tiny, { deals }, 'chicken', { today: '2026-11-16' }).pack.kind, 'deal');
});

test('estimated: true while any price is an estimate, false once every price was read, paid or typed', () => {
  const c = dinnerCost(tiny, {}, 'chix-grill');
  assert.equal(c.estimated, true);
  assert.equal(c.estimatedCost, c.total, 'every catalog price here is an estimate');
  const known = {
    prices: { 'sams/generic/chicken': { size: 10, price: 30 }, 'sams/generic/broccoli': { size: 4, price: 6.5 } },
    deals: { 'sams/greenBeans': { size: 8, price: 8.49, checked: '2026-11-15' } },
  };
  const k = dinnerCost(tiny, known, 'chix-grill', null, { today: '2026-11-16' });
  assert.equal(k.estimated, false);
  assert.equal(k.estimatedCost, 0);
  assert.ok(k.items.every((i) => i.estimated === false));
  // One estimate left makes the whole dinner an estimate, and says how much of it.
  const one = dinnerCost(tiny, { prices: known.prices }, 'chix-grill');
  assert.equal(one.estimated, true);
  assert.equal(one.estimatedCost, 2.12);
});

test('the dinner as it will be served: the night’s sides, remembered swaps and the meat setting', () => {
  const swapped = dinnerCost(tiny, {}, 'chix-grill', { sides: ['broc', 'naan-side'] });
  near(swapped.total, 2.5 * 3 + 1.25 * (6.5 / 4) + 5 * (6.5 / 10));
  const remembered = dinnerCost(tiny, { substitutions: { 'chix-grill': { 1: 'naan-side' } } }, 'chix-grill');
  assert.equal(remembered.total, swapped.total);
  const light = dinnerCost(tiny, { settings: { meatScale: 0.85 } }, 'chix-grill');
  near(light.total, CHIX_GRILL - 2.5 * 3 + 2.13 * 3); // 2.5 lb × 0.85, rounded to 2.13 lb like the list
  assert.equal(light.items.find((i) => i.id === 'chicken').qty, 2.13);
  assert.equal(dinnerCost(tiny, {}, 'chix-grill', null, { servings: 4 }).perServing, 2.91);
});

test('a dinner that is not there costs nothing: null, never a made-up number', () => {
  assert.equal(dinnerCost(tiny, {}, 'no-such-dinner'), null);
  assert.equal(dinnerCost(real, {}, 'turkey-chili'), null, 'a retired id');
  assert.equal(lunchCost(real, {}, 'no-such-lunch'), null);
  assert.equal(costLine(null), '');
});

test('something nothing can price is counted, not guessed', () => {
  const c = itemsCost(tiny, { custom: { 'custom-rub': { name: 'Dry rub', unit: 'tsp' } } }, { chicken: 1, 'custom-rub': 2 });
  assert.equal(c.total, 3);
  assert.equal(c.unpriced, 1);
  assert.equal(c.estimated, true);
  const rub = c.items.find((i) => i.id === 'custom-rub');
  assert.deepEqual({ name: rub.name, cost: rub.cost, source: rub.source }, { name: 'Dry rub', cost: null, source: 'none' });
  assert.equal(c.items[c.items.length - 1].id, 'custom-rub', 'unpriced items sort last');
});

// ---------------------------------------------------------------- lunches and a plan

test('lunchCost: one lunch for one person, by id or by item', () => {
  const c = lunchCost(real, {}, 'bonduelle-chicken-blt');
  assert.equal(c.servings, 1);
  assert.equal(c.total, 4.99);
  assert.equal(c.perServing, 4.99);
  assert.equal(c.toBuy, 4.99);
  assert.deepEqual(lunchCost(real, {}, real.lunch.items['bonduelle-chicken-blt']), c);
  for (const it of real.lunch.itemList) {
    const x = lunchCost(real, {}, it.id);
    near(x.total, lunchFoodCost(real, {}, it));
    assert.ok(x.total > 0, it.id);
  }
});

test('planCost: the nights add up, and packs and the pantry are shared between them', () => {
  const dates = ['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'];
  const state = { plan: plan(['2026-11-17', 'chix-grill'], ['2026-11-18', 'chix-pasta'], ['2026-11-19', 'beef-bowl', { status: 'away' }], ['2026-11-20', 'chix-grill', { status: 'cooked' }]) };
  const p = planCost(tiny, state, dates);
  assert.equal(p.dinners, 2, 'away and cooked nights are not counted');
  assert.deepEqual(p.nights.map((n) => [n.date, n.dinner, n.title]), [['2026-11-17', 'chix-grill', 'chix-grill'], ['2026-11-18', 'chix-pasta', 'chix-pasta']]);
  const a = dinnerCost(tiny, state, 'chix-grill');
  const b = dinnerCost(tiny, state, 'chix-pasta');
  near(p.total, a.total + b.total);
  near(p.perDinner, (a.total + b.total) / 2);
  near(p.perServing, (a.total + b.total) / 10);
  assert.deepEqual(p.nights.map((n) => n.total), [a.total, b.total]);
  // One bag of chicken, one bag of broccoli and one case of beans feed both nights.
  assert.ok(p.toBuy < a.toBuy + b.toBuy);
  near(p.toBuy, 30 + 6.5 + 8.49 + 1.5 + 1.29);
  // …which is what the shopping list for those nights comes to.
  assert.equal(p.toBuy, buildList(tiny, state, { dates }).total);
  // A pound in the freezer is used once, not once per night.
  const withPantry = planCost(tiny, { ...state, pantry: { chicken: { qty: 3 } } }, dates);
  assert.equal(withPantry.pantryValue, 9);
  assert.deepEqual(planCost(tiny, {}, dates), { total: 0, perDinner: 0, perServing: 0, dinners: 0, servings: 5, nights: [], pantryValue: 0, toBuy: 0, estimated: false, estimatedCost: 0, unpriced: 0 });
});

// ---------------------------------------------------------------- the real recipe box

test('every dinner in the box has a cost, and it is the list’s own number', () => {
  for (const d of real.dinnerList) {
    const c = dinnerCost(real, {}, d.id);
    assert.ok(c, d.id);
    assert.equal(c.unpriced, 0, `${d.id}: every ingredient is priced`);
    near(c.total, dinnerFoodCost(real, {}, d.id));
    near(c.perServing, c.total / 5, 0.006);
    assert.ok(c.total >= 6 && c.total <= 36, `${d.id}: $${c.total} for five is a believable dinner`);
    assert.ok(c.pantryValue === 0 && c.toBuy >= c.total - 0.01, d.id);
    for (const i of c.items) assert.ok(i.name && i.unit && ['sams', 'jewel'].includes(i.store) && i.cost >= 0 && i.qty > 0, `${d.id} ${i.id}`);
    assert.equal(c.estimated, c.items.some((i) => i.estimated), d.id);
    assert.ok(c.estimatedCost <= c.total + 0.02, d.id);
  }
});

test('a plan’s to-buy is the shopping list’s total for the same nights', () => {
  const ids = ['cooker-beef-tips-gravy', 'honey-mustard-chicken-thighs', 'chicken-vegetable-stir-fry', 'cooker-pot-roast'];
  const dates = ['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'];
  const state = { plan: plan(...ids.map((id, i) => [dates[i], id])), lunch: { people: { Jeff: { enabled: false }, Knox: { enabled: false } } }, settings: { planStore: 'sams' } };
  const p = planCost(real, state, dates);
  const list = buildList(real, state, { dates, today: '2026-11-16', split: false });
  assert.equal(list.lunches.length, 0);
  near(p.toBuy, list.total, 0.02);
  near(p.total, list.usedByDinners, 0.05);
  assert.equal(p.dinners, 4);
});

test('beef tips cost what Sam’s charges, and the cheap cuts show up as cheap', () => {
  const tips = dinnerCost(real, {}, 'cooker-beef-tips-gravy');
  const meat = tips.items.find((i) => i.id === 'stewMeat');
  assert.equal(meat.store, 'sams');
  near(meat.unitPrice, 6.97, 0.01);
  assert.equal(meat.cost, 15.68);
  assert.equal(meat.estimated, false, 'read from samsclub.com');
  assert.equal(meat.buy, 25.79, 'the trip buys the whole ~3.7 lb pack');
  assert.equal(tips.estimated, true, 'the Jewel prices on the plate are still estimates');
  assert.ok(tips.estimatedCost < tips.total / 2);
  // Chicken thighs from the Sam's tray are the cheap dinner; chuck roast is the dear one.
  assert.ok(dinnerCost(real, {}, 'honey-mustard-chicken-thighs').perServing < dinnerCost(real, {}, 'cooker-pot-roast').perServing);
});

test('cheapestFirst sorts the recipe box by what a plate costs', () => {
  const sorted = cheapestFirst(real, {}, allDinners(real, {}));
  assert.equal(sorted.length, real.dinnerList.length);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i - 1].cost.perServing <= sorted[i].cost.perServing);
  assert.ok(sorted[0].cost.perServing < 3.5 && sorted[sorted.length - 1].cost.perServing > 4.5);
  assert.equal(sorted[0].dinner.id, real.dinnerList.map((d) => [d.id, dinnerCost(real, {}, d.id).perServing]).sort((a, b) => a[1] - b[1] || real.dinners[a[0]].title.localeCompare(real.dinners[b[0]].title))[0][0]);
  // A dinner nothing can price goes last, not first.
  const odd = { id: 'made-up', title: 'A made-up dinner' };
  const withOdd = cheapestFirst(tiny, {}, [odd, ...tiny.dinnerList]);
  assert.equal(withOdd[withOdd.length - 1].dinner.id, 'made-up');
  assert.equal(withOdd[withOdd.length - 1].cost, null);
});

test('costLine says it in words, and says "about" while any price is an estimate', () => {
  const c = dinnerCost(tiny, {}, 'chix-grill');
  assert.equal(costLine(c), 'about $2.33 a serving · $11.65 for five');
  assert.equal(costLine(c, { short: true }), 'about $2.33 a serving');
  assert.equal(costLine({ ...c, estimated: false }), '$2.33 a serving · $11.65 for five');
  assert.equal(costLine(dinnerCost(tiny, {}, 'chix-grill', null, { servings: 4 })), 'about $2.91 a serving · $11.65 for 4');
  assert.equal(costLine(lunchCost(real, {}, 'bonduelle-chicken-blt')), 'about $4.99 a lunch');
  assert.equal(costLine({ total: 0, perServing: 0, servings: 5 }), '');
});

test('app/cost.js is pure: no DOM, no clock, no storage', () => {
  const src = readFileSync(path.join(ROOT, 'app/cost.js'), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const word of ['document', 'window', 'localStorage', 'Date.now', 'new Date', 'fetch(']) assert.ok(!src.includes(word), word);
  assert.match(readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), /'app\/cost\.js',/);
});
