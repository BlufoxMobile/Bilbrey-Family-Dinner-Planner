// Pantry photos (SPEC §13): the family's own pictures of what's on their shelves. The pictures live
// in the family's passcode-protected storage on the server (never in the public site), keyed by a
// random id; state.itemPhotos[itemId] = { photo, at, by } says which picture shows which item.
// This phone keeps a copy of each picture it has seen (Cache Storage), so they load offline.
//
// Store product pictures (docs/spec/23): the family server also keeps the store's own picture of
// each product the family buys, in the same private storage: state.storePhotos[itemId] =
// { photo, store, product, at }. The server fetches it itself from the store's image host (a short
// allowlist, below, shared with the Worker). A picture the family took always wins over it.
//
// No imports and no DOM at module level: the Worker imports the allowlist from this file.

const urls = new Map(); // photo id → object URL
const inflight = new Map();
const CACHE = 'bfdp-photos-v1';
const ID_RE = /^[a-f0-9]{32}$/;
const cacheKey = (id) => new URL(`./__photo/${id}`, globalThis.location?.href || 'http://localhost/').href;
/** The object URL of a picture this phone has already loaded, or '' (so a re-render shows it at once). */
export const cachedPhotoUrl = (id) => urls.get(id) || '';
const photoIdOf = (rec) => (rec && typeof rec.photo === 'string' && ID_RE.test(rec.photo) ? rec.photo : null);

/** The family's own picture of an item (taken or cropped from a scan), or null. */
export function ownPhoto(state, itemId) {
  return photoIdOf(state?.itemPhotos?.[itemId]);
}

/** The store's product picture kept for an item, or null. */
export function storePhoto(state, itemId) {
  return photoIdOf(state?.storePhotos?.[itemId]);
}

/** The photo id that shows an item: the family's own picture first, else the store's; or null. */
export function itemPhoto(state, itemId) {
  return ownPhoto(state, itemId) || storePhoto(state, itemId);
}

// ---------------------------------------------------------------- the stores' image hosts

/** Pictures are asked for at about this size (px, longest side) where the host can resize. */
export const STORE_PHOTO_PX = 480;

/**
 * The only hosts a product picture is ever fetched from: the stores' own image servers.
 *  - scene7.samsclub.com and images.albertsons-media.com (Jewel-Osco's parent) are Adobe Scene7
 *    image servers: /is/image/<company>/<id>, resized with wid / hei.
 *  - i5.samsclubimages.com is Sam's Club's newer image CDN: resized with odnWidth / odnHeight.
 */
export const STORE_IMAGE_HOSTS = Object.freeze({
  'scene7.samsclub.com': Object.freeze({ store: 'sams', kind: 'scene7' }),
  'i5.samsclubimages.com': Object.freeze({ store: 'sams', kind: 'asr' }),
  'images.albertsons-media.com': Object.freeze({ store: 'jewel', kind: 'scene7' }),
});

export function isStoreImageHost(host) {
  return Object.prototype.hasOwnProperty.call(STORE_IMAGE_HOSTS, String(host || '').toLowerCase());
}

/**
 * Checks a product-picture link and builds the request the family server makes for it.
 * → { ok: true, url, source, host, store } | { ok: false, error }
 * `source` is the picture's address without any query (what the server remembers it by); `url`
 * asks the host for a ~480 px JPEG. Whatever query the link came with is dropped, so a link can't
 * ask the host for anything but that picture.
 */
export function storeImageRequest(raw) {
  const bad = (error) => ({ ok: false, error });
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return bad('Give the picture’s link.');
  if (text.length > 600) return bad('That link is too long to be a product picture.');
  let u;
  try { u = new URL(text); } catch { return bad('That isn’t a link.'); }
  if (u.protocol !== 'https:') return bad('Only https picture links are fetched.');
  if (u.username || u.password || (u.port && u.port !== '443')) return bad('That link isn’t a plain picture address.');
  const host = u.hostname.toLowerCase();
  if (!isStoreImageHost(host)) {
    return bad(`Pictures are only fetched from the stores’ own image hosts (${Object.keys(STORE_IMAGE_HOSTS).join(', ')}), not ${host.slice(0, 80)}.`);
  }
  const info = STORE_IMAGE_HOSTS[host];
  const path = u.pathname;
  if (path.length < 2 || path.length > 400) return bad('That link isn’t a product picture.');
  if (info.kind === 'scene7' && !path.startsWith('/is/image/')) return bad(`A picture on ${host} starts with /is/image/.`);
  const source = `https://${host}${path}`;
  const px = STORE_PHOTO_PX;
  const url = info.kind === 'scene7'
    ? `${source}?wid=${px}&hei=${px}&fit=constrain&fmt=jpeg&qlt=85&defaultImage=` // defaultImage= : a missing picture is an error, not a placeholder
    : `${source}?odnWidth=${px}&odnHeight=${px}&odnBg=FFFFFF`;
  return { ok: true, url, source, host, store: info.store };
}

