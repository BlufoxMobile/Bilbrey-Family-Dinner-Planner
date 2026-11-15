// v2.5.4: the list pasted into Jewel-Osco AI (plain lines, under its 2,000-character box) and
// coupons that are already clipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realDb } from './helpers.mjs';
import { buildList, formatAssistantList, shortProductName } from '../app/shopping.js';

const db = realDb();
const SUN = '2026-11-15';
const FRI = '2026-11-20';
const night = (dinner) => ({ dinner, status: 'planned', by: 'Jeff', at: 'x' });

test('product names lose sizes and notes for the store’s AI', () => {
  assert.equal(shortProductName("Boar's Head SmokeMaster Black Forest Ham (sliced at the deli)"), "Boar's Head SmokeMaster Black Forest Ham");
  assert.equal(shortProductName('Jewel Hamburger Buns - 12 Oz'), 'Jewel Hamburger Buns');
  assert.equal(shortProductName('Ball Park Hamburger Buns, 8 ct (the family’s usual)'), 'Ball Park Hamburger Buns');
  assert.equal(shortProductName('Doritos Cool Ranch'), 'Doritos Cool Ranch');
});

test('the Jewel-Osco AI list is plain lines that fit its box', () => {
  const state = {
    settings: { trip: { start: SUN, end: FRI, store: 'jewel' }, organic: true },
    plan: { [SUN]: night('cheeseburgers'), '2026-11-16': night('chicken-tacos'), '2026-11-17': night('naan-pizzas') },
    deals: { 'jewel/buns': { label: 'Jewel Hamburger Buns, 8 ct', size: 8, price: 2.49, was: 2.99, ends: '2026-11-17', checked: SUN, coupon: { price: 1.89, text: '$1.89 with the coupon', expires: '2026-11-17', clipped: true, q: 'buns' } } },
  };
  const dates = [SUN, '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', FRI];
  const list = buildList(db, state, { dates, listKey: `trip:${SUN}:${FRI}:jewel`, store: 'jewel', today: SUN });
  const parts = formatAssistantList(db, list, 'jewel');
  assert.ok(parts.length >= 1);
  for (const p of parts) {
    assert.ok(p.length <= 1900, `part fits the box (${p.length})`);
    assert.match(p, /^Shop my grocery list/);
    assert.doesNotMatch(p, /×|—|~/, 'no pack symbols the AI can’t read');
  }
  const lines = parts.join('\n').split('\n').filter((l) => !/^Shop my grocery list/.test(l));
  assert.equal(lines.length, list.stores.jewel.items.filter((i) => !i.checked).length, 'one line per item');
  const buns = list.coupons.find((c) => c.id === 'buns');
  if (buns) { assert.equal(buns.clipped, true); assert.equal(buns.q, 'buns'); }

  // A long list splits into numbered parts.
  const many = { ...list, stores: { ...list.stores, jewel: { ...list.stores.jewel, items: Array.from({ length: 120 }, (_, k) => ({ id: `x${k}`, freeText: true, name: `Something long enough to matter number ${k}`, qty: 1, unit: 'each' })) } } };
  const split = formatAssistantList(db, many, 'jewel');
  assert.ok(split.length >= 2);
  assert.match(split[0], /^Shop my grocery list \(part 1 of \d\):/);
  split.forEach((p) => assert.ok(p.length <= 1900));
});

// ---------------------------------------------------------------- SPEC §13
import { veggieCheck, budgetPace, offList } from '../app/health.js';
import { kindOfItem, placeOf, useSoon } from '../app/freshness.js';
import { setPantryOps, doneShoppingOps } from '../app/actions.js';
import { prepSchedule } from '../app/prep.js';
import { applyOps } from '../app/state.js';

test('pantry sections: place, then kind', () => {
  const state = { custom: { 'custom-bodyarmor': { name: 'BODYARMOR Orange Mango', unit: 'each', aisle: 'Snacks & Extras', storage: 'fridge' } } };
  assert.equal(kindOfItem(db, state, 'custom-bodyarmor'), 'drinks');
  assert.equal(placeOf(db, state, 'custom-bodyarmor'), 'fridge');
  const meat = Object.values(db.ingredients).find((i) => i.meat && i.storage === 'freezer');
  assert.equal(kindOfItem(db, state, meat.id), 'meat');
  assert.equal(placeOf(db, state, meat.id), 'freezer');
});

