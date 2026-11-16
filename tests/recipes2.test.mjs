// docs/spec/24-chicken-bulk-and-meal-cost.md. What Jeff said on 2026-11-15 at 10 pm, held as rules:
// chicken not turkey, little pork, the BLT bowl minus the T (for Jeff), Wish-Bone ranch, dinners built
// on Sam's Club bulk buys, and the PossibleCooker's STEAM setting. Each validator rule is tried on a
// doctored copy of the real data, so it can't quietly stop catching what it was written for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, realDb } from './helpers.mjs';
import { dinnerById, itemsForNight } from '../app/planner.js';
import { plateHealth } from '../app/nutrition.js';
import { lunchItem, lunchFor, personConfig } from '../app/lunch.js';
import { handsOnMinutes } from '../app/data.js';
import { validateData, loadData, rawProduce, RETIRED_DINNERS, MAX_CORE_PORK, TOMATO_LEFT_OUT, EQUIPMENT } from '../scripts/validate-data.mjs';

const db = realDb();
const disk = loadData();
const read = (p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const recipes = read('data/recipes.json');
const catalog = read('data/catalog.json').ingredients;
const lunches = read('data/lunches.json');
const KEYS = ['catalog', 'recipes', 'lunches', 'nutrition', 'prices', 'photos', 'photoJobs', 'ref'];
function check(change = () => {}) {
  const copy = structuredClone(Object.fromEntries(KEYS.map((k) => [k, disk[k]])));
  change(copy);
  return validateData({ ...copy, fileExists: disk.fileExists });
}
const dinner = (d, id) => d.recipes.dinners.find((x) => x.id === id);
const side = (d, id) => d.recipes.sides.find((x) => x.id === id);
const lunch = (d, id) => d.lunches.items.find((x) => x.id === id);
const says = (res, re) => res.errors.some((e) => re.test(e));
const text = (o) => JSON.stringify(o);

const NEW_DINNERS = ['cooker-beef-tips-gravy', 'air-fryer-steak-bites', 'pepper-steak', 'cooker-pot-roast', 'griddle-steaks-mushrooms',
  'honey-mustard-chicken-thighs', 'chicken-vegetable-stir-fry', 'cooker-chunky-beef-chili', 'apple-glazed-chicken-thighs', 'cooker-chicken-potatoes-carrots'];
const RENAMED = { 'turkey-taco-salad': 'chicken-taco-salad', 'turkey-chili': 'chicken-bean-chili', 'cooker-turkey-meatballs': 'cooker-chicken-meatballs' };

/** Width and height of a lossy .webp, read from its header. */
function webpSize(rel) {
  const b = readFileSync(path.join(ROOT, rel));
  assert.equal(b.toString('ascii', 0, 4) + b.toString('ascii', 8, 16), 'RIFFWEBPVP8 ', `${rel} is a lossy webp`);
  return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
}

test('the recipe box still passes every rule', () => {
  assert.deepEqual(check().errors, []);
});

// ---------------------------------------------------------------- chicken over turkey

test('no dinner and no side has turkey in it: not an ingredient, not a word, not an id', () => {
  for (const d of [...db.dinnerList, ...db.sideList]) {
    assert.ok(!/turkey/i.test(text(d)), `${d.id} says turkey`);
    assert.ok(!Object.keys(d.items).some((id) => /turkey/i.test(id)), `${d.id} uses turkey`);
  }
  assert.ok(!db.dinnerList.some((d) => d.protein === 'turkey'));
  // The thirteen that had it are chicken now.
  for (const id of ['ginger-beef-cabbage', 'chickpea-pepper-pasta', 'sweet-potato-tacos', 'chili-jacket-potatoes', 'breakfast-tacos', 'egg-roll-in-a-bowl',
    'sausage-broccoli-penne', 'chicken-taco-salad', 'chicken-bean-chili', 'cooker-chicken-meatballs', 'cooker-sausage-minestrone', 'cooker-lasagna-soup']) {
    const d = db.dinners[id];
    assert.equal(d.protein, 'chicken', id);
    assert.ok(d.items.groundChicken >= 1.5, `${id} uses ground chicken`);
    assert.match(d.steps.join(' '), /165°F/, `${id} states chicken's safe temperature`);
    assert.match(d.steps.join(' '), /ground chicken/, id);
  }
  const hoagies = db.dinners['sausage-pepper-hoagies'];
  assert.ok(hoagies.items.chickenSausage > 0 && /fully cooked/.test(hoagies.steps.join(' ')) && /165°F/.test(hoagies.steps.join(' ')));
  // A dish that wants sausage gets its seasoning in the pan.
  for (const id of ['chickpea-pepper-pasta', 'sausage-broccoli-penne', 'cooker-sausage-minestrone', 'breakfast-tacos']) assert.ok(db.dinners[id].items.italianSeasoning > 0 && db.dinners[id].items.garlicPowder > 0, id);
});

test('the validator refuses turkey in a dinner or a side, however it arrives', () => {
  assert.ok(says(check((d) => { dinner(d, 'beef-tacos').items.groundTurkey = 1; }), /beef-tacos: uses groundTurkey; the family prefers chicken to turkey/));
  assert.ok(says(check((d) => { dinner(d, 'beef-tacos').subtitle += ' Good with ground turkey too.'; }), /beef-tacos\.subtitle: says turkey/));
  assert.ok(says(check((d) => { dinner(d, 'beef-tacos').tips.push('Leftover turkey works here.'); }), /beef-tacos\.tips\[\d\]: says turkey/));
  assert.ok(says(check((d) => { side(d, 'romaine-salad').steps.push('Top with sliced turkey for a bigger salad.'); }), /side romaine-salad\.steps\[\d\]: says turkey/));
  assert.ok(says(check((d) => { dinner(d, 'chicken-taco-salad').protein = 'turkey'; }), /protein "turkey" not allowed/));
  assert.ok(says(check((d) => { dinner(d, 'chicken-taco-salad').id = 'turkey-taco-salad'; }), /turkey-taco-salad: this dinner was removed for good/));
  assert.ok(says(check((d) => { dinner(d, 'chicken-taco-salad').id = 'turkey-night-salad'; }), /turkey-night-salad\.id: says turkey/));
});

test('the three ids that named turkey are retired, and their dishes, pictures and saved links carry on', () => {
  assert.deepEqual(recipes.renamed, RENAMED);
  for (const [from, to] of Object.entries(RENAMED)) {
    assert.ok(RETIRED_DINNERS[from], `${from} is retired by name`);
    assert.equal(db.dinners[from], undefined);
    assert.ok(db.dinners[to], to);
    assert.equal(db.photos.dinners[from], undefined);
    assert.equal(db.photos.dinners[to].src, `img/dinners/${to}.webp`);
    for (const f of [`img/dinners/${to}.webp`, `img/dinners/${to}-640.webp`]) assert.ok(existsSync(path.join(ROOT, f)), f);
    for (const f of [`img/dinners/${from}.webp`, `img/dinners/${from}-640.webp`]) assert.ok(!existsSync(path.join(ROOT, f)), `${f} is gone`);
    // A night the family planned under the old id neither breaks the plan nor the plate.
    const state = { plan: { '2026-11-17': { dinner: from, status: 'planned' } } };
    assert.equal(dinnerById(db, state, from), null);
    assert.deepEqual(itemsForNight(db, state, from, state.plan['2026-11-17']), {});
  }
  assert.ok(says(check((d) => { d.recipes.renamed['beef-tacos'] = 'pepper-steak'; }), /renamed: "beef-tacos" is still a dinner/));
  assert.ok(says(check((d) => { d.recipes.renamed['old-thing'] = 'pepper-steak'; }), /renamed: "old-thing" must be in RETIRED_DINNERS/));
  assert.ok(says(check((d) => { d.recipes.renamed['turkey-chili'] = 'nowhere'; }), /points at "nowhere", which is not a dinner/));
});

test('turkey stays what it is: Jeff’s lunch meat, in nobody else’s lunch rotation', () => {
  assert.ok(catalog.deliTurkey && catalog.bhSalsalitoTurkey, 'the lunch meats stay in the catalog');
  assert.ok(catalog.groundTurkey && catalog.turkeySausage, 'unused ids stay so receipts and the pantry still match');
  assert.ok(lunches.defaults.Jeff.slots.main.includes('bh-salsalito-turkey-sandwich'));
  for (const [name, d] of Object.entries(lunches.defaults)) {
    if (name === 'Jeff') continue;
    for (const ids of Object.values(d.slots)) for (const id of ids) assert.ok(!/turkey/i.test(id + text(lunchItem(db, {}, id).items)), `${name}: ${id}`);
  }
  assert.ok(says(check((d) => { d.lunches.defaults.Knox.slots.main.push('turkey-cheese-wrap'); }), /defaults\.Knox\.main: "turkey-cheese-wrap" is turkey, which only Jeff eats for lunch/));
  assert.ok(says(check((d) => { d.lunches.defaults.Candi.slots.main = ['bonduelle-chef-turkey-ham']; }), /defaults\.Candi\.main: "bonduelle-chef-turkey-ham" is turkey/));
  assert.deepEqual(check((d) => { d.lunches.defaults.Jeff.slots.main.push('turkey-cheese-wrap'); }).errors, []);
});

// ---------------------------------------------------------------- little pork

test('a handful of pork dinners in the core rotation, the pulled pork among them; the rest are on the bench', () => {
  const PORK = ['pork', 'porkLoin', 'groundPork', 'pulledPork', 'italianSausage', 'chorizo', 'smokedSausage'];
  const core = db.dinnerList.filter((d) => d.rotation === 'core' && Object.keys(d.items).some((id) => PORK.includes(id))).map((d) => d.id);
  assert.ok(core.length <= MAX_CORE_PORK && MAX_CORE_PORK <= 5, `${core.length} core pork dinners: ${core}`);
  assert.ok(core.includes('jd-pulled-pork-sandwiches'), 'the pulled pork in the freezer stays');
  assert.deepEqual(db.dinnerList.filter((d) => d.rotation === 'core' && d.protein === 'pork').map((d) => d.id).sort(), ['jd-pulled-pork-sandwiches', 'mustard-pork-apples']);
  for (const id of ['apple-glazed-pork-chops', 'cooker-braised-pork-apples', 'sweet-sour-pork', 'pork-carnitas-tacos', 'pork-souvlaki-plates', 'breaded-pork-sandwiches', 'honey-garlic-pork-chops']) assert.equal(db.dinners[id].rotation, 'bench', id);
  // The two that had to stay core (prototype ids) changed their meat instead.
  assert.equal(db.dinners['egg-fried-rice'].protein, 'beef');
  assert.ok(db.dinners['egg-fried-rice'].items.sirloinTip > 0 && !db.dinners['egg-fried-rice'].items.porkLoin);
  assert.equal(db.dinners['veggie-chow-mein'].protein, 'chicken');
  assert.ok(db.dinners['veggie-chow-mein'].items.chickenThighs > 0);
  assert.ok(!/pork/i.test(text(db.dinners['egg-fried-rice']) + text(db.dinners['veggie-chow-mein'])));
  // Chicken versions of the two pork dinners that left the rotation's grill nights.
  assert.equal(db.dinners['apple-glazed-chicken-thighs'].rotation, 'core');
  assert.equal(db.dinners['honey-mustard-chicken-thighs'].rotation, 'core');
});

test('the validator holds the pork line', () => {
  assert.ok(says(check((d) => { dinner(d, 'apple-glazed-pork-chops').rotation = 'core'; }), /5 pork dinners in the core rotation .*at most 4: move the rest to the bench/));
  assert.ok(says(check((d) => { dinner(d, 'jd-pulled-pork-sandwiches').rotation = 'bench'; }), /jd-pulled-pork-sandwiches: stays in the core rotation/));
  assert.deepEqual(check((d) => { dinner(d, 'chorizo-nopalitos-tacos').rotation = 'bench'; dinner(d, 'apple-glazed-pork-chops').rotation = 'core'; }).errors, []);
});

// ---------------------------------------------------------------- the BLT bowl, minus the T

test('the Bonduelle Chicken BLT bowl is back for Jeff, with the tomatoes left out', () => {
  const it = lunches.items.find((x) => x.id === 'bonduelle-chicken-blt');
  assert.deepEqual(it.people, ['Jeff']);
  assert.deepEqual(TOMATO_LEFT_OUT['bonduelle-chicken-blt'], ['Jeff']);
  assert.match(it.prep, /leave the tomatoes out/);
  assert.match(it.title, /hold the tomatoes/);
  assert.ok(!/tomato/i.test(it.photo), 'the picture is described without tomatoes');
  assert.deepEqual(rawProduce(it.photo, { picture: true }), []);
  const item = lunchItem(db, {}, 'bonduelle-chicken-blt');
  assert.deepEqual(item.items, { bonduelleBltBowl: 1 });
  assert.equal(db.photos.lunches['bonduelle-chicken-blt'].src, 'img/lunch/bonduelle-chicken-blt.webp');
  assert.deepEqual(webpSize('img/lunch/bonduelle-chicken-blt.webp'), [640, 640]);
  // Only Jeff can have it, and nobody gets it by default.
  for (const [name, d] of Object.entries(lunches.defaults)) if (name !== 'Jeff') for (const ids of Object.values(d.slots)) assert.ok(!ids.includes('bonduelle-chicken-blt'), name);
  // In Jeff's rotation it plans and shops like any other lunch.
  const state = { lunch: { people: { Jeff: { slots: { main: ['bonduelle-chicken-blt'] } } } } };
  assert.deepEqual(personConfig(db, state, 'Jeff').slots.main, ['bonduelle-chicken-blt']);
  assert.equal(lunchFor(db, state, 'Jeff', '2026-11-17').slots.find((s) => s.slot === 'main')?.id ?? lunchFor(db, state, 'Jeff', '2026-11-17').slots[0].id, 'bonduelle-chicken-blt');
  // The Taylor Farms bowl stays out.
  assert.equal(lunchItem(db, {}, 'tf-blt-chicken-bowl'), null);
});

test('the one exception is exactly that: explicit, for Jeff, and gone the moment its words change', () => {
  const blt = (d) => lunch(d, 'bonduelle-chicken-blt');
  assert.ok(says(check((d) => { blt(d).prep = 'Grab one from the fridge: the fork and ranch are inside.'; }), /bonduelle-chicken-blt: comes with raw tomato, so its prep must say to leave the tomatoes out/));
  assert.ok(says(check((d) => { delete blt(d).people; }), /bonduelle-chicken-blt: comes with raw tomato, so it is for Jeff only/));
  assert.ok(says(check((d) => { blt(d).people = ['Jeff', 'Knox']; }), /it is for Jeff only/));
  assert.ok(says(check((d) => { d.lunches.defaults.Knox.slots.main.push('bonduelle-chicken-blt'); }), /defaults\.Knox\.main: "bonduelle-chicken-blt" is for Jeff only/));
  assert.ok(says(check((d) => { blt(d).people = ['Grandpa']; }), /people names "Grandpa", who is not in lunches\.defaults/));
  assert.deepEqual(check((d) => { d.lunches.defaults.Jeff.slots.main.push('bonduelle-chicken-blt'); }).errors, []);
  // Other wordings that plainly say it pass; a new lunch made from the same bowl does not.
  for (const prep of ['Pick the tomatoes off before you eat it.', 'Eat it without the tomatoes.', 'Hold the tomatoes: take them off the top.']) assert.deepEqual(check((d) => { blt(d).prep = prep; }).errors, [], prep);
  assert.ok(says(check((d) => { d.lunches.items.push({ ...blt(d), id: 'blt-bowl-again' }); }), /blt-bowl-again: uses bonduelleBltBowl, which comes with raw tomato/));
  assert.ok(says(check((d) => { d.lunches.items.push({ id: 'tf-blt-chicken-bowl', slot: 'main', title: 'BLT chicken salad bowl', items: { tfBltChickenBowl: 1 }, prep: 'Leave the tomatoes out.', people: ['Jeff'], photo: 'A salad bowl of romaine, bacon bits, cheddar and grilled chicken with a ranch cup.' }); }), /tf-blt-chicken-bowl: uses tfBltChickenBowl, which comes with raw tomato/));
});

test('the raw-tomato rule is as strict as it was everywhere else', () => {
  // The exception's own words and picture are still read.
  assert.ok(says(check((d) => { lunch(d, 'bonduelle-chicken-blt').subtitle = 'Chicken, bacon and grape tomatoes with buttermilk ranch.'; }), /bonduelle-chicken-blt\.subtitle: no raw tomato/));
  assert.ok(says(check((d) => { lunch(d, 'bonduelle-chicken-blt').photo = 'A clear salad bowl with lettuce, chicken strips, bacon and tomatoes, a ranch cup on top.'; }), /bonduelle-chicken-blt\.photo: no raw tomato/));
  // Dinners, sides and every other lunch.
  assert.ok(says(check((d) => { dinner(d, 'beef-tacos').items.tomato = 0.5; }), /beef-tacos: uses tomato/));
  assert.ok(says(check((d) => { dinner(d, 'beef-tacos').steps.push('Top each taco with chopped tomatoes.'); }), /beef-tacos: no raw tomato/));
  assert.ok(says(check((d) => { side(d, 'romaine-salad').items.bonduelleBltBowl = 1; }), /romaine-salad: uses bonduelleBltBowl, which comes with raw tomato/));
  assert.ok(says(check((d) => { lunch(d, 'bonduelle-chef-turkey-ham').subtitle = 'Turkey, ham and cherry tomatoes with creamy ranch. 250 cal, 12 g protein.'; }), /bonduelle-chef-turkey-ham\.subtitle: no raw tomato/));
  assert.ok(says(check((d) => { lunch(d, 'bonduelle-chef-turkey-ham').items.tomato = 1; }), /bonduelle-chef-turkey-ham: uses tomato/));
  for (const d of [...db.dinnerList, ...db.sideList]) assert.ok(!d.items.tomato && !d.items.cucumber, d.id);
});

// ---------------------------------------------------------------- Wish-Bone ranch

test('the family’s ranch is Wish-Bone; the Hidden Valley bottle still matches', () => {
  const r = catalog.ranch;
  assert.equal(r.brand, 'Wish-Bone');
  assert.match(r.name, /Wish-Bone/);
  assert.match(r.packs[r.usual.store][r.usual.tier].label, /Wish-Bone Ranch Dressing, 15 fl oz/);
  assert.equal(r.packs[r.usual.store][r.usual.tier].size, 30, '15 fl oz is 30 tablespoons');
  for (const a of ['wish-bone ranch', 'wishbone ranch', 'hidden valley ranch', 'ranch']) assert.ok(r.aliases.includes(a), a);
  assert.match(catalog.lightRanch.packs.jewel.name.label, /Wish-Bone Light Ranch/);
  for (const d of [...recipes.dinners, ...recipes.sides, ...lunches.items]) assert.ok(!/hidden valley/i.test(text(d)), d.id);
  assert.match(db.dinners['buffalo-chicken-wraps'].subtitle, /Wish-Bone ranch/);
});

test('the validator keeps the ranch straight', () => {
  assert.ok(says(check((d) => { dinner(d, 'buffalo-chicken-wraps').subtitle = 'Griddled chicken with Hidden Valley ranch.'; }), /buffalo-chicken-wraps\.subtitle: names Hidden Valley; the family's ranch is Wish-Bone/));
  assert.ok(says(check((d) => { side(d, 'carrot-sticks').steps[1] = 'Divide among five plates with a spoonful of Hidden Valley ranch for dipping.'; }), /carrot-sticks\.steps\[2\]: names Hidden Valley/));
  assert.ok(says(check((d) => { lunch(d, 'baby-carrots-light-ranch').prep = 'Pack 3 oz baby carrots and 2 tbsp Hidden Valley light ranch.'; }), /baby-carrots-light-ranch\.prep: names Hidden Valley/));
  assert.ok(says(check((d) => { d.catalog.ingredients.ranch.brand = 'Hidden Valley'; }), /catalog\.ranch: brand must be Wish-Bone/));
  assert.ok(says(check((d) => { d.catalog.ingredients.ranch.usual = { store: 'sams', tier: 'name' }; }), /catalog\.ranch: its usual pack must be the Wish-Bone bottle/));
  assert.ok(says(check((d) => { const r = d.catalog.ingredients.ranch; r.aliases = r.aliases.filter((a) => !/hidden valley/.test(a)); }), /"hidden valley ranch" must stay an alias/));
  assert.ok(says(check((d) => { const r = d.catalog.ingredients.ranch; r.aliases = r.aliases.filter((a) => !/wish/.test(a)); }), /needs a Wish-Bone alias/));
  // data/prices.json lays its pack over the catalog's: the validator says so until that file agrees.
  const stale = check((d) => { d.prices = { prices: { ranch: { jewel: { name: { size: 32, price: 4.49, label: 'Hidden Valley Original Ranch, 16 fl oz' } } } } }; });
  assert.ok(stale.warnings.some((w) => /data\/prices\.json: ranch\.jewel\.name is "Hidden Valley/.test(w)));
  const agreed = check((d) => { d.prices = { prices: { ranch: { jewel: { name: { size: 30, price: 3.99, label: 'Wish-Bone Ranch Dressing, 15 fl oz' } } } } }; });
  assert.ok(!agreed.warnings.some((w) => /prices\.json: ranch/.test(w)));
});

// ---------------------------------------------------------------- Sam's Club bulk

test('the bulk buys are in the catalog honestly: real Sam’s packs, read prices marked as read, the rest as estimates', () => {
  const LISTED = { stewMeat: [3.7, 25.79, 6.97], sirloinTip: [4.28, 29.83, 6.97], chuckRoast: [3.7, 27.64, 7.47], groundChicken: [3, 11.76, 3.92] };
  for (const [id, [size, price, perLb]] of Object.entries(LISTED)) {
    const p = catalog[id].packs.sams.generic;
    assert.deepEqual([p.size, p.price], [size, price], id);
    assert.ok(Math.abs(price / size - perLb) < 0.03, `${id} is $${perLb}/lb`);
    assert.equal(p.confidence, 'listed', id);
    assert.match(p.url, /^https:\/\/www\.samsclub\.com\/ip\//, id);
    assert.ok(!/\(est\.?\)|price est/.test(p.label), `${id}: a price read from the store is not called an estimate`);
    assert.equal(catalog[id].meat, true);
    assert.equal(catalog[id].defaultStore, 'sams');
    assert.equal(db.ingredients[id].packs.sams.generic.confidence, 'listed', 'the app knows it too');
  }
  // Everything else new is an estimate and says so on the label.
  const estimates = [['stewMeat', 'jewel'], ['sirloinTip', 'jewel'], ['chuckRoast', 'jewel'], ['groundChicken', 'jewel'], ['chickenSausage', 'jewel'], ['stirFryVeg', 'sams'], ['stirFryVeg', 'jewel'], ['normandyVeg', 'sams'], ['normandyVeg', 'jewel']];
  for (const [id, st] of estimates) for (const tier of ['generic', 'name']) {
    const p = catalog[id].packs[st][tier];
    assert.ok(p.size > 0 && p.price > 0, `${id} ${st}`);
    assert.match(p.label, /\(est\.\)|price est/, `${id} ${st} ${tier} is marked as an estimate`);
    assert.notEqual(p.confidence, 'listed');
  }
  assert.match(catalog.stirFryVeg.packs.sams.generic.label, /Member's Mark Stir Fry Mix, frozen, 5 × 16 oz/);
  assert.match(catalog.normandyVeg.packs.sams.generic.label, /Member's Mark Broccoli Normandy, frozen, 4 lb/);
  for (const id of ['stewMeat', 'sirloinTip', 'chuckRoast', 'groundChicken', 'chickenSausage', 'stirFryVeg', 'normandyVeg']) {
    const n = db.nutrition.per[id];
    assert.ok(n.kcal > 0 && n.protein > 0 && n.carbs >= 0 && n.fat >= 0 && n.fiber >= 0, `${id} has nutrition`);
    assert.ok(db.dinnerList.some((d) => d.items[id]) || db.sideList.some((s) => s.items[id]), `${id} is used`);
    assert.ok(catalog[id].aliases.length >= 4, `${id} matches a receipt by several names`);
  }
  assert.ok(says(check((d) => { delete d.catalog.ingredients.stewMeat.packs.sams.generic.url; }), /stewMeat: packs\.sams\.generic says its price was read from the store \("listed"\) but has no url/));
});

test('"bulk" says how to portion or keep each Sam’s pack, in meal-size freezer bags where it freezes', () => {
  const withBulk = Object.entries(catalog).filter(([, i]) => i.bulk);
  assert.ok(withBulk.length >= 18, `${withBulk.length} bulk items`);
  for (const [id, ing] of withBulk) {
    assert.ok(ing.packs.sams, `${id} has a Sam's pack`);
    assert.equal(typeof ing.bulk.freezes, 'boolean');
    assert.ok(ing.bulk.note.length >= 20, id);
    if (ing.bulk.portionLb !== undefined) {
      assert.equal(ing.unit, 'lb', id);
      assert.ok(ing.bulk.freezes && ing.bulk.portionLb > 0 && ing.bulk.portionLb <= ing.packs.sams.generic.size, id);
    }
  }
  // The meats come in meal-size bags; the vegetables and the pantry sacks say how they keep.
  for (const id of ['stewMeat', 'sirloinTip', 'chuckRoast', 'chickenThighs', 'chicken', 'eyeRoundSteak', 'porkLoin']) assert.equal(catalog[id].bulk.portionLb, 2.25, id);
  for (const id of ['groundChicken', 'beef']) assert.equal(catalog[id].bulk.portionLb, 1, id);
  for (const id of ['broccoli', 'vegetables', 'stirFryVeg', 'normandyVeg', 'beefPatties']) assert.deepEqual([catalog[id].bulk.freezes, catalog[id].bulk.portionLb], [true, undefined], id);
  for (const id of ['potatoes', 'onions', 'carrots', 'jasmine']) assert.equal(catalog[id].bulk.freezes, false, id);

  const bulk = (d, id) => d.catalog.ingredients[id].bulk;
  assert.ok(says(check((d) => { bulk(d, 'stewMeat').portionLb = 9; }), /stewMeat: bulk\.portionLb must be more than 0 and no more than the Sam's pack/));
  assert.ok(says(check((d) => { delete bulk(d, 'stewMeat').portionLb; }), /stewMeat: bulk meat sold by the pound needs bulk\.portionLb/));
  assert.ok(says(check((d) => { bulk(d, 'jasmine').portionLb = 2; }), /jasmine: bulk\.portionLb is for items sold by the pound/));
  assert.ok(says(check((d) => { bulk(d, 'potatoes').portionLb = 2; }), /potatoes: bulk\.portionLb is a freezer-bag size, so bulk\.freezes must be true/));
  assert.ok(says(check((d) => { bulk(d, 'carrots').note = 'Keeps.'; }), /carrots: bulk\.note must say how to portion or keep the pack/));
  assert.ok(says(check((d) => { bulk(d, 'carrots').size = 5; }), /carrots: bulk has an unknown field "size"/));
  assert.ok(says(check((d) => { d.catalog.ingredients.chickenSausage.bulk = { freezes: true, note: 'Freeze the links in their pack for a month.' }; }), /chickenSausage: bulk needs a Sam's Club pack/));
});

test('a dinner is tagged "bulk" exactly when its raw meat comes from a Sam’s bulk pack', () => {
  for (const d of db.dinnerList) {
    const fromBulk = Object.keys(d.items).some((id) => catalog[id]?.meat && !catalog[id]?.cooked && catalog[id]?.bulk);
    assert.equal(d.tags.includes('bulk'), fromBulk, d.id);
  }
  // Heat-and-serve meats and Jewel-only packs are not bulk buys.
  for (const id of ['jd-pulled-pork-sandwiches', 'chicken-alfredo-night', 'chicago-italian-beef', 'sausage-pepper-hoagies', 'chicken-fajitas']) assert.ok(!db.dinners[id].tags.includes('bulk'), id);
  assert.ok(says(check((d) => { dinner(d, 'chicago-italian-beef').tags.push('bulk'); }), /chicago-italian-beef: tagged "bulk" but none of its meat comes from a Sam's bulk pack/));
  assert.ok(says(check((d) => { const t = dinner(d, 'pepper-steak').tags; t.splice(t.indexOf('bulk'), 1); }), /pepper-steak: its sirloinTip comes from a Sam's bulk pack, so it must be tagged "bulk"/));
  assert.ok(says(check((d) => { dinner(d, 'cooker-beef-tips-gravy').leftovers = 'Keeps 4 days in the fridge in a covered container.'; }), /cooker-beef-tips-gravy: tagged "freezer friendly" but leftovers doesn't say how to freeze it/));
});

test('ten dinners are built on the bulk buys: no oven, lean plates, a vegetable, and steps a nervous cook can follow', () => {
  const HOUSE_EQUIPMENT = new Set(EQUIPMENT);
  for (const id of NEW_DINNERS) {
    const d = db.dinners[id];
    assert.ok(d, id);
    assert.equal(d.rotation, 'core', id);
    assert.ok(d.tags.includes('bulk'), `${id} is tagged bulk`);
    assert.ok(d.equipment.length && d.equipment.every((e) => HOUSE_EQUIPMENT.has(e)), `${id}: ${d.equipment}`);
    assert.ok(!/\boven\b|broil|baking sheet|sheet pan/i.test(text(d)), `${id}: no oven`);
    // The meat is one of the Sam's bulk cuts, in a normal portion for five.
    const meat = Object.keys(d.items).filter((x) => catalog[x].meat);
    assert.equal(meat.length, 1, id);
    assert.ok(['stewMeat', 'sirloinTip', 'chuckRoast', 'chickenThighs', 'chicken'].includes(meat[0]), `${id}: ${meat}`);
    assert.ok(d.items[meat[0]] >= 1.75 && d.items[meat[0]] <= 2.25, `${id}: ${d.items[meat[0]]} lb`);
    assert.match(d.steps.join(' '), meat[0].startsWith('chicken') ? /165°F/ : /145°F/, `${id} states its safe temperature`);
    // Detailed steps: amounts named, timers, a setting on every heat step, tips and leftovers.
    assert.ok(d.steps.length >= 4 && d.stepDetail.length === d.steps.length, id);
    assert.ok(d.stepDetail.some((s) => s.minutes > 0), `${id} has a timer`);
    assert.ok(d.stepDetail.some((s) => s.setting && s.minutes > 0), `${id} names the setting on its heat step`);
    assert.match(d.steps.join(' '), /\b(2¼|2|1¾) lb\b/, `${id} names the amount of meat`);
    assert.ok(d.tips.length >= 3 && d.tips.length <= 4 && d.leftovers.length > 40, id);
    assert.equal(d.prepMinutes + d.cookMinutes, d.minutes, id);
    assert.ok(handsOnMinutes(d) <= 20, `${id}: ${handsOnMinutes(d)} hands-on minutes`);
    // Two default sides, one of them a vegetable or a salad.
    assert.equal(d.sides.length, 2, id);
    assert.ok(d.sides.some((s) => ['vegetable', 'salad'].includes(db.sides[s].kind)), id);
    const plate = plateHealth(db, {}, id, null);
    assert.ok(plate.kcal >= 550 && plate.kcal <= 850, `${id}: ${plate.kcal} kcal`);
    assert.ok(plate.proteinG >= 40, `${id}: ${plate.proteinG} g protein`);
    assert.ok(plate.vegServings >= 1.5, `${id}: ${plate.vegServings} vegetable servings`);
  }
  assert.ok(NEW_DINNERS.filter((id) => plateHealth(db, {}, id, null).lean).length >= 7, 'most of them are lean plates');
  // Four in the PossibleCooker with exact settings, the rest on the griddle, grill, air fryer and stove.
  const cooker = NEW_DINNERS.filter((id) => db.dinners[id].equipment.includes('possible cooker'));
  assert.deepEqual(cooker.sort(), ['cooker-beef-tips-gravy', 'cooker-chicken-potatoes-carrots', 'cooker-chunky-beef-chili', 'cooker-pot-roast']);
  for (const id of cooker) {
    const slow = db.dinners[id].stepDetail.find((s) => s.setting === 'SLOW COOK on LO');
    assert.ok(slow && slow.minutes >= 360 && slow.minutes <= 480, id);
    assert.match(db.dinners[id].steps.join(' '), /or use HI for \d(½)? hours/, `${id} gives the faster setting`);
    assert.ok(db.dinners[id].sides.every((s) => !db.sides[s].equipment.includes('possible cooker')), `${id}: its sides don't need the pot`);
  }
  for (const id of ['cooker-beef-tips-gravy', 'cooker-chunky-beef-chili']) {
    assert.ok(db.dinners[id].tags.includes('freezer friendly'), id);
    assert.match(db.dinners[id].leftovers, /freez/, id);
  }
  assert.ok(db.dinners['cooker-chunky-beef-chili'].tips.some((t) => /double/i.test(t)), 'the chili says how to make a big batch');
  // The bulk vegetables are on the table too.
  assert.equal(db.dinners['chicken-vegetable-stir-fry'].items.stirFryVeg, 2);
  assert.ok(db.dinners['griddle-steaks-mushrooms'].sides.includes('steamed-normandy-vegetables'));
  assert.ok(['potatoes', 'carrots', 'onions'].every((x) => db.dinners['cooker-pot-roast'].items[x] > 0 && db.dinners['cooker-chicken-potatoes-carrots'].items[x] > 0));
});

test('every new or changed dish has its picture, in the app’s sizes', () => {
  for (const id of [...NEW_DINNERS, 'egg-fried-rice', ...Object.values(RENAMED)]) {
    assert.equal(db.photos.dinners[id].src, `img/dinners/${id}.webp`, id);
    assert.deepEqual(webpSize(`img/dinners/${id}.webp`), [1200, 800], id);
    assert.deepEqual(webpSize(`img/dinners/${id}-640.webp`), [640, 427], id);
  }
  assert.deepEqual(webpSize('img/sides/steamed-normandy-vegetables.webp'), [640, 640]);
  const jobs = read('dev/photo-jobs.json');
  for (const id of [...NEW_DINNERS, 'egg-fried-rice', 'steamed-normandy-vegetables', 'bonduelle-chicken-blt']) {
    const j = jobs.find((x) => x.id === id);
    assert.ok(j && j.done === '2026-11-15', `${id}: its job is done`);
    assert.match(j.prompt, /Do not show cucumber, raw tomato, raw onion or scallions/);
  }
  assert.ok(!jobs.some((j) => /turkey/i.test(j.id) && j.kind === 'dinner'), 'no job points at a retired id');
  assert.ok(!text(jobs.filter((j) => j.kind !== 'lunch')).match(/turkey/i), 'no dinner or side prompt describes turkey');
});

// ---------------------------------------------------------------- STEAM

test('steamed sides in the PossibleCooker use its STEAM setting', () => {
  for (const id of ['steamed-carrots', 'cooker-green-beans', 'steamed-normandy-vegetables']) {
    const s = db.sides[id];
    assert.deepEqual(s.equipment, ['possible cooker'], id);
    const steam = s.stepDetail.find((x) => x.setting === 'STEAM');
    assert.ok(steam && steam.minutes >= 10 && steam.minutes <= 15, id);
    assert.match(steam.text, /1 cup of water.*put the lid on\. Select STEAM, set the time to \d+ minutes and press START\/STOP/, id);
    assert.ok(!s.stepDetail.some((x) => /SEAR/.test(x.setting || '')), `${id} no longer steams on SEAR/SAUTÉ`);
    assert.ok(!text(s).includes('If your panel has'), `${id}: the button is confirmed`);
  }
  // The stovetop steamed sides stay on the stove (the cooker is often busy with dinner) and say the cooker can do it.
  for (const id of ['steamed-broccoli', 'steamed-mixed-vegetables']) {
    assert.deepEqual(db.sides[id].equipment, ['stovetop'], id);
    assert.match(db.sides[id].tips.join(' '), /STEAM for 6 minutes/, id);
  }
  assert.ok(says(check((d) => { side(d, 'steamed-carrots').steps[1].setting = 'SEAR/SAUTÉ on HI'; }), /steamed-carrots: a steamed dish in the PossibleCooker uses its STEAM setting/));
  assert.ok(says(check((d) => { const s = side(d, 'cooker-green-beans').steps[1]; s.setting = 'SEAR/SAUTÉ on HI'; s.text = 'Add 1 cup of water and the beans, put the lid on and cook on SEAR/SAUTÉ. Once steam is coming from under the lid, cook 6 minutes more.'; }), /cooker-green-beans: a step steams on SEAR\/SAUTÉ on HI; use the STEAM setting/));
  assert.ok(says(check((d) => { side(d, 'steamed-broccoli').steps[1].setting = 'STEAM'; }), /steamed-broccoli: a step is set to "STEAM" but equipment does not list "possible cooker"/));
});
