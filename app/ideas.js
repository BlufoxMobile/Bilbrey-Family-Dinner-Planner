// "What can I make?" (SPEC §17): the request Claude gets (the photos, a note, what's in the
// pantry and when it should be used, the sides and the catalog), the ideas it sends back made
// safe for this family, and saving one as a dinner on a night or in the recipe box.
// Pure: (db, state, args) → data or { ops, undo, message }. No DOM, no network, no clock.

import { set } from './state.js';
import { addDays, round2, slugify, midSentence } from './util.js';
import { CATEGORIES, PROTEINS, EQUIPMENT_LABELS } from './config.js';
import { itemMeta } from './shopping.js';
import { keepsDays, sinceOf } from './freshness.js';
import { isSideDropped, kindOf, storeFor, packFor, dinnerById } from './planner.js';
import { customItemOps, undoFor, nightName } from './actions.js';

export const MAX_IDEA_PHOTOS = 4;
export const NOTE_MAX = 300;
export const IDEA_COUNT = 3;
/** "Put it on a night…" looks this far ahead (today plus 30 more nights). */
export const IDEA_NIGHTS = 31;

// ---------------------------------------------------------------- the request

/** What's on the shelves for Claude: in-stock items with amounts, and a use-by for perishables. */
export function pantryForIdeas(db, state) {
  const out = [];
  for (const [id, p] of Object.entries(state?.pantry || {})) {
    if (!p || typeof p !== 'object' || p.low) continue;
    if (!(typeof p.qty === 'number' ? p.qty > 0 : p.stocked)) continue;
    const m = itemMeta(db, state, id);
    if (m.unknown) continue;
    const label = typeof p.label === 'string' && p.label.trim() && !m.custom ? p.label.trim() : '';
    const row = { id, name: label ? `${m.name} (${label})` : m.name, qty: typeof p.qty === 'number' ? round2(p.qty) : null, unit: m.unit };
    const days = keepsDays(db, state, id);
    const since = sinceOf(p);
    if (days != null && since) row.useBy = addDays(since, days);
    out.push(row);
  }
  // Use-it-first items lead, so they're the ones Claude reads first.
  return out.sort((a, b) => (a.useBy ? 0 : 1) - (b.useBy ? 0 : 1) || String(a.useBy || '').localeCompare(String(b.useBy || '')) || a.name.localeCompare(b.name)).slice(0, 150); // the server takes 150 at most
}

/** The sides in the recipe box Claude may pair with (none that got a thumbs down). */
export function sidesForIdeas(db, state) {
  return db.sideList.filter((s) => !isSideDropped(state, s.id)).map((s) => ({ id: s.id, title: s.title, kind: s.kind })).slice(0, 80);
}

/** Every ingredient the family buys (and their own shelf items), so Claude can name matches. */
export function catalogForIdeas(db, state) {
  const out = Object.values(db.ingredients).map((i) => ({ id: i.id, name: i.name, unit: i.unit }));
  for (const [id, c] of Object.entries(state?.custom || {})) if (c?.name) out.push({ id, name: c.name, unit: c.unit || 'each' });
  return out.slice(0, 400);
}

/** POST /api/ideas body. */
export function buildIdeasRequest(db, state, { images = [], note = '', count = IDEA_COUNT } = {}) {
  return {
    images: (Array.isArray(images) ? images : []).filter((x) => typeof x === 'string' && x.startsWith('data:image/')).slice(0, MAX_IDEA_PHOTOS),
    note: String(note || '').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX),
    pantry: pantryForIdeas(db, state),
    sides: sidesForIdeas(db, state),
    catalog: catalogForIdeas(db, state),
    count: Math.max(1, Math.min(6, Number(count) || IDEA_COUNT)),
  };
}

// ---------------------------------------------------------------- the answer

const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
/** No oven (it leaks propane), never seafood or tofu, never Caesar (SPEC §1, §12.7). */
const OVEN = /\b(oven|broil(?:er|ed|ing)?|bake[sd]?|baking (?:sheet|dish|pan)|roast(?:ed)? in the)\b/i;
const NOT_FOR_US = /\b(tofu|shrimp|prawns?|salmon|tuna|tilapia|cod|halibut|fish|seafood|crab|lobster|scallops?|clams?|mussels?|oysters?|anchov(?:y|ies)|caesar)\b/i;

