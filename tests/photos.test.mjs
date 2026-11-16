// docs/spec/23: store product pictures. The fallback behind every picture in the app (the family's
// own photo wins over the store's), the allowlist of store image hosts, which pictures are wanted,
// and the importer behind window.bilbrey.importStorePhotos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realDb } from './helpers.mjs';
import {
  itemPhoto, ownPhoto, storePhoto, storeImageRequest, isStoreImageHost, STORE_IMAGE_HOSTS, productImages, missingStorePhotos,
  storePhotoOps, importStorePhotos, fetchStorePhoto,
} from '../app/photos.js';
import { applyOps } from '../app/state.js';
import { normalizeProducts } from '../app/data.js';
import { photoCents, photoCostHint, photoCostDetail, scanAverageText, aiStatus } from '../app/claude.js';

const db = realDb();
const A = 'a'.repeat(32);
const B = 'b'.repeat(32);
const C = 'c'.repeat(32);
const JEWEL = 'https://images.albertsons-media.com/is/image/ABS/184070124';
const SAMS = 'https://scene7.samsclub.com/is/image/samsclub/0007874235186_A';
const ids = Object.keys(db.ingredients);
const [I1, I2, I3, I4] = ids;

test('itemPhoto: the family’s own picture wins; the store’s picture is the fallback', () => {
  assert.equal(itemPhoto({}, I1), null);
  assert.equal(itemPhoto(null, I1), null);
  const store = { storePhotos: { [I1]: { photo: B, store: 'jewel', product: 'X', at: 't' } } };
  assert.equal(itemPhoto(store, I1), B, 'only a store picture: it shows');
  assert.equal(ownPhoto(store, I1), null);
  assert.equal(storePhoto(store, I1), B);
  const both = { ...store, itemPhotos: { [I1]: { photo: A, at: 't', by: 'Candi' } } };
  assert.equal(itemPhoto(both, I1), A, 'a picture the family took wins');
  assert.equal(ownPhoto(both, I1), A);
  assert.equal(storePhoto(both, I1), B);
  assert.equal(itemPhoto({ storePhotos: { [I1]: { photo: 'not-an-id' } }, itemPhotos: { [I1]: { photo: 'nope' } } }, I1), null, 'only real photo ids');
  assert.equal(itemPhoto({ itemPhotos: { [I1]: { photo: 'bad' } }, storePhotos: { [I1]: { photo: C } } }, I1), C, 'a broken own entry falls through to the store’s');
});

test('the allowlist: only https, only the stores’ own image hosts, and the query is replaced', () => {
  assert.deepEqual(Object.keys(STORE_IMAGE_HOSTS).sort(), ['i5.samsclubimages.com', 'images.albertsons-media.com', 'scene7.samsclub.com']);
  assert.ok(isStoreImageHost('IMAGES.albertsons-media.com'));
  assert.ok(!isStoreImageHost('images.albertsons-media.com.evil.example'));
  assert.ok(!isStoreImageHost('toString'));

  const j = storeImageRequest(`${JEWEL}?$ng-ecom-pdp-desktop$&defaultImage=Not_Available`);
  assert.deepEqual(j, {
    ok: true, host: 'images.albertsons-media.com', store: 'jewel', source: JEWEL,
    url: `${JEWEL}?wid=480&hei=480&fit=constrain&fmt=jpeg&qlt=85&defaultImage=`,
  });
  const s = storeImageRequest(`  ${SAMS}?wid=2000&hei=2000  `);
  assert.equal(s.store, 'sams');
  assert.equal(s.url, `${SAMS}?wid=480&hei=480&fit=constrain&fmt=jpeg&qlt=85&defaultImage=`);
  const asr = storeImageRequest('https://i5.samsclubimages.com/asr/7d8a3a52-aaaa-bbbb-cccc-0123456789ab.e0f1.jpeg?odnHeight=2000&odnWidth=2000&odnBg=FFFFFF');
  assert.equal(asr.ok, true);
  assert.equal(asr.url, 'https://i5.samsclubimages.com/asr/7d8a3a52-aaaa-bbbb-cccc-0123456789ab.e0f1.jpeg?odnWidth=480&odnHeight=480&odnBg=FFFFFF');
  assert.equal(asr.store, 'sams');

  const bad = [
    'http://images.albertsons-media.com/is/image/ABS/1', // not https
    'https://example.com/is/image/ABS/1.jpg', // not a store host
    'https://images.albertsons-media.com.example.com/is/image/ABS/1',
    'https://user:pw@images.albertsons-media.com/is/image/ABS/1',
    'https://images.albertsons-media.com:8443/is/image/ABS/1',
    'https://images.albertsons-media.com/is/content/ABS/file.pdf', // Scene7, but not an image
    'https://scene7.samsclub.com/',
    'https://www.samsclub.com/ip/some-product/123', // a product page, not a picture
    'https://www.jewelosco.com/shop/product-details.184070124.html',
    'https://i5.walmartimages.com/asr/x.jpeg', // the parent company’s CDN is not Sam’s Club’s
    'data:image/png;base64,AAAA', 'javascript:alert(1)', 'not a link', '', null, 42, `${JEWEL}/${'x'.repeat(700)}`,
  ];
  for (const u of bad) {
    const r = storeImageRequest(u);
    assert.equal(r.ok, false, String(u));
    assert.ok(r.error.length > 5);
  }
  assert.match(storeImageRequest('https://example.com/a.jpg').error, /only fetched from the stores’ own image hosts/);
});

