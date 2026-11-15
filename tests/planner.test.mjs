import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realDb, tinyDb } from './helpers.mjs';
import {
  generatePlan, periodRange, pizzaDates, dinnerById, isBurger, isPizza, isRice, isAsian, effectiveSides, rotationList,
  dinnerFeasibleAt, shiftPeriod, nightType, defaultAnchor,
} from '../app/planner.js';
import { settingsOf } from '../app/state.js';
import { monIndex, startOfWeek, diffDays, weekday, dateRange } from '../app/util.js';
import { buildList } from '../app/shopping.js';

const db = realDb();
const TODAY = '2026-11-14';

function plan(state, dates, opts = {}) {
  const { entries, unfilled } = generatePlan({ db, state, dates, today: TODAY, seedKey: dates[0], by: 'Test', at: 'x', ...opts });
  return { entries, unfilled, state: { ...state, plan: { ...(state.plan || {}), ...entries } } };
}

test('periods: week starts Monday, month is the calendar month', () => {
  const w = periodRange('2026-11-14', 'week', 1);
  assert.equal(w.start, '2026-11-09');
  assert.equal(w.dates.length, 7);
  assert.equal(periodRange('2026-11-14', 'three', 1).dates.length, 21);
  const m = periodRange('2026-11-14', 'month');
  assert.equal(m.start, '2026-11-01');
  assert.equal(m.end, '2026-11-30');
  assert.equal(shiftPeriod('2026-11-01', 'month', 1), '2026-12-01');
  assert.equal(shiftPeriod('2026-11-16', 'two', -1), '2026-11-02');
});

test('default period: Sunday-night planning starts with next week for 1, 2 and 3 weeks', () => {
  const sunday = '2026-11-15';
  for (const [period, days] of [['week', 7], ['two', 14], ['three', 21]]) {
    const r = periodRange(defaultAnchor(sunday, period, 1), period, 1);
    assert.equal(r.start, '2026-11-16', `${period} starts Monday Nov 16, not last Monday`);
    assert.equal(r.dates.length, days);
  }
  // Midweek: this week (and the weeks after it).
  assert.equal(periodRange(defaultAnchor('2026-11-18', 'two', 1), 'two', 1).start, '2026-11-16');
  // Friday (three nights left) still shows this week for a Monday start …
  assert.equal(periodRange(defaultAnchor('2026-11-13', 'week', 1), 'week', 1).start, '2026-11-09');
  // … but with Sunday-start weeks, Friday + Saturday left means next week.
  assert.equal(periodRange(defaultAnchor('2026-11-20', 'two', 0), 'two', 0).start, '2026-11-22');
  // Month: this month, or next month in the last four days.
  assert.equal(periodRange(defaultAnchor('2026-11-15', 'month'), 'month').start, '2026-11-01');
  assert.equal(periodRange(defaultAnchor('2026-11-28', 'month'), 'month').start, '2026-12-01');
  assert.equal(periodRange(defaultAnchor('2026-12-29', 'month'), 'month').start, '2027-01-01');
});

test('month plan follows every house rule', () => {
  const range = periodRange('2026-12-10', 'month');
  const { entries, unfilled } = plan({}, range.dates);
  const st = settingsOf({});
  assert.equal(unfilled.length, 0, 'every night is planned');
  assert.equal(Object.keys(entries).length, 31);
  const pz = pizzaDates('2026-12-01', st.pizzaPerMonth);
  assert.equal(pz.length, 2);
  for (const [date, e] of Object.entries(entries)) {
    const d = dinnerById(db, {}, e.dinner);
    assert.ok(d, `${date} has a real dinner`);
    assert.equal(e.status, 'planned');
    if (pz.includes(date)) {
      assert.ok(isPizza(d), `${date} is pizza night`);
      assert.equal(weekday(date), 6, 'pizza is on a Saturday');
    } else if ([0, 4].includes(monIndex(date))) {
      assert.ok(isBurger(d), `${date} (Mon/Fri) is a burger night, got ${d.id}`);
    } else {
      assert.ok(!isBurger(d) && !isPizza(d), `${date} is not burger/pizza, got ${d.id}`);
    }
  }
  const pizzaCount = Object.values(entries).filter((e) => isPizza(dinnerById(db, {}, e.dinner))).length;
  assert.ok(pizzaCount >= 1 && pizzaCount <= 2, 'pizza 1–2× a month');
  // No repeats within 14 days.
  const byDinner = {};
  for (const [date, e] of Object.entries(entries)) (byDinner[e.dinner] ||= []).push(date);
  for (const [id, ds] of Object.entries(byDinner)) {
    ds.sort();
    for (let i = 1; i < ds.length; i++) assert.ok(diffDays(ds[i], ds[i - 1]) >= 14, `${id} repeats too soon: ${ds.join(', ')}`);
  }
  // Weekly rice ≤ 1 and Asian 2–3 for full weeks inside the month.
  const weeks = {};
  for (const [date, e] of Object.entries(entries)) (weeks[startOfWeek(date, 1)] ||= []).push(dinnerById(db, {}, e.dinner));
  for (const [ws, ds] of Object.entries(weeks)) {
    assert.ok(ds.filter(isRice).length <= 1, `week ${ws} has at most one rice dinner`);
    if (ds.length === 7) {
      const a = ds.filter(isAsian).length;
      assert.ok(a >= 2 && a <= 3, `week ${ws} has 2–3 Asian-inspired dinners (got ${a})`);
    }
  }
});