const EQUIPMENT_ALIASES = {
  'air-fryer': 'air fryer', airfryer: 'air fryer', stove: 'stovetop', 'stove top': 'stovetop', griddle: 'blackstone', grill: 'outdoor grill', 'indoor grill': 'electric grill',
  possiblecooker: 'possible cooker', 'slow cooker': 'possible cooker', 'slow-cooker': 'possible cooker', crockpot: 'possible cooker', 'crock pot': 'possible cooker', 'multi cooker': 'possible cooker', 'multi-cooker': 'possible cooker', 'ninja possiblecooker': 'possible cooker',
};
function cleanEquipment(list) {
  const out = [];
  for (const e of Array.isArray(list) ? list : []) {
    const k = String(e || '').toLowerCase().trim();
    const id = EQUIPMENT_LABELS[k] ? k : EQUIPMENT_ALIASES[k];
    if (id && !out.includes(id)) out.push(id);
  }
  return out.length ? out : ['stovetop'];
}

const known = (db, state, id) => typeof id === 'string' && !!(db.ingredients[id] || state?.custom?.[id]);

function cleanLine(db, state, x) {
  if (!x || typeof x !== 'object') return null;
  const name = str(x.name, 80);
  const matchId = known(db, state, x.matchId) ? x.matchId : null;
  if (!name && !matchId) return null;
  const qty = Number(x.qty);
  return { name: name || itemMeta(db, state, matchId).name, qty: Number.isFinite(qty) && qty > 0 ? Math.round(qty * 1000) / 1000 : null, unit: str(x.unit, 24), matchId };
}

/** One idea from the server, checked against the house rules and the recipe box; null if it can't be used. */
export function normalizeIdea(db, state, raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = str(raw.title, 80);
  if (!title) return null;
  const items = (Array.isArray(raw.items) ? raw.items : []).map((x) => cleanLine(db, state, x)).filter(Boolean).slice(0, 30);
  const missing = (Array.isArray(raw.missing) ? raw.missing : []).map((x) => cleanLine(db, state, x)).filter(Boolean).slice(0, 30);
  const steps = (Array.isArray(raw.steps) ? raw.steps : []).map((s) => str(s, 500)).filter(Boolean).slice(0, 14);
  const words = [title, raw.subtitle, ...items.map((i) => i.name), ...missing.map((i) => i.name)].join(' ');
  if (NOT_FOR_US.test(words) || steps.some((s) => OVEN.test(s))) return null;
  const sides = [...new Set((Array.isArray(raw.sides) ? raw.sides : []).filter((id) => typeof id === 'string' && db.sides[id] && !isSideDropped(state, id)))].slice(0, 2);
  const minutes = Math.round(Number(raw.minutes));
  const category = CATEGORIES.find((c) => c.toLowerCase() === String(raw.category || '').toLowerCase()) || 'Comfort';
  const protein = PROTEINS.includes(String(raw.protein || '').toLowerCase()) ? String(raw.protein).toLowerCase() : 'mixed';
  const pantry = state?.pantry || {};
  return {
    title,
    subtitle: str(raw.subtitle, 160),
    why: str(raw.why, 280),
    minutes: minutes > 0 && minutes <= 240 ? minutes : 30,
    equipment: cleanEquipment(raw.equipment),
    protein,
    category,
    items,
    sides,
    steps: steps.length ? steps : ['Cook the main on the stovetop until done (chicken to 165°F, ground beef to 160°F, pork to 145°F), then plate with the sides.'],
    usesPantry: [...new Set((Array.isArray(raw.usesPantry) ? raw.usesPantry : []).filter((id) => typeof id === 'string' && pantry[id]))],
    missing,
  };
}

/** The ideas in a /api/ideas response that this family can actually cook. */
export function normalizeIdeas(db, state, res) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(res?.ideas) ? res.ideas : []) {
    const idea = normalizeIdea(db, state, raw);
    if (!idea || seen.has(idea.title.toLowerCase())) continue;
    seen.add(idea.title.toLowerCase());
    out.push(idea);
  }
  return out;
}

// ---------------------------------------------------------------- units and cost

