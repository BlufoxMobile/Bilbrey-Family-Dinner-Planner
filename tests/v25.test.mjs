// v2.5 (SPEC §12): trip lists, skips, price checks with sales and coupons, organic produce,
// what the pantry covers, the prep schedule, and receipts → pantry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realDb } from './helpers.mjs';
import { buildList } from '../app/shopping.js';
import { activeDeal, applyDeal, regularPrice } from '../app/deals.js';
import { packFor, canBuyAt } from '../app/planner.js';
import { settingsOf, normalizeTrip } from '../app/state.js';
import { pantryCoverage } from '../app/coverage.js';
import { prepSchedule } from '../app/prep.js';
import { receiptPantryAdds, receiptPantryOps, unsyncedReceipts } from '../app/receipts.js';
import { defaultTripEnd } from '../app/views/list.js';

const db = realDb();
const MON = '2026-11-16';
const TUE = '2026-11-17';
const SUN = '2026-11-15';

const night = (dinner, sides = undefined) => ({ dinner, ...(sides ? { sides } : {}), status: 'planned', by: 'Jeff', at: 'x' });

test('a trip is a store and a last day; anything else is no trip', () => {
  assert.deepEqual(normalizeTrip({ start: SUN, end: '2026-11-20', store: 'jewel' }), { start: SUN, end: '2026-11-20', store: 'jewel' });
  assert.equal(normalizeTrip({ start: SUN, end: '2026-11-14', store: 'jewel' }), null, 'ends before it starts');
  assert.equal(normalizeTrip({ end: '2026-11-20' }), null);
  assert.equal(normalizeTrip({ start: SUN, end: '2026-11-20', store: 'target' }).store, 'both');
  assert.equal(settingsOf({}).trip, null);
  assert.equal(settingsOf({}).organic, false);
  assert.equal(settingsOf({ settings: { organic: true } }).organic, true);
  assert.equal(defaultTripEnd(SUN), '2026-11-20', 'Sunday → this Friday (payday)');
  assert.equal(defaultTripEnd('2026-11-20'), '2026-11-20', 'Friday → today');
  assert.equal(defaultTripEnd('2026-11-21'), '2026-11-22', 'Saturday → Sunday');
});

test('a price check: sale until it ends, coupon until it expires, two weeks at most', () => {
  const state = { deals: { 'jewel/bodyArmorOM': { label: 'BODYARMOR Orange Mango 16 oz', size: 1, price: 1.99, was: 2.29, ends: '2026-11-18', coupon: { price: 0.99, text: '$0.99 each, limit 10', expires: TUE }, checked: SUN } } };
  const d = activeDeal(state, 'jewel', 'bodyArmorOM', SUN);
  assert.equal(d.price, 0.99, 'clipped coupon price');
  assert.equal(d.shelf, 1.99);
  assert.equal(d.regular, 2.29);
  assert.equal(d.sale, true);
  const wed = activeDeal(state, 'jewel', 'bodyArmorOM', '2026-11-18');
  assert.equal(wed.coupon, null, 'coupon ended Tuesday');
  assert.equal(wed.price, 1.99, 'still on sale Wednesday');
  const thu = activeDeal(state, 'jewel', 'bodyArmorOM', '2026-11-19');
  assert.equal(thu.price, 2.29, 'sale over: the regular price');
  assert.equal(activeDeal(state, 'jewel', 'bodyArmorOM', '2026-12-01'), null, 'a two-week-old check is stale');
  const p = applyDeal({ size: 6, price: 8.99, label: 'six-pack', kind: 'usual' }, d);
  assert.equal(p.size, 1);
  assert.equal(p.kind, 'deal');
  assert.equal(regularPrice(p), 2.29);
  assert.ok(canBuyAt(db, state, 'bodyArmorOM', 'jewel'));
});