test('data/products.json options may carry an image link; anything that isn’t https is dropped', () => {
  const p = normalizeProducts({ products: { chicken: { jewel: [
    { name: 'Chicken A', packSize: 3, price: 9, image: JEWEL },
    { name: 'Chicken B', packSize: 3, price: 9, image: 'http://insecure.example/x.jpg' },
    { name: 'Chicken C', packSize: 3, price: 9 },
  ] } } });
  assert.equal(p.byId.chicken.jewel[0].image, JEWEL);
  assert.ok(!('image' in p.byId.chicken.jewel[1]));
  assert.ok(!('image' in p.byId.chicken.jewel[2]));
});

test('which pictures are wanted: product records with an image link (my product, a price check, the picked option)', () => {
  const dbx = { ...db, products: { byId: { [I3]: { sams: [{ name: 'Researched pick', image: SAMS }] } } } };
  const state = {
    myProducts: {
      [`jewel/${I1}`]: { name: 'Jewel thing', image: JEWEL },
      [`sams/${I1}`]: { name: 'Sams thing', image: SAMS },
      [`sams/${I3}`]: { name: 'Researched pick' }, // no link of its own: the option it was picked from has one
      [`jewel/${I4}`]: { name: 'No picture link' },
      'jewel/not-an-item': { name: 'Ghost', image: JEWEL },
      [`sams/${I2}`]: { name: 'Off-list host', image: 'https://example.com/a.jpg' },
    },
    deals: { [`jewel/${I2}`]: { label: 'Checked product', size: 1, price: 2, image: `${JEWEL}9` } },
    storeFor: { [I1]: 'jewel' },
  };
  const want = productImages(dbx, state);
  assert.deepEqual(want.find((e) => e.itemId === I1), { itemId: I1, store: 'jewel', url: JEWEL, product: 'Jewel thing' }, 'the store the family buys it at');
  assert.deepEqual(want.find((e) => e.itemId === I2), { itemId: I2, store: 'jewel', url: `${JEWEL}9`, product: 'Checked product' });
  assert.deepEqual(want.find((e) => e.itemId === I3), { itemId: I3, store: 'sams', url: SAMS, product: 'Researched pick' });
  assert.equal(want.length, 3);
  assert.equal(productImages(dbx, { ...state, storeFor: {} }).find((e) => e.itemId === I1).store, 'sams', 'no preference: Sam’s first');

  assert.equal(missingStorePhotos(dbx, state).length, 3);
  const have = applyOps(state, storePhotoOps({ itemId: I1, photo: A, store: 'jewel', product: 'Jewel thing', at: 't' }));
  assert.deepEqual(have.storePhotos[I1], { photo: A, store: 'jewel', product: 'Jewel thing', at: 't' });
  assert.deepEqual(missingStorePhotos(dbx, have).map((e) => e.itemId).sort(), [I2, I3].sort(), 'a stored picture of that product is not fetched again');
  const changed = { ...have, myProducts: { ...have.myProducts, [`jewel/${I1}`]: { name: 'A different product', image: `${JEWEL}7` } } };
  assert.ok(missingStorePhotos(dbx, changed).some((e) => e.itemId === I1), 'a different product gets its own picture');
});

// ---------------------------------------------------------------- the importer

function harness(initial = {}) {
  let state = initial;
  const calls = [];
  const commits = [];
  const served = new Map(); // url → photo id (the server reuses a picture it already has)
  let n = 0;
  const deps = {
    db,
    state: () => state,
    wait: async () => {},
    now: () => '2026-11-15T20:00:00.000Z',
    commit: (ops) => { commits.push(ops); state = applyOps(state, ops); },
    fetchPhoto: async (url, opts) => {
      calls.push(url);
      if (deps.behave) { const r = await deps.behave(url, calls.length, opts); if (r) return r; }
      if (served.has(url) && !opts?.refresh) return { id: served.get(url), reused: true };
      const id = (++n).toString(16).padStart(32, '0');
      served.set(url, id);
      return { id, reused: false };
    },
  };
  return { deps, calls, commits, get state() { return state; } };
}
const apiError = (status, message, data = {}, retryAfter = 0) => Object.assign(new Error(message), { status, data, retryAfter });

