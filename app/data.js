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
  if (typeof h === 'object') return Object.entries(h).map(([k, v]) => `${k} ${v}`).join('; ');
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
      website: pickStr(s.website, s.url, s.web, links.web, links.website, out[id].website),
      orderUrl: pickStr(s.orderUrl, s.listUrl, s.handoff?.url, s.handoff?.link, links.list, links.order, links.shop, s.website, s.url, out[id].orderUrl),
      appUrl: pickStr(s.appUrl, links.app, links.ios, links.appStore),
      handoff: handoff && handoff.length ? handoff : out[id].handoff,
      handoffMethod: pickStr(s.handoff?.method, s.handoffMethod, s.method),
      notes: pickStr(s.notes, s.note),
    };
  }
  return out;
}

/** Pure: builds the normalized db from raw JSON documents. */
export function buildDb({ catalog, recipes, prices = null, stores = null, photos = null }) {
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
  }

  const dinnerList = (recipes?.dinners || []).filter((d) => d && d.id).map(normalizeDinner);
  const sideList = (recipes?.sides || []).filter((s) => s && s.id).map(normalizeSide);
  const dinners = Object.fromEntries(dinnerList.map((d) => [d.id, d]));
  const sides = Object.fromEntries(sideList.map((s) => [s.id, s]));

  const ph = { dinners: {}, sides: {} };
  if (photos && typeof photos === 'object') {
    for (const k of ['dinners', 'sides']) {
      for (const [id, v] of Object.entries(photos[k] || {})) {
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
  const [catalog, recipes, prices, stores, photos] = await Promise.all([
    getJSON(fetchFn, u('data/catalog.json'), true),
    getJSON(fetchFn, u('data/recipes.json'), true),
    getJSON(fetchFn, u('data/prices.json'), false),
    getJSON(fetchFn, u('data/stores.json'), false),
    getJSON(fetchFn, u('img/photos.json'), false),
  ]);
  return buildDb({ catalog, recipes, prices, stores, photos });
}
