import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tinyDb } from './helpers.mjs';
import { buildList, formatPackQty, formatStoreList, monthBudget, needsFor } from '../app/shopping.js';
import { doneShoppingOps, setPriceOps, notAtStoreOps, toggleCheckOps, addExtraOps, addReceiptOps } from '../app/actions.js';
import { applyOps } from '../app/state.js';
import { buildDb } from '../app/data.js';

const db = tinyDb();
const nights = (...pairs) => ({ plan: Object.fromEntries(pairs.map(([d, dinner, extra]) => [d, { dinner, status: 'planned', ...(extra || {}) }])) });

test('needs sum entrée + both sides for planned nights only', () => {
  const s = nights(['2026-11-17', 'chix-grill'], ['2026-11-18', 'chix-pasta'], ['2026-11-19', 'beef-bowl', { status: 'away' }], ['2026-11-20', 'chix-grill', { status: 'cooked' }]);
  const { needs, nights: n } = needsFor(db, s, ['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20']);
  assert.equal(n.length, 2);
  assert.equal(needs.chicken, 4.5);
  assert.equal(needs.broccoli, 2.5);
  assert.equal(needs.greenBeans, 4);
  assert.ok(!needs.beef, 'away night adds nothing');
});

test('pack rounding, leftovers, cost math and the freezer panel', () => {
  const s = nights(['2026-11-17', 'chix-grill'], ['2026-11-18', 'chix-pasta'], ['2026-11-19', 'naan-chicken']);
  const list = buildList(db, s, { dates: ['2026-11-17', '2026-11-18', '2026-11-19'] });
  const chicken = list.items.find((i) => i.id === 'chicken');
  assert.equal(chicken.need, 6.5);
  assert.equal(chicken.store, 'sams');
  assert.equal(chicken.packs, 1);
  assert.equal(chicken.leftover, 3.5);
  assert.equal(chicken.cost, 30);
  assert.equal(formatPackQty(chicken), '1 × ~10 lb pack');
  assert.ok(list.leftovers.find((l) => l.id === 'chicken' && l.qty === 3.5));
  const fz = list.freezer.find((f) => f.id === 'chicken');
  assert.equal(fz.dinners, 3);
  assert.equal(fz.covers, 3);
  assert.equal(fz.leftover, 3.5);
  const beans = list.items.find((i) => i.id === 'greenBeans');
  assert.equal(beans.need, 6);
  assert.equal(formatPackQty(beans), '1 × 8-can pack');
  const sum = list.items.filter((i) => i.store === 'sams').reduce((t, i) => t + i.cost, 0);
  assert.equal(list.stores.sams.subtotal, Math.round(sum * 100) / 100);
  assert.equal(list.total, Math.round((list.stores.sams.subtotal + list.stores.jewel.subtotal) * 100) / 100);
  assert.ok(Number.isFinite(list.perDinner) && list.perDinner > 0);
});

test('pantry: stocked staples drop off; measured items buy only the shortfall', () => {
  const s = { ...nights(['2026-11-17', 'chix-pasta'], ['2026-11-18', 'chix-pasta']), pantry: { salt: { stocked: true, qty: null }, pasta: { qty: 20 }, chicken: { qty: 4 } } };
  const list = buildList(db, s, { dates: ['2026-11-17', '2026-11-18'] });
  assert.ok(!list.items.find((i) => i.id === 'salt'));
  assert.ok(list.covered.find((c) => c.id === 'salt'));
  assert.ok(!list.items.find((i) => i.id === 'chicken'), '4 lb on hand covers 2 × 2 lb');
  const pasta = list.items.find((i) => i.id === 'pasta');
  assert.equal(pasta.shortfall, 12);
  assert.equal(pasta.packs, 1);
  // Running low puts a staple back on the list even if nothing needs it.
  const low = buildList(db, { pantry: { salt: { stocked: true, low: true } } }, { dates: [] });
  const salt = low.items.find((i) => i.id === 'salt');
  assert.ok(salt && salt.packs === 1 && salt.reasons.includes('low'));
});

