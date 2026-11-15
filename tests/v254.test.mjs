// v2.5.4: the list pasted into Jewel-Osco AI (plain lines, under its 2,000-character box) and
// coupons that are already clipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realDb } from './helpers.mjs';
import { buildList, formatAssistantList, shortProductName } from '../app/shopping.js';

const db = realDb();
const SUN = '2026-11-15';
const FRI = '2026-11-20';
const night = (dinner) => ({ dinner, status: 'planned', by: 'Jeff', at: 'x' });

test('product names lose sizes and notes for the store’s AI', () => {
  assert.equal(shortProductName("Boar's Head SmokeMaster Black Forest Ham (sliced at the deli)"), "Boar's Head SmokeMaster Black Forest Ham");
  assert.equal(shortProductName('Jewel Hamburger Buns - 12 Oz'), 'Jewel Hamburger Buns');
  assert.equal(shortProductName('Ball Park Hamburger Buns, 8 ct (the family’s usual)'), 'Ball Park Hamburger Buns');
  assert.equal(shortProductName('Doritos Cool Ranch'), 'Doritos Cool Ranch');
});

test('the Jewel-Osco AI list is plain lines that fit its box', () => {
  const state = {
    settings: { trip: { start: SUN, end: FRI, store: 'jewel' }, organic: true },
    plan: { [SUN]: night('cheeseburgers'), '2026-11-16': night('chicken-tacos'), '2026-11-17': night('naan-pizzas') },
    deals: { 'jewel/buns': { label: 'Jewel Hamburger Buns, 8 ct', size: 8, price: 2.49, was: 2.99, ends: '2026-11-17', checked: SUN, coupon: { price: 1.89, text: '$1.89 with the coupon', expires: '2026-11-17', clipped: true, q: 'buns' } } },
  };
  const dates = [SUN, '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', FRI];
  const list = buildList(db, state, { dates, listKey: `trip:${SUN}:${FRI}:jewel`, store: 'jewel', today: SUN });
  const parts = formatAssistantList(db, list, 'jewel');
  assert.ok(parts.length >= 1);
  for (const p of parts) {
    assert.ok(p.length <= 1900, `part fits the box (${p.length})`);
    assert.match(p, /^Shop my grocery list/);
    assert.doesNotMatch(p, /×|—|~/, 'no pack symbols the AI can’t read');
  }
  const lines = parts.join('\n').split('\n').filter((l) => !/^Shop my grocery list/.test(l));
  assert.equal(lines.length, list.stores.jewel.items.filter((i) => !i.checked).length, 'one line per item');
  const buns = list.coupons.find((c) => c.id === 'buns');
  if (buns) { assert.equal(buns.clipped, true); assert.equal(buns.q, 'buns'); }

  // A long list splits into numbered parts.
  const many = { ...list, stores: { ...list.stores, jewel: { ...list.stores.jewel, items: Array.from({ length: 120 }, (_, k) => ({ id: `x${k}`, freeText: true, name: `Something long enough to matter number ${k}`, qty: 1, unit: 'each' })) } } };
  const split = formatAssistantList(db, many, 'jewel');
  assert.ok(split.length >= 2);
  assert.match(split[0], /^Shop my grocery list \(part 1 of \d\):/);
  split.forEach((p) => assert.ok(p.length <= 1900));
});
