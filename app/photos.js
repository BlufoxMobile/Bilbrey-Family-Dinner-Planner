// Pantry photos (SPEC §13): the family's own pictures of what's on their shelves. The pictures live
// in the family's passcode-protected storage on the server (never in the public site), keyed by a
// random id; state.itemPhotos[itemId] = { photo, at, by } says which picture shows which item.
// This phone keeps a copy of each picture it has seen (Cache Storage), so they load offline.

const urls = new Map(); // photo id → object URL
const inflight = new Map();
const CACHE = 'bfdp-photos-v1';
const ID_RE = /^[a-f0-9]{32}$/;
const cacheKey = (id) => new URL(`./__photo/${id}`, globalThis.location?.href || 'http://localhost/').href;

/** The photo id that shows an item, or null. */
export function itemPhoto(state, itemId) {
  const p = state?.itemPhotos?.[itemId]?.photo;
  return typeof p === 'string' && ID_RE.test(p) ? p : null;
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