test('store & brand: per-item store toggle, name brand, family price correction, not-at-this-store', () => {
  const base = nights(['2026-11-17', 'chix-grill']);
  const dates = ['2026-11-17'];
  let list = buildList(db, { ...base, storeFor: { chicken: 'jewel' } }, { dates });
  let c = list.items.find((i) => i.id === 'chicken');
  assert.equal(c.store, 'jewel');
  assert.equal(c.packs, 1);
  assert.equal(c.cost, 12);
  list = buildList(db, { ...base, brands: { chicken: 'name' } }, { dates });
  assert.equal(list.items.find((i) => i.id === 'chicken').cost, 45);
  const withPrice = applyOps(base, setPriceOps(base, { store: 'sams', brand: 'generic', id: 'chicken', size: 10, price: 27.5, who: 'Candi' }).ops);
  c = buildList(db, withPrice, { dates }).items.find((i) => i.id === 'chicken');
  assert.equal(c.cost, 27.5);
  assert.equal(c.pack.source, 'family');
  const noSams = applyOps(base, notAtStoreOps(db, base, { store: 'sams', id: 'chicken' }).ops);
  assert.equal(buildList(db, noSams, { dates }).items.find((i) => i.id === 'chicken').store, 'jewel');
  const jewelPlan = { ...base, settings: { planStore: 'jewel' } };
  const jl = buildList(db, jewelPlan, { dates });
  assert.ok(jl.items.every((i) => i.store === 'jewel'));
});

test('extras feed the list; checked items go to the pantry on "Done shopping"', () => {
  let s = nights(['2026-11-17', 'chix-grill']);
  s = applyOps(s, addExtraOps(db, s, { item: 'milk', qty: 1, every: 'week' }).ops);
  s = applyOps(s, addExtraOps(db, s, { name: 'Paper towels', qty: 1, store: 'sams', price: 21.98 }).ops);
  const dates = ['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30'];
  let list = buildList(db, s, { dates, listKey: 'k' });
  const milk = list.items.find((i) => i.id === 'milk');
  assert.equal(milk.packs, 2, 'weekly extra × 2 weeks');
  const towels = list.items.find((i) => i.freeText);
  assert.equal(towels.cost, 21.98);
  assert.equal(towels.store, 'sams');
  s = applyOps(s, toggleCheckOps(s, { listKey: 'k', key: 'chicken' }).ops);
  list = buildList(db, s, { dates, listKey: 'k' });
  assert.equal(list.items.find((i) => i.id === 'chicken').checked, true);
  const done = doneShoppingOps(db, s, { list, who: 'Jeff' });
  s = applyOps(s, done.ops);
  assert.equal(s.pantry.chicken.qty, 10);
  assert.ok(!s.checked?.k);
  list = buildList(db, s, { dates, listKey: 'k' });
  assert.ok(!list.items.find((i) => i.id === 'chicken'), 'the pantry now covers it');
});

