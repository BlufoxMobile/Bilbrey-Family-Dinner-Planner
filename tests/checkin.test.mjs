// docs/spec/25: the weekly check-in (money, and a private weigh-in), Easy tonight, two plates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realDb } from './helpers.mjs';
import {
  weekOf, dueWeek, shownWeek, checkinDay, weekSpend, weeklyShare, moneyCheckin, moneyCheckedOps, moneyUncheckedOps, isChecked,
  parseLb, weighSeries, weeklySeries, weighTrend, weighProgress, progressLine, weighOps, removeWeighOps, shareWeighOps, forgetWeighOps, sharedWeighIns, WEIGH_GOALS,
} from '../app/checkin.js';
import { easyTonight, EASY_MAX_WORK, EASY_MAX_TOTAL } from '../app/easy.js';
import { applyOps, normalizeDevice, normalizeWeigh } from '../app/state.js';
import { handsOnMinutes } from '../app/data.js';
import * as checkinView from '../app/views/checkin.js';
import { plateGuide } from '../app/views/common.js';

const db = realDb();
const MON = '2026-11-16';
const receipts = [
  { id: 'a', date: '2026-11-15', store: 'jewel', amount: 176.46 },
  { id: 'b', date: '2026-11-03', store: 'sams', amount: 212 },
  { id: 'b', date: '2026-11-03', store: 'sams', amount: 212 }, // the same receipt twice counts once
];

test('the week ends on the check-in day (Sunday unless the family picks another)', () => {
  assert.deepEqual(weekOf(MON), { start: '2026-11-16', end: '2026-11-22' });
  assert.deepEqual(weekOf('2026-11-15'), { start: '2026-11-09', end: '2026-11-15' });
  assert.deepEqual(weekOf(MON, 4), { start: '2026-11-14', end: '2026-11-20' }, 'a Friday check-in');
  assert.equal(checkinDay({}), 6);
  assert.equal(checkinDay({ settings: { checkinDay: 0 } }), 0);
  assert.equal(checkinDay({ settings: { checkinDay: 9 } }), 6);
});

test('the check-in is offered on its day and two days after, until it is done', () => {
  assert.deepEqual(dueWeek({}, '2026-11-15'), { start: '2026-11-09', end: '2026-11-15' }, 'on Sunday: the week ending today');
  assert.deepEqual(dueWeek({}, MON), { start: '2026-11-09', end: '2026-11-15' }, 'Monday: last week is still waiting');
  assert.equal(dueWeek({}, '2026-11-18'), null, 'by Wednesday it stops asking');
  const done = applyOps({}, moneyCheckedOps({}, { week: { start: '2026-11-09', end: '2026-11-15' }, spent: 176.46, at: '2026-11-16T15:00:00Z' }).ops);
  assert.ok(isChecked(done, '2026-11-09'));
  assert.equal(dueWeek(done, MON), null);
  assert.deepEqual(shownWeek(done, MON), { start: '2026-11-16', end: '2026-11-22' }, 'then the page shows the week in progress');
  assert.equal(isChecked(applyOps(done, moneyUncheckedOps(done, { week: { start: '2026-11-09' } }).ops), '2026-11-09'), false);
});

test('money check-in: the week, the month against the target, and something to do', () => {
  const state = { receipts, settings: { monthlyTarget: 650 } };
  assert.equal(weeklyShare(650), 150);
  const w = weekSpend(state, { start: '2026-11-09', end: '2026-11-15' });
  assert.equal(w.total, 176.46);
  assert.equal(w.trips, 1);
  const m = moneyCheckin(db, state, MON);
  assert.equal(m.week.total, 176.46);
  assert.equal(m.week.done, true);
  assert.equal(m.last.total, 212);
  assert.equal(m.history.length, 6);
  assert.equal(m.history.at(-1).total, 176.46);
  assert.equal(m.record.length, 12);
  assert.deepEqual([m.record[0].total, m.record[0].diff, m.record[1].total], [176.46, 26.46, 212], 'the record is newest first, against the weekly share');
  assert.equal(m.average, 194.23, 'averaged since the first receipt in the record');
  assert.equal(m.month.spent, 388.46);
  assert.ok(['on', 'tight', 'over'].includes(m.status));
  assert.ok(m.verdict.length > 20);
  assert.ok(m.tips.length >= 1 && m.tips.length <= 3);
  assert.equal(m.checked, null);
  // Over the target: says so, and points at the pantry.
  const over = moneyCheckin(db, { receipts: [{ id: 'x', date: '2026-11-10', store: 'sams', amount: 900 }], settings: { monthlyTarget: 650 } }, MON);
  assert.equal(over.status, 'over');
  assert.match(over.verdict, /^Over budget/);
  assert.ok(over.tips.some((t) => t.href === '#/plan'));
  assert.equal(over.month.perWeekLeft, 0);
  // What was thrown out that week is counted.
  const wasted = moneyCheckin(db, { ...state, waste: { k1: { id: 'corn', name: 'Corn on the cob (frozen)', qty: 1, unit: 'bag', cost: 4.5, reason: 'tossed', date: '2026-11-12' }, k2: { id: 'x', name: 'Old', cost: 9, reason: 'tossed', date: '2026-10-01' } } }, MON);
  assert.equal(wasted.waste.total, 4.5);
  assert.ok(wasted.tips.some((t) => /trash/.test(t.text) && /corn on the cob/.test(t.text)));
});

