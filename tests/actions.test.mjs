import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tinyDb, realDb } from './helpers.mjs';
import { applyOps } from '../app/state.js';
import { addDays } from '../app/util.js';
import {
  placeDinnerOps, swapNightsOps, markAwayOps, bringBackOps, substituteOps, nightSideOps, resetSideOps, voteOps, markCookedOps,
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

test('placing a dinner not in the plan replaces the night and moves the bumped dinner to the next open night', () => {
  const s = week();
  const r = placeDinnerOps(db, s, { dinnerId: 'burger', date: '2026-11-17', ...ctx });
  assert.equal(r.kind, 'replace');
  assert.equal(r.displaced.dinner, 'chix-grill');
  assert.equal(r.movedTo, '2026-11-19', 'the first open night after Tuesday (Wednesday has a dinner)');
  const n = run(s, r);
  assert.equal(n.plan['2026-11-17'].dinner, 'burger');
  assert.equal(n.plan['2026-11-19'].dinner, 'chix-grill');
  assert.deepEqual(n.plan['2026-11-19'].sides, ['broc', 'beans'], 'its sides go with it');
  assert.match(r.message, /^Burger is on for tomorrow\. .* moved to Thursday\.$/i);
  assert.deepEqual(applyOps(n, r.undo).plan, s.plan, 'one Undo puts both nights back');
  // Tonight's dinner never lands on tonight, and a full six weeks drops it with a plain message.
  const full = { plan: Object.fromEntries(Array.from({ length: 50 }, (_, i) => [addDays(TODAY, i), { dinner: 'beef-bowl', status: 'planned' }])) };
  full.plan[TODAY] = { dinner: 'chix-pasta', status: 'planned' };
  const f = placeDinnerOps(db, full, { dinnerId: 'burger', date: TODAY, ...ctx });
  assert.equal(f.movedTo, null);
  assert.match(f.message, /came off the plan/);
  // The old move-it-yourself op still works for the connector and older screens.
  const m = moveDisplacedOps(db, run(s, { ops: [r.ops[0]] }), { ...r.displaced, toDate: '2026-11-20', ...ctx });
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

test('a side for one night changes only that night (gauntlet r4)', () => {
  let s = week();
  s.plan['2026-11-24'] = { dinner: 'chix-grill', sides: ['broc', 'beans'], status: 'planned' };
  const r = nightSideOps(db, s, { date: '2026-11-17', dinnerId: 'chix-grill', slot: 0, ref: 'item:greenBeans@2' });
  s = run(s, r);
  assert.match(r.message, /^Tuesday only: Green beans instead of steamed broccoli\.$/);
  assert.equal(effectiveSides(db, s, 'chix-grill', s.plan['2026-11-17'])[0].ref, 'item:greenBeans@2');
  assert.equal(effectiveSides(db, s, 'chix-grill', s.plan['2026-11-24'])[0].ref, 'broc', 'the next time it’s planned, the recipe’s side');
  assert.equal(s.substitutions?.['chix-grill'], undefined, 'nothing remembered');
  assert.equal(nightSideOps(db, s, { date: '2026-11-17', dinnerId: 'other', slot: 0, ref: 'broc' }).error, true, 'only the dinner on that night');
});

test('“not for us” drops a dinner and promotes the best bench dinner (SPEC §9.2, one family signal)', () => {
  let s = week();
  s.plan['2026-11-25'] = { dinner: 'beef-bowl', sides: [], status: 'planned' };
  const r = voteOps(db, s, { ...ctx, dinnerId: 'beef-bowl', who: 'Knox', value: -1 });
  assert.equal(r.retired, true);
  assert.equal(r.promoted, 'bench-beef', 'same category + protein wins');
  assert.match(r.message, /^beef-bowl is marked “not for us”, so it’s off the menu\. bench-beef takes its place in the rotation and on its 2 planned nights\.$/);
  assert.deepEqual(r.ops[0], { op: 'set', path: ['votes', 'beef-bowl'], value: { Family: -1 } }, 'one voice, whoever the old caller says is asking');
  s = run(s, r);
  assert.ok(isRetired(s, 'beef-bowl'));
  assert.equal(isFavorite(s, { ...db.dinners['beef-bowl'], tags: ['family favorite'] }), false, 'a dropped dinner is not a favorite');
  assert.ok(rotationList(db, s).some((d) => d.id === 'bench-beef'));
  assert.equal(s.plan['2026-11-18'].dinner, 'bench-beef', 'future planned nights get the new dinner');
  assert.equal(s.plan['2026-11-25'].dinner, 'bench-beef');
  assert.ok(!benchList(db, s).some((d) => d.id === 'bench-beef'));
  const back = run(s, restoreOps(db, s, { dinnerId: 'beef-bowl' }));
  assert.ok(!isRetired(back, 'beef-bowl'));
  assert.equal(back.votes?.['beef-bowl'], undefined, 'a fresh start: nothing saved');
});

test('the thumbs toggle the family’s signal: nobody has to say who they are, and one “loved” makes a favorite', () => {
  let s = {};
  const first = voteOps(db, s, { dinnerId: 'chix-grill', who: null, value: 1 });
  assert.ok(!first.error && !first.needsWho, 'no “pick who’s using this phone” any more');
  assert.equal(first.favorite, true);
  s = run(s, first);
  assert.deepEqual(s.votes['chix-grill'], { Family: 1 });
  assert.ok(isFavorite(s, db.dinners['chix-grill']));
  s = run(s, voteOps(db, s, { dinnerId: 'chix-grill', value: 1 }));
  assert.equal(s.votes['chix-grill'], undefined, 'tapping again goes back to fine, with nothing saved');
  assert.ok(!isFavorite(s, db.dinners['chix-grill']));
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