test('store list text is clean and in packs', () => {
  const s = nights(['2026-11-17', 'chix-grill'], ['2026-11-18', 'burger']);
  const list = buildList(db, s, { dates: ['2026-11-17', '2026-11-18'] });
  const text = formatStoreList(db, list, 'sams');
  assert.match(text, /^Sam's Club list for Nov 17 – 18/);
  assert.match(text, /Chicken breast — 1 × ~10 lb pack/);
  assert.match(text, /Hamburger buns — 1 × 12-count pack/);
  assert.ok(!/undefined|NaN/.test(text));
  const jewel = formatStoreList(db, list, 'jewel');
  assert.match(jewel, /Frozen fries — 1 × 32 oz pack/);
  // Volume items name a sensible container (cooking oil comes in a bottle, not a jar).
  const vol = (name, aisle, unit = 'tbsp') => formatPackQty({ name, aisle, unit, pack: { size: 48 }, packs: 1 });
  assert.equal(vol('Neutral cooking oil', 'Spices & Baking'), '1 × bottle (about 48 tbsp)');
  assert.equal(vol('Chicken broth', 'Canned & Jarred', 'cups'), '1 × carton (about 48 cups)');
  assert.equal(vol('Light brown sugar', 'Spices & Baking'), '1 × bag (about 48 tbsp)');
  assert.equal(vol('Smoked paprika', 'Spices & Baking', 'tsp'), '1 × jar (about 48 tsp)');
  assert.equal(vol('Creamy peanut butter', 'Canned & Jarred'), '1 × jar (about 48 tbsp)');
});

test('budget: receipts + still to buy, savings vs $1,000', () => {
  const s = { ...nights(['2026-11-20', 'chix-grill'], ['2026-11-21', 'chix-pasta']), settings: { monthlyTarget: 600 } };
  const withR = applyOps(s, addReceiptOps(s, { date: '2026-11-03', store: 'jewel', amount: 112.4 }).ops);
  const b = monthBudget(db, withR, '2026-11-16');
  assert.equal(b.target, 600);
  assert.equal(b.spent, 112.4);
  assert.equal(b.plannedRemaining, 2);
  assert.equal(b.projected, Math.round((112.4 + b.stillToBuy) * 100) / 100);
  assert.equal(b.unplanned, 13);
  assert.ok(b.ifPlanned > b.projected);
  // 13 nights aren't planned yet: savings vs the old $1,000 month must count them (at the
  // rotation average), never compare a half-planned month with a whole one.
  assert.equal(b.ifPlanned, Math.round((b.projected + b.average * 13) * 100) / 100);
  assert.equal(b.savings, Math.round((1000 - b.ifPlanned) * 100) / 100);
  assert.equal(b.leftIfPlanned, Math.round((600 - b.ifPlanned) * 100) / 100);
});

test('budget: a fully planned month compares its projection with $1,000 as is', () => {
  const dates = Array.from({ length: 15 }, (_, i) => `2026-11-${String(16 + i).padStart(2, '0')}`);
  const s = nights(...dates.map((d, i) => [d, i % 2 ? 'chix-grill' : 'chix-pasta']));
  const b = monthBudget(db, s, '2026-11-16');
  assert.equal(b.unplanned, 0);
  assert.equal(b.ifPlanned, b.projected);
  assert.equal(b.savings, Math.round((1000 - b.projected) * 100) / 100);
});

test('prices.json overrides catalog packs; missing optional files are fine', () => {
  const catalog = { ingredients: { chicken: { name: 'Chicken', unit: 'lb', packs: { sams: { generic: { size: 10, price: 29.9, label: 'A' } } } } } };
  const d = buildDb({ catalog, recipes: { dinners: [], sides: [] }, prices: { updated: '2026-11-14', prices: { chicken: { sams: { generic: { size: 9, price: 31.5, confidence: 'listed' } }, jewel: { generic: { size: 3, price: 12 } } } } } });
  assert.equal(d.ingredients.chicken.packs.sams.generic.price, 31.5);
  assert.equal(d.ingredients.chicken.packs.sams.generic.label, 'A', 'keeps catalog label');
  assert.equal(d.ingredients.chicken.packs.jewel.generic.size, 3);
  assert.equal(d.pricesUpdated, '2026-11-14');
  const e = buildDb({ catalog, recipes: { dinners: [], sides: [] } });
  assert.equal(e.pricesUpdated, null);
  assert.equal(e.stores.jewel.website, 'https://www.jewelosco.com');
});

test('typical month = rotation average × nights + everyday extras', async () => {
  const { rotationAverage, extrasPerMonth, dinnerFoodCost } = await import('../app/shopping.js');
  const s = applyOps({}, addExtraOps(db, {}, { item: 'milk', qty: 1, every: 'week' }).ops);
  const avg = rotationAverage(db, s);
  assert.ok(avg > 0);
  const b = monthBudget(db, s, '2026-11-16');
  assert.equal(b.typical.dinners, Math.round(avg * 30 * 100) / 100);
  assert.equal(b.typical.extras, extrasPerMonth(db, s).total);
  assert.equal(b.typical.extras, Math.round(3.69 * 52 / 12 * 100) / 100);
  assert.equal(b.typical.total, Math.round((b.typical.dinners + b.typical.extras) * 100) / 100);
  const light = dinnerFoodCost(db, { settings: { meatScale: 0.85 } }, 'chix-grill');
  assert.ok(light < dinnerFoodCost(db, {}, 'chix-grill'), 'lighter meat costs less');
});
