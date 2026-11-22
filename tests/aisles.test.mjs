// The shopping list's two modes and the aisles behind "In the store" (docs/spec/28).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { realDb } from './helpers.mjs';
import { cleanAisle, aisleFor, aisleKey, shopStops, storeProductUrl, aisleCoverage, normalizeAisles, LIST_MODES } from '../app/aisles.js';

const db = realDb();
const raw = JSON.parse(readFileSync(new URL('../data/aisles.json', import.meta.url), 'utf8'));

test('two ways to shop: in the store, or order online', () => {
  assert.deepEqual(LIST_MODES.map((m) => m.id), ['store', 'online']);
});

test('aisle codes are read the way they are written on the sign', () => {
  assert.equal(cleanAisle('M9'), 'M9');
  assert.equal(cleanAisle(' aisle m 9 '), 'M9');
  assert.equal(cleanAisle('Aisle 12'), '12');
  assert.equal(cleanAisle('#7'), '7');
  assert.equal(cleanAisle('G11'), 'G11');
  for (const bad of ['', 'produce', 'back wall', '12345', null, undefined]) assert.equal(cleanAisle(bad), '', String(bad));
});

test('the walk goes zone by zone, then by number (A1, A2, A10, B1); plain numbers in order', () => {
  const codes = ['M9', 'A10', 'G1', 'A2', 'G11', 'A1', 'F3'];
  assert.deepEqual([...codes].sort((a, b) => aisleKey(a).localeCompare(aisleKey(b))), ['A1', 'A2', 'A10', 'F3', 'G1', 'G11', 'M9']);
  assert.deepEqual(['12', '3', '7'].sort((a, b) => aisleKey(a).localeCompare(aisleKey(b))), ['3', '7', '12']);
});

test('data/aisles.json: Sam’s aisles read off samsclub.com for the Addison club, and only for real items', () => {
  const sams = raw.stores.sams;
  assert.equal(sams.club, '6487');
  for (const [id, e] of Object.entries(sams.items)) {
    assert.ok(db.ingredients[id], `${id} is a catalog item`);
    if (e.aisle) assert.equal(cleanAisle(e.aisle), e.aisle, id);
    if (e.near) assert.equal(e.url, undefined, `${id}: a near match never links to a product`);
    else assert.match(e.url, /^https:\/\/www\.samsclub\.com\/ip\/[^/]+\/\d+$/, id);
  }
  assert.equal(aisleFor(db, {}, 'sams', 'chicken').code, 'M9');
  assert.equal(aisleFor(db, {}, 'sams', 'chicken').source, 'store');
  assert.equal(aisleFor(db, {}, 'jewel', 'chicken'), null, 'Jewel’s site shows no aisles');
  assert.equal(normalizeAisles(raw).stores.sams.items.chicken.aisle, 'M9');
  assert.deepEqual(normalizeAisles(null).stores.jewel.items, {});
});

test('the family’s aisle always wins, and clearing it falls back to the store’s', () => {
  const state = { aisles: { sams: { chicken: { aisle: 'M10', by: 'Jeff' } }, jewel: { garlic: { aisle: '1', by: 'Candi' } } } };
  assert.deepEqual(aisleFor(db, state, 'sams', 'chicken'), { code: 'M10', label: 'Aisle M10', source: 'family', by: 'Jeff', near: false });
  assert.equal(aisleFor(db, state, 'jewel', 'garlic').label, 'Aisle 1');
  assert.equal(aisleFor(db, { aisles: { sams: { chicken: { aisle: '' } } } }, 'sams', 'chicken'), null, 'an empty entry means “not sure”');
  assert.equal(aisleFor(db, { aisles: { sams: {} } }, 'sams', 'chicken').code, 'M9');
});

test('in the store: one stop per aisle in walking order; no aisle yet rides with its section, never doubling back', () => {
  const it = (id, aisle) => ({ id, key: id, aisle, name: id });
  const items = [it('honey', 'Condiments & Sauces'), it('chicken', 'Meat'), it('bananas', 'Produce'), it('beefPatties', 'Meat'), it('garlic', 'Produce'), it('mystery', 'Frozen')];
  const stops = shopStops(db, {}, 'sams', items);
  assert.deepEqual(stops.map((s) => s.label), ['Aisle F7', 'Aisle G1', 'Aisle M9', 'Frozen']);
  const g1 = stops.find((s) => s.aisle === 'G1');
  assert.deepEqual(g1.items.map((i) => i.id), ['bananas', 'garlic'], 'garlic has no Sam’s aisle, so it goes with the produce');
  assert.ok(g1.guess.has('garlic') && !g1.guess.has('bananas'), 'and it is marked as a guess');
  assert.deepEqual(stops.find((s) => s.aisle === 'M9').items.map((i) => i.id), ['chicken', 'beefPatties'], 'two things in one aisle share a stop');
  const jewel = shopStops(db, { aisles: { jewel: { garlic: { aisle: '1' } } } }, 'jewel', items);
  assert.equal(jewel[0].label, 'Aisle 1');
  assert.deepEqual(aisleCoverage(db, {}, 'sams', items), { known: 4, total: 6 });
});

test('order online: the exact product page when we know it, never a near match', () => {
  assert.match(storeProductUrl(db, 'sams', 'chicken'), /\/13896820369$/);
  assert.equal(storeProductUrl(db, 'sams', 'hummus'), null, 'the club only had a near match');
  assert.equal(storeProductUrl(db, 'jewel', 'chicken'), null);
});
