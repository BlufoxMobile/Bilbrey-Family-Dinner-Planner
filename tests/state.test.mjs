import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { applyOps, deriveKey, Store, set, del, push, settingsOf, makeStorage } from '../app/state.js';
import { startMockApi } from '../dev/mock-api.mjs';

const memStorage = () => makeStorage({ _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); } });

test('ops: set creates intermediates, del removes, push appends', () => {
  let s = applyOps({}, [set(['votes', 'smashburgers', 'Knox'], 1)]);
  assert.deepEqual(s, { votes: { smashburgers: { Knox: 1 } } });
  s = applyOps(s, [del(['votes', 'smashburgers', 'Knox']), push(['receipts'], { amount: 5 }), push(['receipts'], { amount: 6 })]);
  assert.deepEqual(s.votes.smashburgers, {});
  assert.equal(s.receipts.length, 2);
  const orig = { plan: { a: { dinner: 'x' } } };
  applyOps(orig, [set(['plan', 'a', 'dinner'], 'y')]);
  assert.equal(orig.plan.a.dinner, 'x', 'applyOps is pure');
});

test('settings defaults: burger nights Mon+Fri, $650 target', () => {
  const s = settingsOf({});
  assert.deepEqual(s.burgerNights, [0, 4]);
  assert.equal(s.monthlyTarget, 650);
  assert.equal(s.riceMaxPerWeek, 1);
  assert.equal(settingsOf({ settings: { monthlyTarget: 'abc' } }).monthlyTarget, 650);
});

test('deriveKey matches SPEC §5', async () => {
  const k = await deriveKey('  Tacos Tuesday ');
  const expected = createHash('sha256').update('bilbrey-dinner-planner:tacos tuesday').digest('hex');
  assert.equal(k, expected);
});

test('store: works offline, queues ops, survives reload, then syncs', async () => {
  const storage = memStorage();
  const api = await startMockApi({ port: 0, quiet: true });
  const port = api.server.address().port;
  try {
    // Unreachable API first.
    const s1 = new Store({ storage, apiBase: 'http://127.0.0.1:1', autoSync: false, timeoutMs: 1500 });
    s1.setDevice({ who: 'Candi' });
    assert.equal(await s1.connect(), 'offline');
    s1.commit([set(['plan', '2026-11-16'], { dinner: 'smashburgers', status: 'planned' })]);
    assert.equal(s1.state.plan['2026-11-16'].dinner, 'smashburgers');
    assert.equal(s1.pending.length, 1);
    clearTimeout(s1.retryTimer);

    // Reload from storage, now the API is reachable but has no passcode.
    const s2 = new Store({ storage, apiBase: `http://127.0.0.1:${port}`, autoSync: false });
    assert.equal(s2.state.plan['2026-11-16'].dinner, 'smashburgers', 'local state survived reload');
    assert.equal(s2.device.who, 'Candi');
    assert.equal(await s2.connect(), 'needs-setup');
    await s2.createPasscode('Tacos');
    assert.equal(s2.status, 'synced');
    assert.equal(s2.pending.length, 0);
    assert.equal(api.db.state.plan['2026-11-16'].dinner, 'smashburgers', 'queued op reached the server');

    // A second phone joins with the passcode and sees the same plan.
    const s3 = new Store({ storage: memStorage(), apiBase: `http://127.0.0.1:${port}`, autoSync: false });
    assert.equal(await s3.connect(), 'needs-passcode');
    await assert.rejects(() => s3.enterPasscode('wrong'), /doesn't match/);
    await s3.enterPasscode('tacos ');
    assert.equal(s3.state.plan['2026-11-16'].dinner, 'smashburgers');

    // Phone 3 votes; phone 2 pulls it.
    s3.commit([set(['votes', 'smashburgers', 'Knox'], 1)]);
    await s3.sync();
    await s2.sync();
    assert.equal(s2.state.votes.smashburgers.Knox, 1);
  } finally {
    api.server.close();
  }
});

test('store: local-only mode never talks to the server', async () => {
  let calls = 0;
  const s = new Store({ storage: memStorage(), apiBase: 'http://x', fetchFn: () => { calls++; throw new Error('no'); }, autoSync: false });
  s.useLocalOnly();
  assert.equal(await s.connect(), 'local');
  s.commit([set(['settings', 'brand'], 'name')]);
  await s.sync();
  assert.equal(calls, 0);
  assert.equal(s.state.settings.brand, 'name');
});