test('use it first: cooked meat about four days from when it came home', () => {
  const fridgeMeat = db.ingredients.pulledChicken; // cooked: about 4 days in the fridge
  let state = {};
  state = applyOps(state, setPantryOps(db, state, { id: fridgeMeat.id, qty: 3, who: 'Jeff', at: '2026-11-15T15:00:00Z' }).ops);
  assert.equal(state.pantry[fridgeMeat.id].since, '2026-11-15', 'new stock gets a came-home date');
  state = applyOps(state, setPantryOps(db, state, { id: fridgeMeat.id, qty: 2, who: 'Jeff', at: '2026-11-16T15:00:00Z' }).ops);
  assert.equal(state.pantry[fridgeMeat.id].since, '2026-11-15', 'using some keeps the date');
  const soon = useSoon(db, state, '2026-11-18');
  assert.equal(soon[0]?.id, fridgeMeat.id);
  assert.equal(soon[0].daysLeft, 1);
  assert.equal(soon[0].useBy, '2026-11-19');
  assert.equal(useSoon(db, state, '2026-11-10').length, 0, 'not yet');
});

test('portion and freeze: bulk fresh meat the day it comes home', () => {
  const chicken = db.ingredients.chicken;
  if (!chicken?.meat) return;
  let state = { plan: { '2026-11-16': { dinner: 'chicken-tacos', status: 'planned' } } };
  const list = { listKey: 'k', items: [{ id: 'chicken', checked: true, kind: 'measured', pack: { size: 3 }, bought: 3, packs: 1 }] };
  state = applyOps(state, doneShoppingOps(db, state, { list: { ...list, items: list.items.map((i) => ({ ...i })) }, who: 'Jeff', at: '2026-11-15T20:00:00Z' }).ops);
  const p = state.pantry.chicken;
  assert.equal(p.since, '2026-11-15');
  assert.ok(p.bought?.qty >= 2, 'remembers how much came home');
  const tasks = prepSchedule(db, { ...state, pantry: { chicken: { ...p, qty: 3 } } }, { today: '2026-11-15', days: 7 }).flatMap((d) => d.tasks);
  const t = tasks.find((x) => x.kind === 'freeze');
  if (chicken.storage === 'fridge' || chicken.storage === 'freezer') assert.ok(t, 'a portion-and-freeze job');
  if (t) assert.match(t.text, /freeze/i);
});

test('vegetable check finds dinners with no vegetable', () => {
  const sideIds = Object.values(db.sides);
  const starch = sideIds.filter((s) => s.kind === 'starch').map((s) => s.id);
  const veg = sideIds.find((s) => s.kind === 'vegetable').id;
  const d = Object.values(db.dinners).find((x) => (x.sideSlots || 2) === 2);
  const state = { plan: { '2026-11-16': { dinner: d.id, sides: [starch[0], starch[1]], status: 'planned' }, '2026-11-17': { dinner: d.id, sides: [starch[0], veg], status: 'planned' } } };
  const v = veggieCheck(db, state, ['2026-11-16', '2026-11-17']);
  assert.equal(v.total, 2);
  assert.equal(v.withVeg, 1);
  assert.equal(v.gaps[0].date, '2026-11-16');
});

test('budget pace: receipts so far plus this trip against $650', () => {
  const state = { settings: { monthlyTarget: 650 }, receipts: [{ id: 'a', date: '2026-11-03', store: 'sams', amount: 210 }, { id: 'b', date: '2026-10-30', store: 'jewel', amount: 99 }] };
  const p = budgetPace(state, '2026-11-15', 102);
  assert.equal(p.spent, 210);
  assert.equal(p.after, 312);
  assert.equal(p.left, 338);
  assert.equal(p.pace, 325);
  assert.equal(p.over, false);
});

test('after the trip: receipt lines that weren’t on the list', () => {
  const r = { lines: [{ p: 'Perdue chicken', m: 'chicken', t: 11.24 }, { p: 'Candy', t: 3.5 }, { p: 'Pringles', m: 'buns', t: 2.39 }] };
  const x = offList(db, {}, r, ['chicken']);
  assert.equal(x.extra.length, 1);
  assert.equal(x.extraTotal, 2.39);
  assert.equal(x.unmatchedTotal, 3.5);
});
