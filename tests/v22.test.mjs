// v2.2 (SPEC §9): one thumbs-down drops a dinner or side, lunch thumbs, receipts and My products.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { tinyDb, realDb, ROOT } from './helpers.mjs';
import { buildDb, normalizeProducts, normalizeSide } from '../app/data.js';
import { applyOps } from '../app/state.js';
import {
  isRetired, rotationList, benchList, effectiveSides, generatePlan, isFavorite, implicitPromotions, inRotation,
  isSideDropped, packFor, feasibleSides, dinnerById,
} from '../app/planner.js';
import {
  voteOps, sideVoteOps, restoreSideOps, restoreOps, lunchVoteOps, toggleLunchItemOps, setProductOps, clearProductOps, setPriceOps,
} from '../app/actions.js';
import { personConfig, lunchFor } from '../app/lunch.js';
import {
  parseSize, convertSize, importReceipt, importReceipts, linePaid, packSizeFor, receiptId, deleteReceiptOps, suggestMatches, normalizeReceipt,
} from '../app/receipts.js';
import { searchUrl, findItUrl, learnedProducts, productLabel, shownProduct, searchQuery, cleanPackLabel } from '../app/products.js';
import { buildList, formatStoreList } from '../app/shopping.js';
import { dateRange } from '../app/util.js';

const run = (s, r) => applyOps(s, r.ops);
const ctx = { today: '2026-11-16', at: '2026-11-16T12:00:00.000Z' };

/** tinyDb plus a third vegetable side, so a dropped vegetable has somewhere to go. */
function sideDb() {
  const db = tinyDb();
  const peas = normalizeSide({ id: 'peas', title: 'Buttered peas', kind: 'vegetable', items: { broccoli: 1 }, steps: ['Warm.'] });
  const corn = normalizeSide({ id: 'corn', title: 'Corn', kind: 'vegetable', items: { broccoli: 1 }, steps: ['Warm.'] });
  db.sides.peas = peas; db.sides.corn = corn;
  db.sideList.push(peas, corn);
  return db;
}

// ---------------------------------------------------------------- dinners

test('“not for us” drops a dinner; a bench dinner takes its place; Undo puts it back', () => {
  const db = tinyDb();
  let s = { plan: { '2026-11-18': { dinner: 'beef-bowl', sides: ['broc', 'beans'], status: 'planned' } } };
  const r = voteOps(db, s, { ...ctx, dinnerId: 'beef-bowl', who: 'Candi', value: -1 });
  assert.equal(r.retired, true);
  assert.equal(r.promoted, 'bench-beef');
  assert.match(r.message, /^beef-bowl is marked “not for us”, so it’s off the menu\. bench-beef takes its place in the rotation and on its planned night\.$/);
  s = run(s, r);
  assert.ok(isRetired(s, 'beef-bowl'));
  assert.ok(!rotationList(db, s).some((d) => d.id === 'beef-bowl'));
  assert.ok(rotationList(db, s).some((d) => d.id === 'bench-beef'));
  assert.equal(s.plan['2026-11-18'].dinner, 'bench-beef');
  const back = applyOps(s, r.undo);
  assert.ok(!isRetired(back, 'beef-bowl'), 'Undo brings it back');
  assert.equal(back.plan['2026-11-18'].dinner, 'beef-bowl');
  // There is one signal, so tapping the thumbs-down again takes it back (the dinner that came in stays).
  const again = voteOps(db, s, { ...ctx, dinnerId: 'beef-bowl', who: 'Knox', value: -1 });
  assert.equal(again.restored, true);
  assert.ok(!isRetired(run(s, again), 'beef-bowl'));
  assert.ok(rotationList(db, run(s, again)).some((d) => d.id === 'bench-beef'));
  // Restore (from the Dropped list) is a fresh start: nothing saved.
  const restored = run(s, restoreOps(db, s, { dinnerId: 'beef-bowl' }));
  assert.ok(!isRetired(restored, 'beef-bowl'));
  assert.equal(restored.votes?.['beef-bowl'], undefined);
});

test('taking back “not for us” brings the dinner back; one “loved” makes a favorite', () => {
  const db = tinyDb();
  let s = run({}, voteOps(db, {}, { ...ctx, dinnerId: 'chix-grill', who: 'Knox', value: -1 }));
  assert.ok(isRetired(s, 'chix-grill'));
  const r = voteOps(db, s, { ...ctx, dinnerId: 'chix-grill', who: 'Knox', value: -1 });
  assert.equal(r.restored, true);
  s = run(s, r);
  assert.ok(!isRetired(s, 'chix-grill'));
  const fav = voteOps(db, s, { ...ctx, dinnerId: 'chix-pasta', value: 1 });
  assert.equal(fav.favorite, true);
  assert.ok(isFavorite(run(s, fav), dinnerById(db, s, 'chix-pasta')));
});

