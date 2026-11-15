import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realDb, tinyDb, fixtureDb, lunchesDoc, usingRealLunches, usingRealNutrition } from './helpers.mjs';
import { buildDb, normalizeLunches } from '../app/data.js';
import { applyOps } from '../app/state.js';
import {
  lunchFor, lunchDayIndex, personConfig, lunchNeeds, lunchPeople, lunchSwapsFor, LUNCH_EPOCH, hasLunchDay,
} from '../app/lunch.js';
import {
  skipLunchOps, unskipLunchOps, pickLunchOps, resetLunchPickOps, toggleLunchItemOps, toggleLunchDayOps, setLunchEnabledOps,
  applyLunchSwapOps, addCustomLunchOps, bringBackTripOps, markAwayOps, awayBlock,
} from '../app/actions.js';
import { buildList, monthBudget } from '../app/shopping.js';
import { plateNutrition, lunchNutrition, dayNutrition, lighterSide, sideNutrition, lunchSwaps, fmtKcal } from '../app/nutrition.js';
import { dateRange } from '../app/util.js';

const db = realDb();
const WEEK = dateRange('2026-11-16', 7); // Mon … Sun
const knoxDefault = () => personConfig(db, {}, 'Knox');

test('defaults come from lunches.json until someone edits; nothing is written to state', () => {
  const k = knoxDefault();
  assert.equal(k.enabled, true);
  assert.deepEqual(k.days, [1, 2, 3, 4, 5]);
  assert.equal(k.saved, false);
  assert.equal(personConfig(db, {}, 'Jeff').enabled, true);
  for (const n of ['Candi', 'Jordan', 'Jackson']) assert.equal(personConfig(db, {}, n).enabled, false);
  const people = lunchPeople(db, {}, 'Jeff');
  assert.equal(people[0].name, 'Jeff', "the phone's person leads");
  assert.ok(people.slice(0, 2).every((p) => p.cfg.enabled));
});

test('weekdays only by default; the rotation alternates day to day and is the same on every phone', () => {
  const k = knoxDefault();
  assert.ok(!hasLunchDay(k, '2026-11-21') && !hasLunchDay(k, '2026-11-22'), 'no weekend lunches');
  const drinks = WEEK.slice(0, 5).map((d) => lunchFor(db, {}, 'Knox', d).slots.find((s) => s.slot === 'drink')?.id);
  const list = k.slots.drink;
  assert.ok(list.length >= 2, 'Knox has two drinks in rotation');
  for (let i = 1; i < 5; i++) assert.notEqual(drinks[i], drinks[i - 1], 'drinks alternate day to day');
  // Index counts only lunch days since the epoch.
  assert.equal(lunchDayIndex(k, LUNCH_EPOCH), 0);
  assert.equal(lunchDayIndex(k, '2026-01-05'), 0, 'Monday after the epoch Sunday is lunch day 0');
  assert.equal(lunchDayIndex(k, '2026-01-12'), 5, 'one full week later');
  assert.equal(lunchFor(db, {}, 'Knox', '2026-11-21'), null);
});

test('skip a day, swap one slot for a day, and reset', () => {
  let s = {};
  const mon = '2026-11-16';
  s = applyOps(s, skipLunchOps(db, s, { name: 'Knox', date: mon, reason: 'No school', today: mon }).ops);
  const l = lunchFor(db, s, 'Knox', mon);
  assert.equal(l.skip, true);
  assert.equal(l.reason, 'No school');
  assert.deepEqual(l.items, {}, 'a skipped lunch needs no groceries');
  s = applyOps(s, unskipLunchOps(db, s, { name: 'Knox', date: mon }).ops);
  assert.equal(lunchFor(db, s, 'Knox', mon).skip, false);
  const other = knoxDefault().slots.drink.find((id) => id !== lunchFor(db, s, 'Knox', mon).slots.find((x) => x.slot === 'drink').id);
  s = applyOps(s, pickLunchOps(db, s, { name: 'Knox', date: mon, slot: 'drink', id: other }).ops);
  const sl = lunchFor(db, s, 'Knox', mon).slots.find((x) => x.slot === 'drink');
  assert.equal(sl.id, other);
  assert.equal(sl.override, true);
  s = applyOps(s, pickLunchOps(db, s, { name: 'Knox', date: mon, slot: 'drink', id: null }).ops);
  assert.equal(lunchFor(db, s, 'Knox', mon).slots.find((x) => x.slot === 'drink').removed, true, 'left out that day');
  s = applyOps(s, resetLunchPickOps(db, s, { name: 'Knox', date: mon, slot: 'drink' }).ops);
  assert.equal(lunchFor(db, s, 'Knox', mon).slots.find((x) => x.slot === 'drink').override, false);
});

