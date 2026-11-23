import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freezerNote } from '../app/views/tonight.js';

test('freezer notes on Tonight read as plain English', () => {
  const base = { unit: 'lb', have: 0, leftover: 0 };
  assert.equal(
    freezerNote({ ...base, name: 'Lean ground beef', packs: 1, packSize: 10.74, covers: 5, dinners: 5, leftover: 0.24 }),
    'Lean ground beef: one 10¾ lb pack covers all 5 dinners, with 0.24 lb left over.',
  );
  assert.equal(
    freezerNote({ ...base, name: 'Frozen French fries', unit: 'oz', packs: 2, packSize: 32, covers: 2, dinners: 2 }),
    'Frozen French fries: two 32 oz packs cover both dinners.',
  );
  assert.equal(
    freezerNote({ ...base, name: 'Chicken breast', packs: 0, have: 4, covers: 2, dinners: 3 }),
    'Chicken breast: the 4 lb in the freezer covers 2 of 3 dinners.',
  );
  assert.equal(
    freezerNote({ ...base, name: 'Chicken breast', packs: 1, packSize: 10, have: 2, covers: 4, dinners: 4, leftover: 3 }),
    'Chicken breast: one 10 lb pack plus the 2 lb in the freezer cover all 4 dinners, with 3 lb left over.',
  );
});

test('clockText: dinner time rounded up to the quarter hour, no a.m./p.m. (gauntlet r8)', async () => {
  const { clockText } = await import('../app/util.js');
  assert.equal(clockText(17 * 60 + 30 + 90 + 30), '7:30');
  assert.equal(clockText(18 * 60 + 1), '6:15');
  assert.equal(clockText(12 * 60), '12:00');
});