test('older thumbs-downs are honored lazily: dropped, never planned, and a bench dinner fills in, with no writes', () => {
  const db = tinyDb();
  const legacy = { votes: { 'beef-bowl': { Jackson: -1, Jeff: 1 } } }; // from before the one-vote rule: no `retired`
  assert.ok(isRetired(legacy, 'beef-bowl'));
  const implicit = implicitPromotions(db, legacy);
  assert.equal(implicit.get('bench-beef'), 'beef-bowl', 'the best bench dinner fills the gap');
  assert.ok(inRotation(legacy, dinnerById(db, legacy, 'bench-beef'), db));
  assert.ok(!benchList(db, legacy).some((d) => d.id === 'bench-beef'));
  const rot = rotationList(db, legacy).map((d) => d.id);
  assert.ok(!rot.includes('beef-bowl') && rot.includes('bench-beef'));
  const { entries } = generatePlan({ db, state: legacy, dates: dateRange('2026-11-16', 14), today: '2026-11-16' });
  assert.ok(!Object.values(entries).some((e) => e.dinner === 'beef-bowl'), 'never planned again');
  assert.deepEqual(legacy, { votes: { 'beef-bowl': { Jackson: -1, Jeff: 1 } } }, 'nothing was written');
});

// ---------------------------------------------------------------- sides

test('a side thumbs-down drops it everywhere: the best same-kind side replaces it, nothing is written to substitutions', () => {
  const db = sideDb();
  let s = { substitutions: { 'chix-pasta': { 1: 'broc' } } };
  const r = sideVoteOps(db, s, { sideId: 'broc', who: 'Jordan', value: -1 });
  assert.equal(r.dropped, true);
  assert.match(r.message, /^Steamed broccoli is marked “not for us”, so it’s off the menu\./);
  assert.deepEqual(r.ops[0].value, { Family: -1 });
  assert.deepEqual(r.ops.map((o) => o.path[0]), ['sideVotes']);
  s = run(s, r);
  assert.ok(isSideDropped(s, 'broc'));
  const grill = effectiveSides(db, s, 'chix-grill', null);
  assert.equal(grill[0].ref, 'corn', 'deterministic: alphabetical among equals, never the other side already on the plate');
  assert.equal(grill[0].replaced, true);
  assert.equal(grill[0].droppedId, 'broc');
  assert.equal(grill[1].ref, 'beans');
  // A remembered substitution to the dropped side falls back the same way.
  const pasta = effectiveSides(db, s, 'chix-pasta', null);
  assert.ok(pasta.every((x) => x.ref !== 'broc'));
  assert.equal(s.substitutions['chix-pasta'][1], 'broc', 'the remembered choice is kept for if it comes back');
  // The generator stores the recipe's side; the swap stays on the fly.
  const refs = feasibleSides(db, s, dinnerById(db, s, 'chix-grill'), 'both', null);
  assert.equal(refs[0], 'broc');
  // Same answer every time.
  assert.deepEqual(effectiveSides(db, s, 'chix-grill', null).map((x) => x.ref), grill.map((x) => x.ref));
  // Restore from the Dropped list.
  const back = run(s, restoreSideOps(db, s, { sideId: 'broc' }));
  assert.equal(effectiveSides(db, back, 'chix-grill', null)[0].ref, 'broc');
});

test('a dropped side with no same-kind partner for that dinner still gets a same-kind side (fries → wedges on burger night)', () => {
  const db = realDb();
  const fries = db.sides['jewel-fries'];
  if (!fries) return;
  const s = run({}, sideVoteOps(db, {}, { sideId: 'jewel-fries', who: 'Knox', value: -1 }));
  const burgers = db.dinnerList.filter((d) => d.category === 'Burgers' && d.sides.includes('jewel-fries'));
  assert.ok(burgers.length > 0);
  for (const d of burgers) {
    const [side] = effectiveSides(db, s, d.id, null).filter((x) => x.droppedId === 'jewel-fries');
    assert.ok(side, `${d.id} gets a replacement`);
    assert.equal(db.sides[side.parsed.id].kind, fries.kind, `${d.id}: a starch for a starch, not ${side.parsed.id}`);
  }
  // Deterministic: every burger gets the same one, so the message names it.
  const reps = new Set(burgers.map((d) => effectiveSides(db, s, d.id, null).find((x) => x.droppedId === 'jewel-fries').parsed.id));
  assert.equal(reps.size, 1);
});