test('the editor: rotation order is selection order; days and on/off persist as the person’s own config', () => {
  let s = {};
  const extra = db.lunch.itemList.find((x) => x.slot === 'snack' && !knoxDefault().slots.snack.includes(x.id));
  s = applyOps(s, toggleLunchItemOps(db, s, { name: 'Knox', slot: 'snack', id: extra.id }).ops);
  const k = personConfig(db, s, 'Knox');
  assert.equal(k.saved, true);
  assert.equal(k.slots.snack[k.slots.snack.length - 1], extra.id, 'appended to the rotation');
  s = applyOps(s, toggleLunchDayOps(db, s, { name: 'Knox', day: 5 }).ops);
  assert.ok(!personConfig(db, s, 'Knox').days.includes(5));
  s = applyOps(s, setLunchEnabledOps(db, s, { name: 'Candi', enabled: true }).ops);
  assert.equal(personConfig(db, s, 'Candi').enabled, true);
  assert.ok(!Object.prototype.hasOwnProperty.call(s.lunch.people.Knox, 'saved'), 'no UI-only keys stored');
});

test('lunch groceries join the list with pack math, a Lunches tag and their own cost line', () => {
  const s = { plan: { '2026-11-17': { dinner: db.dinnerList[0].id, status: 'planned' } } };
  const { needs, lunches } = lunchNeeds(db, s, WEEK);
  assert.ok(lunches.length >= 10, 'Knox and Jeff, Mon–Fri');
  const list = buildList(db, s, { dates: WEEK });
  const lunchItems = list.items.filter((i) => i.reasons.includes('lunches'));
  assert.ok(lunchItems.length > 0);
  for (const i of lunchItems) {
    assert.ok(i.lunchNeed > 0);
    if (i.pack) {
      assert.ok(i.bought + 1e-9 >= i.shortfall, `${i.id}: packs cover the need`);
      assert.equal(i.packs, Math.ceil(i.shortfall / i.pack.size - 1e-9));
    }
  }
  const anyId = Object.keys(needs).find((id) => list.items.find((i) => i.id === id && i.pack));
  assert.ok(anyId);
  assert.equal(list.lunches.length, lunches.length);
  assert.ok(list.lunchCost > 0);
  assert.equal(Math.round((list.dinnerCost + list.lunchCost + list.extrasCost) * 100), Math.round(list.total * 100), 'the three lines add up');
  // Skipping Knox all week drops his groceries.
  let skipped = s;
  for (const d of WEEK.slice(0, 5)) skipped = applyOps(skipped, skipLunchOps(db, skipped, { name: 'Knox', date: d }).ops);
  const after = buildList(db, skipped, { dates: WEEK });
  assert.ok(after.lunchCost < list.lunchCost);
  assert.ok(after.lunches.length === lunches.length - 5);
  // Turning everyone's lunches off removes them entirely.
  let off = s;
  for (const n of ['Knox', 'Jeff']) off = applyOps(off, setLunchEnabledOps(db, off, { name: n, enabled: false }).ops);
  assert.equal(buildList(db, off, { dates: WEEK }).lunchCost, 0);
});

test('budget shows dinners, lunches and extras separately', () => {
  const b = monthBudget(db, {}, '2026-11-16');
  assert.ok(b.lunchesToBuy > 0);
  assert.ok(b.typical.lunches > 0);
  assert.ok(b.typical.lunchCount >= 20);
  assert.equal(Math.round((b.dinnersToBuy + b.lunchesToBuy + b.extras) * 100), Math.round(b.stillToBuy * 100));
});

test('the real lunch library: Knox and Jeff set up as Jeff described, Knox’s drinks alternate', { skip: !usingRealLunches() }, () => {
  const k = personConfig(db, {}, 'Knox');
  assert.ok(k.slots.drink.length === 2);
  assert.ok(personConfig(db, {}, 'Jeff').slots.main.length >= 1);
  assert.ok(db.lunch.swaps.length >= 3);
  const list = buildList(db, {}, { dates: WEEK });
  for (const i of list.items.filter((x) => x.reasons.includes('lunches') && x.pack)) {
    assert.ok(i.packs >= 1 && Number.isFinite(i.cost), `${i.id} priced in packs`);
    assert.ok(!/undefined|NaN/.test(JSON.stringify([i.name, i.unit])));
  }
});