test('importStorePhotos saves every picture, in batches, and running it again changes nothing', async () => {
  const h = harness();
  const list = [
    { itemId: I1, url: `${JEWEL}1`, store: 'jewel', product: 'Product one' },
    { itemId: I2, url: `${SAMS}`, store: 'sams', product: 'Product two' },
    { itemId: I3, url: `${JEWEL}3`, product: 'Store worked out from the host' },
  ];
  const r = await importStorePhotos(list, { ...h.deps, batch: 2 });
  assert.equal(r.total, 3);
  assert.equal(r.saved, 3);
  assert.equal(r.failed + r.skipped + r.unchanged, 0);
  assert.equal(h.commits.length, 2, 'two pictures, then the last one');
  assert.deepEqual(h.state.storePhotos[I1], { photo: r.results[0].photo, store: 'jewel', product: 'Product one', at: '2026-11-15T20:00:00.000Z' });
  assert.equal(h.state.storePhotos[I2].store, 'sams');
  assert.equal(h.state.storePhotos[I3].store, 'jewel');
  assert.match(h.state.storePhotos[I3].photo, /^[a-f0-9]{32}$/);

  const again = await importStorePhotos(list, h.deps);
  assert.equal(again.saved, 0);
  assert.equal(again.unchanged, 3);
  assert.equal(h.commits.length, 2, 'nothing new to save');

  // The family took its own picture meanwhile: the importer never touches itemPhotos, and theirs still wins.
  const own = harness({ itemPhotos: { [I1]: { photo: C } } });
  await importStorePhotos(list, own.deps);
  assert.equal(own.state.itemPhotos[I1].photo, C);
  assert.equal(itemPhoto(own.state, I1), C);
});

test('importStorePhotos skips bad entries and reports them; one failure never stops the rest', async () => {
  const h = harness();
  h.deps.behave = (url) => {
    if (url.endsWith('missing')) throw apiError(404, 'images.albertsons-media.com has no picture at that address.', { notFound: true });
    if (url.endsWith('huge')) throw apiError(413, 'That picture is larger than 400 KB.');
    return null;
  };
  const r = await importStorePhotos([
    { itemId: I1, url: `${JEWEL}1`, store: 'jewel', product: 'Good' },
    { itemId: 'no-such-item', url: `${JEWEL}2`, store: 'jewel' },
    { itemId: I2, url: 'https://example.com/pic.jpg', store: 'jewel' },
    { itemId: I3, url: `${JEWEL}missing`, store: 'jewel' },
    { itemId: I4, url: `${JEWEL}huge`, store: 'jewel' },
    { itemId: I1, url: `${JEWEL}dup`, store: 'jewel' },
    null, 'chicken', { url: JEWEL },
    { itemId: ids[5], url: `${JEWEL}6`, store: 'jewel', product: 'Also good' },
  ], h.deps);
  assert.equal(r.total, 10);
  assert.equal(r.saved, 2);
  assert.equal(r.failed, 2);
  assert.equal(r.skipped, 6);
  assert.deepEqual(r.results.map((x) => x.status), ['saved', 'skipped', 'skipped', 'failed', 'failed', 'skipped', 'skipped', 'skipped', 'skipped', 'saved']);
  assert.match(r.results[1].error, /isn’t in the recipe box/);
  assert.match(r.results[2].error, /only fetched from the stores’ own image hosts/);
  assert.equal(r.results[3].httpStatus, 404);
  assert.match(r.results[5].error, /Listed twice/);
  assert.equal(h.calls.length, 4, 'bad entries are never sent to the server');
  assert.ok(h.state.storePhotos[I1] && h.state.storePhotos[ids[5]]);
  assert.ok(!h.state.storePhotos[I3]);
  assert.equal(r.stopped, null);

  const dry = harness();
  const d = await importStorePhotos([{ itemId: I1, url: JEWEL }, { itemId: 'nope', url: JEWEL }], { ...dry.deps, dryRun: true });
  assert.deepEqual(d.results.map((x) => x.status), ['ready', 'skipped']);
  assert.equal(dry.calls.length, 0, 'a dry run fetches nothing');
  assert.equal(dry.commits.length, 0);
});