test('lunch thumbs-down takes an item out of that person’s rotation only', () => {
  const db = realDb();
  const knox = personConfig(db, {}, 'Knox');
  const id = knox.slots.drink?.[0];
  if (!id) return;
  const r = lunchVoteOps(db, {}, { itemId: id, person: 'Knox', value: -1 });
  const s = run({}, r);
  assert.ok(!personConfig(db, s, 'Knox').slots.drink.includes(id));
  assert.match(r.message, /out of Knox’s lunches/);
  // Nobody else's lunches change, and putting it back by hand clears the thumbs-down.
  assert.deepEqual(personConfig(db, s, 'Jeff'), personConfig(db, {}, 'Jeff'));
  const s2 = run(s, toggleLunchItemOps(db, s, { name: 'Knox', slot: 'drink', id }));
  assert.equal(s2.lunchVotes[id]?.Knox, undefined);
  assert.ok(personConfig(db, s2, 'Knox').slots.drink.includes(id));
  const l = lunchFor(db, s, 'Knox', '2026-11-16');
  assert.ok(!l || !Object.values(l.slots).some((x) => x.id === id));
});

// ---------------------------------------------------------------- receipts

test('sizes convert to the catalog unit', () => {
  assert.equal(convertSize(parseSize('6.5 lb'), 'lb'), 6.5);
  assert.equal(convertSize(parseSize('2 x 3 lb'), 'lb'), 6);
  assert.equal(convertSize(parseSize('40 oz'), 'lb'), 2.5);
  assert.equal(convertSize(parseSize('2 lb'), 'oz'), 32);
  assert.equal(convertSize(parseSize('40 ct'), 'tortillas'), 40);
  assert.equal(convertSize(parseSize('8 x 15 oz'), 'cans'), 8);
  assert.equal(convertSize(parseSize('24 pk 16.9 fl oz'), 'bottles'), 24);
  assert.equal(convertSize(parseSize('1 gal'), 'cups'), 16);
  assert.equal(convertSize(parseSize('32 oz'), 'cups'), 4, 'broth sold in ounces means fluid ounces');
  assert.equal(convertSize(parseSize('18 oz'), 'tbsp') , 36);
  assert.equal(convertSize(parseSize('2 lb'), 'tbsp'), null, 'weight to spoons needs a person');
  // Count after the size, as products.json and prices.json write packs.
  assert.equal(convertSize(parseSize('22 oz × 2'), 'oz'), 44);
  assert.equal(convertSize(parseSize('28 oz x 2'), 'oz'), 56);
  assert.equal(convertSize(parseSize('14.5 oz × 8'), 'cans'), 8);
  assert.equal(convertSize(parseSize('16 fl oz × 6'), 'bottles'), 6);
  assert.equal(convertSize(parseSize('4 oz sticks × 6'), 'tbsp'), 48);
  assert.equal(convertSize(parseSize('6 × 4 oz sticks'), 'tbsp'), 48);
  assert.equal(convertSize(parseSize('2 x 3 lb'), 'lb'), 6, 'count first still works');
  assert.equal(convertSize(parseSize('20 oz × 2 (~40 slices)'), 'slices'), 40, 'a count named outright wins');
  assert.equal(convertSize(parseSize('20 oz × 2 (~40 slices)'), 'oz'), 40);
  assert.equal(parseSize('BANANAS'), null);
  assert.equal(linePaid({ qty: 2, lineTotal: 20, discount: 3 }), 8.5);
  assert.equal(linePaid({ qty: 1, unitPrice: 4.99 }), 4.99);
});

const SAMS = {
  store: 'sams', date: '2026-11-12', total: 61.42, savings: 3, tax: 1.2,
  lines: [
    { text: 'MM CHKN BRST', product: "Member's Mark Boneless Skinless Chicken Breast", brand: "Member's Mark", size: '6.5 lb', qty: 1, unitPrice: 17.94, lineTotal: 17.94, discount: 0, matchId: 'chicken', confidence: 0.95 },
    { text: 'MM SHRD CHDR', product: "Member's Mark Shredded Mild Cheddar", brand: "Member's Mark", size: '2 lb', qty: 2, unitPrice: 8.48, lineTotal: 16.96, discount: 3, matchId: 'cheese', confidence: 0.9 },
    { text: 'PAPER TOWEL', product: 'Paper towels', qty: 1, lineTotal: 22.98, matchId: null },
    { text: 'BATTERIES', product: 'AA batteries', qty: 1, lineTotal: 9.99, matchId: null, skip: true },
  ],
};