test('weigh-ins: a number a week, and only plain words about it', () => {
  assert.equal(parseLb('182.44'), 182.4);
  assert.equal(parseLb('182,5'), 182.5);
  assert.equal(parseLb('12'), null);
  assert.equal(parseLb('abc'), null);
  const w = { '2026-10-26': 212, '2026-10-28': 211.5, '2026-11-02': 210.6, '2026-11-09': 209.8, bad: 5, '2026-11-10': 9999 };
  assert.equal(weighSeries(w).length, 4);
  assert.deepEqual(weeklySeries(weighSeries(w)).map((p) => p.lb), [211.5, 210.6, 209.8], 'the last weigh-in of each week');
  const t = weighTrend(w, { today: MON, goal: 'lose' });
  assert.equal(t.change, -0.8);
  assert.equal(t.total, -1.7);
  assert.equal(t.headline, 'Down 0.8 lb since last week.');
  assert.equal(t.doneThisWeek, false);
  assert.equal(t.doctor, '');
  assert.equal(weighTrend({ ...w, [MON]: 209.9 }, { today: MON, goal: 'lose' }).headline, 'About the same as last week.');
  assert.equal(weighTrend({ ...w, [MON]: 209.9 }, { today: MON, goal: 'lose' }).doneThisWeek, true);
  assert.match(weighTrend({ '2026-11-09': 150 }, { today: MON }).headline, /150 lb to start/);
  assert.equal(weighTrend({}, { today: MON }).headline, 'No weigh-ins yet.');
  // The written record: a row a week, newest first, with the change that week and since the start.
  assert.deepEqual(weighProgress(w).map((r) => [r.date, r.lb, r.change, r.total]), [['2026-11-09', 209.8, -0.8, -1.7], ['2026-11-02', 210.6, -0.9, -0.9], ['2026-10-28', 211.5, null, 0]]);
  assert.equal(progressLine(w), 'Down 1.7 lb in 2 weeks.');
  assert.equal(progressLine({ '2026-11-09': 150 }), 'First weigh-in is in.');
  assert.equal(progressLine({}), '');
});

test('weigh-ins: what each direction hears', () => {
  const down = { '2026-10-26': 118, '2026-11-02': 117, '2026-11-09': 116.2 };
  const gain = weighTrend(down, { today: MON, goal: 'gain' });
  assert.match(gain.doctor, /2 weeks down in a row.*call your doctor/, 'someone trying to gain who keeps losing is pointed to a doctor');
  assert.doesNotMatch(gain.note + gain.headline, /good|bad|fail|should/i);
  assert.equal(weighTrend(down, { today: MON, goal: 'lose' }).doctor, '', 'a pound a week is an ordinary pace');
  const up = weighTrend({ '2026-11-02': 117, '2026-11-09': 118.5 }, { today: MON, goal: 'gain' });
  assert.match(up.note, /direction you wanted/);
  assert.match(weighTrend({ '2026-11-02': 210, '2026-11-09': 212 }, { today: MON, goal: 'lose' }).note, /One week doesn’t say much/);
  const fast = weighTrend({ '2026-10-19': 230, '2026-10-26': 226, '2026-11-02': 223, '2026-11-09': 220 }, { today: MON, goal: 'lose' });
  assert.match(fast.doctor, /1 to 2 lb a week/);
  // Nothing anywhere names a goal weight or a calorie number.
  for (const g of WEIGH_GOALS) {
    const x = weighTrend(down, { today: MON, goal: g.id });
    assert.doesNotMatch(`${x.headline} ${x.note} ${x.doctor}`, /calor|goal weight|target|BMI/i);
  }
});

