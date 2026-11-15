// Counting the pantry in packages (SPEC §13.5): the family counts jars, boxes and bags; the planner
// keeps amounts in the recipe box's units (oz of marinara, slices of bread). One package is worth
// the size of the product the family last bought (a receipt or a picked product), else the
// catalog's single-store pack. Pure: no DOM.

import { containerSize, normUnit } from './scanqty.js';

const WORDS = ['jar', 'bottle', 'can', 'box', 'bag', 'loaf', 'pouch', 'tub', 'carton', 'canister', 'jug', 'bowl', 'tray', 'sleeve', 'pack', 'package', 'bunch', 'head'];
const PLURAL = { box: 'boxes', pouch: 'pouches', loaf: 'loaves', bunch: 'bunches', package: 'packages' };
/** Units that already count packages: 3 cans are 3 cans. */
const COUNTED = new Set(['can', 'bottle', 'jar', 'box', 'bag', 'pouch', 'bowl', 'pack', 'package', 'tub', 'carton', 'crust', 'biscuit', 'each', 'item', 'unit']);

export const plural = (word, n) => (Math.abs(n - 1) < 1e-9 ? word : PLURAL[word] || `${word}s`);

function wordFrom(text) {
  const s = String(text || '').toLowerCase();
  if (/\bgallon\b/.test(s)) return 'jug';
  let best = null;
  for (const w of WORDS) {
    const m = new RegExp(`\\b${w}(e?s)?\\b`).exec(s);
    if (m && (!best || m.index < best.index)) best = { w, index: m.index };
  }
  return best?.w || null;
}

/** What a package of this is usually called, when no label says. */
function defaultWord(name, unit) {
  const n = String(name || '').toLowerCase();
  if (unit === 'slice' && /bread|loaf/.test(n)) return 'loaf';
  if (/milk/.test(n)) return 'jug';
  if (/cereal|cracker|pasta|spaghetti|macaroni|penne|cookies|graham|rice sides?|mix\b/.test(n)) return 'box';
  if (/sauce|salsa|jelly|jam|giardiniera|pickle|peanut butter|mayo|marinara|masala|nopalitos|olives|seasoning|spice/.test(n)) return 'jar';
  if (/oil|vinegar|ketchup|mustard|dressing|syrup|soy|honey/.test(n)) return 'bottle';
  if (/fries|chips|frozen|shredded|rice|buns|tortilla|bag|nuggets|corn|vegetables|peas|broccoli/.test(n)) return 'bag';
  if (/butter/.test(n)) return 'box';
  return 'pack';
}

/** The family's latest product for an item at either store (what's most likely on the shelf). */
function latestProduct(state, id) {
  let best = null;
  for (const store of ['jewel', 'sams']) {
    const p = state?.myProducts?.[`${store}/${id}`];
    if (!p || !(Number(p.packSize) > 0)) continue;
    const when = String(p.date || p.at || '');
    if (!best || when > best.when) best = { ...p, when };
  }
  return best;
}

/**
 * How an item is counted on the shelf. → { per, word, counted } or null (staples, or nothing to go on).
 * per = recipe units in one package; counted = the unit already counts packages (cans, bowls).
 */
export function packageOf(db, state, id) {
  const ing = db.ingredients[id];
  const custom = !ing ? state?.custom?.[id] : null;
  if (!ing && !custom) return null;
  if ((ing || custom).kind === 'staple') return null;
  const unit = normUnit((ing || custom).unit) || 'each';
  if (COUNTED.has(unit)) return { per: 1, word: unit === 'each' || unit === 'item' || unit === 'unit' ? 'pack' : unit, counted: true };
  const own = Number(state?.pantry?.[id]?.per);
  const mine = latestProduct(state, id);
  const per = own > 0 ? own : mine ? Number(mine.packSize) : ing ? containerSize(ing) : null;
  if (!(per > 0)) return null;
  const pack = ing?.packs?.jewel?.name || ing?.packs?.jewel?.generic || ing?.packs?.sams?.generic;
  const word = wordFrom(mine?.name) || wordFrom(ing?.container?.label) || wordFrom(pack?.label) || defaultWord((ing || custom).name, unit);
  return { per, word, counted: false };
}

/** Packages on the shelf for an amount in recipe units (quarters, so "½ jar" reads right). */
export function packagesFor(qty, per) {
  if (!(per > 0) || typeof qty !== 'number') return null;
  return Math.round((qty / per) * 4) / 4;
}