test('importReceipt: log, my products, price history, budget line; same receipt never counted twice', () => {
  const db = realDb();
  const ops = importReceipt({}, SAMS, { db, by: 'Jeff', source: 'scan', at: ctx.at });
  assert.equal(ops.id, 'sams-2026-11-12-6142');
  assert.equal(ops.matched, 2);
  assert.equal(ops.learned, 2);
  assert.equal(ops.counted, true);
  const s = applyOps({}, ops);
  const log = s.receiptLog['sams-2026-11-12-6142'];
  assert.equal(log.total, 61.42);
  assert.equal(log.source, 'scan');
  assert.equal(log.lines.length, 3, 'skipped lines stay out of the log');
  assert.deepEqual(log.lines[0], { p: "Member's Mark Boneless Skinless Chicken Breast", s: '6.5 lb', t: 17.94, m: 'chicken', k: 6.5 }, 'compact lines');
  assert.deepEqual(log.lines[2], { p: 'Paper towels', t: 22.98 }, 'unmatched lines are logged only');
  assert.deepEqual(s.myProducts['sams/chicken'] && { name: s.myProducts['sams/chicken'].name, packSize: s.myProducts['sams/chicken'].packSize, price: s.myProducts['sams/chicken'].price, source: s.myProducts['sams/chicken'].source, date: s.myProducts['sams/chicken'].date },
    { name: "Member's Mark Boneless Skinless Chicken Breast", packSize: 6.5, price: 17.94, source: 'receipt', date: '2026-11-12' });
  assert.equal(s.myProducts['sams/cheese'].packSize, 32, '2 lb of cheese in the catalog’s ounces');
  assert.equal(s.myProducts['sams/cheese'].price, 6.98, 'paid per pack after the instant savings');
  assert.deepEqual(s.priceHistory['sams/chicken'], [{ price: 17.94, packSize: 6.5, date: '2026-11-12', receipt: 'sams-2026-11-12-6142' }]);
  assert.equal(s.receipts.length, 1);
  assert.equal(s.receipts[0].amount, 61.42);
  assert.equal(s.receipts[0].note, 'Scanned receipt');
  // The same receipt again (second photo, or the import seeing it): nothing.
  const again = importReceipt(s, { ...SAMS, lines: SAMS.lines.slice(0, 1) }, { db, at: ctx.at });
  assert.equal(again.duplicate, true);
  assert.equal(again.length, 0);
  // Logged by hand first: the log and products are saved, the Budget doesn't count it twice.
  const hand = { receipts: [{ id: 'r1', date: '2026-11-12', store: 'sams', amount: 61.42, by: 'Candi' }] };
  const o2 = importReceipt(hand, SAMS, { db, at: ctx.at });
  assert.equal(o2.counted, false);
  assert.equal(applyOps(hand, o2).receipts.length, 1);
});

test('importReceipts: a batch catches its own repeats, keeps the newest product, and stays small', () => {
  const db = realDb();
  const older = { ...SAMS, date: '2026-10-20', total: 40.1, lines: [{ product: 'Tyson Chicken Breasts', size: '6 lb', qty: 1, lineTotal: 21.5, matchId: 'chicken' }] };
  const { ops, results, state } = importReceipts({}, [SAMS, older, SAMS], { db, by: 'Jeff', at: ctx.at });
  assert.deepEqual(results.map((r) => r.duplicate), [false, false, true]);
  assert.equal(state.myProducts['sams/chicken'].name, "Member's Mark Boneless Skinless Chicken Breast", 'an older receipt never replaces a newer purchase');
  assert.deepEqual(state.priceHistory['sams/chicken'].map((h) => h.date), ['2026-10-20', '2026-11-12'], 'history oldest → newest');
  assert.equal(new Set(ops.filter((o) => o.op === 'set').map((o) => JSON.stringify(o.path))).size, ops.filter((o) => o.op === 'set').length, 'one write per path');
  assert.deepEqual(applyOps({}, ops), state);
  // Deleting a receipt takes back what it taught.
  const del = applyOps(state, deleteReceiptOps(state, 'sams-2026-11-12-6142'));
  assert.ok(!del.receiptLog['sams-2026-11-12-6142']);
  assert.equal(del.receipts.length, 1);
  assert.equal(del.myProducts['sams/chicken'].name, 'Tyson Chicken Breasts', 'falls back to the older purchase');
  assert.deepEqual(del.priceHistory['sams/chicken'].map((h) => h.date), ['2026-10-20']);
});

