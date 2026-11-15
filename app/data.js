// Loads the static data files and normalizes them into one `db` object.
// data/catalog.json + data/recipes.json are required; data/prices.json,
// data/stores.json and img/photos.json are optional. prices.json packs override
// catalog packs. Nothing here touches the DOM.

const BRANDS = ['generic', 'name'];
const STORES = ['sams', 'jewel'];

export const STORE_DEFAULTS = {
  sams: {
    id: 'sams', name: "Sam's Club", short: "Sam's", address: 'Addison, IL', phone: '', hours: '',
    website: 'https://www.samsclub.com', orderUrl: 'https://www.samsclub.com',
    coupons: {
      url: 'https://www.samsclub.com/', label: "Sam's Instant Savings", automatic: true,
      note: "Instant Savings come off automatically at checkout for members. There's nothing to clip.", steps: [],
    },
    handoff: [
      'Your list is on the clipboard.',
      "Open the Sam's Club app (or samsclub.com) and go to Lists.",
      'Paste the list into a new list, or search each item and add it to your cart.',
      'Choose Club Pickup or shop in the club, then check out in the app.',
    ],
  },
  jewel: {
    id: 'jewel', name: 'Jewel-Osco', short: 'Jewel', address: '599 E. Roosevelt Road, Glen Ellyn, IL', phone: '', hours: '',
    website: 'https://www.jewelosco.com', orderUrl: 'https://www.jewelosco.com',
    coupons: {
      url: 'https://www.jewelosco.com/foru/coupons-deals.html', label: 'Clip Jewel coupons', automatic: false,
      note: 'Digital coupons only count once they’re clipped in Jewel-Osco’s site or app while you’re signed in. The planner can’t clip them for you.', steps: [],
    },
    handoff: [
      'Your list is on the clipboard.',
      'Open the Jewel-Osco app (or jewelosco.com) and go to your shopping list.',
      'Paste the list, then add each item to your cart.',
      'Pick Drive Up & Go or delivery, then check out in the app.',
    ],
  },
};

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

function cleanPack(p, source) {
  if (!p || typeof p !== 'object') return null;
  const size = num(p.size);
  const price = num(p.price);
  if (!(size > 0) || !(price >= 0)) return null;
  const out = { size, price, source };
  if (p.label) out.label = String(p.label);
  if (p.url) out.url = String(p.url);
  if (p.confidence) out.confidence = String(p.confidence);
  return out;
}

export function normalizeIngredient(id, raw) {
  const packs = {};
  for (const s of STORES) {
    for (const b of BRANDS) {
      const p = cleanPack(raw?.packs?.[s]?.[b], 'catalog');
      if (p) (packs[s] ||= {})[b] = p;
    }
  }
  return {
    id,
    name: String(raw?.name || id),
    unit: String(raw?.unit || 'each'),
    aisle: String(raw?.aisle || 'Snacks & Extras'),
    storage: ['freezer', 'fridge', 'pantry', 'counter'].includes(raw?.storage) ? raw.storage : 'pantry',
    kind: raw?.kind === 'staple' ? 'staple' : 'measured',
    defaultStore: STORES.includes(raw?.defaultStore) ? raw.defaultStore : (packs.sams && !packs.jewel ? 'sams' : 'jewel'),
    aliases: Array.isArray(raw?.aliases) ? raw.aliases.map(String) : [],
    extra: !!raw?.extra,
    meat: !!raw?.meat,
    packs,
  };
}

function cleanItems(items) {
  const out = {};
  if (items && typeof items === 'object') {
    for (const [k, v] of Object.entries(items)) { const n = num(v); if (n > 0) out[k] = n; }
  }
  return out;
}

export function normalizeDinner(raw) {
  const tags = Array.isArray(raw.tags) ? raw.tags.map((t) => String(t).toLowerCase()) : [];
  const isBurger = tags.includes('burger') || raw.category === 'Burgers';
  const sides = Array.isArray(raw.sides) ? raw.sides.filter(Boolean).map(String) : [];
  return {
    id: String(raw.id),
    title: String(raw.title || raw.id),
    subtitle: raw.subtitle ? String(raw.subtitle) : '',
    category: String(raw.category || 'Comfort'),
    protein: String(raw.protein || 'mixed'),
    minutes: num(raw.minutes) || 0,
    equipment: Array.isArray(raw.equipment) ? raw.equipment.map(String) : [],
    tags,
    rotation: raw.rotation === 'bench' ? 'bench' : 'core',
    items: cleanItems(raw.items),
    steps: Array.isArray(raw.steps) ? raw.steps.map(String) : [],
    sides,
    sideSlots: num(raw.sideSlots) || (isBurger ? 1 : 2),
    custom: !!raw.custom,
  };
}

