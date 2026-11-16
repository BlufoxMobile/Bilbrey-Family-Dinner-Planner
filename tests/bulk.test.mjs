// Making the most of Sam's Club bulk packs (docs/spec/24 §24.5, §24.8): a modest nudge in the plan
// generator, read from the catalog's `bulk` on each ingredient. The rules that keep a week varied
// still decide; the nudge only tips close calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDb } from '../app/data.js';
import { generatePlan, bulkScore, BULK_NUDGE, dinnerById } from '../app/planner.js';
import { addDays } from '../app/util.js';
import { realDb } from './helpers.mjs';

const pack = (size, price) => ({ generic: { size, price, label: `g${size}` }, name: { size, price, label: `n${size}` } });
const BULK = { freezes: true, portionLb: 2.25, note: 'Split the pack into 2¼-lb freezer bags the day you buy it.' };
/** Ten dinners: two on chicken thighs (a 5½-lb Sam's tray) and eight on other meats at the same low price a pound,
 * so the money math barely separates them and the nudge is what the test sees. */
function db({ bulk = true } = {}) {
  const meat = (name, extra = {}) => ({ name, unit: 'lb', aisle: 'Meat', storage: 'freezer', kind: 'measured', meat: true, defaultStore: 'sams', packs: { sams: pack(5.5, 5.5) }, ...extra });
  const catalog = { ingredients: {
    thighs: meat('Chicken thighs', bulk ? { bulk: BULK } : {}),
    beef: meat('Ground beef'), pork: meat('Pork chops'), sausage: meat('Sausage'), steak: meat('Steak'),
    rice: { name: 'Rice', unit: 'cups', aisle: 'Pasta & Grains', storage: 'pantry', kind: 'measured', defaultStore: 'sams', packs: { sams: pack(50, 15) }, ...(bulk ? { bulk: { freezes: false, note: 'Keeps a year in a sealed bin, away from heat.' } } : {}) },
  } };
  const D = (id, category, protein, items) => ({ id, title: id, subtitle: '', category, protein, minutes: 30, equipment: ['stovetop'], tags: [], rotation: 'core', steps: ['Cook to 165°F.'], sides: [], sideSlots: 0, items });
  const recipes = { dinners: [
    D('thighs-grill', 'Grill', 'chicken', { thighs: 2.25 }),
    D('thighs-tacos', 'Tex-Mex', 'chicken', { thighs: 2.25 }),
    D('beef-pasta', 'Pasta', 'beef', { beef: 2.25 }),
    D('pork-comfort', 'Comfort', 'pork', { pork: 2.25 }),
    D('sausage-soup', 'Soups', 'sausage', { sausage: 2.25 }),
    D('steak-salad', 'Salads', 'beef', { steak: 2.25 }),
    D('beef-skillet', 'Skillet', 'beef', { beef: 2.25 }),
    D('pork-sandwich', 'Sandwiches', 'pork', { pork: 2.25 }),
    D('sausage-pasta', 'Pasta', 'sausage', { sausage: 2.25 }),
    D('steak-grill', 'Grill', 'beef', { steak: 2.25 }),
  ], sides: [] };
  return buildDb({ catalog, recipes });
}
const MON = '2026-11-16';
const week = Array.from({ length: 5 }, (_, i) => addDays(MON, i));
const settings = { planStore: 'sams', lean: false, burgerDays: [], pizzaPerMonth: 0 };
const seeds = Array.from({ length: 60 }, (_, i) => `seed-${i}`);

test('bulkScore: the rest of a pack this plan opened, bulk meat already in the freezer, and a cap', () => {
  const d = db();
  const ledger = (rem, opened = []) => ({ rem, opened: new Set(opened) });
  assert.equal(bulkScore(d, {}, ledger({}), { thighs: 2.25 }), 0, 'nothing on hand, nothing opened: no nudge for simply being a bulk item');
  assert.equal(bulkScore(d, {}, ledger({ thighs: 3.25 }, ['thighs']), { thighs: 2.25 }), BULK_NUDGE.finish, 'finishing the tray the plan bought');
  assert.equal(bulkScore(d, {}, ledger({ thighs: 2.25 }), { thighs: 2.25 }), BULK_NUDGE.onHand, 'a bag already in the freezer');
  assert.ok(Math.abs(bulkScore(d, {}, ledger({ thighs: 1.125 }, ['thighs']), { thighs: 2.25 }) - BULK_NUDGE.finish / 2) < 1e-9, 'half covered counts half');
  assert.equal(bulkScore(d, {}, ledger({ rice: 40 }), { rice: 2 }), BULK_NUDGE.side, 'a big bag that is not meat counts a little');
  assert.equal(bulkScore(d, {}, ledger({ beef: 9 }, ['beef']), { beef: 2.25 }), 0, 'an item without `bulk` is left to the money math');
  assert.equal(bulkScore(db({ bulk: false }), {}, ledger({ thighs: 3 }, ['thighs']), { thighs: 2.25 }), 0);
  const many = Object.fromEntries(['a', 'b', 'c'].map((k) => [k, 2]));
  const big = buildDb({ catalog: { ingredients: Object.fromEntries(Object.keys(many).map((k) => [k, { name: k, unit: 'lb', meat: true, kind: 'measured', packs: { sams: pack(6, 20) }, bulk: BULK }])) }, recipes: { dinners: [], sides: [] } });
  assert.equal(bulkScore(big, {}, ledger({ a: 6, b: 6, c: 6 }, ['a', 'b', 'c']), many), BULK_NUDGE.max, 'capped');
  assert.ok(BULK_NUDGE.max < 1 && BULK_NUDGE.finish <= 0.5, 'modest: under the favorite bonus (1.0), no more than the same-protein-in-a-row penalty (0.5)');
});

