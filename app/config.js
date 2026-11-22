// App-wide constants. Keep VERSION in step with CACHE_VERSION in sw.js.
export const VERSION = '3.4.1';

/** The family's Cloudflare Worker (SPEC §5). */
export const API_BASE = 'https://bilbrey-dinner-planner.jeff-bilbrey-jb.workers.dev';

/**
 * The API base actually used. For local testing only, `?api=http://127.0.0.1:8788`
 * is remembered on that device (and `?api=default` clears it).
 */
export function apiBase() {
  try {
    const q = new URLSearchParams(globalThis.location?.search || '').get('api');
    if (q === 'default') globalThis.localStorage?.removeItem('bfdp.apiBase');
    else if (q && /^https?:\/\/[^\s]+$/.test(q)) globalThis.localStorage?.setItem('bfdp.apiBase', q.replace(/\/$/, ''));
    return globalThis.localStorage?.getItem('bfdp.apiBase') || API_BASE;
  } catch {
    return API_BASE;
  }
}

export const FAMILY = ['Jeff', 'Candi', 'Knox', 'Jordan', 'Jackson'];
/** Who can retire or restore dinners by hand. */
export const PARENTS = ['Jeff', 'Candi'];

export const BASELINE_MONTHLY = 1000;

export const AWAY_REASONS = [
  { id: 'Date night', label: 'Date night', note: 'Enjoy the night out.' },
  { id: 'Out of town', label: 'Out of town', note: 'Safe travels.' },
  { id: 'Big lunch', label: 'Big lunch / not hungry', note: 'A light night at home.' },
  { id: 'Eating out', label: 'Eating out', note: 'Someone else is cooking.' },
  { id: 'Other', label: 'Other', note: 'No dinner planned at home.' },
];

export const AISLES = ['Meat', 'Produce', 'Frozen', 'Dairy & Eggs', 'Bakery', 'Pasta & Grains', 'Canned & Jarred',
  'Condiments & Sauces', 'Spices & Baking', 'Snacks & Extras'];

export const STORAGE = [
  { id: 'freezer', label: 'Freezer' },
  { id: 'fridge', label: 'Fridge' },
  { id: 'pantry', label: 'Pantry shelf' },
  { id: 'counter', label: 'Counter' },
];

export const CATEGORIES = ['Burgers', 'Asian-inspired', 'Pasta', 'Tex-Mex', 'Grill', 'Comfort', 'Salads'];
// No dinner in the box is built on turkey (docs/spec/24 §24.1: the family prefers chicken), so it isn't offered.
// 'seafood' is fried shrimp night, the one seafood dinner (Jeff, 2026-11-22).
export const PROTEINS = ['chicken', 'beef', 'pork', 'sausage', 'seafood', 'mixed'];

export const EQUIPMENT_LABELS = {
  stovetop: 'Stovetop',
  blackstone: 'Blackstone',
  'electric grill': 'Electric grill',
  'outdoor grill': 'Outdoor grill',
  'air fryer': 'Air fryer',
  microwave: 'Microwave',
  // Ninja 10-in-1 Everyday PossibleCooker Pro 6.5 qt (MC1101): slow cook, sear/sauté, braise, steam, rice, keep warm.
  'possible cooker': 'PossibleCooker',
};

export const STORE_IDS = ['sams', 'jewel'];