export function normalizeSide(raw) {
  return {
    id: String(raw.id),
    title: String(raw.title || raw.id),
    kind: String(raw.kind || 'vegetable'),
    minutes: num(raw.minutes) || 0,
    equipment: Array.isArray(raw.equipment) ? raw.equipment.map(String) : [],
    items: cleanItems(raw.items),
    steps: Array.isArray(raw.steps) ? raw.steps.map(String) : [],
    tags: Array.isArray(raw.tags) ? raw.tags.map((t) => String(t).toLowerCase()) : [],
  };
}

function pickStr(...vals) {
  for (const v of vals) if (typeof v === 'string' && v.trim()) return v.trim();
  return '';
}

function addressStr(a) {
  if (!a) return '';
  if (typeof a === 'string') return a;
  if (typeof a === 'object') return [a.street || a.line1, a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return '';
}

function hoursStr(h) {
  if (!h) return '';
  if (typeof h === 'string') return h;
  if (Array.isArray(h)) return h.map((x) => (typeof x === 'string' ? x : [x.days || x.day, x.hours || x.time].filter(Boolean).join(' '))).join('; ');
  if (typeof h === 'object') {
    const main = h.store || h.club || h.hours || h.open;
    if (typeof main === 'string') return main;
    const v = Object.entries(h).find(([k, x]) => typeof x === 'string' && !['source', 'note', 'notes'].includes(k) && !/^https?:/.test(x));
    return v ? v[1] : '';
  }
  return '';
}

function stepsFrom(h) {
  if (!h) return null;
  if (Array.isArray(h)) return h.map((x) => (typeof x === 'string' ? x : x?.text || x?.step || '')).filter(Boolean);
  if (typeof h === 'string') return [h];
  if (typeof h === 'object') return stepsFrom(h.steps || h.instructions || h.how || h.text);
  return null;
}

/** Accepts several reasonable stores.json shapes; always returns { sams, jewel }. */
export function normalizeStores(raw) {
  const out = { sams: { ...STORE_DEFAULTS.sams }, jewel: { ...STORE_DEFAULTS.jewel } };
  if (!raw || typeof raw !== 'object') return out;
  let entries = raw.stores ?? raw;
  if (Array.isArray(entries)) entries = Object.fromEntries(entries.map((s) => [s.id || s.key || (String(s.name || '').toLowerCase().includes('sam') ? 'sams' : 'jewel'), s]));
  for (const id of STORES) {
    const s = entries?.[id];
    if (!s || typeof s !== 'object') continue;
    const links = s.links || s.deepLinks || s.urls || {};
    const handoff = stepsFrom(s.handoff || s.handoffSteps || s.ordering || s.order);
    out[id] = {
      ...out[id],
      name: pickStr(s.name, out[id].name),
      short: pickStr(s.short, s.shortName, out[id].short),
      address: pickStr(addressStr(s.address), out[id].address),
      phone: pickStr(s.phone, out[id].phone),
      hours: pickStr(hoursStr(s.hours), out[id].hours),
      website: pickStr(s.website, s.url, s.web, links.web, links.website, links.storePage, links.shop, out[id].website),
      orderUrl: pickStr(s.orderUrl, s.listUrl, s.handoff?.url, s.handoff?.link, links.shopThisStore, links.groceryPage, links.list, links.order, links.shop, s.website, s.url, out[id].orderUrl),
      appUrl: pickStr(s.appUrl, s.apps?.ios?.url, links.app, links.ios, links.appStore),
      searchTemplate: pickStr(links.searchTemplate, s.searchTemplate),
      storeName: pickStr(s.storeName),
      handoff: handoff && handoff.length ? handoff : out[id].handoff,
      notes: pickStr(s.notes, s.note),
      coupons: couponsFrom(s.coupons ?? links.coupons, out[id].coupons),
    };
  }
  return out;
}

/** stores.json `coupons` may be a URL string or { url, label, note|how|steps }. */
function couponsFrom(c, fallback) {
  if (!c) return fallback;
  if (typeof c === 'string') return /^https?:\/\//.test(c) ? { ...fallback, url: c } : fallback;
  if (typeof c !== 'object') return fallback;
  const url = pickStr(c.url, c.link, c.page, c.href, c.web);
  const steps = stepsFrom(c.steps || c.appSteps || c.how);
  return {
    ...fallback,
    url: /^https?:\/\//.test(url) ? url : fallback.url,
    label: pickStr(c.label, c.name, fallback.label),
    note: pickStr(c.note, c.notes, typeof c.how === 'string' ? c.how : '', fallback.note),
    steps: steps && steps.length ? steps : fallback.steps || [],
    automatic: typeof c.automatic === 'boolean' ? c.automatic : fallback.automatic,
    clipAll: c.clipAll === true,
  };
}

export const LUNCH_SLOTS = [
  { id: 'main', label: 'Main' },
  { id: 'side', label: 'Side' },
  { id: 'snack', label: 'Snack' },
  { id: 'drink', label: 'Drink' },
];

export function normalizeLunchItem(raw, extra = {}) {
  if (!raw || !raw.id) return null;
  return {
    id: String(raw.id),
    slot: String(raw.slot || 'main'),
    title: String(raw.title || raw.name || 'Lunch item'),
    subtitle: raw.subtitle ? String(raw.subtitle) : '',
    items: cleanItems(raw.items),
    tags: Array.isArray(raw.tags) ? raw.tags.map((t) => String(t).toLowerCase()) : [],
    prep: raw.prep ? String(raw.prep) : '',
    ...extra,
  };
}

const DAY_NUMS = [0, 1, 2, 3, 4, 5, 6];
export function normalizeLunchPerson(raw, slots = LUNCH_SLOTS) {
  const days = Array.isArray(raw?.days) ? [...new Set(raw.days.map(Number).filter((d) => DAY_NUMS.includes(d)))].sort() : [1, 2, 3, 4, 5];
  const out = { enabled: !!raw?.enabled, days, slots: {} };
  for (const sl of slots) {
    const list = raw?.slots?.[sl.id];
    out.slots[sl.id] = Array.isArray(list) ? list.filter((x) => typeof x === 'string' && x) : [];
  }
  return out;
}

/** data/lunches.json (§8.2) → { slots, items, itemList, defaults, swaps, updated }; empty when missing. */
export function normalizeLunches(raw) {
  const slots = Array.isArray(raw?.slots) && raw.slots.length
    ? raw.slots.filter((x) => x && x.id).map((x) => ({ id: String(x.id), label: String(x.label || x.id) }))
    : LUNCH_SLOTS;
  const itemList = (Array.isArray(raw?.items) ? raw.items : []).map((x) => normalizeLunchItem(x)).filter(Boolean);
  const items = Object.fromEntries(itemList.map((x) => [x.id, x]));
  const defaults = {};
  for (const [name, d] of Object.entries(raw?.defaults || {})) defaults[name] = normalizeLunchPerson(d, slots);
  const swaps = (Array.isArray(raw?.swaps) ? raw.swaps : [])
    .filter((x) => x && items[x.from] && items[x.to] && x.from !== x.to)
    .map((x) => ({ from: String(x.from), to: String(x.to), why: x.why ? String(x.why) : '' }));
  return { available: itemList.length > 0, slots, items, itemList, defaults, swaps, updated: typeof raw?.updated === 'string' ? raw.updated.slice(0, 10) : null };
}

/** data/nutrition.json (§8.3) → { per: { id: { kcal, protein } } } or null when missing. */
export function normalizeNutrition(raw) {
  if (!raw || typeof raw !== 'object' || !raw.per || typeof raw.per !== 'object') return null;
  const per = {};
  for (const [id, v] of Object.entries(raw.per)) {
    const kcal = num(v?.kcal);
    const protein = num(v?.protein);
    if (kcal == null || kcal < 0) continue;
    per[id] = { kcal, protein: protein != null && protein >= 0 ? protein : 0 };
  }
  return { per, updated: typeof raw.updated === 'string' ? raw.updated.slice(0, 10) : null, notes: typeof raw.notes === 'string' ? raw.notes : '' };
}

/** Pure: builds the normalized db from raw JSON documents. */
export function buildDb({ catalog, recipes, prices = null, stores = null, photos = null, lunches = null, nutrition = null }) {
  const ingredients = {};
  for (const [id, raw] of Object.entries(catalog?.ingredients || {})) ingredients[id] = normalizeIngredient(id, raw);

  let pricesUpdated = null;
  let pricesNotes = '';
  if (prices && typeof prices === 'object' && prices.prices) {
    pricesUpdated = typeof prices.updated === 'string' ? prices.updated.slice(0, 10) : null;
    pricesNotes = typeof prices.notes === 'string' ? prices.notes : '';
    for (const [id, byStore] of Object.entries(prices.prices)) {
      const ing = ingredients[id];
      if (!ing || !byStore) continue;
      for (const s of STORES) {
        for (const b of BRANDS) {
          const p = cleanPack(byStore?.[s]?.[b], 'prices');
          if (!p) continue;
          const base = ing.packs?.[s]?.[b];
          (ing.packs[s] ||= {})[b] = { ...(base || {}), ...p, label: p.label || base?.label };
        }
      }
    }
    // A store doesn't carry an id when prices.json has no entry for that store and it's listed in notSeenAt.
    for (const s of STORES) {
      const ids = Array.isArray(prices.notSeenAt?.[s]) ? prices.notSeenAt[s] : [];
      for (const id of ids) {
        const ing = ingredients[id];
        const priced = prices.prices?.[id]?.[s] && (prices.prices[id][s].generic || prices.prices[id][s].name);
        if (ing && !priced) delete ing.packs[s];
      }
    }
  }

  const dinnerList = (recipes?.dinners || []).filter((d) => d && d.id).map(normalizeDinner);
  const sideList = (recipes?.sides || []).filter((s) => s && s.id).map(normalizeSide);
  const dinners = Object.fromEntries(dinnerList.map((d) => [d.id, d]));
  const sides = Object.fromEntries(sideList.map((s) => [s.id, s]));

  const ph = { dinners: {}, sides: {}, lunches: {} };
  if (photos && typeof photos === 'object') {
    // Lunch photos arrive under `lunch` (SPEC §8); `lunches` is accepted too.
    for (const [k, from] of [['dinners', 'dinners'], ['sides', 'sides'], ['lunches', 'lunches'], ['lunches', 'lunch']]) {
      for (const [id, v] of Object.entries(photos[from] || {})) {
        const src = typeof v === 'string' ? v : v?.src || v?.path || v?.full;
        if (typeof src === 'string' && src) {
          const small = typeof v === 'object' ? v.small || v['640'] || v.thumb : null;
          ph[k][id] = { src: src.replace(/^\//, ''), small: small ? String(small).replace(/^\//, '') : null };
        }
      }
    }
  }

  return {
    ingredients,
    dinners,
    dinnerList,
    sides,
    sideList,
    photos: ph,
    stores: normalizeStores(stores),
    pricesUpdated,
    pricesNotes,
    hasPrices: !!pricesUpdated,
    lunch: normalizeLunches(lunches),
    nutrition: normalizeNutrition(nutrition),
  };
}

async function getJSON(fetchFn, url, required) {
  try {
    const res = await fetchFn(url, { cache: 'no-cache' });
    if (!res.ok) {
      if (required) throw new Error(`${url} returned ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    if (required) throw new Error(`Couldn't load ${url}: ${e.message}`);
    return null;
  }
}

/** Fetches the data files relative to the app's base URL. */
export async function loadDb({ base = './', fetchFn = globalThis.fetch.bind(globalThis) } = {}) {
  const u = (p) => new URL(p, new URL(base, globalThis.location?.href || 'http://localhost/')).href;
  const [catalog, recipes, prices, stores, photos, lunches, nutrition] = await Promise.all([
    getJSON(fetchFn, u('data/catalog.json'), true),
    getJSON(fetchFn, u('data/recipes.json'), true),
    getJSON(fetchFn, u('data/prices.json'), false),
    getJSON(fetchFn, u('data/stores.json'), false),
    getJSON(fetchFn, u('img/photos.json'), false),
    getJSON(fetchFn, u('data/lunches.json'), false),
    getJSON(fetchFn, u('data/nutrition.json'), false),
  ]);
  return buildDb({ catalog, recipes, prices, stores, photos, lunches, nutrition });
}