test('organic produce: the organic pack when the family buys organic, kept when the receipt product is organic', () => {
  const off = packFor(db, {}, 'peppers', 'jewel');
  assert.ok(!off.organic);
  const on = packFor(db, { settings: { organic: true } }, 'peppers', 'jewel');
  assert.equal(on.kind, 'organic');
  assert.match(on.label, /organic/i);
  const fuji = { settings: { organic: true }, myProducts: { 'jewel/apples': { name: 'Fuji apples, 3 lb bag', packSize: 3, price: 2.67, source: 'receipt' } } };
  assert.equal(packFor(db, fuji, 'apples', 'jewel').kind, 'organic', 'a conventional receipt product gives way');
  const org = { settings: { organic: true }, myProducts: { 'jewel/bananas': { name: 'Organic bananas (by the lb)', packSize: 1.76, price: 1.57, source: 'receipt' } } };
  assert.equal(packFor(db, org, 'bananas', 'jewel').kind, 'mine', 'their organic product stays');
  assert.equal(packFor(db, { settings: { organic: true } }, 'beef', 'jewel').kind === 'organic', false, 'only produce');
});

test('a trip list: one store, skips set aside, fresh-on-the-day items apart, sales and coupons in the total', () => {
  const state = {
    settings: { organic: true },
    plan: { [MON]: night('blackened-cajun-chicken') },
    pantry: {},
    lunch: { people: { Knox: { enabled: false } } },
    skips: { 'trip:x': { chicken: { reason: 'stretch', note: 'Two big breasts, cut thin' } } },
    deals: { 'jewel/bonduelleBltBowl': { label: 'Bonduelle Chicken BLT', size: 1, price: 3, was: 4.99, ends: '2026-11-18', checked: SUN } },
  };
  const dates = [MON, TUE];
  const list = buildList(db, state, { dates, listKey: 'trip:x', store: 'jewel', today: SUN });
  assert.ok(list.items.every((i) => i.store === 'jewel' || i.storeFallback), 'everything Jewel carries is bought at Jewel');
  assert.ok(!list.items.some((i) => i.id === 'chicken'), 'skipped chicken is off the cart');
  assert.equal(list.skipped[0].id, 'chicken');
  assert.equal(list.skipped[0].skip.reason, 'stretch');
  const sandwich = list.onDay.find((i) => i.id === 'jewelDeliChickenSandwich');
  assert.ok(sandwich, 'Tuesday’s hot-deli sandwich is bought on the day');
  assert.ok(!list.items.some((i) => i.id === 'jewelDeliChickenSandwich'));
  const bowl = list.items.find((i) => i.id === 'bonduelleBltBowl');
  assert.equal(bowl.cost, 3);
  assert.equal(bowl.regularCost, 4.99);
  assert.ok(list.savings >= 1.99 - 1e-9);
  assert.equal(list.checkedCount, 1);
  const total = list.items.reduce((t, i) => t + (i.cost || 0), 0);
  assert.ok(Math.abs(list.total - total) < 0.01, 'skipped and on-the-day items are not in the total');
});

test('what the pantry covers: dinners in date order take from the shelf, the rest show what’s missing', () => {
  const state = {
    plan: { [MON]: night('pantry-beef-chili'), [TUE]: night('pantry-beef-chili') },
    pantry: {
      beef: { qty: 2.1 }, chiliBeans: { qty: 2 }, tomatoes: { qty: 1 }, paprika: { stocked: true, qty: null }, cajunSeasoning: { stocked: true, qty: null },
      oil: { stocked: true, qty: null }, cheese: { qty: 8 }, cannedCorn: { qty: 4 }, carrots: { qty: 5 }, butter: { qty: 10 }, pepper: { stocked: true, qty: null }, salt: { stocked: true, qty: null }, ranch: { stocked: true, qty: null },
    },
  };
  const cov = pantryCoverage(db, state, { dates: [MON, TUE] });
  assert.equal(cov.total, 2);
  assert.equal(cov.rows[0].ready, true, 'Monday’s chili is fully stocked');
  assert.equal(cov.rows[1].ready, false, 'Tuesday’s chili finds the beef used up');
  assert.ok(cov.rows[1].missing.some((m) => m.id === 'beef'));
  assert.equal(cov.ready, 1);
});