test('generator is deterministic: two phones agree', () => {
  const dates = periodRange('2026-11-16', 'two').dates;
  const a = plan({}, dates).entries;
  const b = plan({}, dates).entries;
  assert.deepEqual(a, b);
  const c = plan({ settings: { planStore: 'jewel' } }, dates).entries;
  assert.notDeepEqual(a, c, 'different settings → may differ');
});

test('never plans retired dinners; includes promoted bench dinners', () => {
  const rot = rotationList(db, {});
  const bench = db.dinnerList.find((d) => d.rotation === 'bench');
  const victim = rot.find((d) => !isBurger(d) && !isPizza(d));
  const state = { retired: { [victim.id]: { by: 'votes' } }, ...(bench ? { promoted: { [bench.id]: { replaced: victim.id } } } : {}) };
  const ids = new Set(rotationList(db, state).map((d) => d.id));
  assert.ok(!ids.has(victim.id));
  if (bench) assert.ok(ids.has(bench.id));
  const { entries } = plan(state, periodRange('2026-12-01', 'month').dates);
  assert.ok(!Object.values(entries).some((e) => e.dinner === victim.id), 'retired dinner never planned');
  for (const e of Object.values(entries)) {
    const d = dinnerById(db, state, e.dinner);
    assert.ok(d.rotation === 'core' || state.promoted?.[d.id], `${d.id} is in rotation`);
  }
});

test('fill keeps existing nights; re-plan keeps away/cooked/manual and never touches the past', () => {
  const dates = periodRange('2026-11-09', 'week').dates; // Mon Nov 9 … Sun Nov 15, today = Sat Nov 14
  const someDinner = rotationList(db, {}).find((d) => !isBurger(d) && !isPizza(d)).id;
  const base = {
    plan: {
      '2026-11-10': { dinner: someDinner, status: 'cooked' },
      '2026-11-14': { dinner: null, status: 'away', away: { reason: 'Date night' } },
      '2026-11-15': { dinner: someDinner, status: 'planned', manual: true },
    },
  };
  const filled = plan(base, dates);
  assert.ok(!('2026-11-09' in filled.entries), 'past nights are not filled');
  assert.ok(!('2026-11-14' in filled.entries), 'away night kept');
  assert.ok(!('2026-11-15' in filled.entries), 'manual night kept');
  const replan = plan(base, dates, { mode: 'replan' });
  assert.deepEqual(Object.keys(replan.entries), [], 'nothing auto-planned in the future to replace');
  const nextWeek = periodRange('2026-11-16', 'week').dates;
  const first = plan({}, nextWeek);
  const withManual = { plan: { ...first.state.plan, '2026-11-18': { ...first.entries['2026-11-18'], manual: true } } };
  const re = plan(withManual, nextWeek, { mode: 'replan', seedKey: 'other-seed' });
  assert.ok(!('2026-11-18' in re.entries), 'manual night survives a re-plan');
  assert.ok(Object.keys(re.entries).length >= 5, 'auto nights are re-planned');
});

test('single-store planning only uses dinners that store carries (or the pantry covers)', () => {
  const t = tinyDb();
  const dates = dateRange('2026-11-17', 3); // Tue–Thu: regular nights
  assert.equal(dinnerFeasibleAt(t, {}, 'naan-chicken', 'jewel'), false, 'naan is Sam’s-only');
  assert.equal(dinnerFeasibleAt(t, {}, 'naan-chicken', 'sams'), true);
  assert.equal(dinnerFeasibleAt(t, { pantry: { samsOnly: { qty: 10 } } }, 'naan-chicken', 'jewel'), true, 'pantry covers the gap');
  assert.equal(dinnerFeasibleAt(t, { availability: { 'jewel/chicken': false } }, 'chix-grill', 'jewel'), false, 'marked not at this store');
  const { entries } = generatePlan({ db: t, state: { settings: { planStore: 'jewel' } }, dates, today: TODAY });
  for (const e of Object.values(entries)) assert.notEqual(e.dinner, 'naan-chicken');
  // A Sam's-only side gets swapped for one Jewel carries.
  const t2 = tinyDb();
  t2.dinners['chix-grill'].sides = ['naan-side', 'beans'];
  const { entries: e2 } = generatePlan({ db: t2, state: { settings: { planStore: 'jewel' }, retired: { 'chix-pasta': {}, 'beef-bowl': {}, 'naan-chicken': {} } }, dates: ['2026-11-17'], today: TODAY });
  assert.equal(e2['2026-11-17'].dinner, 'chix-grill');
  assert.ok(!e2['2026-11-17'].sides.includes('naan-side'));
});