test('a lunch swap changes that person’s rotation (remembered)', () => {
  const swaps = lunchSwapsFor(db, {}, 'Jeff');
  if (!swaps.length) return;
  const sw = swaps[0];
  const s = applyOps({}, applyLunchSwapOps(db, {}, { name: 'Jeff', from: sw.from, to: sw.to }).ops);
  const cfg = personConfig(db, s, 'Jeff');
  assert.ok(cfg.slots[sw.slot].includes(sw.to));
  assert.ok(!cfg.slots[sw.slot].includes(sw.from));
  assert.equal(lunchSwapsFor(db, s, 'Jeff').find((x) => x.from === sw.from), undefined, 'no longer suggested');
});

test('real data: every lunch in the library has calories and protein', { skip: !(usingRealLunches() && usingRealNutrition()) }, () => {
  const gaps = db.lunch.itemList.filter((it) => !lunchNutrition(db, { items: it.items })?.complete).map((it) => it.id);
  assert.deepEqual(gaps, []);
  const n = dayNutrition(db, {}, 'Knox', '2026-11-16');
  assert.ok(n && n.lunch && n.lunch.complete && n.kcal > 0 && Number.isFinite(n.protein));
});

test('swap ideas are labeled honestly: lighter first, protein-up swaps never called lighter', () => {
  const sws = lunchSwaps(db, {}, 'Jeff');
  if (!sws.length) return;
  const order = { lighter: 0, protein: 1, idea: 2 };
  for (let i = 1; i < sws.length; i++) assert.ok(order[sws[i - 1].kind] <= order[sws[i].kind], 'lighter ideas lead');
  for (const sw of sws) {
    if (sw.kind === 'lighter') assert.ok(sw.saves >= 20);
    if (sw.kind === 'protein') assert.ok(sw.saves < 20 && sw.proteinGain >= 5);
    if (sw.saves != null) assert.ok(Number.isFinite(sw.saves) && Number.isFinite(sw.proteinGain));
  }
  const plus = sws.find((x) => x.to.endsWith('-plus-chicken'));
  if (plus && plus.saves != null) assert.notEqual(plus.kind, 'lighter', 'adding chicken is not a lighter idea');
});

test('a family-made lunch item becomes a shelf item to buy', () => {
  const r = addCustomLunchOps(db, {}, { title: 'Pickle spears', slot: 'side', name: 'Knox' });
  const s = applyOps({}, r.ops);
  assert.ok(s.lunch.custom[r.id]);
  assert.ok(personConfig(db, s, 'Knox').slots.side.includes(r.id));
  const list = buildList(db, s, { dates: WEEK });
  const line = list.items.find((i) => i.name === 'Pickle spears');
  assert.ok(line && line.reasons.includes('lunches'));
});

test('nutrition per plate follows the meat scale and remembered substitutions; shelf items without data show nothing', () => {
  const t = tinyDb();
  const base = plateNutrition(t, {}, 'chix-grill', null);
  // chicken 2.5 lb × 545 + broccoli 1.25 × 150 + green beans 2 × 70 → ÷ 5
  assert.equal(Math.round(base.kcal), Math.round((2.5 * 545 + 1.25 * 150 + 2 * 70) / 5));
  assert.equal(base.complete, true);
  const light = plateNutrition(t, { settings: { meatScale: 0.85 } }, 'chix-grill', null);
  assert.equal(Math.round(light.kcal), Math.round((Math.round(2.5 * 0.85 * 100) / 100 * 545 + 1.25 * 150 + 2 * 70) / 5));
  const sub = { substitutions: { 'chix-grill': { 0: 'fries' } } };
  const withFries = plateNutrition(t, sub, 'chix-grill', null);
  assert.equal(Math.round(withFries.kcal), Math.round((2.5 * 545 + 32 * 45 + 2 * 70) / 5));
  const custom = { custom: { 'custom-rotel': { name: 'Rotel', unit: 'cans' } }, substitutions: { 'chix-grill': { 0: 'custom:custom-rotel@2' } } };
  assert.equal(sideNutrition(t, custom, { type: 'custom', id: 'custom-rotel', qty: 2 }), null, 'unknown shelf item → “—”');
  assert.equal(plateNutrition(t, custom, 'chix-grill', null).complete, false);
  assert.equal(fmtKcal(1347), '1,350');
});

test('lighter idea for a dinner side: same kind, at least 80 calories less a plate', () => {
  const t = tinyDb();
  t.sides.creamy = { id: 'creamy', title: 'Creamed spinach', kind: 'vegetable', minutes: 10, equipment: [], items: { beef: 0.6 }, steps: [], tags: [] };
  t.sideList.push(t.sides.creamy);
  const s = { substitutions: { 'chix-grill': { 0: 'creamy' } } };
  const idea = lighterSide(t, s, 'chix-grill', null);
  assert.ok(idea);
  assert.equal(idea.to.kind, 'vegetable');
  assert.ok(idea.saves >= 80);
  assert.equal(lighterSide(t, {}, 'chix-grill', null), null, 'already light: no nagging');
});