test('pack size: given → converted → the family’s/researched default', () => {
  const db = realDb();
  assert.deepEqual(packSizeFor(db, {}, 'sams', 'chicken', { packSize: 7 }), { packSize: 7, how: 'given' });
  assert.deepEqual(packSizeFor(db, {}, 'sams', 'chicken', { size: '2 x 3 lb' }), { packSize: 6, how: 'converted' });
  const d = packSizeFor(db, {}, 'sams', 'chicken', { product: 'Chicken breast' });
  assert.equal(d.how, 'default');
  assert.equal(d.packSize, db.ingredients.chicken.packs.sams.generic.size);
  assert.ok(suggestMatches(db, {}, { product: 'Boneless skinless chicken breast' })[0]?.id === 'chicken');
  assert.equal(receiptId(normalizeReceipt({ store: "Sam's Club", date: '2026-11-01', total: '12.30' })), 'sams-2026-11-01-1230');
});

test('price follows the one product: paid on a receipt → the family’s fixed price → their usual / researched / catalog product; an old per-tier fix counts until replaced', () => {
  const db = realDb();
  const base = packFor(db, {}, 'chicken', 'sams');
  assert.equal(base.kind, 'usual');
  assert.equal(base.price, db.ingredients.chicken.packs.sams[db.ingredients.chicken.usual.tier].price);
  const s1 = applyOps({}, importReceipt({}, SAMS, { db, at: ctx.at }));
  const paid = packFor(db, s1, 'chicken', 'sams');
  assert.deepEqual([paid.source, paid.price, paid.size, paid.date], ['paid', 17.94, 6.5, '2026-11-12']);
  // "Fix the price": same product, the family's price.
  const s2 = run(s1, setPriceOps(db, s1, { store: 'sams', id: 'chicken', size: 6.5, price: 18.5, who: 'Candi' }));
  const fixed = packFor(db, s2, 'chicken', 'sams');
  assert.deepEqual([fixed.source, fixed.price, fixed.product.name], ['typed', 18.5, "Member's Mark Boneless Skinless Chicken Breast"]);
  // An older per-tier family price still prices the product until they buy, pick or fix one.
  const legacy = { prices: { 'sams/generic/chicken': { size: 10, price: 25, by: 'Candi' } } };
  assert.equal(packFor(db, legacy, 'chicken', 'sams').source, 'family');
  assert.equal(packFor(db, { ...s1, ...legacy }, 'chicken', 'sams').source, 'paid', 'what they paid beats an old fix');
  // Jewel is untouched by a Sam's receipt.
  assert.deepEqual(packFor(db, s1, 'chicken', 'jewel'), packFor(db, {}, 'chicken', 'jewel'));
});