test('generator groups proteins so a bulk pack is used across dinners', () => {
  const dates = periodRange('2026-11-16', 'two').dates;
  const { state } = plan({}, dates);
  const list = buildList(db, state, { dates });
  const chicken = list.items.find((i) => i.id === 'chicken');
  if (chicken && chicken.store === 'sams') {
    const dinnersUsing = chicken.uses.length;
    assert.ok(dinnersUsing >= 2, 'a 10 lb pack feeds several dinners');
    assert.ok(chicken.leftover < chicken.pack.size, 'no more than one pack wasted');
  }
});

test('night types follow settings', () => {
  const st = settingsOf({ settings: { burgerNights: [2], pizzaPerMonth: 0 } });
  assert.equal(nightType('2026-11-18', st), 'burger'); // Wednesday
  assert.equal(nightType('2026-11-16', st), 'regular');
  assert.equal(nightType('2026-11-14', st), 'regular', 'no pizza when pizzaPerMonth = 0');
  assert.deepEqual(pizzaDates('2026-11-01', 1), ['2026-11-14']);
});

test('effective sides: remembered substitution beats the night and the default', () => {
  const t = tinyDb();
  const s0 = effectiveSides(t, {}, 'chix-grill', { sides: ['broc', 'beans'] });
  assert.deepEqual(s0.map((s) => s.ref), ['broc', 'beans']);
  const st = { substitutions: { 'chix-grill': { 0: 'item:greenBeans@2' } } };
  const s1 = effectiveSides(t, st, 'chix-grill', { sides: ['fries', 'beans'] });
  assert.equal(s1[0].ref, 'item:greenBeans@2');
  assert.equal(s1[0].remembered, true);
  const burger = effectiveSides(t, { substitutions: { burger: { 1: 'broc' } } }, 'burger', null);
  assert.deepEqual(burger.map((s) => s.ref), ['fries', 'broc'], 'burger night: fries + an added side');
});

test('meat per dinner: "lighter" scales only catalog items marked meat', async () => {
  const { itemsForNight, scaleItems } = await import('../app/planner.js');
  const meatId = Object.keys(db.ingredients).find((id) => db.ingredients[id].meat);
  const d = db.dinnerList.find((x) => x.items[meatId]);
  if (!meatId || !d) return;
  const full = itemsForNight(db, {}, d.id, null);
  const light = itemsForNight(db, { settings: { meatScale: 0.85 } }, d.id, null);
  assert.equal(light[meatId], Math.round(full[meatId] * 0.85 * 100) / 100);
  const other = Object.keys(full).find((id) => !db.ingredients[id]?.meat);
  if (other) assert.equal(light[other], full[other]);
  assert.deepEqual(scaleItems(db, {}, { x: 1 }), { x: 1 });
});

test('Sam’s-only still fills a week and explains what’s missing', async () => {
  const { storeCoverage } = await import('../app/planner.js');
  const cov = storeCoverage(db, {}, 'sams');
  assert.ok(cov.ok >= 20, `enough dinners for Sam's only (${cov.ok}/${cov.total})`);
  const dates = periodRange('2026-11-16', 'week').dates;
  const { entries, unfilled } = generatePlan({ db, state: { settings: { planStore: 'sams' } }, dates, today: TODAY });
  assert.equal(unfilled.length, 0);
  assert.equal(Object.keys(entries).length, 7);
  for (const e of Object.values(entries)) assert.ok(dinnerFeasibleAt(db, { settings: { planStore: 'sams' } }, e.dinner, 'sams', e));
});

test('a rice side counts toward the weekly rice limit', async () => {
  const { nightIsRice } = await import('../app/planner.js');
  const riceSide = db.sideList.find((s) => s.tags?.includes('rice'));
  const plain = db.dinnerList.find((d) => !isRice(d) && !isBurger(d));
  if (!riceSide || !plain) return;
  assert.equal(nightIsRice(db, {}, plain.id, { sides: [riceSide.id] }), true);
  const range = periodRange('2026-12-07', 'week');
  const { entries } = plan({}, range.dates);
  const n = Object.entries(entries).filter(([, e]) => nightIsRice(db, {}, e.dinner, e)).length;
  assert.ok(n <= 1, `at most one rice night (got ${n})`);
});
