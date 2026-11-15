// v2.3: pantry scans count jars and boxes; the recipe box measures in oz, slices and cups.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realDb } from './helpers.mjs';
import { scanQtyIn, containerSize, normUnit, labelOz } from '../app/scanqty.js';
import { mergeDetections, scanLabel, guessAisle } from '../app/views/pantry.js';

const db = realDb();
const ing = (id) => db.ingredients[id];

test('units normalize: plurals, abbreviations, fluid ounces', () => {
  assert.equal(normUnit('Jars'), 'jar');
  assert.equal(normUnit('lbs'), 'lb');
  assert.equal(normUnit('fl. oz'), 'oz');
  assert.equal(normUnit('loaves'), 'loaf');
  assert.equal(normUnit('boxes'), 'box');
  assert.equal(normUnit('slices'), 'slice');
  assert.equal(normUnit(''), null);
  assert.equal(labelOz("Sara Lee Artesano Bakery Bread, 20 oz (~16 slices)"), 20);
  assert.equal(labelOz('Royal basmati rice, 2 lb bag'), 32);
});

test('one jar of Rao’s is a jar’s worth of ounces, not 1 oz', () => {
  const r = scanQtyIn(ing('marinara'), 1, 'jar');
  assert.equal(r.qty, containerSize(ing('marinara')));
  assert.ok(r.qty >= 22 && r.qty <= 24, `marinara jar ${r.qty} oz`);
  assert.equal(r.from, '1 jar');
  assert.equal(scanQtyIn(ing('tikka'), 2, 'jars').qty, 25, 'two 12.5 oz Maya Kaimal jars');
  assert.equal(scanQtyIn(ing('bread'), 1, 'loaf').qty, containerSize(ing('bread')), 'a loaf is a loaf of slices');
  assert.ok(containerSize(ing('bread')) >= 16 && containerSize(ing('bread')) <= 22);
  assert.equal(scanQtyIn(ing('elbows'), 1, 'box').qty, 16, 'a 1 lb box of elbows');
  assert.equal(scanQtyIn(ing('buns'), 1, 'package').qty, 8, 'a bag of 8 buns');
  assert.equal(scanQtyIn(ing('crackers'), 4, 'box').qty, 54.8, 'four Ritz boxes');
});

test('cans stay cans, buns stay buns, and weights convert', () => {
  assert.equal(scanQtyIn(ing('cannedCorn'), 3, 'can').qty, 3);
  assert.equal(scanQtyIn(ing('chiliBeans'), 2, 'cans').qty, 2);
  assert.equal(scanQtyIn(ing('buns'), 6, 'buns').qty, 6);
  assert.equal(scanQtyIn(ing('marinara'), 24, 'oz').qty, 24);
  assert.equal(scanQtyIn(ing('chicken'), 48, 'oz').qty, 3, '48 oz of chicken is 3 lb');
  const rice = scanQtyIn(ing('basmati'), 2, 'lb').qty;
  assert.ok(rice >= 4.4 && rice <= 5, `a 2 lb bag of basmati is about 4.6 cups (got ${rice})`);
  assert.equal(scanQtyIn(ing('marinara'), null, null).qty, null);
  assert.equal(scanQtyIn(ing('marinara'), 0, 'jar').qty, null);
});

test('a catalog container size wins over the pack heuristic', () => {
  const custom = { ...ing('marinara'), container: { size: 22 } };
  assert.equal(scanQtyIn(custom, 2, 'jar').qty, 44);
});

test('the review merges duplicates by product, converts amounts and keeps the label', () => {
  const app = { db, state: { custom: {} } };
  const rows = mergeDetections(app, [
    { name: 'Marinara sauce, jarred', brand: "Rao's", label: 'Homemade Marinara Sauce', matchId: 'marinara', qty: 1, unit: 'jar', confidence: 0.95 },
    { name: 'Marinara sauce, jarred', matchId: 'marinara', qty: 2, unit: 'jar', confidence: 0.8 },
    { name: 'Chicken noodle soup, canned', brand: 'Progresso', label: 'Traditional Chicken Noodle Soup', matchId: null, qty: 2, unit: 'can', confidence: 0.9 },
  ]);
  const sauce = rows.find((r) => r.matchId === 'marinara');
  assert.equal(sauce.qty, 2 * containerSize(ing('marinara')), 'the larger count wins, converted to oz');
  assert.equal(sauce.seen, '2 jar');
  assert.equal(sauce.label, "Rao's Homemade Marinara Sauce");
  const soup = rows.find((r) => !r.matchId);
  assert.equal(soup.qty, 2);
  assert.equal(soup.label, 'Progresso Traditional Chicken Noodle Soup');
  assert.equal(scanLabel({ brand: 'Progresso', label: 'Progresso Chicken Noodle' }), 'Progresso Chicken Noodle', 'no doubled brand');
  assert.equal(scanLabel({}), '');
});

test('new shelf items get a sensible aisle', () => {
  assert.equal(guessAisle('Cajun seasoning'), 'Spices & Baking');
  assert.equal(guessAisle('Red pepper, ground'), 'Spices & Baking');
  assert.equal(guessAisle('Old Bay seasoning'), 'Spices & Baking');
  assert.equal(guessAisle('Hot sauce, bottle'), 'Condiments & Sauces');
  assert.equal(guessAisle("Miss Vickie's Jalapeno chips, bag"), 'Snacks & Extras');
  assert.equal(guessAisle('Thin rice noodles, Thai Kitchen'), 'Pasta & Grains');
  assert.equal(guessAisle('Progresso soup, canned'), 'Canned & Jarred');
});