test('My products on the list: product name, paid price, exact names in Copy & open, Find it link', () => {
  const db = realDb();
  const products = normalizeProducts(JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/products.json'), 'utf8')));
  db.products = products;
  const plan = { '2026-11-16': { dinner: db.dinnerList.find((d) => d.items.chicken)?.id, status: 'planned' } };
  let s = applyOps({ plan, settings: { planStore: 'sams' } }, importReceipt({}, SAMS, { db, at: ctx.at }));
  const list = buildList(db, s, { dates: ['2026-11-16'] });
  const item = list.items.find((i) => i.id === 'chicken');
  assert.equal(item.pack.source, 'paid');
  assert.equal(item.pack.product.name, "Member's Mark Boneless Skinless Chicken Breast");
  assert.equal(item.cost, Math.round(item.packs * 17.94 * 100) / 100);
  const text = formatStoreList(db, list, 'sams');
  assert.match(text, /Member's Mark Boneless Skinless Chicken Breast, 6\.5 lb — /);
  assert.equal(productLabel(item.pack.product), "Member's Mark Boneless Skinless Chicken Breast, 6.5 lb");
  // Learned from receipts, shown in the picker.
  assert.equal(learnedProducts(s, 'sams', 'chicken')[0].price, 17.94);
  // Choosing a researched product.
  const opt = products.byId.chicken.sams[1];
  s = run(s, setProductOps(db, s, { store: 'sams', id: 'chicken', product: { ...opt, source: 'pick' }, who: 'Jeff', at: ctx.at }));
  const picked = packFor(db, s, 'chicken', 'sams');
  assert.deepEqual([picked.source, picked.price, picked.size], ['product', 23.88, 6]);
  // Find it: the store's search for that exact product (or its saved page).
  assert.equal(searchUrl(db, 'sams', 'Tyson Boneless Skinless Chicken Breasts, 6 lb'), 'https://www.samsclub.com/s/Tyson+Boneless+Skinless+Chicken+Breasts');
  assert.equal(searchUrl(db, 'jewel', 'Signature Farms Chicken, ~3 lb'), 'https://www.jewelosco.com/shop/search-results.html?q=Signature%20Farms%20Chicken');
  assert.equal(findItUrl(db, 'sams', products.byId.chicken.sams[0]), products.byId.chicken.sams[0].url);
  assert.equal(searchQuery("Member's Mark Shredded Mild Cheddar (est.)"), "Member's Mark Shredded Mild Cheddar");
  // Typed without a price: product name shows, price stays the estimate.
  const s3 = run({}, setProductOps(db, {}, { store: 'jewel', id: 'cheese', product: { name: 'Kraft Shredded Cheddar', size: '8 oz', source: 'typed' }, who: 'Candi' }));
  const p3 = packFor(db, s3, 'cheese', 'jewel');
  assert.notEqual(p3.source, 'typed');
  assert.equal(p3.product.name, 'Kraft Shredded Cheddar');
  assert.equal(shownProduct(s3, 'jewel', 'cheese', p3).label, 'Kraft Shredded Cheddar, 8 oz');
  const cleared = run(s3, clearProductOps(db, s3, { store: 'jewel', id: 'cheese' }));
  assert.equal(packFor(db, cleared, 'cheese', 'jewel').product, undefined);
});

test('researched pack labels read as product names: nested notes, "; also bought" and " — notes" are dropped', () => {
  const cases = [
    ['Morton Iodized Salt, 26 oz (= ~123 tsp) (DoorDash Jewel-Osco listing, Nov 2026 (size not shown; size assumed; delivery-app prices can run above in-store))', 'Morton Iodized Salt, 26 oz'],
    ['Claussen Kosher Dill Pickle Spears, 24 oz (est. price) (the family’s usual); Vienna spears also bought', 'Claussen Kosher Dill Pickle Spears, 24 oz'],
    ['Signature Select Ground Cumin, ~1.75 oz (= ~24 tsp) (DoorDash Jewel-Osco listing, Nov 2026 (size not shown); $3.49 on sale)', 'Signature Select Ground Cumin, ~1.75 oz'],
    ["Member's Mark 93/7 Ground Beef, ~3.2 lb 3-pack ($6.32/lb) — Sam's sells no national-brand ground beef", "Member's Mark 93/7 Ground Beef, ~3.2 lb 3-pack"],
    ['BODYARMOR Orange Mango sports drink, 16 fl oz × 6 (est.; singles ≈ $2.49). 110 cal, 25 g sugar a bottle', 'BODYARMOR Orange Mango sports drink, 16 fl oz × 6'],
    ["Rao's Homemade Marinara, 22 oz × 2", "Rao's Homemade Marinara, 22 oz × 2"],
  ];
  for (const [raw, want] of cases) assert.equal(cleanPackLabel(raw), want);
  // Every researched label in the real data comes out clean (no stray brackets or notes).
  const db = realDb();
  for (const i of Object.values(db.ingredients)) for (const store of ['sams', 'jewel']) for (const tier of ['generic', 'name']) {
    const label = cleanPackLabel(i.packs?.[store]?.[tier]?.label);
    assert.ok(!/[()[\];]|also bought| — /.test(label), `${i.id} ${store}/${tier}: ${label}`);
  }
});

test('one product per store: bought → the usual → the first researched option → the catalog pack; old brand settings change nothing', () => {
  const db = realDb();
  const m = db.ingredients.marinara;
  assert.ok(m?.usual && m.brand && db.products.byId.marinara, 'marinara has a usual and researched options');
  const home = m.usual.store;
  const other = home === 'sams' ? 'jewel' : 'sams';
  const shown = (state, store, id) => shownProduct(state, store, id, packFor(db, state, id, store), db);
  // 2. The family's usual, where they buy it (Rao's), with its brand.
  const p1 = packFor(db, {}, 'marinara', home);
  assert.equal(p1.kind, 'usual');
  assert.equal(shown({}, home, 'marinara').usual, true);
  assert.match(shown({}, home, 'marinara').label, /Rao/);
  // 3. The other store: its first researched product, at that product's price — and no usual brand glued on.
  const opt = db.products.byId.marinara[other]?.[0];
  if (opt) {
    const p2 = packFor(db, {}, 'marinara', other);
    assert.deepEqual([p2.kind, p2.size, p2.price], ['option', opt.packSize, opt.price]);
    const sp = shown({}, other, 'marinara');
    assert.equal(sp.usual, false);
    assert.ok(sp.label.startsWith(opt.name), sp.label);
  }
  // 1. What they bought wins, at the price they paid.
  const bought = { myProducts: { [`${other}/marinara`]: { name: "Rao's Homemade Marinara Sauce", size: '24 oz', packSize: 24, unit: 'oz', price: 8.99, source: 'receipt', date: '2026-11-12' } } };
  const p3 = packFor(db, bought, 'marinara', other);
  assert.deepEqual([p3.kind, p3.source, p3.size, p3.price], ['mine', 'paid', 24, 8.99]);
  assert.equal(shown(bought, other, 'marinara').label, "Rao's Homemade Marinara Sauce, 24 oz");
  // Copy & open names the product itself, wherever it came from.
  const plan = { '2026-11-17': { dinner: 'classic-spaghetti', status: 'planned' } };
  for (const [state, store] of [[{ plan, storeFor: { marinara: home } }, home], [{ plan, storeFor: { marinara: other } }, other]]) {
    const list = buildList(db, state, { dates: ['2026-11-17'] });
    const line = list.items.find((i) => i.id === 'marinara');
    if (line?.store !== store) continue;
    assert.ok(formatStoreList(db, list, store).includes(`${line.product.label} — `), `${store}: ${line.product.label}`);
  }
  // 4. Nothing else known: the catalog's pack.
  const plain = Object.values(db.ingredients).find((i) => !i.usual && !db.products.byId[i.id] && i.packs?.jewel);
  assert.equal(packFor(db, {}, plain.id, 'jewel').kind, 'catalog');
  // Old data: per-item brand picks and the household brand setting are ignored.
  const old = { brands: { marinara: m.usual.tier === 'name' ? 'generic' : 'name', [plain.id]: 'name', chicken: 'name' }, settings: { brand: 'name' } };
  for (const id of ['marinara', plain.id, 'chicken']) for (const st of ['sams', 'jewel']) assert.deepEqual(packFor(db, old, id, st), packFor(db, {}, id, st), `${id} at ${st}`);
  // Nowhere does a usual brand get glued onto another store's product.
  for (const i of Object.values(db.ingredients).filter((x) => x.brand && x.usual?.store)) {
    const sp = shown({}, i.usual.store === 'sams' ? 'jewel' : 'sams', i.id);
    if (sp) assert.ok(!sp.usual && !sp.label.includes(' · '), `${i.id}: ${sp.label}`);
  }
});

test('products.json and stores.json search templates degrade gracefully', () => {
  assert.deepEqual(normalizeProducts(null), { updated: null, byId: {} });
  const db = buildDb({ catalog: { ingredients: {} }, recipes: { dinners: [], sides: [] }, stores: { stores: { sams: { search: { web: 'https://www.samsclub.com/s/{q}?clubId=6487' } } } } });
  assert.equal(searchUrl(db, 'sams', 'Kirkland eggs'), 'https://www.samsclub.com/s/Kirkland+eggs?clubId=6487');
  assert.equal(searchUrl(db, 'jewel', 'eggs'), 'https://www.jewelosco.com/shop/search-results.html?q=eggs');
});

test('purchase-history import (coordinator shape): packSize as given, newest purchase wins in any order, compact and small', () => {
  const db = realDb();
  const r = (date, total, lines) => ({ store: 'jewel', date, total, savings: 1.5, source: 'import', lines });
  const L = (product, matchId, lineTotal, packSize, extra = {}) => ({ text: product.toUpperCase().slice(0, 18), product, brand: product.split(' ')[0], size: '', qty: 1, unitPrice: lineTotal, lineTotal, discount: 0, matchId, packSize, ...extra });
  const list = [
    r('2026-11-10', 30.5, [L('Signature Farms Chicken Breast', 'chicken', 11.2, 2.8), L('Lucerne 2% Milk Gallon', 'milk', 3.49, 16), L('Bananas', null, 1.6, null)]),
    r('2026-09-02', 25.1, [L('Tyson Chicken Breast', 'chicken', 13.9, 3), L('Jewel Milk Gallon', 'milk', 2.99, 16)]),
    r('2026-10-15', 18.0, [L('Signature Farms Chicken Breast', 'chicken', 10.05, 2.6, { discount: 1 })]),
  ];
  const { ops, results, state } = importReceipts({ receipts: [{ id: 'x', date: '2026-10-15', store: 'jewel', amount: 52.75, by: 'Candi' }] }, list, { db, by: 'Jeff', at: ctx.at });
  assert.deepEqual(results.map((x) => [x.lines, x.matched, x.counted]), [[3, 2, true], [2, 2, true], [1, 1, false]], 'a trip logged by hand that day already counts');
  assert.deepEqual(state.myProducts['jewel/chicken'] && [state.myProducts['jewel/chicken'].name, state.myProducts['jewel/chicken'].date, state.myProducts['jewel/chicken'].packSize, state.myProducts['jewel/chicken'].price],
    ['Signature Farms Chicken Breast', '2026-11-10', 2.8, 11.2], 'the most recent purchase, whatever the order');
  assert.equal(state.myProducts['jewel/milk'].packSize, 16, 'packSize used as given (cups)');
  assert.deepEqual(state.priceHistory['jewel/chicken'].map((h) => [h.date, h.price]), [['2026-09-02', 13.9], ['2026-10-15', 9.05], ['2026-11-10', 11.2]]);
  assert.ok(!Object.keys(state.myProducts).some((k) => k.endsWith('/null')), 'unmatched lines set nothing');
  assert.equal(state.receipts.filter((x) => x.receiptId).every((x) => x.note === 'Imported from purchase history'), true);
  assert.equal(state.receiptLog[results[0].id].source, 'import');
  // ~80 receipts × 8 lines: well under the Worker's 1 MB, a few requests of ≤200 ops.
  const big = [];
  const ids = Object.keys(db.ingredients).slice(0, 60);
  for (let i = 0; i < 80; i++) {
    const date = `2026-${String(8 + Math.floor(i / 27)).padStart(2, '0')}-${String(1 + (i % 27)).padStart(2, '0')}`;
    big.push(r(date, 40 + i, Array.from({ length: 8 }, (_, k) => L(`Signature Select Product Number ${k} With A Long Name`, k < 6 ? ids[(i + k) % ids.length] : null, 3 + k, 1))));
  }
  const res = importReceipts({}, big, { db, by: 'Jeff', at: ctx.at });
  const bytes = Buffer.byteLength(JSON.stringify(res.state));
  assert.ok(bytes < 400_000, `640 lines of history take ${bytes} bytes`);
  assert.ok(res.ops.length < 1000 && res.ops.every((o) => o.path.length <= 3));
  assert.ok(Object.values(res.state.priceHistory).every((h) => h.length <= 12 && h.every((x, j) => !j || h[j - 1].date <= x.date)));
});

test('catalog `usual`: the family’s usual store and product by default; their choices still win; paid prices say paid', async () => {
  const { storeFor } = await import('../app/planner.js');
  const { priceSource, shownProduct, brandedLabel } = await import('../app/products.js');
  const db = realDb();
  const usual = Object.values(db.ingredients).filter((i) => i.usual);
  if (!usual.length) return;
  const nameTier = usual.find((i) => i.usual.tier === 'name') || usual[0];
  assert.equal(storeFor(db, {}, nameTier.id, 'both'), nameTier.usual.store);
  assert.equal(storeFor(db, { storeFor: { [nameTier.id]: nameTier.usual.store === 'sams' ? 'jewel' : 'sams' } }, nameTier.id, 'both') !== nameTier.usual.store || !db.ingredients[nameTier.id].packs[nameTier.usual.store === 'sams' ? 'jewel' : 'sams'], true);
  const p = packFor(db, {}, nameTier.id, nameTier.usual.store);
  if (p?.confidence === 'paid') assert.equal(priceSource(p).kind, 'paid');
  const shown = shownProduct({}, nameTier.usual.store, nameTier.id, p, db);
  assert.ok(shown.usual && shown.label.length > 0);
  assert.equal(brandedLabel('Lucerne large eggs, 12 ct', 'Jewel (Lucerne)'), 'Lucerne large eggs, 12 ct');
  assert.equal(brandedLabel('Hamburger buns, 8 ct', 'Ball Park'), 'Ball Park · Hamburger buns, 8 ct');
  // More (or fewer) than 50 core dinners is fine.
  assert.ok(rotationList(db, {}).length >= 50);
});