// ---------------------------------------------------------------- which pictures are wanted

const httpsUrl = (v) => (typeof v === 'string' && /^https:\/\//.test(v.trim()) ? v.trim() : '');
const knownItem = (db, state, id) => typeof id === 'string' && !!(db?.ingredients?.[id] || state?.custom?.[id]);

/**
 * The picture link each item's product record carries (optional `image` on a myProducts entry, a
 * price check in state.deals, or the data/products.json option the family picked), one per item:
 * the store the family buys it at first. → [{ itemId, store, url, product }]
 */
export function productImages(db, state) {
  const found = new Map(); // itemId → { store: entry }
  const add = (itemId, store, url, product) => {
    if (!knownItem(db, state, itemId) || !['sams', 'jewel'].includes(store) || !storeImageRequest(url).ok) return;
    const per = found.get(itemId) || {};
    if (!per[store]) per[store] = { itemId, store, url, product: String(product || '').slice(0, 120) };
    found.set(itemId, per);
  };
  const split = (key) => { const i = String(key).indexOf('/'); return i > 0 ? [key.slice(0, i), key.slice(i + 1)] : [null, null]; };
  for (const [key, p] of Object.entries(state?.myProducts || {})) {
    if (!p || typeof p !== 'object') continue;
    const [store, id] = split(key);
    let url = httpsUrl(p.image);
    if (!url) url = httpsUrl((db?.products?.byId?.[id]?.[store] || []).find((o) => o.name === p.name)?.image);
    if (url) add(id, store, url, p.name);
  }
  for (const [key, d] of Object.entries(state?.deals || {})) {
    if (!d || typeof d !== 'object' || !httpsUrl(d.image)) continue;
    const [store, id] = split(key);
    add(id, store, httpsUrl(d.image), d.label);
  }
  const out = [];
  for (const [itemId, per] of found) {
    const pref = state?.storeFor?.[itemId];
    out.push(per[pref] || per.sams || per.jewel);
  }
  return out;
}

/** The pictures still to fetch: an item with a picture link and no stored picture of that product. */
export function missingStorePhotos(db, state) {
  return productImages(db, state).filter((e) => {
    const sp = state?.storePhotos?.[e.itemId];
    return !(photoIdOf(sp) && sp.store === e.store && String(sp.product || '') === e.product);
  });
}

/** The op that records an item's store picture. */
export function storePhotoOps({ itemId, photo, store, product = '', at = new Date().toISOString() }) {
  return [{ op: 'set', path: ['storePhotos', itemId], value: { photo, store, product: String(product || '').slice(0, 120), at } }];
}

// ---------------------------------------------------------------- fetching them

/** Asks the family server to fetch one store picture. → { id, reused } (rejects with the store's ApiError). */
export async function fetchStorePhoto(store, url, { refresh = false } = {}) {
  const r = await store.api('POST', '/api/photo/fetch', refresh ? { url, refresh: true } : { url }, { timeoutMs: 40000 });
  if (!r?.id || !ID_RE.test(r.id)) throw Object.assign(new Error('The family server didn’t save that picture.'), { status: 502 });
  return { id: r.id, reused: !!r.reused };
}

const RETRY_STATUS = new Set([0, 429, 500, 504]);
const STOP_STATUS = new Set([401, 403, 507]); // no passcode, not allowed here, storage full: nothing later will work either

/**
 * Fetches and saves store pictures for a list of items in one go.
 *   list: [{ itemId, url, store?, product? }]
 *   deps: { db, state: () => state, fetchPhoto(url, { refresh }) → { id, reused }, commit(ops) }
 * Robust by design: a bad entry or a failed fetch never stops the rest; every entry is reported;
 * a host that refuses the family server three times in a row is left alone (reported, not worked
 * around); progress is committed every `batch` pictures; and it is safe to run again: a picture the
 * server already has comes back at once, and an item that already shows it is left untouched.
 * → { total, saved, unchanged, failed, skipped, refusedHosts, stopped, dryRun, results: [{ itemId, status, photo?, error?, httpStatus? }] }
 */
export async function importStorePhotos(list, {
  db, state, fetchPhoto, commit, concurrency = 3, batch = 20, dryRun = false, refresh = false, retries = 2,
  now = () => new Date().toISOString(), wait = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const getState = typeof state === 'function' ? state : () => state;
  const entries = Array.isArray(list) ? list : list ? [list] : [];
  const results = [];
  const todo = [];
  const seen = new Set();
  for (const raw of entries) {
    const itemId = raw && typeof raw === 'object' && typeof raw.itemId === 'string' ? raw.itemId.trim() : '';
    const res = { itemId: itemId || null, status: 'skipped' };
    results.push(res);
    if (!itemId) { res.error = 'No itemId.'; continue; }
    if (!knownItem(db, getState(), itemId)) { res.error = 'That item isn’t in the recipe box or on the family’s shelves.'; continue; }
    if (seen.has(itemId)) { res.error = 'Listed twice; the first one is used.'; continue; }
    const req = storeImageRequest(raw.url);
    if (!req.ok) { res.error = req.error; continue; }
    seen.add(itemId);
    const store = raw.store === 'sams' || raw.store === 'jewel' ? raw.store : req.store;
    todo.push({ res, itemId, url: String(raw.url).trim(), host: req.host, store, product: typeof raw.product === 'string' ? raw.product.trim().slice(0, 120) : '' });
    res.status = 'ready';
  }
  const summary = () => ({
    total: entries.length,
    saved: results.filter((r) => r.status === 'saved').length,
    unchanged: results.filter((r) => r.status === 'unchanged').length,
    failed: results.filter((r) => r.status === 'failed').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    refusedHosts: [...refused].filter(([, n]) => n >= 3).map(([h]) => h),
    stopped,
    dryRun,
    results,
  });
  const refused = new Map(); // host → refusals in a row
  let stopped = null;
  if (dryRun) return summary();

  let pendingOps = [];
  const flush = () => {
    if (!pendingOps.length) return;
    const ops = pendingOps;
    pendingOps = [];
    commit(ops);
  };
  let next = 0;
  const worker = async () => {
    for (;;) {
      const job = todo[next++];
      if (!job) return;
      const { res } = job;
      if (stopped) { res.status = 'failed'; res.error = stopped; continue; }
      if ((refused.get(job.host) || 0) >= 3) { res.status = 'failed'; res.refused = true; res.error = `${job.host} is refusing the family server, so its pictures were left alone.`; continue; }
      for (let attempt = 0; ; attempt++) {
        try {
          const got = await fetchPhoto(job.url, { refresh });
          refused.set(job.host, 0);
          const cur = getState()?.storePhotos?.[job.itemId];
          if (photoIdOf(cur) === got.id && cur.store === job.store && String(cur.product || '') === job.product) res.status = 'unchanged';
          else {
            pendingOps.push(...storePhotoOps({ itemId: job.itemId, photo: got.id, store: job.store, product: job.product, at: now() }));
            res.status = 'saved';
            if (pendingOps.length >= batch) flush();
          }
          res.photo = got.id;
          break;
        } catch (e) {
          const status = Number(e?.status) || 0;
          if (RETRY_STATUS.has(status) && attempt < retries && !stopped) {
            await wait(Math.min(30000, status === 429 ? (Number(e?.retryAfter) || 5) * 1000 : 1500 * (attempt + 1)));
            continue;
          }
          res.status = 'failed';
          res.httpStatus = status;
          res.error = e?.message || 'The picture couldn’t be fetched.';
          if (e?.data?.refused) { res.refused = true; refused.set(job.host, (refused.get(job.host) || 0) + 1); }
          if (STOP_STATUS.has(status) || status === 0) stopped = status === 0 ? 'No connection to the family server.' : res.error;
          break;
        }
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.max(1, Math.min(6, Number(concurrency) || 1)) }, worker));
  } finally {
    flush(); // whatever was fetched is kept, even if something above threw
  }
  return summary();
}

const tried = new Map(); // "itemId|store|product" → when this phone last tried
let ensuring = false;

/**
 * Quietly fetches the pictures of products the family picked (or a receipt / price check matched)
 * when the product record carries a picture link. A few at a time; a failure waits six hours.
 */
export async function ensureStorePhotos(app, { max = 6, retryMs = 6 * 3600 * 1000 } = {}) {
  const dev = app?.store?.device;
  if (ensuring || !dev?.key || dev.localOnly || globalThis.navigator?.onLine === false) return 0;
  const t = Date.now();
  const want = missingStorePhotos(app.db, app.state).filter((e) => t - (tried.get(`${e.itemId}|${e.store}|${e.product}`) || 0) > retryMs).slice(0, max);
  if (!want.length) return 0;
  for (const e of want) tried.set(`${e.itemId}|${e.store}|${e.product}`, t);
  ensuring = true;
  try {
    const r = await importStorePhotos(want, {
      db: app.db, state: () => app.state, concurrency: 2, retries: 0,
      fetchPhoto: (url, o) => fetchStorePhoto(app.store, url, o),
      commit: (ops) => app.store.commit(ops),
    });
    return r.saved;
  } catch {
    return 0;
  } finally {
    ensuring = false;
  }
}

/** An <img> source for a photo id (object URL), fetched once and kept on this phone. */
export async function photoUrl(store, id) {
  if (!ID_RE.test(String(id))) return null;
  if (urls.has(id)) return urls.get(id);
  if (inflight.has(id)) return inflight.get(id);
  const job = (async () => {
    let blob = null;
    const cache = globalThis.caches ? await caches.open(CACHE).catch(() => null) : null;
    const hit = cache ? await cache.match(cacheKey(id)).catch(() => null) : null;
    if (hit) blob = await hit.blob();
    else {
      blob = await store.getPhoto(id);
      if (cache && blob) await cache.put(cacheKey(id), new Response(blob, { headers: { 'Content-Type': blob.type || 'image/webp' } })).catch(() => {});
    }
    const u = URL.createObjectURL(blob);
    urls.set(id, u);
    return u;
  })().finally(() => inflight.delete(id));
  inflight.set(id, job);
  return job;
}

/** Fills every <img data-photo="id"> under root that has no picture yet. */
export function hydratePhotos(root, store) {
  if (!root) return;
  for (const img of root.querySelectorAll('img[data-photo]')) {
    const id = img.dataset.photo;
    if (img.getAttribute('src')) continue;
    if (urls.has(id)) { img.src = urls.get(id); continue; }
    photoUrl(store, id).then((u) => { if (u) img.src = u; }).catch(() => img.classList.add('is-missing'));
  }
}

/** Remembers a just-uploaded picture so it shows at once (no round trip). */
export async function rememberPhoto(id, blob) {
  if (!ID_RE.test(String(id)) || !blob) return;
  urls.set(id, URL.createObjectURL(blob));
  const cache = globalThis.caches ? await caches.open(CACHE).catch(() => null) : null;
  if (cache) await cache.put(cacheKey(id), new Response(blob, { headers: { 'Content-Type': blob.type || 'image/webp' } })).catch(() => {});
}

function loadImage(src) {
  return new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('unreadable')); i.src = src; });
}

