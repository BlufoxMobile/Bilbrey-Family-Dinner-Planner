// Checked prices, sales and coupons (SPEC §12.3). Jewel-Osco and Sam's Club don't let apps read
// their prices or coupons, so these come from a price check: someone (usually Claude, reading the
// store's own site) writes what the shelf price, the sale and the clip-able coupon were on a date.
// The list then shows "about $X after sales and coupons", and which coupons to clip first.
// Pure: no DOM, no clock (today is passed in).
//
// state.deals["jewel/bodyArmorOM"] = {
//   label, size (catalog units), price (shelf price for that pack today, sale included),
//   was (regular price, optional), ends (YYYY-MM-DD the sale ends, optional),
//   coupon: { price (pack price once clipped), text, expires, clipped (already clipped in the
//             family's account), q (words that find it on the store's coupon page) } (optional),
//   checked (YYYY-MM-DD), by, url (optional)
// }

import { diffDays } from './util.js';

/** A price check is good for two weeks; a sale or coupon only until it ends. */
export const DEAL_DAYS = 14;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

export function dealKey(store, id) { return `${store}/${id}`; }

/** The checked price for an item at a store, still current on `today`, or null. */
export function activeDeal(state, store, id, today = null) {
  const d = state?.deals?.[dealKey(store, id)];
  if (!d || typeof d !== 'object') return null;
  const size = num(d.size);
  const price = num(d.price);
  if (!(size > 0) || !(price >= 0)) return null;
  if (today && ISO.test(String(d.checked || '')) && diffDays(today, d.checked) > DEAL_DAYS) return null;
  const was = num(d.was);
  const saleOn = !d.ends || !today || d.ends >= today;
  const shelf = saleOn ? price : (was != null && was > 0 ? was : price);
  let coupon = null;
  const cp = num(d.coupon?.price);
  if (d.coupon && cp != null && cp >= 0 && (!d.coupon.expires || !today || d.coupon.expires >= today)) {
    coupon = {
      price: cp, text: String(d.coupon.text || 'Clip the store coupon'), expires: ISO.test(String(d.coupon.expires || '')) ? d.coupon.expires : null,
      clipped: d.coupon.clipped === true, q: typeof d.coupon.q === 'string' ? d.coupon.q.slice(0, 60) : '',
    };
  }
  return {
    key: dealKey(store, id), store, id, size, shelf,
    regular: was != null && was > shelf ? was : null,
    sale: saleOn && was != null && was > price,
    ends: saleOn && ISO.test(String(d.ends || '')) ? d.ends : null,
    coupon,
    price: coupon && coupon.price < shelf ? coupon.price : shelf,
    label: d.label ? String(d.label) : '',
    checked: ISO.test(String(d.checked || '')) ? d.checked : null,
    by: d.by ? String(d.by) : '',
    url: d.url ? String(d.url) : null,
  };
}

/**
 * The list's pack for an item, priced from a current price check. The checked product replaces the
 * usual one (the check is for the exact product on the shelf that day).
 */
export function applyDeal(pack, deal) {
  if (!deal) return pack;
  return {
    ...(pack || {}),
    size: deal.size,
    price: deal.price,
    shelf: deal.shelf,
    regular: deal.regular,
    coupon: deal.coupon,
    sale: deal.sale,
    ends: deal.ends,
    label: deal.label || pack?.label || '',
    url: deal.url || pack?.url || null,
    store: deal.store,
    kind: 'deal',
    source: 'checked',
    date: deal.checked,
    product: undefined,
  };
}

/** What one pack would cost without the sale and coupon (for "you save"). */
export function regularPrice(pack) {
  if (!pack) return null;
  if (pack.kind !== 'deal') return pack.price;
  return pack.regular != null ? pack.regular : pack.shelf ?? pack.price;
}
