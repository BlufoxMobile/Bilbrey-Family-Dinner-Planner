import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tinyDb, realDb } from './helpers.mjs';
import { applyOps } from '../app/state.js';
import {
  placeDinnerOps, swapNightsOps, markAwayOps, bringBackOps, substituteOps, resetSideOps, voteOps, markCookedOps,
  unmarkCookedOps, moveDisplacedOps, retireOps, restoreOps, generateOps,
} from '../app/actions.js';
import { buildList } from '../app/shopping.js';
import { effectiveSides, rotationList, isRetired, isFavorite, benchList, periodRange, sideInfo, parseSideRef } from '../app/planner.js';

const db = tinyDb();
const TODAY = '2026-11-16';
const ctx = { who: 'Jeff', at: '2026-11-16T12:00:00Z', today: TODAY };
const week = () => ({
  plan: {
    '2026-11-16': { dinner: 'chix-pasta', sides: ['broc', 'beans'], status: 'planned' },
    '2026-11-17': { dinner: 'chix-grill', sides: ['broc', 'beans'], status: 'planned' },
    '2026-11-18': { dinner: 'beef-bowl', sides: ['broc', 'beans'], status: 'planned' },
  },
});
const run = (state, r) => applyOps(state, r.ops);

test('"Make this tonight" with a dinner already in the plan swaps the two nights', () => {
  const s = week();
  const r = placeDinnerOps(db, s, { dinnerId: 'beef-bowl', date: '2026-11-16', ...ctx });
  assert.equal(r.kind, 'swap');
  const n = run(s, r);
  assert.equal(n.plan['2026-11-16'].dinner, 'beef-bowl');
  assert.equal(n.plan['2026-11-18'].dinner, 'chix-pasta', 'tonight’s dinner moved to the night beef-bowl was on');
  assert.equal(n.plan['2026-11-16'].manual, true);
  assert.match(r.message, /Swapped/);
  assert.deepEqual(applyOps(n, r.undo).plan, s.plan, 'undo restores both nights exactly');
});

test('placing a dinner not in the plan replaces the night and offers the displaced dinner', () => {
  const s = week();
  const r = placeDinnerOps(db, s, { dinnerId: 'burger', date: '2026-11-17', ...ctx });
  assert.equal(r.kind, 'replace');
  assert.equal(r.displaced.dinner, 'chix-grill');
  let n = run(s, r);
  assert.equal(n.plan['2026-11-17'].dinner, 'burger');
  const m = moveDisplacedOps(db, n, { ...r.displaced, toDate: '2026-11-19', ...ctx });
  n = run(n, m);
  assert.equal(n.plan['2026-11-19'].dinner, 'chix-grill');
  assert.match(m.message, /moved to/);
});

test('moving onto an open night leaves the old night open; cooked nights are protected', () => {
  const s = week();
  const r = placeDinnerOps(db, s, { dinnerId: 'chix-grill', date: '2026-11-20', ...ctx });
  assert.equal(r.kind, 'move');
  const n = run(s, r);
  assert.equal(n.plan['2026-11-20'].dinner, 'chix-grill');
  assert.ok(!n.plan['2026-11-17'], 'Tuesday is open');
  const cooked = { plan: { ...s.plan, '2026-11-16': { ...s.plan['2026-11-16'], status: 'cooked' } } };
  assert.equal(placeDinnerOps(db, cooked, { dinnerId: 'beef-bowl', date: '2026-11-16', ...ctx }).error, true);
  assert.equal(swapNightsOps(db, cooked, { a: '2026-11-16', b: '2026-11-17', ...ctx }).error, true);
});

test('two-tap swap trades everything, including an away night', () => {
  const s = week();
  s.plan['2026-11-19'] = { dinner: null, status: 'away', away: { reason: 'Date night' } };
  const n = run(s, swapNightsOps(db, s, { a: '2026-11-17', b: '2026-11-19', ...ctx }));
  assert.equal(n.plan['2026-11-17'].status, 'away');
  assert.equal(n.plan['2026-11-19'].dinner, 'chix-grill');
});