test('weigh-ins stay on the phone unless the person chooses the family’s storage', () => {
  assert.equal(normalizeDevice({}).weigh, null, 'nothing until someone sets it up');
  const mine = normalizeWeigh({ name: ' Candi ', goal: 'gain', weights: { '2026-11-09': 118.26, junk: 4 } });
  assert.deepEqual(mine, { name: 'Candi', goal: 'gain', keep: 'device', weights: { '2026-11-09': 118.3 } });
  assert.deepEqual(normalizeWeigh({ name: 'Jeff', keep: 'family', weights: { '2026-11-09': 210 } }).weights, {}, 'in the family’s storage, the phone keeps no copy');
  assert.equal(normalizeWeigh({ goal: 'lose' }), null);
  // Choosing the family's storage: saved, listed, removable, and erased for good on request.
  let state = {};
  state = applyOps(state, shareWeighOps(state, { name: 'Jeff', goal: 'lose', weights: { '2026-11-09': 210 } }).ops);
  state = applyOps(state, weighOps(state, { name: 'Jeff', date: MON, lb: '209.2', goal: 'lose' }).ops);
  assert.deepEqual(sharedWeighIns(state), [{ name: 'Jeff', goal: 'lose', weights: { '2026-11-09': 210, [MON]: 209.2 } }]);
  assert.equal(weighOps(state, { name: 'Jeff', date: MON, lb: 'x' }).error, true);
  state = applyOps(state, removeWeighOps(state, { name: 'Jeff', date: MON }).ops);
  assert.deepEqual(Object.keys(state.checkin.weights.Jeff), ['2026-11-09']);
  state = applyOps(state, forgetWeighOps(state, { name: 'Jeff' }).ops);
  assert.deepEqual(sharedWeighIns(state), []);
});

// ---------------------------------------------------------------- the screens
const fakeApp = ({ state = {}, weigh = null, tv = false, dismissed = [], ui = {} } = {}) => ({
  db, state, ui, today: () => MON, who: () => 'Family', tvOn: () => tv,
  store: { device: { weigh, dismissed }, state },
});

test('the check-in page: weigh-ins are shared in the open, the TV included, unless the family turns that off', () => {
  const state = { receipts, settings: { monthlyTarget: 650 } };
  const weigh = { name: 'Candi', goal: 'gain', keep: 'device', weights: { '2026-11-02': 117.4, '2026-11-09': 118.6 } };
  const phone = checkinView.render(fakeApp({ state, weigh })).s;
  assert.match(phone, /\$176\.46/);
  assert.match(phone, /Candi’s weigh-in/);
  assert.match(phone, /Up 1\.2 lb since last week/);
  assert.match(phone, /Only on this phone/);
  // Shared weigh-ins show on every screen by default.
  const shared = { ...state, checkin: { people: { Jeff: { goal: 'lose' } }, weights: { Jeff: { '2026-11-02': 212, '2026-11-09': 210.5 } } } };
  assert.match(checkinView.render(fakeApp({ state: shared })).s, /Jeff’s weigh-in/);
  const tv = checkinView.render(fakeApp({ state: shared, tv: true })).s;
  assert.match(tv, /Jeff’s weigh-in/);
  assert.match(tv, /Down 1\.5 lb since last week/);
  assert.match(tv, /Week by week \(2 weigh-ins\)/, 'the record is there to track progress');
  const both = { ...shared, checkin: { people: { ...shared.checkin.people, Candi: { goal: 'gain' } }, weights: { ...shared.checkin.weights, Candi: { '2026-11-02': 117.4, '2026-11-09': 118.6 } } } };
  assert.match(checkinView.render(fakeApp({ state: both })).s, /Progress so far[\s\S]*Candi[\s\S]*Up 1\.2 lb in 1 week[\s\S]*Jeff[\s\S]*Down 1\.5 lb in 1 week/);
  // The family can turn the TV off for weigh-ins: groceries stay, no weight and no name shows.
  const off = { ...shared, settings: { ...state.settings, weighOnTv: false } };
  const hidden = checkinView.render(fakeApp({ state: off, weigh, tv: true })).s;
  assert.match(hidden, /\$176\.46/);
  assert.doesNotMatch(hidden, /210\.5|118\.6|Jeff’s weigh-in|Candi’s/);
  assert.match(hidden, /turned off for the TV/);
  assert.match(checkinView.render(fakeApp({ state: off })).s, /Jeff’s weigh-in/, 'phones still show them');
  // New weigh-ins are shared with the family unless the person chooses their own phone.
  assert.match(checkinView.render(fakeApp({ state, ui: { weighSetup: true } })).s, /value="family" checked/);
  // Nobody set up: an offer, with the caution, and no form until asked.
  const fresh = checkinView.render(fakeApp({ state })).s;
  assert.match(fresh, /A weekly weigh-in, if you want one/);
  assert.match(fresh, /one for a doctor/);
  assert.doesNotMatch(fresh, /data-submit="weigh:setup"/);
  assert.match(checkinView.render(fakeApp({ state, ui: { weighSetup: true } })).s, /data-submit="weigh:setup"/);
});