const UNIT_WORDS = {
  lbs: 'lb', pound: 'lb', pounds: 'lb', ounce: 'oz', ounces: 'oz', gram: 'g', grams: 'g', kilogram: 'kg', kilograms: 'kg',
  tablespoon: 'tbsp', tablespoons: 'tbsp', tbs: 'tbsp', teaspoon: 'tsp', teaspoons: 'tsp', cup: 'cups', c: 'cups', milliliters: 'ml',
};
const WEIGHT = { oz: 1, lb: 16, g: 1 / 28.3495, kg: 1000 / 28.3495 };
const VOLUME = { tsp: 1, tbsp: 3, cups: 48, ml: 1 / 4.92892 };
const unitKey = (u) => { const k = String(u || '').toLowerCase().replace(/\.$/, '').trim(); return UNIT_WORDS[k] || k; };
const singular = (u) => u.replace(/(ches|shes|xes|ses)$/, (m) => m.slice(0, -2)).replace(/ies$/, 'y').replace(/s$/, '');

/**
 * An amount in the item's own unit: same unit as given, or converted between weights or between
 * volumes. Anything else is taken as already in the item's unit (Claude was told it). null = no amount.
 */
export function qtyIn(db, state, id, qty, unit) {
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) return null;
  const to = unitKey(itemMeta(db, state, id).unit);
  const from = unitKey(unit);
  if (!from || from === to || singular(from) === singular(to)) return n;
  if (WEIGHT[from] && WEIGHT[to]) return Math.round((n * WEIGHT[from]) / WEIGHT[to] * 1000) / 1000;
  if (VOLUME[from] && VOLUME[to]) return Math.round((n * VOLUME[from]) / VOLUME[to] * 1000) / 1000;
  return n;
}

/**
 * What the missing things would cost: whole packs at the store the family buys each at, priced
 * like the list. Shelf items Claude named that aren't in the catalog have no price yet.
 * → { cost, priced (how many), unpriced: [names] }
 */
export function missingCost(db, state, idea) {
  let cost = 0;
  let priced = 0;
  const unpriced = [];
  for (const m of idea?.missing || []) {
    const id = m.matchId && db.ingredients[m.matchId] ? m.matchId : null;
    const pack = id ? packFor(db, state, id, storeFor(db, state, id)) : null;
    if (!pack || !(pack.size > 0) || !(pack.price >= 0)) { unpriced.push(m.name); continue; }
    const need = kindOf(db, state, id) === 'staple' ? null : qtyIn(db, state, id, m.qty, m.unit);
    cost += Math.max(1, need ? Math.ceil(need / pack.size - 1e-9) : 1) * pack.price;
    priced++;
  }
  return { cost: round2(cost), priced, unpriced };
}

// ---------------------------------------------------------------- saving an idea

/** A best guess at the aisle (and where it's kept) for an ingredient that isn't in the catalog. */
export function ideaAisle(name) {
  const n = String(name || '').toLowerCase();
  if (/frozen/.test(n)) return { aisle: 'Frozen', storage: 'freezer' };
  if (/\b(chicken|beef|pork|turkey|sausage|bacon|steak|chorizo|ham|kielbasa|brisket|ribs?|chops?|ground)\b/.test(n)) return { aisle: 'Meat', storage: 'fridge' };
  if (/\b(milk|cream|cheese|yogurt|butter|eggs?|sour cream|half-and-half|parmesan|mozzarella|feta)\b/.test(n)) return { aisle: 'Dairy & Eggs', storage: 'fridge' };
  if (/\b(bread|buns?|rolls?|tortillas?|naan|pita|baguette|bagels?)\b/.test(n)) return { aisle: 'Bakery', storage: 'counter' };
  if (/\b(basil|cilantro|parsley|mint|dill|thyme|rosemary|chives|scallions?|green onions?|lemons?|limes?|ginger|garlic|spinach|kale|lettuce|romaine|cabbage|carrots?|celery|zucchini|squash|mushrooms?|peppers?|broccoli|cauliflower|green beans|asparagus|potato(?:es)?|sweet potato(?:es)?|apples?|avocados?|corn|jalape[nñ]os?|herbs?)\b/.test(n)) return { aisle: 'Produce', storage: 'fridge' };
  if (/\b(sauce|dressing|ketchup|mustard|mayo|salsa|vinegar|honey|syrup|soy|sriracha|hoisin|teriyaki)\b/.test(n)) return { aisle: 'Condiments & Sauces', storage: 'pantry' };
  if (/\b(seasoning|spice|paprika|cumin|oregano|chili powder|cinnamon|flour|sugar|cornstarch|bouillon|stock|broth)\b/.test(n)) return { aisle: 'Spices & Baking', storage: 'pantry' };
  if (/\b(rice|pasta|noodles?|spaghetti|penne|macaroni|quinoa|couscous|orzo)\b/.test(n)) return { aisle: 'Pasta & Grains', storage: 'pantry' };
  return { aisle: 'Canned & Jarred', storage: 'pantry' };
}

