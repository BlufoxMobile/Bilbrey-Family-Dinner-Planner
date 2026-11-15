// Pantry scan amounts → the recipe box's units.
//
// The scanner counts what it sees ("1 jar", "3 cans", "1 loaf"); the catalog measures many items in
// cooking units (oz of marinara, slices of bread, cups of rice). Without converting, "1 jar of Rao's"
// was saved as 1 oz and the list still bought nearly a full jar. A container is worth the size of one
// retail container: the catalog's `container.size` when set, else the single-store (Jewel) pack size,
// which is one jar / box / loaf / bag, else the Sam's pack.

const WEIGHT_OZ = { oz: 1, lb: 16, g: 1 / 28.3495, kg: 35.274 };
const SYNONYMS = {
  ounce: 'oz', ounces: 'oz', 'fl oz': 'oz', floz: 'oz', 'fluid ounce': 'oz', 'fluid ounces': 'oz',
  lbs: 'lb', pound: 'lb', pounds: 'lb', gram: 'g', grams: 'g', kilogram: 'kg', kilograms: 'kg',
  pkg: 'package', pkgs: 'package', packages: 'package', loaves: 'loaf', boxes: 'box', jars: 'jar',
  cans: 'can', bottles: 'bottle', bags: 'bag', pouches: 'pouch', cartons: 'carton', containers: 'container',
  tubs: 'tub', tins: 'tin', packets: 'packet', canisters: 'canister', jugs: 'jug', sleeves: 'sleeve',
  cases: 'case', items: 'item', units: 'unit', pieces: 'piece', ea: 'each', patties: 'patty',
};
/** Words that mean "one retail container" when the catalog measures in something else. */
const CONTAINERS = new Set(['jar', 'can', 'bottle', 'box', 'bag', 'package', 'pack', 'carton', 'container', 'tub', 'loaf',
  'pouch', 'tin', 'packet', 'canister', 'jug', 'sleeve', 'case', 'each', 'item', 'unit', 'piece']);
/** Catalog units that already count retail containers: 1 can is 1 can. */
const ONE_PER_CONTAINER = new Set(['can', 'bottle', 'jar']);

/** "Jars" → "jar", "fl. oz" → "oz", "lbs" → "lb". Null for nothing. */
export function normUnit(u) {
  let s = String(u ?? '').toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (SYNONYMS[s]) return SYNONYMS[s];
  if (WEIGHT_OZ[s]) return s;
  if (s.endsWith('s') && s.length > 3) s = s.slice(0, -1);
  return SYNONYMS[s] || s;
}

function basePack(ing) {
  const j = ing?.packs?.jewel;
  const s = ing?.packs?.sams;
  return j?.name || j?.generic || s?.generic || s?.name || null;
}

/** Catalog units in one retail container (1 jar of Rao's = 24 oz; 1 loaf = 16 slices), or null. */
export function containerSize(ing) {
  const c = Number(ing?.container?.size);
  if (c > 0) return c;
  if (ONE_PER_CONTAINER.has(normUnit(ing?.unit))) return 1;
  const p = basePack(ing);
  return Number(p?.size) > 0 ? Number(p.size) : null;
}

/** The net weight printed on a pack label, in oz ("20 oz", "2 lb bag", "~2.5 oz jar"), or null. */
export function labelOz(label) {
  const s = String(label || '');
  const lb = /(\d+(?:\.\d+)?)\s*(?:lb|lbs|pound)\b/i.exec(s);
  const oz = /(\d+(?:\.\d+)?)\s*(?:fl\.?\s*)?oz\b/i.exec(s);
  if (lb && (!oz || lb.index < oz.index)) return Number(lb[1]) * 16;
  return oz ? Number(oz[1]) : null;
}

/**
 * A scanned amount in the ingredient's own unit.
 * Returns { qty, per, from } — qty null when it can't be worked out; per = catalog units per
 * container when a container count was converted; from = what the scanner said ("1 jar").
 */
export function scanQtyIn(ing, qty, unit) {
  const q = Number(qty);
  if (!ing || !(q > 0)) return { qty: null, per: null, from: null };
  const cu = normUnit(ing.unit);
  const su = normUnit(unit);
  const from = `${round2(q)} ${unit || 'each'}`;
  if (su && su === cu) return { qty: round2(q), per: null, from };
  // Weight to weight: 2 lb of chicken, 24 oz of sauce.
  if (su && WEIGHT_OZ[su] && WEIGHT_OZ[cu]) return { qty: round2((q * WEIGHT_OZ[su]) / WEIGHT_OZ[cu]), per: null, from };
  // Weight into a cooking unit (2 lb of rice → cups): scale by the catalog pack's printed weight.
  if (su && WEIGHT_OZ[su]) {
    const size = containerSize(ing);
    const oz = labelOz(ing.container?.label || basePack(ing)?.label);
    if (size && oz) return { qty: round2((q * WEIGHT_OZ[su] * size) / oz), per: null, from };
    return { qty: null, per: null, from };
  }
  // Container counts: 3 cans of corn stay 3 cans; 1 jar of marinara becomes 24 oz.
  if (ONE_PER_CONTAINER.has(cu)) return { qty: round2(q), per: null, from };
  if (!su || CONTAINERS.has(su)) {
    const size = containerSize(ing);
    if (size) return { qty: round2(q * size), per: size, from };
  }
  return { qty: round2(q), per: null, from };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