test('a host that refuses the family server is reported and left alone; a busy server is retried', async () => {
  const h = harness();
  h.deps.behave = (url) => {
    if (url.includes('samsclub')) throw apiError(502, 'scene7.samsclub.com refused the family server (HTTP 403), so the picture wasn’t saved.', { refused: true, host: 'scene7.samsclub.com' });
    return null;
  };
  const list = [
    ...[0, 1, 2, 3, 4].map((k) => ({ itemId: ids[k], url: `${SAMS}${k}`, store: 'sams' })),
    { itemId: ids[6], url: `${JEWEL}6`, store: 'jewel' },
  ];
  const r = await importStorePhotos(list, { ...h.deps, concurrency: 1 });
  assert.equal(r.saved, 1, 'the other store’s pictures still come through');
  assert.equal(r.failed, 5);
  assert.deepEqual(r.refusedHosts, ['scene7.samsclub.com']);
  assert.equal(h.calls.filter((u) => u.includes('samsclub')).length, 3, 'three refusals in a row, then the host is left alone (no retries, no workarounds)');
  assert.match(r.results[4].error, /refusing the family server/);
  assert.ok(r.results.slice(0, 5).every((x) => x.refused));

  // 429 and timeouts are retried; the picture is saved on the second try.
  const busy = harness();
  let tries = 0;
  busy.deps.behave = () => { tries++; if (tries === 1) throw apiError(429, 'Too many pictures at once.', {}, 2); if (tries === 2) throw apiError(504, 'Couldn’t reach the host.'); return null; };
  const ok = await importStorePhotos([{ itemId: I1, url: JEWEL }], busy.deps);
  assert.equal(ok.saved, 1);
  assert.equal(busy.calls.length, 3);

  // No passcode on this device: stop at once, keep what was saved, say why.
  const locked = harness();
  locked.deps.behave = (url, n) => { if (n >= 2) throw apiError(401, 'Wrong family passcode.'); return null; };
  const stopped = await importStorePhotos([0, 1, 2, 3].map((k) => ({ itemId: ids[k], url: `${JEWEL}${k}` })), { ...locked.deps, concurrency: 1 });
  assert.equal(stopped.saved, 1);
  assert.equal(stopped.failed, 3);
  assert.equal(stopped.stopped, 'Wrong family passcode.');
  assert.equal(locked.calls.length, 2, 'nothing more is tried after a 401');
  assert.ok(locked.state.storePhotos[ids[0]], 'what was fetched before the stop is kept');
});

test('fetchStorePhoto posts the link to the family server and checks the answer', async () => {
  const sent = [];
  const store = { api: async (method, path, body, opts) => { sent.push({ method, path, body, opts }); return { ok: true, id: A, reused: true }; } };
  assert.deepEqual(await fetchStorePhoto(store, JEWEL), { id: A, reused: true });
  assert.deepEqual(sent[0].body, { url: JEWEL });
  assert.equal(sent[0].path, '/api/photo/fetch');
  await fetchStorePhoto(store, JEWEL, { refresh: true });
  assert.deepEqual(sent[1].body, { url: JEWEL, refresh: true });
  await assert.rejects(fetchStorePhoto({ api: async () => ({ ok: true }) }, JEWEL), /didn’t save/);
});

// ---------------------------------------------------------------- what a photo costs

test('the cost hint is the real arithmetic: the first photo of a scan stores the list, the rest read it', () => {
  const opus = { inUsd: 4, outUsd: 20, cacheWriteUsd: 5, cacheReadUsd: 0.2 };
  const c = photoCents(opus);
  // (1,700 photo tokens x $4 + 800 out x $20 + 7,600 list tokens x $5) / 1M = 6.08¢; reading the list: x $0.20 → 2.43¢
  assert.ok(Math.abs(c.first - 6.08) < 0.005, String(c.first));
  assert.ok(Math.abs(c.next - 2.432) < 0.005, String(c.next));
  assert.equal(photoCostHint(opus), 'About 2–6¢ a photo');
  assert.equal(photoCostHint({ inUsd: 0.1, outUsd: 0.5, cacheWriteUsd: 0.125, cacheReadUsd: 0.01 }), 'Under 1¢ a photo');
  assert.match(photoCostDetail(opus), /first photo of a scan costs about 6¢ and each one after it about 2¢/);
  assert.equal(photoCostDetail({}), '');
  assert.equal(photoCents({ inUsd: 'x' }), null);

  assert.equal(scanAverageText({ scan: { photos: 12, usd: 0.36 } }), 'about 3¢ each this month');
  assert.equal(scanAverageText({ scan: { photos: 2, usd: 0.1 } }), '', 'too few photos to call it an average');
  assert.equal(scanAverageText({}), '');
  const info = { keySet: true, model: 'claude-opus-5-5', spentUsd: 1, capUsd: 5, scan: { photos: 10, usd: 0.31 } };
  assert.equal(aiStatus(info, 'claude-opus-5-5').text, 'Claude Opus 5.5 reads your photos, about 3¢ each this month');
});