test('lunch and day nutrition (lunch + dinner plate)', () => {
  const db = fixtureDb();
  const mon = '2026-11-16';
  const l = lunchFor(db, {}, 'Jeff', mon);
  const n = lunchNutrition(db, l);
  assert.ok(n && n.kcal > 0);
  const s = { plan: { [mon]: { dinner: db.dinnerList[0].id, status: 'planned' } } };
  const day = dayNutrition(db, s, 'Jeff', mon);
  assert.ok(day.kcal >= n.kcal);
  const away = { plan: { [mon]: { dinner: db.dinnerList[0].id, status: 'away' } } };
  assert.equal(Math.round(dayNutrition(db, away, 'Jeff', mon).kcal), Math.round(n.kcal), 'no dinner when away');
  assert.equal(dayNutrition(buildDb({ catalog: { ingredients: {} }, recipes: {} }), s, 'Jeff', mon), null, 'no nutrition file → nothing shown');
  const sw = lunchSwaps(db, {}, 'Jeff');
  for (const x of sw) if (x.saves != null) assert.ok(Number.isFinite(x.saves));
});

test('one tap brings a whole trip home', () => {
  const t = tinyDb();
  let s = { plan: Object.fromEntries(['2026-11-18', '2026-11-19', '2026-11-20'].map((d) => [d, { dinner: 'chix-grill', status: 'planned' }])) };
  s = applyOps(s, markAwayOps(t, s, { dates: ['2026-11-18', '2026-11-19', '2026-11-20'], reason: 'Out of town', today: '2026-11-16' }).ops);
  assert.deepEqual(awayBlock(s, '2026-11-19'), ['2026-11-18', '2026-11-19', '2026-11-20']);
  const r = bringBackTripOps(t, s, { date: '2026-11-19', today: '2026-11-16' });
  assert.match(r.message, /3 nights are back/);
  const back = applyOps(s, r.ops);
  assert.ok(['2026-11-18', '2026-11-19', '2026-11-20'].every((d) => back.plan[d].status === 'planned'));
  assert.deepEqual(applyOps(back, r.undo).plan, s.plan, 'undo puts the trip back');
});

test('missing lunches.json degrades to “no lunches” without errors', () => {
  const none = realDb({ lunches: false, nutrition: false });
  assert.equal(none.lunch.available, false);
  assert.equal(lunchNeeds(none, {}, WEEK).lunches.length, 0);
  assert.equal(buildList(none, {}, { dates: WEEK }).lunchCost, 0);
  assert.equal(plateNutrition(none, {}, none.dinnerList[0].id, null), null);
  const doc = normalizeLunches(lunchesDoc());
  assert.ok(doc.itemList.length >= (usingRealLunches() ? 20 : 8));
});

test('the drink rotation carries over the weekend and past a skipped day (never the same drink twice running)', () => {
  const drinkOn = (s, d) => lunchFor(db, s, 'Knox', d).slots.find((x) => x.slot === 'drink')?.id;
  const packed = (s, dates) => dates.filter((d) => !lunchFor(db, s, 'Knox', d)?.skip).map((d) => drinkOn(s, d));
  const twoWeeks = dateRange('2026-11-16', 14).filter((d) => hasLunchDay(knoxDefault(), d));
  const plain = packed({}, twoWeeks);
  for (let i = 1; i < plain.length; i++) assert.notEqual(plain[i], plain[i - 1], `lunch ${i}: Fri → Mon keeps alternating`);
  // Wednesday off: Thursday picks up where Tuesday left off.
  const s = applyOps({}, skipLunchOps(db, {}, { name: 'Knox', date: '2026-11-18', reason: 'No school' }).ops);
  const withSkip = packed(s, twoWeeks);
  assert.equal(withSkip.length, plain.length - 1);
  for (let i = 1; i < withSkip.length; i++) assert.notEqual(withSkip[i], withSkip[i - 1], `after the skip, lunch ${i} still alternates`);
  assert.equal(drinkOn(s, '2026-11-17'), drinkOn({}, '2026-11-17'), 'days before the skip are unchanged');
  assert.equal(drinkOn(s, '2026-11-19'), drinkOn({}, '2026-11-18'), 'Thursday gets what Wednesday would have had');
  // A skip on a day Knox doesn't pack lunch changes nothing.
  const sat = applyOps({}, skipLunchOps(db, {}, { name: 'Knox', date: '2026-11-21' }).ops);
  assert.deepEqual(packed(sat, twoWeeks), plain);
});