test('the prep schedule: thaw the evening before, brown once for two nights, pack lunches the night before', () => {
  const state = {
    plan: { [MON]: night('blackened-cajun-chicken'), [TUE]: night('chorizo-nopalitos-tacos'), '2026-11-19': night('pantry-beef-chili') },
    pantry: { chicken: { qty: 1.5 }, chorizo: { qty: 2.6 }, beef: { qty: 3.1 } },
    lunch: { people: { Knox: { slots: { side: ['cool-ranch-portion'] } } } },
  };
  const sched = prepSchedule(db, state, { today: SUN, days: 7 });
  const sun = sched.find((d) => d.date === SUN).tasks;
  assert.ok(sun.some((t) => t.kind === 'thaw' && /1½ lb of boneless chicken/i.test(t.text) && t.when === 'evening'), 'tonight: the 1½ lb in the freezer goes to the fridge for Monday');
  assert.ok(sun.some((t) => t.kind === 'lunch' && /snack bags/i.test(t.text)), 'portion the party bag or the Ritz once for the week');
  const mon = sched.find((d) => d.date === MON).tasks;
  assert.ok(mon.some((t) => t.kind === 'thaw' && /chorizo/i.test(t.text)), 'Monday night: chorizo for Tuesday');
  const tue = sched.find((d) => d.date === TUE).tasks;
  assert.ok(tue.some((t) => t.kind === 'cook' && /ground beef/i.test(t.text) && /Thursday/.test(t.text)), 'brown Thursday’s chili beef with Tuesday’s tacos');
  assert.ok(mon.some((t) => t.kind === 'thaw' && /3\.1 lb of lean ground beef/.test(t.text) && /Thursday/.test(t.text)), 'the beef for both nights thaws together on Monday');
  assert.ok(!sched.some((d) => d.date === '2026-11-18' && d.tasks.some((t) => t.kind === 'thaw' && /ground beef/.test(t.text))), 'no second thaw for Thursday');
  assert.ok(tue.some((t) => t.kind === 'buy' && /Jeff/.test(t.text)), 'Tuesday morning: Jeff’s hot-deli sandwich');
  assert.ok(sched.some((d) => d.tasks.some((t) => /Pack .* lunches/.test(t.text))), 'pack tomorrow’s lunches each evening');
});

test('receipts → pantry: each matched line adds its pack, once, and only recent receipts wait to sync', () => {
  const state = {
    pantry: { buns: { qty: 2, stocked: false } },
    receiptLog: {
      'jewel-2026-11-15-6300': { store: 'jewel', date: SUN, total: 63, lines: [{ p: 'Jewel Hamburger Buns', t: 2.49, m: 'buns', k: 8 }, { p: 'Capri Sun Fruit Punch 10 pk', q: 2, t: 8.98, m: 'capriSun', k: 10 }, { p: 'Pepsi', t: 2.5 }] },
      'jewel-2026-10-01-1000': { store: 'jewel', date: '2026-10-01', total: 10, lines: [{ p: 'Bread', t: 3, m: 'bread', k: 20 }] },
    },
  };
  const adds = receiptPantryAdds(db, state, state.receiptLog['jewel-2026-11-15-6300']);
  assert.deepEqual(adds.map((a) => [a.id, a.add]), [['buns', 8], ['capriSun', 20]]);
  const ops = receiptPantryOps(db, state, 'jewel-2026-11-15-6300', { who: 'Jeff', at: '2026-11-15T20:00:00Z' });
  const buns = ops.find((o) => o.path[1] === 'buns');
  assert.equal(buns.value.qty, 10, '2 at home + 8 bought');
  assert.ok(ops.some((o) => o.path.join('/') === 'receiptLog/jewel-2026-11-15-6300/pantry'));
  const waiting = unsyncedReceipts(db, state, SUN);
  assert.deepEqual(waiting.map((r) => r.id), ['jewel-2026-11-15-6300'], 'the October receipt is too old to sync');
  const synced = { ...state, receiptLog: { ...state.receiptLog, 'jewel-2026-11-15-6300': { ...state.receiptLog['jewel-2026-11-15-6300'], pantry: 'x' } } };
  assert.deepEqual(receiptPantryOps(db, synced, 'jewel-2026-11-15-6300'), [], 'never twice');
});