test('not eating at home removes the dinner and its groceries; bring back restores them', () => {
  const s = week();
  const dates = Object.keys(s.plan);
  const before = buildList(db, s, { dates });
  const beefBefore = before.items.find((i) => i.id === 'beef');
  assert.ok(beefBefore, 'beef on the list for beef-bowl');
  const r = markAwayOps(db, s, { dates: ['2026-11-18'], reason: 'Date night', ...ctx });
  const n = run(s, r);
  assert.equal(n.plan['2026-11-18'].status, 'away');
  assert.equal(n.plan['2026-11-18'].dinner, 'beef-bowl', 'remembers what was planned');
  const after = buildList(db, n, { dates });
  assert.ok(!after.items.find((i) => i.id === 'beef'), 'beef dropped off the list');
  assert.ok(after.total < before.total, 'total went down');
  assert.equal(after.nights.length, 2);
  const back = run(n, bringBackOps(db, n, { date: '2026-11-18', ...ctx }));
  assert.equal(back.plan['2026-11-18'].status, 'planned');
  assert.equal(back.plan['2026-11-18'].dinner, 'beef-bowl');
  assert.ok(buildList(db, back, { dates }).items.find((i) => i.id === 'beef'));
});

test('away for a trip covers a date range; pushing a dinner moves it to another night', () => {
  const s = week();
  const trip = markAwayOps(db, s, { dates: ['2026-11-16', '2026-11-17', '2026-11-18'], reason: 'Out of town', ...ctx });
  const n = run(s, trip);
  assert.ok(['2026-11-16', '2026-11-17', '2026-11-18'].every((d) => n.plan[d].status === 'away'));
  assert.equal(buildList(db, n, { dates: Object.keys(s.plan) }).items.length, 0, 'nothing to buy');
  const p = markAwayOps(db, s, { dates: ['2026-11-17'], reason: 'Eating out', pushTo: '2026-11-21', ...ctx });
  const m = run(s, p);
  assert.equal(m.plan['2026-11-17'].dinner, null);
  assert.equal(m.plan['2026-11-21'].dinner, 'chix-grill');
  assert.match(p.message, /moved to/);
});

test('substituting a side is remembered for that dinner on every future night, and can be reset', () => {
  let s = week();
  s.plan['2026-11-24'] = { dinner: 'chix-grill', sides: ['broc', 'beans'], status: 'planned' };
  const r = substituteOps(db, s, { dinnerId: 'chix-grill', slot: 0, ref: 'item:greenBeans@2' });
  s = run(s, r);
  assert.match(r.message, /Remembered for chix-grill/);
  for (const d of ['2026-11-17', '2026-11-24']) {
    assert.equal(effectiveSides(db, s, 'chix-grill', s.plan[d])[0].ref, 'item:greenBeans@2');
  }
  // On the plate it reads as the food, not the shopping label ("Green beans, 15 oz cans").
  const shelf = sideInfo(db, s, parseSideRef('item:greenBeans@2'));
  assert.equal(shelf.title, 'Green beans');
  assert.equal(shelf.steps[0], 'Warm or plate the green beans (2 cans) and divide among five plates.');
  assert.match(r.message, /Green beans instead of Steamed broccoli\.$/);
  const list = buildList(db, s, { dates: ['2026-11-17', '2026-11-24'] });
  const gb = list.items.find((i) => i.id === 'greenBeans');
  assert.equal(gb.need, 8, '2 cans substitute + 2 cans default beans, × 2 nights');
  assert.ok(!list.items.find((i) => i.id === 'broccoli'), 'broccoli no longer needed');
  s = run(s, resetSideOps(db, s, { dinnerId: 'chix-grill', slot: 0 }));
  assert.equal(effectiveSides(db, s, 'chix-grill', s.plan['2026-11-24'])[0].ref, 'broc');
});