test('Tonight’s reminder carries the grocery total and never a weight', () => {
  const state = { receipts };
  const weigh = { name: 'Jeff', goal: 'lose', keep: 'device', weights: { '2026-11-09': 210.5 } };
  const card = checkinView.checkinCard(fakeApp({ state, weigh })).s;
  assert.match(card, /Weekly check-in/);
  assert.match(card, /\$176\.46/);
  assert.match(card, /Your weigh-in is ready too/);
  assert.doesNotMatch(card, /210\.5|lb/);
  assert.doesNotMatch(checkinView.checkinCard(fakeApp({ state: { ...state, settings: { weighOnTv: false } }, weigh, tv: true })).s, /weigh-in/, 'with weigh-ins off for the TV, its reminder doesn’t mention one');
  assert.equal(String(checkinView.checkinCard(fakeApp({ state, dismissed: ['checkin:2026-11-09'] }))), '', 'waved off for the week');
  const done = applyOps(state, moneyCheckedOps(state, { week: { start: '2026-11-09', end: '2026-11-15' } }).ops);
  assert.equal(String(checkinView.checkinCard(fakeApp({ state: done }))), '', 'done, and nobody weighs in here: nothing to show');
});

test('easy tonight: the least work, from what is in the house', () => {
  const pantry = {};
  for (const [id, ing] of Object.entries(db.ingredients)) pantry[id] = ing.kind === 'staple' ? { stocked: true } : { qty: 60 };
  const e = easyTonight(db, { pantry }, MON, { hour: 17 });
  assert.equal(e.picks.length, 3);
  for (const p of e.picks) {
    assert.ok(p.ready, `${p.dinner.title} is fully in the house`);
    assert.ok(p.work <= EASY_MAX_WORK && p.total <= EASY_MAX_TOTAL, `${p.dinner.title} is quick`);
    assert.equal(p.work, handsOnMinutes(p.dinner));
    assert.equal(p.cooker, false, 'no slow-cooker dinners at five o’clock');
  }
  assert.equal(new Set(e.picks.map((p) => `${p.dinner.category}|${p.dinner.protein}`)).size, 3, 'three different kinds of dinner');
  // Tonight's own dinner isn't offered back, and an empty pantry offers nothing as "in the house".
  const first = e.picks[0].dinner.id;
  const again = easyTonight(db, { pantry, plan: { [MON]: { dinner: first, status: 'planned' } } }, MON, { hour: 17 });
  assert.ok(!again.picks.some((p) => p.dinner.id === first));
  const bare = easyTonight(db, {}, MON);
  assert.equal(bare.picks.length, 3, 'the quickest dinners still show');
  assert.ok(bare.picks.every((p) => !p.ready && p.missing.length > 0), 'each saying what it needs');
  // Last night's dinner isn't offered again, and a missing side doesn't rule a dinner out.
  const ate = easyTonight(db, { pantry, plan: { '2026-11-15': { dinner: first, status: 'cooked' } } }, MON, { hour: 17 });
  assert.ok(!ate.picks.some((p) => p.dinner.id === first));
  const d0 = e.picks[0].dinner;
  const sideOnly = Object.keys(db.sides[String(d0.sides[0]).replace(/^side:/, '')]?.items || {}).filter((id) => !(id in d0.items) && db.ingredients[id]?.kind !== 'staple');
  if (sideOnly.length) {
    const p2 = { ...pantry, [sideOnly[0]]: { qty: 0 } };
    const pick = easyTonight(db, { pantry: p2 }, MON, { hour: 17, limit: 40 }).picks.find((p) => p.dinner.id === d0.id);
    if (pick) { assert.equal(pick.ready, true); assert.ok(pick.sideOut.length >= 1); }
  }
  // Leftovers and ready-made meals are the no-cooking options.
  const l = easyTonight(db, { pantry, leftovers: { '2026-11-15': { title: 'Chicken tacos', servings: 3, saved: 3, useBy: '2026-11-18' } } }, MON);
  assert.deepEqual(l.leftovers, [{ date: '2026-11-15', title: 'Chicken tacos', servings: 3 }]);
});

test('one dinner, two plates: a lighter one and a fuller one', () => {
  const g = plateGuide().s;
  assert.match(g, /One dinner, two plates/);
  assert.match(g, /A lighter plate, if you want one/);
  assert.match(g, /A fuller plate, if you need one/);
  assert.doesNotMatch(g, /calor/i);
});

test('cinematic motion: numbers count up to exactly what was written', async () => {
  const { parseNumber, formatNumber } = await import('../app/fx.js');
  assert.deepEqual(parseNumber('$1,176.46'), { prefix: '$', value: 1176.46, decimals: 2 });
  assert.deepEqual(parseNumber('5'), { prefix: '', value: 5, decimals: 0 });
  assert.equal(parseNumber('5 of 6'), null, 'only plain numbers are animated');
  assert.equal(parseNumber('≈ 770'), null);
  assert.equal(formatNumber(1176.46, parseNumber('$1,176.46')), '$1,176.46');
  assert.equal(formatNumber(0, parseNumber('$176.46')), '$0.00');
});
