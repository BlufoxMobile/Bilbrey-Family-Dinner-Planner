// 2026-11-22: Jeff and Candi went through every dinner and side and marked 22 dinners and 7 sides No.
// Their note: "think of 30 minute or less meals if possible. Also, we don't do a lot of pork." Jeff: "I would be
// good with a fried shrimp night with some SeaPak fried shrimp. We usually eat two packs when we cook that and we
// cook that with fries." Candi: "Sometimes we like french style green beans, and other simple, easy canned goods as sides."
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realDb } from './helpers.mjs';
import { validateData, loadData, RETIRED_DINNERS, SHRIMP_NIGHT, bannedWords } from '../scripts/validate-data.mjs';
import { handsOnMinutes } from '../app/data.js';
import { PROTEINS } from '../app/config.js';

const db = realDb();
const disk = loadData();
const KEYS = ['catalog', 'recipes', 'lunches', 'nutrition', 'prices', 'photos', 'photoJobs', 'ref'];
const check = (change = () => {}) => { const c = structuredClone(Object.fromEntries(KEYS.map((k) => [k, disk[k]]))); change(c); return validateData({ ...c, fileExists: disk.fileExists }); };
const says = (res, re) => res.errors.some((e) => re.test(e));

const NO = ['apple-glazed-pork-chops', 'breaded-pork-sandwiches', 'chicken-katsu', 'chicken-pepper-plates', 'chicken-tostadas', 'cooker-beef-stew', 'cooker-braised-pork-apples', 'cooker-chicken-cacciatore', 'cooker-italian-beef', 'cooker-lasagna-soup', 'cooker-sausage-minestrone', 'cooker-sesame-ginger-chicken', 'hibachi-chicken-noodles', 'honey-garlic-pork-chops', 'kung-pao-chicken', 'mustard-pork-apples', 'peanut-sweet-potatoes', 'pork-carnitas-tacos', 'pork-souvlaki-plates', 'sausage-pepper-hoagies', 'sweet-potato-tacos', 'sweet-sour-pork'];
const NO_SIDES = ['air-fryer-veggies', 'applesauce-cups', 'asian-slaw', 'lime-slaw', 'spinach-apple-salad', 'steamed-mixed-vegetables', 'sweet-potatoes'];
const NEW = ['hamburger-steaks-gravy', 'philly-cheesesteaks', 'steak-fajitas', 'cheesy-taco-pasta', 'mongolian-beef', 'cheesy-beef-quesadillas', 'one-pot-chili-mac', 'french-dip-sandwiches', 'beef-potato-skillet', 'honey-garlic-chicken-bites', 'lemon-pepper-chicken', 'smothered-chicken', 'chicken-ranch-pasta', 'southwest-chicken-rice', 'hawaiian-bbq-chicken', 'chicken-tender-night', 'chicken-street-tacos', 'garlic-butter-chicken-noodles', 'chicken-and-dumplings', 'garlic-parmesan-chicken', 'cheesy-chicken-broccoli-rice', 'seapak-shrimp-night'];

test('what the family marked No is gone for good, from the dinners, the sides and every default', () => {
  for (const id of NO) { assert.equal(db.dinners[id], undefined, id); assert.ok(RETIRED_DINNERS[id], `${id} is retired by name`); assert.equal(db.photos.dinners[id], undefined, id); }
  for (const id of NO_SIDES) { assert.equal(db.sides[id], undefined, id); assert.equal(db.photos.sides[id], undefined, id); }
  for (const d of db.dinnerList) for (const s of d.sides) assert.ok(!NO_SIDES.includes(s), `${d.id} still serves ${s}`);
});

test('22 new dinners in their place: 30 minutes or less, no pork, each with its picture', () => {
  assert.equal(NEW.length, NO.length);
  for (const id of NEW) {
    const d = db.dinners[id];
    assert.ok(d, id);
    assert.equal(d.rotation, 'core', id);
    assert.ok(d.minutes <= 30, `${id}: ${d.minutes} min`);
    assert.ok(handsOnMinutes(d) <= 15, `${id}: ${handsOnMinutes(d)} hands-on`);
    assert.notEqual(d.protein, 'pork', id);
    assert.ok(db.photos.dinners[id], `${id} has a picture`);
  }
  assert.ok(db.dinnerList.length >= 105);
});

test('fried shrimp night: two bags of SeaPak with fries, and the only seafood in the house', () => {
  const d = db.dinners[SHRIMP_NIGHT.dinner];
  assert.equal(d.protein, 'seafood');
  assert.ok(PROTEINS.includes('seafood'));
  assert.equal(d.items.seapakShrimp, 36, 'two 18 oz bags');
  assert.ok(d.sides.includes('jewel-fries'));
  assert.equal(db.ingredients.seapakShrimp.brand, 'SeaPak');
  assert.ok(!/\boven\b/i.test(JSON.stringify(db.ingredients.seapakShrimp)), 'no oven words, even from the box');
  assert.match(d.steps.join(' '), /air fryer|air-fry/i);
  for (const x of db.dinnerList) if (x.id !== SHRIMP_NIGHT.dinner) {
    assert.ok(!x.items.seapakShrimp, x.id);
    assert.equal(x.protein === 'seafood', false, x.id);
  }
  // The validator still refuses shrimp anywhere else.
  assert.ok(says(check((c) => { c.recipes.dinners.find((x) => x.id === 'beef-tacos').subtitle += ' Add shrimp.'; }), /beef-tacos.*banned word "shrimp"/));
  assert.ok(says(check((c) => { c.recipes.dinners.find((x) => x.id === 'beef-tacos').items.seapakShrimp = 10; }), /beef-tacos: only fried shrimp night uses the shrimp/));
  assert.deepEqual(bannedWords('Fried shrimp night'), ['shrimp'], 'the word is still banned by itself');
});

test('simple canned sides: French-style green beans, Mexicorn, cream-style corn, new potatoes', () => {
  assert.match(db.sides['canned-green-beans'].title, /French-style green beans/);
  for (const id of ['mexicorn', 'cream-corn', 'new-potatoes']) {
    const s = db.sides[id];
    assert.ok(s && s.minutes <= 12 && db.photos.sides[id], id);
    assert.ok(Object.keys(s.items).some((x) => db.ingredients[x].unit === 'cans'), `${id} comes from a can`);
  }
  assert.ok(db.dinnerList.filter((d) => d.sides.includes('mexicorn')).length >= 3, 'Mexicorn on the Tex-Mex nights');
});