test('three thumbs-down retire a dinner and promote the best bench dinner', () => {
  let s = week();
  s.plan['2026-11-25'] = { dinner: 'beef-bowl', sides: [], status: 'planned' };
  s = run(s, voteOps(db, s, { ...ctx, dinnerId: 'beef-bowl', who: 'Knox', value: -1 }));
  s = run(s, voteOps(db, s, { ...ctx, dinnerId: 'beef-bowl', who: 'Jordan', value: -1 }));
  assert.ok(!isRetired(s, 'beef-bowl'));
  const r = voteOps(db, s, { ...ctx, dinnerId: 'beef-bowl', who: 'Jackson', value: -1 });
  assert.equal(r.retired, true);
  assert.equal(r.promoted, 'bench-beef', 'same category + protein wins');
  assert.match(r.message, /^Three thumbs down, so beef-bowl is taking a break\. Something new to try: bench-beef joins the rotation in its place, and takes over its 2 planned nights\.$/);
  s = run(s, r);
  assert.ok(isRetired(s, 'beef-bowl'));
  assert.equal(isFavorite(s, { ...db.dinners['beef-bowl'], tags: ['family favorite'] }), false, 'a voted-out dinner is nobody’s favorite');
  assert.ok(rotationList(db, s).some((d) => d.id === 'bench-beef'));
  assert.equal(s.plan['2026-11-18'].dinner, 'bench-beef', 'future planned nights get the new dinner');
  assert.equal(s.plan['2026-11-25'].dinner, 'bench-beef');
  assert.ok(!benchList(db, s).some((d) => d.id === 'bench-beef'));
  const back = run(s, restoreOps(db, s, { dinnerId: 'beef-bowl' }));
  assert.ok(!isRetired(back, 'beef-bowl'));
  assert.equal(Object.values(back.votes['beef-bowl']).filter((v) => v === -1).length, 0, 'fresh start on votes');
});

test('votes toggle, need a person, and three thumbs-up make a favorite', () => {
  let s = {};
  assert.equal(voteOps(db, s, { dinnerId: 'chix-grill', who: null, value: 1 }).needsWho, true);
  s = run(s, voteOps(db, s, { dinnerId: 'chix-grill', who: 'Jeff', value: 1 }));
  s = run(s, voteOps(db, s, { dinnerId: 'chix-grill', who: 'Jeff', value: 1 }));
  assert.equal(s.votes['chix-grill'].Jeff, undefined, 'tapping again clears');
  s = run(s, voteOps(db, s, { dinnerId: 'chix-grill', who: 'Jeff', value: 1 }));
  s = run(s, voteOps(db, s, { dinnerId: 'chix-grill', who: 'Candi', value: 1 }));
  const r = voteOps(db, s, { dinnerId: 'chix-grill', who: 'Knox', value: 1 });
  assert.equal(r.favorite, true);
});

test('marking cooked deducts measured ingredients from the pantry; un-cooking puts them back', () => {
  let s = week();
  s.pantry = { chicken: { qty: 5 }, pasta: { qty: 10 }, salt: { stocked: true, qty: null } };
  const r = markCookedOps(db, s, { date: '2026-11-16', ...ctx });
  s = run(s, r);
  assert.equal(s.plan['2026-11-16'].status, 'cooked');
  assert.equal(s.pantry.chicken.qty, 3);
  assert.equal(s.pantry.pasta.qty, 0, 'never below zero');
  assert.equal(s.pantry.salt.stocked, true, 'staples untouched');
  s = run(s, unmarkCookedOps(db, s, { date: '2026-11-16' }));
  assert.equal(s.pantry.chicken.qty, 5);
  assert.equal(s.pantry.pasta.qty, 10);
  assert.equal(s.plan['2026-11-16'].status, 'planned');
});

test('manual retire by a parent promotes too', () => {
  const s = week();
  const r = retireOps(db, s, { ...ctx, dinnerId: 'chix-pasta', who: 'Candi' });
  assert.equal(r.promoted, 'bench-pasta');
});

test('generateOps writes explicit plan entries for the real data', () => {
  const real = realDb();
  const dates = periodRange('2026-11-16', 'week').dates;
  const r = generateOps(real, {}, { dates, ...ctx });
  assert.equal(r.ops.length, 7);
  assert.ok(r.ops.every((o) => o.op === 'set' && o.path[0] === 'plan' && o.value.dinner));
});