/** A unit word for a new shelf item ("1 bunch" → "bunches"); weights and spoons stay as they are. */
function shelfUnit(unit) {
  const u = unitKey(unit);
  if (!u) return 'each';
  if (WEIGHT[u] || VOLUME[u] || u === 'each' || u.endsWith('s')) return u;
  return /(ch|sh|x)$/.test(u) ? `${u}es` : `${u}s`;
}

/** A custom dinner the family already saved from the same idea (same title), or null. */
export function savedIdeaId(state, idea) {
  const t = String(idea?.title || '').trim().toLowerCase();
  if (!t) return null;
  const hit = Object.entries(state?.customDinners || {}).find(([, d]) => d && String(d.title || '').trim().toLowerCase() === t);
  return hit ? hit[0] : null;
}

/** "lemon-garlic-chicken", or "-2", "-3"… when the recipe box already has that id. */
export function uniqueDinnerId(db, state, title) {
  const base = slugify(title);
  let id = base;
  let n = 2;
  while (db.dinners[id] || state?.customDinners?.[id]) id = `${base}-${n++}`;
  return id;
}

/** Every ingredient line of an idea: its items, then anything it's missing that isn't listed there. */
function allLines(idea) {
  const out = [...(idea.items || [])];
  const has = (x) => out.some((y) => (x.matchId && y.matchId === x.matchId) || y.name.toLowerCase() === x.name.toLowerCase());
  for (const m of idea.missing || []) if (!has(m)) out.push(m);
  return out;
}

/**
 * Two sides for every dinner: Claude's picks, then a vegetable if there isn't one, then whatever
 * the recipe box most often serves with this kind of dinner. Deterministic.
 */
function fillSides(db, state, picked, category) {
  const sides = [...picked];
  const paired = new Map();
  for (const d of db.dinnerList) if (d.category === category) for (const id of d.sides) paired.set(id, (paired.get(id) || 0) + 1);
  const pool = db.sideList
    .filter((s) => !isSideDropped(state, s.id))
    .sort((a, b) => (paired.get(b.id) || 0) - (paired.get(a.id) || 0) || a.id.localeCompare(b.id));
  const free = (s) => !sides.includes(s.id);
  const veg = (s) => s.kind === 'vegetable' || s.kind === 'salad';
  if (sides.length < 2 && !sides.some((id) => veg(db.sides[id] || {}))) {
    const v = pool.find((s) => free(s) && veg(s));
    if (v) sides.push(v.id);
  }
  while (sides.length < 2) {
    const s = pool.find((x) => free(x) && !veg(x)) || pool.find(free);
    if (!s) break;
    sides.push(s.id);
  }
  return sides.slice(0, 2);
}

/**
 * The dinner (state.customDinners[id]) an idea becomes, plus the shelf items its unmatched
 * ingredients need so the shopping list can buy them. → { id, dinner, ops }
 */