test('two phones editing the same person at once both keep their change (each edit writes one field)', () => {
  const base = {};
  const snack = db.lunch.itemList.find((x) => x.slot === 'snack' && !knoxDefault().slots.snack.includes(x.id));
  const jeffPhone = toggleLunchDayOps(db, base, { name: 'Knox', day: 3 }); // no Wednesday lunch
  const candiPhone = toggleLunchItemOps(db, base, { name: 'Knox', slot: 'snack', id: snack.id });
  for (const r of [jeffPhone, candiPhone]) {
    assert.equal(r.ops.length, 1);
    assert.ok(r.ops[0].path.length > 3, `writes one field, not the whole config: ${r.ops[0].path.join('.')}`);
  }
  for (const order of [[jeffPhone, candiPhone], [candiPhone, jeffPhone]]) {
    const s = applyOps(applyOps(base, order[0].ops), order[1].ops);
    const k = personConfig(db, s, 'Knox');
    assert.ok(!k.days.includes(3), 'Jeff’s change kept');
    assert.ok(k.slots.snack.includes(snack.id), 'Candi’s change kept');
    assert.deepEqual(k.slots.drink, knoxDefault().slots.drink, 'untouched slots still follow the defaults');
    assert.equal(k.enabled, true);
  }
  // Turning someone on writes just that switch; their days come from the defaults.
  const c = applyOps({}, setLunchEnabledOps(db, {}, { name: 'Candi', enabled: true }).ops);
  assert.deepEqual(c.lunch.people.Candi, { enabled: true });
  assert.deepEqual(personConfig(db, c, 'Candi').days, [1, 2, 3, 4, 5]);
});

test('upgrading from v2.0.1: the family’s existing data reads the same and nothing is written', async () => {
  const { v201State } = await import('./fixtures/v201-state.mjs');
  const before = JSON.stringify(v201State);
  const k = personConfig(db, v201State, 'Knox');
  assert.equal(k.enabled, true, 'Knox and Jeff start with their lunches, read from lunches.json');
  const list = buildList(db, v201State, { dates: WEEK, listKey: '2026-11-16+7' });
  const dinnerOnly = buildList(realDb({ lunches: false }), v201State, { dates: WEEK, listKey: '2026-11-16+7' });
  assert.equal(list.nights.length, dinnerOnly.nights.length, 'the same dinners are planned');
  assert.ok(list.items.find((i) => i.id === 'beef')?.checked, 'checked-off items stay checked');
  for (const i of list.items) assert.ok(!/^[a-z]+[A-Z]\w*$/.test(i.name), `${i.id} shows a name, not an id`);
  const b = monthBudget(db, v201State, '2026-11-16');
  assert.equal(b.spent, 64.18, 'receipts carry over');
  assert.equal(JSON.stringify(v201State), before, 'reading never changes the family’s data');
});

test('a lunch product missing from this phone’s catalog (mid-update) shows its lunch name, never an id', async () => {
  const { readableId } = await import('../app/shopping.js');
  const stale = realDb();
  const knox = personConfig(stale, {}, 'Knox');
  const drinkItem = stale.lunch.items[knox.slots.drink[0]];
  const ingId = Object.keys(drinkItem.items)[0];
  delete stale.ingredients[ingId]; // as if the catalog were last version's
  const line = buildList(stale, {}, { dates: WEEK }).items.find((i) => i.id === ingId);
  assert.ok(line, 'still on the list');
  assert.equal(line.name, drinkItem.title);
  assert.equal(readableId('bhBlackForestHam'), 'Bh black forest ham');
  assert.equal(readableId('custom-rotel-2'), 'Rotel 2');
});

test('the list’s Lunches / Dinners filters: per-store shares add up to the cost lines', async () => {
  const { filterShare } = await import('../app/views/list.js');
  const s = { plan: { '2026-11-17': { dinner: 'smashburgers', sides: ['jewel-fries'], status: 'planned' }, '2026-11-18': { dinner: db.dinnerList[1].id, status: 'planned' } } };
  const list = buildList(db, s, { dates: WEEK });
  const sum = (f, keep) => Math.round(list.items.filter(keep).reduce((t, i) => t + filterShare(f, i), 0) * 100) / 100;
  assert.equal(sum('lunches', (i) => i.reasons.includes('lunches')), list.lunchCost);
  assert.equal(Math.round((sum('dinners', (i) => i.reasons.includes('dinners') || i.reasons.includes('low')) + list.lunchCost + list.extrasCost) * 100), Math.round(list.total * 100));
});