/**
 * A square picture of one item: the scanner's box around it (thousandths of the photo), padded a
 * little, or the middle of the photo when there's no box. → Blob (WebP, JPEG where WebP isn't made).
 */
export async function cropItem(src, box = null, { size = 360 } = {}) {
  const img = await loadImage(src);
  const W = img.naturalWidth || 1;
  const H = img.naturalHeight || 1;
  let x0; let y0; let x1; let y1;
  if (Array.isArray(box) && box.length === 4) {
    [x0, y0, x1, y1] = box.map((v, i) => (v / 1000) * (i % 2 ? H : W));
    const pad = 0.08 * Math.max(x1 - x0, y1 - y0);
    x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  } else {
    const s = Math.min(W, H) * 0.9;
    x0 = (W - s) / 2; y0 = (H - s) / 2; x1 = x0 + s; y1 = y0 + s;
  }
  // Square it around the middle, inside the photo.
  const side = Math.min(Math.max(x1 - x0, y1 - y0), W, H);
  const cx = Math.min(Math.max((x0 + x1) / 2, side / 2), W - side / 2);
  const cy = Math.min(Math.max((y0 + y1) / 2, side / 2), H - side / 2);
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(img, cx - side / 2, cy - side / 2, side, side, 0, 0, size, size);
  const blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.82));
  if (blob && blob.type === 'image/webp') return blob;
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
}
