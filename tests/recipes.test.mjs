// The recipe box (docs/spec/18-recipe-box.md): house rules, detailed steps, the PossibleCooker,
// per-plate nutrition and the picture queue. The validator's rules are tested on doctored copies
// of the real data, so a rule can't quietly stop catching what it was written for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, realDb } from './helpers.mjs';
import { buildDb, normalizeDinner, normalizeSide, normalizeSteps, normalizeNutrition, stepMinutes, handsOnMinutes, fmtMinutes } from '../app/data.js';
import { dinnerById, effectiveSides, itemsForNight } from '../app/planner.js';
import { plateHealth, plateNutrition, itemsMacros, lunchMacros, LEAN_RULE, VEG_SERVING_GRAMS, PLATES } from '../app/nutrition.js';
import { lunchItem } from '../app/lunch.js';
import { buildList } from '../app/shopping.js';
import { EQUIPMENT_LABELS } from '../app/config.js';
import { EQUIPMENT_ICON, icon } from '../app/icons.js';
import { photo } from '../app/ui.js';
import { normalizeIdea } from '../app/ideas.js';
import { validateData, loadData, bannedWords, rawProduce, COOKER_SETTING, RETIRED_DINNERS, EQUIPMENT } from '../scripts/validate-data.mjs';

const db = realDb();
const disk = loadData();
const read = (p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const recipes = read('data/recipes.json');
const KEYS = ['catalog', 'recipes', 'lunches', 'nutrition', 'prices', 'photos', 'photoJobs', 'ref'];
/** The validator's verdict on the real data after `change` has doctored a copy of it. */
function check(change = () => {}) {
  const copy = structuredClone(Object.fromEntries(KEYS.map((k) => [k, disk[k]])));
  change(copy);
  return validateData({ ...copy, fileExists: disk.fileExists });
}
const dinner = (d, id) => d.recipes.dinners.find((x) => x.id === id);
const side = (d, id) => d.recipes.sides.find((x) => x.id === id);
const says = (res, re) => res.errors.some((e) => re.test(e));
const cookerDinners = () => db.dinnerList.filter((d) => d.equipment.includes('possible cooker'));

// ---------------------------------------------------------------- the data as it stands

test('the recipe box passes every rule', () => {
  const res = check();
  assert.deepEqual(res.errors, []);
  assert.ok(res.stats.core >= 50 && res.stats.bench >= 20);
});

test('the two tofu-named dinners are gone, everywhere', () => {
  for (const id of ['sesame-tofu-noodles', 'orange-tofu-bowls']) {
    assert.equal(db.dinners[id], undefined, id);
    assert.ok(RETIRED_DINNERS[id], `${id} is retired by name`);
    assert.equal(db.photos.dinners[id], undefined, 'no picture entry');
    assert.ok(!existsSync(path.join(ROOT, `img/dinners/${id}.webp`)), 'no picture file');
  }
  for (const d of [...db.dinnerList, ...db.sideList, ...db.lunch.itemList]) assert.deepEqual(bannedWords(d.id), [], d.id);
});

test('a night the family planned with a removed dinner neither breaks the list nor the plate', () => {
  const state = { plan: { '2026-11-16': { dinner: 'sesame-tofu-noodles', status: 'planned', by: 'Jeff', at: 'x' }, '2026-11-17': { dinner: 'tikka-masala', status: 'planned', by: 'Jeff', at: 'x' } } };
  assert.equal(dinnerById(db, state, 'sesame-tofu-noodles'), null);
  assert.deepEqual(itemsForNight(db, state, 'sesame-tofu-noodles', state.plan['2026-11-16']), {});
  assert.equal(plateHealth(db, state, 'sesame-tofu-noodles', state.plan['2026-11-16']), null);
  const list = buildList(db, state, { dates: ['2026-11-16', '2026-11-17'], listKey: 'k', today: '2026-11-15' });
  assert.ok(list.items.some((i) => i.id === 'tikka'), 'the other night still shops');
});

// ---------------------------------------------------------------- why the validator let tofu through, and that it can't again

test('validator: an id is text too, and the reference list can no longer force a retired dinner back', () => {
  // Before v3 only titles and steps were read, and the reference-id rule required these two ids to exist.
  const back = check((d) => d.recipes.dinners.push({ ...structuredClone(dinner(d, 'orange-chicken')), id: 'orange-tofu-bowls' }));
  assert.ok(says(back, /dinner orange-tofu-bowls \(id\): banned word "tofu"/));
  assert.ok(says(back, /orange-tofu-bowls: this dinner was removed for good/));
  const renamed = check((d) => { dinner(d, 'orange-chicken').id = 'crispy-tofu-bites'; });
  assert.ok(says(renamed, /crispy-tofu-bites \(id\): banned word "tofu"/));
  // The reference rule still guards every other prototype id.
  const dropped = check((d) => { d.recipes.dinners = d.recipes.dinners.filter((x) => x.id !== 'classic-spaghetti'); });
  assert.ok(says(dropped, /reference dinner id "classic-spaghetti" missing/));
  assert.ok(!says(check(), /reference dinner id/));
});

test('validator: every field of a dish is read, including ones added later', () => {
  for (const [field, value, word] of [
    ['tips', ['Finish it under the oven broiler for color.'], 'oven'], ['leftovers', 'Flake it into a tuna-style salad the next day.', 'tuna'],
    ['subtitle', 'Like a Caesar, but warm.', 'Caesar'], ['brandNewField', 'a splash of fish sauce', 'fish'], ['photo', 'Crispy tofu cubes on rice in a bowl, glossy with sauce.', 'tofu'],
  ]) {
    const res = check((d) => { dinner(d, 'orange-chicken')[field] = value; });
    assert.ok(says(res, new RegExp(`orange-chicken.*banned word "${word}"`)), `${field}: ${word}`);
  }
  const step = check((d) => { dinner(d, 'orange-chicken').steps[2] = { text: 'Bake in a 400°F oven for 20 minutes.', setting: 'Oven 400°F' }; });
  assert.ok(says(step, /orange-chicken.*banned word "oven"/));
  const seafood = check((d) => { side(d, 'edamame').steps.push('Drizzle with a spoonful of oyster sauce.'); });
  assert.ok(says(seafood, /side edamame.*banned word "oyster"/));
  assert.deepEqual(bannedWords('Barbecue sauce (seafood-free)'), [], 'the one allowed seafood phrase');
  assert.deepEqual(bannedWords('Finish with a drizzle and finish plating.'), [], '"finish" is not fish');
});

test('validator: no raw cucumber, onion or tomato in a recipe, a lunch or a picture', () => {
  assert.deepEqual(rawProduce('Top with diced onion and serve.'), ['raw onion']);
  assert.deepEqual(rawProduce('Add the diced onion and cook until soft, 5 minutes.'), []);
  assert.deepEqual(rawProduce('Garnish with sliced scallions.'), ['raw onion']);
  assert.deepEqual(rawProduce('Add the 2 cans of diced tomatoes with their juice.'), []);
  assert.deepEqual(rawProduce('Serve with sliced tomatoes and cucumber spears.').sort(), ['cucumber', 'raw tomato']);
  assert.deepEqual(rawProduce('Top with dill pickle chips.'), [], 'pickles are fine');
  // In a picture, an onion or tomato has to be called cooked right there.
  assert.deepEqual(rawProduce('A burger with lettuce and onion on a bun.', { picture: true }), ['raw onion']);
  assert.deepEqual(rawProduce('A hoagie with charred peppers and onions.', { picture: true }), []);
  assert.deepEqual(rawProduce('Warm naan topped with chicken and red onion.', { picture: true }), ['raw onion'], '"warm" naan does not cook the onion');
  assert.deepEqual(rawProduce('A salad with tomato and egg.', { picture: true }), ['raw tomato']);
  assert.deepEqual(rawProduce('Penne in a chunky tomato sauce.', { picture: true }), []);
  for (const d of [...recipes.dinners, ...recipes.sides]) assert.deepEqual(rawProduce(d.photo, { picture: true }), [], `${d.id} photo`);

  assert.ok(says(check((d) => { dinner(d, 'beef-tacos').steps.push('Top each taco with chopped onion and fresh tomato.'); }), /beef-tacos: no raw onion/));
  assert.ok(says(check((d) => { dinner(d, 'beef-tacos').tips = ['Add cucumber slices for crunch.']; }), /beef-tacos: no cucumber/));
  assert.ok(says(check((d) => { side(d, 'romaine-salad').photo = 'A bowl of chopped romaine with cucumber slices and lemon.'; }), /romaine-salad\.photo: no cucumber/));
  assert.ok(says(check((d) => { side(d, 'romaine-salad').items.cucumber = 1; }), /romaine-salad: uses cucumber/));
  const lunch = check((d) => { d.lunches.items[0].subtitle = 'Ham, cheddar and grape tomatoes.'; });
  assert.ok(says(lunch, /lunch bh-black-forest-ham-sandwich\.subtitle: no raw tomato/));
  assert.ok(says(check((d) => { d.lunches.items[0].title = 'Chicken Caesar wrap'; }), /lunch .*banned word "Caesar"/));
});

test('lunches: the raw-tomato salad bowls are out, and every lunch still resolves', () => {
  // The Bonduelle BLT bowl came back for Jeff with the tomatoes left out (docs/spec/24, tests/recipes2.test.mjs).
  assert.equal(lunchItem(db, {}, 'tf-blt-chicken-bowl'), null);
  assert.ok(db.lunch.swaps.every((s) => db.lunch.items[s.from] && db.lunch.items[s.to]));
  for (const cfg of Object.values(db.lunch.defaults)) for (const ids of Object.values(cfg.slots)) for (const id of ids) assert.ok(db.lunch.items[id], id);
  const unknown = check((d) => { d.lunches.items[0].items.madeUpThing = 1; });
  assert.ok(says(unknown, /item "madeUpThing" is not in the catalog/));
  assert.ok(says(check((d) => { d.lunches.defaults.Jeff.slots.main.push('tf-blt-chicken-bowl'); }), /"tf-blt-chicken-bowl" is not a lunch item/));
});

test('a calorie or protein number in a lunch\'s own words is the number the app works out', () => {
  // The Salsalito sandwich said "about 550 cal" while its items add up to about 610.
  const said = (re) => db.lunch.itemList.filter((it) => re.test(it.subtitle)).length;
  assert.ok(said(/\d+ cal/) >= 4, 'several lunches state their calories');
  const off = check((d) => { d.lunches.items.find((x) => x.id === 'bh-salsalito-turkey-sandwich').subtitle = 'Turkey on bread. About 550 cal and 35 g protein.'; });
  assert.ok(says(off, /bh-salsalito-turkey-sandwich: says "550 cal" but its items add up to 6\d\d/));
  const protein = check((d) => { d.lunches.items.find((x) => x.id === 'hard-boiled-eggs').subtitle = 'Peeled and ready, 30 g protein.'; });
  assert.ok(says(protein, /hard-boiled-eggs: says "30 g protein" but its items add up to 12 g/));
});

// ---------------------------------------------------------------- healthier dinners

test('every dinner has a vegetable: on the side, or on the burger', () => {
  for (const d of db.dinnerList) {
    const h = plateHealth(db, {}, d.id);
    if (d.tags.includes('burger')) { assert.deepEqual(d.sides, ['jewel-fries'], `${d.id} keeps Jeff's burger rule`); assert.ok(h.vegServings >= 0.4, `${d.id} ${h.vegServings}`); continue; }
    assert.ok(d.sides.some((id) => ['vegetable', 'salad'].includes(db.sides[id].kind)), `${d.id} has a vegetable or salad side`);
    assert.ok(h.vegServings >= 1, `${d.id} ${h.vegServings} servings`);
  }
  const noVeg = check((d) => { dinner(d, 'mustard-pork-apples').sides = ['sweet-potatoes', 'grilled-apples']; });
  assert.ok(says(noVeg, /mustard-pork-apples: neither default side is a vegetable or a salad/));
});

test('the box is lighter than it was, without shrinking the protein', () => {
  const plates = db.dinnerList.map((d) => plateHealth(db, {}, d.id));
  const avg = (k) => plates.reduce((a, p) => a + p[k], 0) / plates.length;
  assert.ok(avg('kcal') < 830, `average plate ${Math.round(avg('kcal'))} kcal (it was 954 before v3)`);
  assert.ok(avg('proteinG') >= 50, `average ${Math.round(avg('proteinG'))} g protein`);
  assert.ok(Math.max(...plates.map((p) => p.kcal)) <= 1000, 'no plate over 1,000 kcal (the old box went to 1,429)');
  assert.ok(Math.min(...plates.map((p) => p.kcal)) >= 500, 'portions stay normal');
  assert.ok(plates.filter((p) => p.lean).length >= 30, `${plates.filter((p) => p.lean).length} lean plates`);
  // comfort nights are still there
  assert.ok(db.dinnerList.filter((d) => d.tags.includes('burger') && d.rotation === 'core').length >= 6);
  assert.ok(db.dinnerList.some((d) => d.tags.includes('pizza')));
  const heavy = check((d) => { dinner(d, 'classic-spaghetti').items.spaghetti = 40; });
  assert.ok(says(heavy, /classic-spaghetti: \d+ kcal a plate is over 1000/));
  const noMeat = check((d) => { delete dinner(d, 'classic-spaghetti').items.beef; });
  assert.ok(says(noMeat, /classic-spaghetti: no meat ingredient/));
});

// ---------------------------------------------------------------- the PossibleCooker

test('"possible cooker" is a piece of equipment everywhere equipment is listed', () => {
  assert.ok(EQUIPMENT.includes('possible cooker'));
  assert.equal(EQUIPMENT_LABELS['possible cooker'], 'PossibleCooker');
  assert.ok(icon(EQUIPMENT_ICON['possible cooker']).includes('<svg'), 'it has its own icon');
  assert.notEqual(icon(EQUIPMENT_ICON['possible cooker']), icon('no-such-icon'), 'not the fallback icon');
  for (const d of [...db.dinnerList, ...db.sideList]) for (const e of d.equipment) assert.ok(EQUIPMENT_LABELS[e], `${d.id}: ${e}`);
  // An idea from Claude that says "slow cooker" lands on the family's own cooker.
  const idea = normalizeIdea(db, {}, { title: 'Slow-cooked chicken', items: [{ name: 'Chicken breast', qty: 2, matchId: 'chicken' }], steps: ['Slow cook the chicken to 165°F.'], equipment: ['Slow Cooker', 'possible cooker', 'stove'] });
  assert.deepEqual(idea.equipment, ['possible cooker', 'stovetop']);
});

test('about 14 PossibleCooker dinners, each with real settings a cook can follow', () => {
  const list = cookerDinners();
  assert.ok(list.length >= 14, `${list.length} dinners`);
  assert.ok(db.sideList.filter((s) => s.equipment.includes('possible cooker')).length >= 3, 'a few sides too');
  const used = new Set();
  for (const d of list) {
    const settings = d.stepDetail.map((s) => s.setting).filter((s) => s && COOKER_SETTING.test(s));
    assert.ok(settings.length >= 1, `${d.id} names a cooker setting`);
    settings.forEach((s) => used.add(s));
    for (const s of d.stepDetail.filter((x) => /^SLOW COOK on LO$/.test(x.setting || ''))) {
      assert.ok(s.minutes >= 360 && s.minutes <= 720, `${d.id}: LO runs 6 to 12 hours`);
      assert.match(s.text, /Select SLOW COOK, set it to LO and the time to \d+ hours/);
    }
    assert.ok(d.prepMinutes <= 30, `${d.id}: ${d.prepMinutes} minutes of hands-on work`);
    assert.ok(plateHealth(db, {}, d.id).vegServings >= 1.5, `${d.id} is vegetable-forward`);
    assert.ok(!d.steps.some((t) => /oven/i.test(t)));
  }
  for (const s of ['SLOW COOK on LO', 'SEAR/SAUTÉ on HI', 'BRAISE', 'KEEP WARM']) assert.ok(used.has(s), s);
  assert.ok(list.filter((d) => d.tags.includes('freezer friendly')).length >= 8, 'made for two or three shopping trips a month');
  assert.ok(list.filter((d) => d.tags.includes('soup')).length >= 4);
  assert.ok(list.every((d) => Object.keys(d.items).some((id) => db.ingredients[id].meat)), 'meat in every one');
});

test('validator: cooker settings are real ones, with times the machine allows', () => {
  const id = 'cooker-chicken-tortilla-soup';
  const slowStep = (d) => dinner(d, id).steps.find((s) => s.setting === 'SLOW COOK on LO');
  assert.ok(says(check((d) => { slowStep(d).setting = 'SLOW COOK LOW 6 hours'; }), /is not a PossibleCooker setting/));
  assert.ok(says(check((d) => { slowStep(d).minutes = 120; }), /SLOW COOK on LO needs a time from 6 to 12 hours/));
  assert.ok(says(check((d) => { for (const s of dinner(d, id).steps) if (typeof s === 'object') delete s.setting; }), /uses the PossibleCooker but no step carries its setting/));
  assert.ok(says(check((d) => { dinner(d, 'tikka-masala').steps[3].setting = 'SLOW COOK on HI'; }), /equipment does not list "possible cooker"/));
  assert.ok(says(check((d) => { dinner(d, id).equipment = ['instant pot']; }), /equipment "instant pot" not allowed/));
  for (const s of ['SLOW COOK on LO', 'SLOW COOK on HI', 'SEAR/SAUTÉ on HI', 'SEAR/SAUTÉ on MED', 'BRAISE', 'STEAM', 'WHITE RICE', 'KEEP WARM']) assert.ok(COOKER_SETTING.test(s), s);
  // Jeff's cooker has STEAM (confirmed 2026-11-15): the sides that steam in the pot use it, with the water, the lid and a time.
  for (const id of ['steamed-carrots', 'cooker-green-beans', 'steamed-normandy-vegetables']) {
    const steam = db.sides[id].stepDetail.filter((x) => x.setting === 'STEAM');
    assert.equal(steam.length, 1, `${id} steams with STEAM`);
    assert.match(steam[0].text, /Pour 1 cup of water into the PossibleCooker pot.+put the lid on\. Select STEAM, set the time to \d+ minutes and press START\/STOP\./);
    assert.match(steam[0].text, /The cooker brings the water to a boil first, then counts the time down and beeps\./, 'one wording for the preheat (docs/spec/24 §24.6)');
    if (id !== 'steamed-normandy-vegetables') assert.match(steam[0].text, /The \w+ are done when/, `${id} keeps its doneness cue`);
    assert.ok(steam[0].minutes >= 10, 'the step allows for the water coming to a boil');
    assert.doesNotMatch(JSON.stringify(recipes.sides.find((x) => x.id === id)), /SEAR\/SAUTÉ/, `${id}: no sear/sauté workaround left`);
  }
  for (const d of [...db.dinnerList, ...db.sideList]) for (const st of d.stepDetail) if (/\bsteam\b/i.test(st.text) && /PossibleCooker pot/.test(st.text)) assert.equal(st.setting, 'STEAM', `${d.id}: a step that steams in the pot uses STEAM`);
  for (const s of ['PRESSURE COOK', 'AIR FRY', 'SLOW COOK', 'BAKE']) assert.ok(!COOKER_SETTING.test(s), s);
});

test('new ingredients are in the catalog with packs, prices marked as estimates, and nutrition', () => {
  const catalog = read('data/catalog.json').ingredients;
  // turkeySausage was one of these until the family said chicken, not turkey (docs/spec/24).
  for (const id of ['whiteBeans', 'celery', 'greenChiles', 'beefBroth']) {
    const ing = catalog[id];
    assert.ok(ing, id);
    for (const st of Object.keys(ing.packs)) for (const tier of ['generic', 'name']) {
      assert.ok(ing.packs[st][tier].price > 0 && ing.packs[st][tier].size > 0);
      assert.match(ing.packs[st][tier].label, /\(est\.\)/, `${id} ${st} ${tier} is marked as an estimate`);
    }
    assert.ok(db.nutrition.per[id].kcal >= 0 && db.nutrition.per[id].carbs >= 0, `${id} has nutrition`);
    assert.ok(db.dinnerList.some((d) => d.items[id]), `${id} is used`);
  }
  assert.equal(catalog.turkeySausage.meat, true, 'the id stays so receipts and the pantry still match');
  assert.ok(!db.dinnerList.some((d) => d.items.turkeySausage || d.items.groundTurkey), 'no dinner uses turkey');
});

// ---------------------------------------------------------------- detailed recipes

test('stepMinutes reads the timer out of a step', () => {
  for (const [text, want] of [
    ['Simmer about 10 minutes.', 10], ['Cook 6–8 minutes per side, then rest 5 minutes.', 6], ['SLOW COOK on LO for 6 to 7 hours', 360],
    ['Simmer 15 minutes, stirring every 2 minutes', 15], ['Stir for 30 seconds.', null], ['Cook 1½ hours', 90], ['Braise 2½–3 hours', 150],
    ['A 45-minute simmer', 45], ['Divide into 10 balls.', null], ['Air-fry at 400°F until crisp.', null], ['Cook 12 to 15 mins.', 12], ['', null],
  ]) assert.equal(stepMinutes(text), want, text);
});

test('steps: sentences or { text, minutes, setting }, always handed on as strings plus stepDetail', () => {
  const detail = normalizeSteps([
    'Brown the beef, about 10 minutes.',
    { text: 'Put the lid on and slow cook.', minutes: 390, setting: 'SLOW COOK on LO' },
    { text: 'Rest 5 minutes while you set the table.', minutes: 0 },
    { text: 'Whisk the sauce.', setting: 'Stovetop, low' },
    '', null, { text: '   ' }, 42,
  ]);
  assert.deepEqual(detail, [
    { text: 'Brown the beef, about 10 minutes.', minutes: 10, setting: null },
    { text: 'Put the lid on and slow cook.', minutes: 390, setting: 'SLOW COOK on LO' },
    { text: 'Rest 5 minutes while you set the table.', minutes: null, setting: null },
    { text: 'Whisk the sauce.', minutes: null, setting: 'Stovetop, low' },
    { text: '42', minutes: null, setting: null },
  ]);
  assert.deepEqual(normalizeSteps(undefined), []);
  for (const d of [...db.dinnerList, ...db.sideList]) {
    assert.ok(d.steps.length > 0 && d.steps.every((s) => typeof s === 'string' && s.length >= 10), `${d.id}: steps are sentences`);
    assert.equal(d.stepDetail.length, d.steps.length, d.id);
    d.stepDetail.forEach((s, i) => {
      assert.equal(s.text, d.steps[i]);
      assert.deepEqual(Object.keys(s), ['text', 'minutes', 'setting']);
      assert.ok(s.minutes === null || (Number.isInteger(s.minutes) && s.minutes > 0));
      assert.ok(s.setting === null || typeof s.setting === 'string');
    });
  }
});

test('a dinner the family saved themselves (plain strings, no new fields) still works', () => {
  const state = { customDinners: { 'grandmas-goulash': { title: 'Grandma’s goulash', category: 'Comfort', protein: 'beef', minutes: 45, equipment: ['stovetop'], tags: [], items: { beef: 2, elbows: 12 }, steps: ['Brown the beef to 160°F, about 10 minutes.', 'Stir in the macaroni and simmer.'], sides: ['steamed-broccoli', 'garlic-toast'] } } };
  const d = dinnerById(db, state, 'grandmas-goulash');
  assert.deepEqual(d.steps, ['Brown the beef to 160°F, about 10 minutes.', 'Stir in the macaroni and simmer.']);
  assert.deepEqual(d.stepDetail, [{ text: d.steps[0], minutes: 10, setting: null }, { text: d.steps[1], minutes: null, setting: null }]);
  assert.equal(d.minutes, 45);
  assert.equal(d.prepMinutes, null);
  assert.equal(d.cookMinutes, null);
  assert.deepEqual(d.tips, []);
  assert.equal(d.leftovers, '');
  assert.equal(handsOnMinutes(d), 45, 'no prep time given: the whole time is hands-on');
  assert.equal(effectiveSides(db, state, 'grandmas-goulash').length, 2);
  const h = plateHealth(db, state, 'grandmas-goulash');
  assert.ok(h.kcal > 400 && h.proteinG > 30);
  // The oldest shape of all: nothing but a title and steps.
  const bare = normalizeDinner({ id: 'x', title: 'X', steps: ['Cook it.'] });
  assert.deepEqual([bare.steps, bare.stepDetail.length, bare.minutes, bare.tips, bare.leftovers], [['Cook it.'], 1, 0, [], '']);
  assert.deepEqual(normalizeSide({ id: 's', title: 'S' }).stepDetail, []);
});

test('every built-in dinner: prep + cook = total, a timer, tips, leftovers and its safe temperature', () => {
  for (const d of db.dinnerList) {
    assert.ok(Number.isInteger(d.prepMinutes) && Number.isInteger(d.cookMinutes), d.id);
    assert.equal(d.prepMinutes + d.cookMinutes, d.minutes, `${d.id} minutes is the total`);
    assert.ok(d.steps.length >= 3, `${d.id} has ${d.steps.length} steps`);
    assert.ok(d.stepDetail.some((s) => s.minutes), `${d.id} has a timer`);
    assert.ok(d.stepDetail.some((s) => s.setting), `${d.id} names a heat or appliance setting`);
    assert.ok(d.tips.length >= 1 && d.tips.length <= 4, `${d.id} tips`);
    assert.ok(d.leftovers.length >= 15, `${d.id} leftovers`);
    assert.match(d.steps.join(' '), /1(45|60|65)°F/, `${d.id} states a safe temperature`);
    assert.ok(d.steps.join(' ').length >= 450, `${d.id}: steps a nervous cook can follow`);
    assert.ok(handsOnMinutes(d) <= 30, `${d.id}: ${handsOnMinutes(d)} hands-on minutes`);
  }
  assert.equal(fmtMinutes(25), '25 min');
  assert.equal(fmtMinutes(60), '1 hr');
  assert.equal(fmtMinutes(db.dinners['cooker-beef-stew'].minutes), '8 hr 40 min');
  assert.equal(handsOnMinutes(db.dinners['cooker-beef-stew']), 25);
  const bad = check((d) => { dinner(d, 'smashburgers').cookMinutes = 99; });
  assert.ok(says(bad, /smashburgers: minutes \(30\) must be prepMinutes \+ cookMinutes \(114\)/));
  assert.ok(says(check((d) => { delete dinner(d, 'smashburgers').leftovers; }), /smashburgers: leftovers must say/));
  assert.ok(says(check((d) => { dinner(d, 'smashburgers').tips = []; }), /smashburgers: needs at least one tip/));
  assert.ok(says(check((d) => { dinner(d, 'smashburgers').steps[1] = { text: 'Smash them.', minuts: 2 }; }), /unknown field "minuts"/));
  assert.ok(says(check((d) => { dinner(d, 'smashburgers').steps[1] = { text: 'Smash each ball flat and thin.', minutes: -3 }; }), /minutes must be a whole number/));
  assert.ok(says(check((d) => { dinner(d, 'smashburgers').steps = dinner(d, 'smashburgers').steps.map((s) => (typeof s === 'string' ? s : s.text).replace('160°F', 'done')); }), /smashburgers: uses ground meat .* never state 160°F/));
});

// ---------------------------------------------------------------- nutrition

const tiny = () => buildDb({
  catalog: { ingredients: {
    chicken: { name: 'Chicken breast', unit: 'lb', meat: true, packs: {} }, pasta: { name: 'Spaghetti', unit: 'oz', packs: {} },
    broccoli: { name: 'Frozen broccoli', unit: 'lb', packs: {} }, butter: { name: 'Butter', unit: 'tbsp', packs: {} }, mystery: { name: 'Mystery sauce', unit: 'oz', packs: {} },
    nofiber: { name: 'Plain rice', unit: 'cups', packs: {} },
  } },
  recipes: {
    dinners: [
      { id: 'lean', title: 'Lean', category: 'Grill', protein: 'chicken', items: { chicken: 2.5 }, steps: ['Grill.'], sides: ['broc', 'none-side'], sideSlots: 2 },
      { id: 'heavy', title: 'Heavy', category: 'Pasta', protein: 'chicken', items: { chicken: 2.5, pasta: 30, butter: 10 }, steps: ['Boil.'], sides: ['broc', 'broc2'], sideSlots: 2 },
      { id: 'thin', title: 'Thin', category: 'Pasta', protein: 'chicken', items: { chicken: 0.5, pasta: 10 }, steps: ['Boil.'], sides: ['broc', 'broc2'], sideSlots: 2 },
      { id: 'unknown', title: 'Unknown', category: 'Pasta', protein: 'chicken', items: { chicken: 2.5, mystery: 8 }, steps: ['Stir.'], sides: ['broc', 'broc2'], sideSlots: 2 },
      { id: 'partial', title: 'Partial', category: 'Pasta', protein: 'chicken', items: { chicken: 2.5, nofiber: 1 }, steps: ['Stir.'], sides: ['broc', 'broc2'], sideSlots: 2 },
    ],
    sides: [{ id: 'broc', title: 'Broccoli', kind: 'vegetable', items: { broccoli: 1.25 }, steps: ['Steam.'] }, { id: 'broc2', title: 'More broccoli', kind: 'vegetable', items: { broccoli: 1.25, butter: 1 }, steps: ['Steam.'] }],
  },
  nutrition: { per: {
    chicken: { kcal: 500, protein: 100, carbs: 0, fat: 10, fiber: 0 }, pasta: { kcal: 100, protein: 4, carbs: 20, fat: 0.5, fiber: 1 },
    broccoli: { kcal: 120, protein: 12, carbs: 20, fat: 1, fiber: 12, veg: 6 }, butter: { kcal: 100, protein: 0, carbs: 0, fat: 11, fiber: 0 },
    nofiber: { kcal: 600, protein: 12 },
  } },
});

test('plateHealth: one plate of five, with the sides as served', () => {
  const t = tiny();
  // lean: 2.5 lb chicken + 1.25 lb broccoli (the second side does not exist, so it adds nothing)
  assert.deepEqual(plateHealth(t, {}, 'lean'), {
    kcal: 280, proteinG: 53, carbsG: 5, fatG: 5, fiberG: 3, vegServings: 1.5, lean: true, why: 'A lean plate: 280 cal with 53 g protein.',
  });
  // heavy: (1250 + 3000 + 1000 + 150 + 150 + 100) / 5 = 1130 kcal
  const heavy = plateHealth(t, {}, 'heavy');
  assert.deepEqual([heavy.kcal, heavy.proteinG, heavy.vegServings, heavy.lean], [1130, 80, 3, false]);
  assert.equal(heavy.why, 'A heartier plate: 1,130 cal with 80 g protein.');
  const thin = plateHealth(t, {}, 'thin');
  assert.deepEqual([thin.kcal, thin.proteinG, thin.lean], [330, 24, false]);
  assert.match(thin.why, /^Lighter on protein: 24 g a plate/);
  assert.deepEqual(Object.keys(plateHealth(t, {}, 'lean')), ['kcal', 'proteinG', 'carbsG', 'fatG', 'fiberG', 'vegServings', 'lean', 'why']);
  assert.equal(PLATES, 5);
  assert.equal(VEG_SERVING_GRAMS, 80);
});

test('plateHealth: the lean rule is two plain numbers', () => {
  assert.deepEqual({ ...LEAN_RULE }, { maxKcal: 750, minProteinG: 35 });
  assert.ok(Object.isFrozen(LEAN_RULE));
  for (const d of db.dinnerList) {
    const h = plateHealth(db, {}, d.id);
    assert.equal(h.lean, h.kcal <= LEAN_RULE.maxKcal && h.proteinG >= LEAN_RULE.minProteinG, d.id);
    assert.ok(!/\b(good|bad|unhealthy|guilt|cheat|should|too much)\b/i.test(h.why), `${d.id}: "${h.why}" does not judge`);
  }
  assert.equal(plateHealth(db, {}, 'blackened-cajun-chicken').lean, true);
  assert.equal(plateHealth(db, {}, 'mushroom-burgers').lean, false);
});

test('plateHealth: nothing is guessed', () => {
  const t = tiny();
  const u = plateHealth(t, {}, 'unknown');
  assert.equal(u.lean, false, 'an ingredient without calories can never make a plate lean');
  assert.match(u.why, /No numbers yet for Mystery sauce/);
  assert.ok(!('carbsG' in u) && !('fatG' in u) && !('fiberG' in u));
  assert.equal(u.vegServings, 3);
  const p = plateHealth(t, {}, 'partial');
  assert.ok(p.kcal > 0 && !('carbsG' in p) && !('fiberG' in p), 'carbs, fat and fiber are left off when one ingredient lacks them');
  assert.equal(plateHealth(t, {}, 'no-such-dinner'), null);
  assert.equal(plateHealth(buildDb({ catalog: { ingredients: {} }, recipes: { dinners: [{ id: 'a', title: 'A', items: {}, steps: [] }], sides: [] } }), {}, 'a'), null, 'no nutrition file: no verdict');
  assert.equal(itemsMacros(t, { chicken: 1, mystery: 1 }).carbs, null);
  assert.deepEqual(normalizeNutrition({ per: { a: { kcal: 10, protein: 1, carbs: 'x', fat: -1, veg: 2 } } }).per.a, { kcal: 10, protein: 1, veg: 2 });
});

test('plateHealth follows the night: swapped sides and the meat setting change the plate', () => {
  const base = plateHealth(db, {}, 'tikka-masala');
  assert.equal(base.kcal, Math.round(plateNutrition(db, {}, 'tikka-masala').kcal), 'same plate as plateNutrition');
  const entry = { dinner: 'tikka-masala', sides: ['warm-naan', 'buttered-peas'], status: 'planned' };
  const swapped = plateHealth(db, {}, 'tikka-masala', entry);
  assert.notEqual(swapped.kcal, base.kcal);
  assert.equal(swapped.kcal, Math.round(plateNutrition(db, {}, 'tikka-masala', entry).kcal));
  const remembered = plateHealth(db, { substitutions: { 'tikka-masala': { 0: 'steamed-jasmine-rice' } } }, 'tikka-masala');
  assert.notEqual(remembered.kcal, base.kcal, 'a remembered substitution counts');
  const less = plateHealth(db, { settings: { meatScale: 0.85 } }, 'tikka-masala');
  assert.ok(less.kcal < base.kcal && less.proteinG < base.proteinG);
  const shelf = plateHealth(db, {}, 'tikka-masala', { ...entry, sides: ['item:greenBeans@2', 'turmeric-rice'] });
  assert.ok(shelf.vegServings > 1, 'a can of green beans from the shelf is a vegetable');
});

test('every dinner and every lunch has calories, protein, carbs, fat and fiber', () => {
  for (const d of db.dinnerList) {
    const h = plateHealth(db, {}, d.id);
    for (const k of ['kcal', 'proteinG', 'carbsG', 'fatG', 'fiberG', 'vegServings']) assert.ok(Number.isFinite(h[k]), `${d.id} ${k}`);
    const fromMacros = 4 * h.proteinG + 4 * (h.carbsG - h.fiberG) + 2 * h.fiberG + 9 * h.fatG;
    assert.ok(Math.abs(fromMacros - h.kcal) <= h.kcal * 0.1, `${d.id}: macros add up to ${Math.round(fromMacros)} of ${h.kcal} kcal`);
  }
  for (const it of db.lunch.itemList) {
    const m = lunchMacros(db, it);
    assert.ok(m && m.complete, `${it.id} is fully known`);
    for (const k of ['kcal', 'protein', 'carbs', 'fat', 'fiber']) assert.ok(Number.isFinite(m[k]) && m[k] >= 0, `${it.id} ${k}`);
  }
  for (const [id, n] of Object.entries(db.nutrition.per)) if (db.ingredients[id]) for (const k of ['carbs', 'fat', 'fiber']) assert.ok(n[k] >= 0, `${id} ${k}`);
  assert.equal(read('data/nutrition.json').macrosEstimated, true, 'the file says its macros are estimates');
});

test('validator: nutrition has to be there, and has to add up', () => {
  assert.ok(says(check((d) => { delete d.nutrition.per.chicken; }), /nutrition\.chicken: no entry for this catalog id/));
  assert.ok(says(check((d) => { delete d.nutrition.per.spaghetti.carbs; }), /item "spaghetti" has no calories, protein, carbs, fat and fiber/));
  assert.ok(says(check((d) => { d.nutrition.per.butter.fat = 1; }), /nutrition\.butter: 102 kcal does not match its protein\/carbs\/fat/));
  assert.ok(says(check((d) => { d.nutrition.per.broccoli.fiber = 99; }), /nutrition\.broccoli: fiber 99 g is more than carbs/));
  assert.ok(says(check((d) => { d.nutrition.per.broccoli.veg = -1; }), /nutrition\.broccoli: veg must be a number >= 0/));
});

// ---------------------------------------------------------------- pictures

test('a dish without a picture shows the placeholder, never a broken image', () => {
  // Every dish has its picture now, so take some away in a copy: the PossibleCooker dinners, as on the day they were added.
  const bare = { ...db, photos: { ...db.photos, dinners: { ...db.photos.dinners } } };
  const waiting = cookerDinners();
  assert.ok(waiting.length >= 14);
  for (const d of waiting) delete bare.photos.dinners[d.id];
  for (const d of waiting) {
    const htmlText = String(photo(bare, 'dinner', d.id, { category: d.category, alt: d.title }));
    assert.ok(htmlText.includes('photo-ph'), `${d.id} has the placeholder`);
    assert.ok(!htmlText.includes('<img'), `${d.id} has no <img> to break`);
    assert.ok(String(photo(db, 'dinner', d.id, { category: d.category, alt: d.title })).includes('<img'), `${d.id} shows its real picture`);
  }
  // Whatever is still waiting in the real data (nothing, today) gets the same treatment.
  for (const d of db.dinnerList.filter((x) => !db.photos.dinners[x.id])) assert.ok(!String(photo(db, 'dinner', d.id, {})).includes('<img'), d.id);
  assert.ok(String(photo(db, 'dinner', 'smashburgers', {})).includes('<img'));
  for (const kind of ['dinners', 'sides', 'lunches']) for (const [id, p] of Object.entries(db.photos[kind])) assert.ok(existsSync(path.join(ROOT, p.src)), `${kind}.${id} → ${p.src}`);
});

test('dev/photo-jobs.json queues every dish that needs a picture', () => {
  const jobs = read('dev/photo-jobs.json');
  const key = (j) => `${j.kind}:${j.id}`;
  const queued = new Set(jobs.map(key));
  assert.equal(queued.size, jobs.length, 'no dish twice');
  const dir = { dinner: 'img/dinners', side: 'img/sides', lunch: 'img/lunch' };
  const table = { dinner: db.dinners, side: db.sides, lunch: db.lunch.items };
  for (const j of jobs) {
    assert.deepEqual(Object.keys(j).slice(0, 4), ['kind', 'id', 'file', 'prompt']);
    assert.ok(table[j.kind]?.[j.id], `${key(j)} exists`);
    assert.equal(j.file, `${dir[j.kind]}/${j.id}.webp`);
    assert.ok(j.prompt.length > 150 && j.prompt.includes('Do not show cucumber, raw tomato, raw onion or scallions'));
    assert.deepEqual(rawProduce(j.prompt.split('No text')[0], { picture: true }), [], `${key(j)} prompt`);
    assert.deepEqual(bannedWords(j.prompt), [], `${key(j)} prompt`);
  }
  // the four the brief named, every new dish, and every lunch that never had a picture
  for (const k of ['dinner:greek-chicken-pitas', 'dinner:hummus-grill-plates', 'dinner:pork-souvlaki-plates', 'side:romaine-salad']) assert.ok(queued.has(k), k);
  for (const d of db.dinnerList) if (!db.photos.dinners[d.id]) assert.ok(queued.has(`dinner:${d.id}`), d.id);
  for (const s of db.sideList) if (!db.photos.sides[s.id]) assert.ok(queued.has(`side:${s.id}`), s.id);
  for (const l of db.lunch.itemList) if (!db.photos.lunches[l.id]) assert.ok(queued.has(`lunch:${l.id}`), l.id);
  assert.ok(jobs.filter((j) => /cucumber/.test(j.why || '')).length >= 15, 'the cucumber pictures the contact sheets turned up');
});

test('validator: pictures on disk, and a job for whatever is missing', () => {
  // A picture listed in photos.json whose file isn't there.
  const ghost = check((d) => { d.photos.dinners['cooker-beef-stew'] = 'img/dinners/never-made.webp'; });
  assert.ok(says(ghost, /dinners\.cooker-beef-stew points at img\/dinners\/never-made\.webp, which is not on disk/));
  const stale = check((d) => { d.photos.dinners['orange-tofu-bowls'] = 'img/dinners/orange-tofu-bowls.webp'; });
  assert.ok(says(stale, /orange-tofu-bowls is a picture of a dinner that isn't in the recipe box/));
  // A dish with no picture: an error with no job, only a warning while one is queued.
  const forgotten = check((d) => { delete d.photos.dinners['cooker-beef-stew']; d.photoJobs = d.photoJobs.filter((j) => j.id !== 'cooker-beef-stew'); });
  assert.ok(says(forgotten, /dinner cooker-beef-stew: no picture yet and no job/));
  const queued = check((d) => { delete d.photos.dinners['cooker-beef-stew']; });
  assert.deepEqual(queued.errors, []);
  assert.ok(queued.warnings.some((w) => /dinner cooker-beef-stew: no picture yet \(queued/.test(w)), 'queued is a warning, not an error');
  assert.ok(!check().warnings.some((w) => /no picture yet/.test(w)), 'every dish has its picture today');
  assert.ok(says(check((d) => { d.photoJobs[0].file = 'img/elsewhere.png'; }), /file must be img\//));
  assert.ok(says(check((d) => { d.photoJobs[0].prompt = `${'A plate of noodles with cucumber slices and scallions. '.repeat(2)}No text.`; }), /prompt: no cucumber/));
  assert.ok(says(check((d) => { d.photoJobs.push({ kind: 'dinner', id: 'not-a-dinner', file: 'img/dinners/not-a-dinner.webp', prompt: 'x'.repeat(80) }); }), /there is no dinner with that id/));
});