export function dinnerFromIdea(db, state, idea, { rotation = 'bench', who, at } = {}) {
  const ops = [];
  let st = state || {};
  const items = {};
  for (const line of allLines(idea)) {
    let id = known(db, st, line.matchId) ? line.matchId : null;
    let qty;
    if (id) {
      qty = qtyIn(db, st, id, line.qty, line.unit) ?? 1;
    } else {
      const name = line.name.replace(/^(a|an|some)\s+/i, '').trim();
      if (!name) continue;
      const where = ideaAisle(name);
      const c = customItemOps(st, { name: name.charAt(0).toUpperCase() + name.slice(1), unit: shelfUnit(line.unit), aisle: where.aisle, storage: where.storage, kind: 'measured' });
      id = c.id;
      if (c.ops.length) {
        ops.push(...c.ops);
        st = { ...st, custom: { ...(st.custom || {}), [c.id]: c.ops[0].value } };
      }
      qty = line.qty > 0 ? line.qty : 1;
    }
    items[id] = Math.round(((items[id] || 0) + qty) * 1000) / 1000;
  }
  const id = uniqueDinnerId(db, st, idea.title);
  const tags = [];
  if ((idea.usesPantry || []).length) tags.push('from your pantry');
  const dinner = {
    title: idea.title,
    subtitle: idea.subtitle || idea.why || '',
    category: idea.category,
    protein: idea.protein,
    minutes: idea.minutes,
    equipment: [...idea.equipment],
    tags,
    rotation: rotation === 'core' ? 'core' : 'bench',
    items,
    sides: fillSides(db, st, idea.sides || [], idea.category),
    sideSlots: 2,
    steps: [...idea.steps],
    source: 'claude',
    ...(idea.why ? { why: idea.why } : {}),
    by: who || 'Family',
    at: at || new Date().toISOString(),
  };
  ops.push(set(['customDinners', id], dinner));
  return { id, dinner, ops, state: st };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Save an idea: `to: 'box'` keeps it in the recipe box (in the rotation); `to: 'night'` puts it on
 * `date` (a one-off, on the bench, unless it's already in the box). A night with a dinner is
 * replaced; `moveTo` puts the dinner it bumps on another night instead of dropping it.
 * → { ops, undo, message, id, displaced, error? }
 */
export function saveIdeaOps(db, state, idea, { to = 'night', date = null, moveTo = null, who, at, today } = {}) {
  const when = at || new Date().toISOString();
  const stamp = { by: who || 'Family', at: when };
  const ops = [];
  let id = savedIdeaId(state, idea);
  let made = null;
  if (to === 'night') {
    const target = state?.plan?.[date];
    if (!date) return { ops: [], undo: [], message: 'Pick a night first.', error: true };
    if (target?.status === 'cooked') return { ops: [], undo: [], message: `${cap(nightName(date, today))} is already marked cooked.`, error: true };
    if (id && target?.dinner === id && target.status === 'planned') return { ops: [], undo: [], message: `${idea.title} is already on for ${nightName(date, today)}.`, id };
  }
  if (!id) {
    made = dinnerFromIdea(db, state, idea, { rotation: to === 'box' ? 'core' : 'bench', who, at: when });
    id = made.id;
    ops.push(...made.ops);
  } else if (to === 'box' && state.customDinners[id]?.rotation === 'bench') {
    ops.push(set(['customDinners', id, 'rotation'], 'core'));
  } else if (to === 'box') {
    return { ops: [], undo: [], message: `${idea.title} is already in the recipe box.`, id };
  }
  if (to === 'box') {
    return { ops, undo: undoFor(state, ops), message: `${idea.title} is in the recipe box and joins the rotation.`, id, displaced: null };
  }
  const target = state?.plan?.[date];
  const sides = [...((made ? made.dinner : state.customDinners[id])?.sides || [])];
  ops.push(set(['plan', date], { dinner: id, sides, status: 'planned', manual: true, ...stamp }));
  const displaced = target?.dinner && target.status === 'planned' ? target.dinner : null;
  const displacedTitle = displaced ? dinnerById(db, state, displaced)?.title || 'the dinner that was there' : '';
  let message = `${idea.title} is on for ${nightName(date, today)}.`;
  if (displaced && moveTo && moveTo !== date && !state?.plan?.[moveTo]?.dinner) {
    ops.push(set(['plan', moveTo], { ...target, manual: true, ...stamp }));
    message += ` ${displacedTitle} moved to ${nightName(moveTo, today)}.`;
  } else if (displaced) {
    message += ` It replaces ${displacedTitle}.`;
  }
  const need = (idea.missing || []).length;
  message += need ? ` The list has the ${need === 1 ? 'one thing' : `${need} things`} it needs.` : ' Everything it needs is in the pantry.';
  return { ops, undo: undoFor(state, ops), message, id, displaced };
}

/** The next open nights after `date` (for "move the dinner that's there"), within `days`. */
export function openNightsAfter(state, date, { days = 14, limit = 3 } = {}) {
  const out = [];
  for (let i = 1; i <= days && out.length < limit; i++) {
    const d = addDays(date, i);
    const e = state?.plan?.[d];
    if (!e || (e.status === 'planned' && !e.dinner)) out.push(d);
  }
  return out;
}

/** "chicken thighs, rice and frozen peas" — the pantry items an idea uses, in plain words. */
export function pantryWords(db, state, ids) {
  return ids.map((id) => midSentence(itemMeta(db, state, id).name.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/,.*$/, '').trim()));
}