test('a tray bought for one night is finished by another night of the same plan more often than without the nudge', () => {
  // Monday is set by hand to a thighs dinner, which sends a 5½-lb tray to the list. Tuesday and Wednesday are open.
  const state = { settings, plan: { [MON]: { dinner: 'thighs-grill', sides: [], status: 'planned', manual: true } } };
  const finished = (d) => seeds.filter((seedKey) => {
    const { entries, unfilled } = generatePlan({ db: d, state, dates: week.slice(0, 3), mode: 'fill', today: MON, seedKey });
    assert.deepEqual(unfilled, []);
    return Object.values(entries).some((e) => e.dinner === 'thighs-tacos');
  }).length;
  const withNudge = finished(db());
  const without = finished(db({ bulk: false }));
  if (process.env.SHOW) console.log('finish the tray:', withNudge, 'vs', without);
  assert.ok(withNudge > without, `the other thighs dinner joins the week in ${withNudge} of ${seeds.length} plans with the nudge, ${without} without`);
  assert.ok(withNudge >= seeds.length * 0.6, `most plans finish the tray (${withNudge} of ${seeds.length})`);
});

test('bulk meat already in the freezer is planned sooner', () => {
  const state = { settings, pantry: { thighs: { qty: 4.5, since: '2026-11-10', by: 'Family', at: '2026-11-10T18:00:00Z' } } };
  const nights = (d) => seeds.reduce((n, seedKey) => n + Object.values(generatePlan({ db: d, state, dates: week.slice(0, 3), mode: 'fill', today: MON, seedKey }).entries).filter((e) => e.dinner.startsWith('thighs')).length, 0);
  assert.ok(nights(db()) >= nights(db({ bulk: false })), 'never fewer thigh dinners in the first three nights');
  assert.ok(nights(db()) >= seeds.length, 'at least one a plan on average');
});

test('the rules that keep the week varied still hold', () => {
  const d = db();
  for (const seedKey of seeds) {
    const state = { settings, pantry: { thighs: { qty: 11, by: 'Family', at: '2026-11-10T18:00:00Z', since: '2026-11-10' } } };
    const { entries } = generatePlan({ db: d, state, dates: week, mode: 'fill', today: MON, seedKey });
    const ids = week.map((x) => entries[x].dinner);
    assert.equal(new Set(ids).size, ids.length, `${seedKey}: no dinner repeats inside the week, even with 11 lb of thighs in the freezer`);
    const cats = ids.map((id) => dinnerById(d, state, id).category);
    for (let i = 1; i < cats.length; i++) assert.notEqual(cats[i], cats[i - 1], `${seedKey}: no category two nights running`);
  }
});

test('the real recipe box: after a hand-set thigh dinner, plans use the rest of the Sam’s tray at least as often', () => {
  const real = realDb();
  const stripped = { ...real, ingredients: Object.fromEntries(Object.entries(real.ingredients).map(([id, i]) => { const { bulk, ...rest } = i; return [id, rest]; })) };
  assert.ok(real.ingredients.chickenThighs.bulk && real.dinners['honey-mustard-chicken-thighs']);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(MON, i));
  const state = { settings: { planStore: 'both' }, plan: { [MON]: { dinner: 'honey-mustard-chicken-thighs', status: 'planned', manual: true } } };
  const uses = (d) => seeds.slice(0, 24).reduce((n, seedKey) => n + Object.values(generatePlan({ db: d, state, dates, mode: 'fill', today: MON, seedKey }).entries).filter((e) => d.dinners[e.dinner].items.chickenThighs).length, 0);
  assert.ok(uses(real) >= uses(stripped), `${uses(real)} thigh dinners with the nudge, ${uses(stripped)} without`);
});
