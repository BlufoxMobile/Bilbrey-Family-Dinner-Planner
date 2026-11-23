// Cooking, in plain logic (SPEC §22): detailed steps with their timers and heat settings, the
// whole plate timed together, the amounts each step uses, a pantry check for one recipe, safe
// temperatures, leftovers, plate facts (calories, protein, lean) and the week's dinner summary,
// and the recipe-box filters. Pure: no DOM, no clock (now / today are passed in).

import * as N from './nutrition.js';
import { dinnerById, effectiveSides, sideInfo, itemsForNight, scaleItems, isFavorite } from './planner.js';
import { itemMeta, unitText, readableId, singular } from './shopping.js';
import { onHand, ENOUGH, readiness, stapleShort } from './coverage.js';
import { useSoon, sinceOf, placeOf } from './freshness.js';
import { activeDeal } from './deals.js';
import { isVegSide, VEG_ON_PLATE } from './health.js';
import { addDays, diffDays, round2, shortDate, weekdayName, midSentence, listJoin } from './util.js';
import { fmtMinutes } from './data.js';

export { fmtMinutes }; // "45 min", "1 hr 10 min": one way to say a time, everywhere (app/data.js)

// ---------------------------------------------------------------- equipment

/** Every appliance in the house (never an oven). Ids match `equipment` in data/recipes.json. */
export const EQUIPMENT = [
  { id: 'stovetop', label: 'Stovetop', words: /skillet|saucepan|\bpots?\b|\bpans?\b|stovetop|burner|\bwok\b|\bboil|simmer/i },
  { id: 'blackstone', label: 'Blackstone', words: /blackstone|griddle/i },
  { id: 'electric grill', label: 'Electric grill', words: /electric grill|\bgrill/i },
  { id: 'outdoor grill', label: 'Outdoor grill', words: /outdoor grill|\bgrill/i },
  { id: 'air fryer', label: 'Air fryer', words: /air[- ]?fr(?:y|ied|yer)/i },
  { id: 'microwave', label: 'Microwave', words: /microwave/i },
  { id: 'possible cooker', label: 'PossibleCooker', words: /possible ?cooker|slow[- ]cook|sear\/saut[eé]|\bbraise|keep warm|\bninja\b/i },
];
const EQUIPMENT_BY_ID = Object.fromEntries(EQUIPMENT.map((e) => [e.id, e]));
export const equipmentLabel = (id) => EQUIPMENT_BY_ID[id]?.label || (id ? String(id).charAt(0).toUpperCase() + String(id).slice(1) : '');

// ---------------------------------------------------------------- times, tips, notes

const posNum = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const asList = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? [v] : []).map((x) => String(x).trim()).filter(Boolean);

/** → { prep, cook, total } in minutes; prep and cook are null when the recipe only knows its total. */
export function recipeTimes(recipe) {
  const prep = posNum(recipe?.prepMinutes);
  const cook = posNum(recipe?.cookMinutes);
  const total = posNum(recipe?.minutes) || (prep || cook ? (prep || 0) + (cook || 0) : null);
  return { prep, cook, total };
}

export const recipeTips = (recipe) => asList(recipe?.tips);

/** The recipe's own leftovers note, or the general rule (USDA: 2 hours, 3–4 days, 165°F). */
export function leftoversNote(recipe) {
  const own = asList(recipe?.leftovers).join(' ');
  return own || 'Cool it and get it in the fridge within 2 hours. It keeps 3–4 days; reheat until steaming hot all the way through (165°F).';
}

/**
 * How long a dinner takes, for a card or a row. Most dinners: "35 min". A dinner that mostly cooks
 * on its own (a slow cook, a braise: an hour or more that isn't hands-on) says both, so nobody
 * reads six hours as six hours of work: "20 min hands-on, 6 hr 20 min in all".
 * → '' when the recipe doesn't know its time.
 */
export function timeLabel(recipe) {
  const t = recipeTimes(recipe);
  if (!t.total) return '';
  return t.prep && t.total - t.prep >= 60 ? `${fmtMinutes(t.prep)} hands-on, ${fmtMinutes(t.total)} in all` : fmtMinutes(t.total);
}

// ---------------------------------------------------------------- reading a step

const DUR = /(\d+(?:\.\d+)?)(?:\s*(?:–|—|-|to)\s*(\d+(?:\.\d+)?))?\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)\b(?:\s+(?:per|a|each)\s+(side|batch))?/gi;
const UNIT_SECONDS = { h: 3600, m: 60, s: 1 };
const UNIT_SHORT = { h: 'hr', m: 'min', s: 'sec' };

/**
 * The waits a step mentions: "2–3 minutes per side", "about 10 minutes", "30 seconds".
 * → [{ seconds (the low end: check early), maxSeconds, label, per: 'side'|'batch'|null }]
 * Skips asides that aren't a wait: "(6–8 if your grill closes…)", "up to 2 hours", "the last 2 minutes",
 * "1 minute less than the box says".
 */
export function parseDurations(text) {
  const out = [];
  const s = String(text || '');
  for (const m of s.matchAll(DUR)) {
    const before = s.slice(Math.max(0, m.index - 12), m.index).toLowerCase();
    const after = s.slice(m.index + m[0].length, m.index + m[0].length + 12).toLowerCase();
    if (/\($/.test(before) || /(up to|last|final|every|within)\s+(about\s+)?$/.test(before) || /^\s+(less|early|before the)/.test(after)) continue;
    const u = m[3][0].toLowerCase();
    const lo = Number(m[1]);
    const hi = m[2] ? Number(m[2]) : lo;
    if (!(lo > 0) || hi < lo) continue;
    const per = m[4] ? m[4].toLowerCase() : null;
    const label = `${m[2] ? `${m[1]}–${m[2]}` : m[1]} ${UNIT_SHORT[u]}${per ? ` per ${per}` : ''}`;
    out.push({ seconds: Math.round(lo * UNIT_SECONDS[u]), maxSeconds: Math.round(hi * UNIT_SECONDS[u]), label, per });
  }
  return out;
}

const HEAT = /\b(?:over|on|to|at)\s+(medium[- ]high|medium[- ]low|medium|high|low)\b(?!\s*-?\s*(?:sodium|fat|speed))/i;
const TEMP = /\b(?:at|to)\s+(?:the package temperature \(usually\s+)?(\d{3})\s*°\s*F/i;

/** The heat a step asks for: "Medium-high heat", "400°F". '' when it doesn't say. */
export function parseSetting(text) {
  const s = String(text || '');
  const out = [];
  const t = TEMP.exec(s);
  if (t && Number(t[1]) >= 250) out.push(`${t[1]}°F`);
  const h = HEAT.exec(s);
  if (h) { const w = h[1].toLowerCase().replace(' ', '-'); out.push(`${w.charAt(0).toUpperCase()}${w.slice(1)} heat`); }
  return out.join(', ');
}

const WAITS = /\b(cook|simmer|boil|rest|grill|fry|steam|heat|preheat|marinate|toast|brown|sear|warm|microwave|braise|reduce|chill|soak|stand|sit|thaw|crisp|melt|smoke|bubble)/i;

/**
 * A recipe's steps with what a cook needs beside each one.
 * Uses `stepDetail: [{ text, minutes, setting }]` when the recipe has it; otherwise reads the
 * plain `steps` strings (a family-saved dinner has only those).
 * → [{ text, setting, timers: [{ seconds, maxSeconds, label, per }], minutes (how long the step
 *      takes, for the timeline; null when the step doesn't say) }]
 */
export function stepDetails(recipe) {
  const plain = Array.isArray(recipe?.steps) ? recipe.steps.map(String) : [];
  const rich = Array.isArray(recipe?.stepDetail) ? recipe.stepDetail : [];
  const n = rich.length || plain.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = rich.length ? rich[i] : null;
    const text = String((r && typeof r === 'object' ? r.text : typeof r === 'string' ? r : '') || plain[i] || '').trim();
    if (!text) continue;
    const given = r && typeof r === 'object' ? posNum(Number(r.minutes)) : null;
    let timers = parseDurations(text).slice(0, 3);
    if (!timers.length && given && WAITS.test(text)) timers = [{ seconds: Math.round(given * 60), maxSeconds: Math.round(given * 60), label: fmtMinutes(given), per: null }];
    const read = timers.reduce((t, x) => t + (x.maxSeconds * (x.per ? 2 : 1)) / 60, 0);
    out.push({
      text,
      setting: String((r && typeof r === 'object' && r.setting) || '').trim() || parseSetting(text),
      timers,
      minutes: given ?? (read > 0 ? Math.round(read * 10) / 10 : null),
    });
  }
  return out;
}

const COOKER_PROGRAM = /^(slow cook|sear\/saut[eé]|braise|steam|(?:white |brown )?rice|oats|pasta|keep warm)(?![a-z])/i;
const upFirst = (t) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * Which appliance a step's setting is for, when the setting says so. The recipe box writes
 * "Stovetop, medium-low, lid on" or "Air fryer, 400°F", and the PossibleCooker's programs by name
 * ("SLOW COOK on LO", "sear/sauté, high"). → { id, what } ("Medium-low, lid on") | null
 */
export function settingOwner(setting) {
  const s = String(setting || '').trim();
  if (!s) return null;
  if (COOKER_PROGRAM.test(s)) return { id: 'possible cooker', what: s };
  const m = s.match(/^([^,]+),\s*(.+)$/);
  const named = m ? m[1].trim().toLowerCase() : '';
  const eq = named ? EQUIPMENT.find((e) => e.id === named || e.label.toLowerCase() === named) : null;
  return eq ? { id: eq.id, what: upFirst(m[2].trim()) } : null;
}

/** Each appliance the recipe uses, with the settings its steps call for. → [{ id, label, settings: [] }] */
export function equipmentSettings(recipe) {
  const ids = (Array.isArray(recipe?.equipment) ? recipe.equipment : []).map(String);
  const steps = stepDetails(recipe);
  return ids.map((id) => {
    const eq = EQUIPMENT_BY_ID[id];
    const settings = [];
    const add = (t) => { if (t && !settings.includes(t)) settings.push(t); };
    for (const st of steps) {
      if (!st.setting) continue;
      // A setting that names its appliance goes there and nowhere else.
      const owner = settingOwner(st.setting);
      if (owner) { if (owner.id === id) add(owner.what); continue; }
      // Otherwise (a family-saved dinner, read from its sentences) it goes by what the step mentions.
      const mentions = eq?.words.test(st.text);
      // A temperature in °F is an air-fryer (or cooker) setting; a burner heat belongs to the rest.
      const fits = /°F/.test(st.setting) ? ['air fryer', 'possible cooker'].includes(id) || mentions : id !== 'microwave' || mentions;
      if ((ids.length === 1 || mentions) && fits) add(st.setting);
    }
    return { id, label: equipmentLabel(id), settings };
  });
}

// ---------------------------------------------------------------- safe temperatures

const SAFE = {
  165: { food: 'Chicken and turkey', note: 'in the thickest part' },
  160: { food: 'Ground meat and sausage', note: 'no pink in the middle' },
  145: { food: 'Pork chops and steaks', note: 'then rest 3 minutes' },
};
const BY_PROTEIN = { chicken: 165, turkey: 165, beef: 160, pork: 145, sausage: 160 };
// The line names this dinner's own meat (gauntlet r5: a beef pot roast read "145°F Pork chops and steaks").
const FOODS = {
  chicken: { 165: 'Chicken' }, turkey: { 165: 'Turkey' }, sausage: { 160: 'Sausage' },
  beef: { 160: 'Ground beef', 145: 'Beef steaks and roasts' },
  pork: { 160: 'Ground pork', 145: 'Pork chops and roasts' },
  seafood: { 145: 'Shrimp and fish' },
};
const GROUND = new Set(['beef', 'beefPatties', 'groundTurkey', 'groundPork', 'chorizo']);

/** Safe internal temperatures for this dinner, from its steps and its protein. → [{ temp, food, note }] */
export function safeTemps(recipe) {
  const found = new Set();
  const texts = [...(Array.isArray(recipe?.steps) ? recipe.steps.map(String) : []), ...(Array.isArray(recipe?.stepDetail) ? recipe.stepDetail.map((s) => String(s?.text || '')) : [])];
  for (const t of texts) for (const m of t.matchAll(/(\d{3})\s*°\s*F/g)) if (SAFE[m[1]]) found.add(Number(m[1]));
  const protein = recipe?.protein;
  const ground = Object.keys(recipe?.items || {}).some((id) => GROUND.has(id));
  const usual = protein === 'beef' ? (ground || !Object.keys(recipe?.items || {}).length ? 160 : 145) : BY_PROTEIN[protein];
  if (!found.size && usual) found.add(usual);
  // A braise or slow-cooked roast is done long after it's safe: by the fork, not the thermometer.
  const braised = (protein === 'beef' || protein === 'pork') && texts.some((t) => /pulls? apart|fork-tender|shreds? easily/i.test(t));
  return [...found].sort((a, b) => b - a).map((temp) => {
    if (braised && temp === 145) return { temp, food: protein === 'beef' ? 'Beef roast' : 'Pork roast', note: 'done when it pulls apart with a fork', past: true };
    if (protein === 'seafood' && temp === 145) return { temp, food: 'Shrimp and fish', note: 'opaque all the way through' };
    return { temp, food: FOODS[protein]?.[temp] || SAFE[temp].food, note: SAFE[temp].note };
  });
}

// ---------------------------------------------------------------- the whole plate, timed together

/**
 * One track per dish: the dinner, then each side. Steps that don't say how long they take share
 * what's left of the dish's total time.
 * recipes: [{ id, title, kind: 'main'|'side', recipe: { minutes, steps, stepDetail, items, equipment } }]
 */
export function cookTracks(recipes) {
  return (recipes || []).filter((r) => r && r.recipe).map((r, i) => {
    const steps = stepDetails(r.recipe);
    const known = steps.reduce((t, s) => t + (s.minutes || 0), 0);
    const open = steps.filter((s) => s.minutes == null).length;
    const stated = recipeTimes(r.recipe).total || 0;
    // A step that doesn't say (chop, stir, plate) gets a fair share, never more than a few minutes.
    const each = open ? Math.min(6, Math.max(1, Math.round(((stated - known) / open) * 10) / 10)) : 0;
    const timed = steps.map((s) => ({ ...s, est: s.minutes ?? each }));
    const used = timed.reduce((t, s) => t + s.est, 0);
    // Whatever the recipe's total has left over is getting ready: it goes on the first step.
    if (timed.length && stated > used) timed[0] = { ...timed[0], est: Math.round((timed[0].est + stated - used) * 10) / 10 };
    return { id: r.id || (i === 0 ? 'main' : `side${i - 1}`), title: r.title || 'Dinner', kind: r.kind || (i === 0 ? 'main' : 'side'), items: r.recipe.items || {}, minutes: Math.max(stated, Math.round(used)), steps: timed };
  });
}

/**
 * Everything ends together: each dish is lined up to finish when the longest one does, and the
 * steps are put in the order to start them (order 'together'), or dish by dish (order 'dish').
 * → { total, tracks: [{ id, title, kind, start, end, minutes }],
 *     steps: [{ key: 'main:0', track, title, kind, index, of, at (minutes from the start), est, text, setting, timers }],
 *     cues: [{ id, title: "Steamed broccoli", text: "Start it about 20 min in, around step 3 of the dinner. It needs 10 min." }] }
 */
export function cookTimeline(tracks, { order = 'together' } = {}) {
  const list = (tracks || []).filter((t) => t.steps.length);
  const total = list.reduce((m, t) => Math.max(m, t.minutes), 0);
  const steps = [];
  const spans = [];
  list.forEach((t, order) => {
    const used = t.steps.reduce((a, s) => a + s.est, 0);
    let at = Math.max(0, total - Math.max(used, 0));
    spans.push({ id: t.id, title: t.title, kind: t.kind, start: Math.round(at), end: total, minutes: Math.round(total - at) });
    t.steps.forEach((s, index) => {
      steps.push({ key: `${t.id}:${index}`, track: t.id, title: t.title, kind: t.kind, order, index, of: t.steps.length, at: Math.round(at * 10) / 10, est: s.est, text: s.text, setting: s.setting, timers: s.timers });
      at += s.est;
    });
  });
  // 'dish': one dish start to finish, then the next (for a cook who'd rather not juggle).
  if (order === 'dish') steps.sort((a, b) => a.order - b.order || a.index - b.index);
  else steps.sort((a, b) => a.at - b.at || a.order - b.order || a.index - b.index);
  const main = list.find((t) => t.kind === 'main') || list[0];
  const cues = [];
  for (const sp of spans) {
    if (!main || sp.id === main.id) continue;
    const mainSpan = spans.find((x) => x.id === main.id);
    if (sp.start <= 1 && sp.minutes > (mainSpan?.minutes || 0)) { cues.push({ id: sp.id, title: sp.title, text: `Start here. About ${fmtMinutes(sp.minutes)}, the longest thing on the plate.` }); continue; }
    if (sp.minutes <= 5) { cues.push({ id: sp.id, title: sp.title, text: `About ${fmtMinutes(Math.max(1, sp.minutes))}. Leave it for last, while the dinner rests.` }); continue; }
    // Where the dinner is when this side has to start.
    const during = steps.filter((x) => x.track === main.id && x.at <= sp.start + 0.01).pop();
    cues.push({
      id: sp.id,
      title: sp.title,
      // Counted back from dinner being ready (gauntlet r4: "8 hr 30 min in, around step 5" was arithmetic).
      text: during && sp.start > 1
        ? `Start it about ${fmtMinutes(sp.minutes)} before dinner is ready.`
        : `Start it when you start the dinner. It needs ${fmtMinutes(sp.minutes)}.`,
    });
  }
  return { total: Math.round(total), tracks: spans, steps, cues };
}

/** The dinner and its sides as served on a night (or its usual sides when `entry` is null), ready for cookTracks. */
export function plateRecipes(db, state, dinnerId, entry) {
  const d = dinnerById(db, state, dinnerId);
  if (!d) return [];
  const out = [{ id: 'main', title: d.title, kind: 'main', recipe: d }];
  effectiveSides(db, state, dinnerId, entry).forEach((s, i) => {
    const info = sideInfo(db, state, s.parsed);
    if (!info) return;
    out.push({ id: `side${i}`, title: info.title, kind: 'side', ref: s.ref, parsed: s.parsed, recipe: info.recipe ? { ...info.recipe, items: info.items } : { minutes: info.minutes, steps: info.steps, items: info.items, equipment: info.equipment } });
  });
  return out;
}

// ---------------------------------------------------------------- amounts in the step that uses them

const STOP = new Set(('fresh frozen dry dried canned boneless skinless lean light dark toasted neutral cooking table large small medium whole ground shredded '
  + 'sliced diced chopped minced low sodium unsalted salted extra virgin organic plain sweet hot mild red green yellow white black brown baby mini style mix '
  + 'sauce seasoning can cans jar bag pack oz lb the and of with for in a an or to cut').split(' '));

function stem(w) {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(ches|shes|sses|xes|oes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}
const tokens = (text) => (String(text || '').toLowerCase().replace(/[’']/g, '').match(/[a-zà-ÿ]+/g) || []).map(stem);

/** "Soy sauce (Kikkoman)" → "soy sauce": how an ingredient reads in a sentence. */
export function plainName(name) {
  return midSentence(String(name || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/,.*$/, '').trim());
}

/** "2¼ lb boneless chicken breast", "3 oranges", "5 hamburger buns": an amount and what it is, said once. */
export function ingredientLabel(qty, meta) {
  const name = plainName(meta.name);
  const amount = unitText(qty, meta.unit);
  const unit = stem(String(meta.unit || '').toLowerCase());
  // The unit is the food itself ("3 oranges" of "Oranges"): say it once, and "1 lime", not "1 limes".
  if (unit && name.toLowerCase().split(/\s+/).some((w) => stem(w) === unit)) {
    const one = qty > 0 && qty < 1 + 1e-9;
    return `${amount.replace(/\s+\S+$/, '')} ${one ? name.split(/\s+/).map((w) => (stem(w.toLowerCase()) === unit ? singular(w) : w)).join(' ') : name}`;
  }
  return `${amount} ${name}`;
}

/** Phrases that mean this ingredient in a step, longest first. */
function phrasesFor(meta, id) {
  const name = tokens(String(meta.name || '').replace(/\([^)]*\)/g, ' ').replace(/,.*$/, ''));
  const own = tokens(readableId(id));
  const sets = [name, own, ...(meta.aliases || []).map(tokens)].filter((w) => w.length);
  // A lone word counts when it's the thing itself: the last word of the name ("rice"), or the first
  // or last word of the id ("chicken" for chickenThighs). Never a describer ("dry", "frozen").
  const heads = new Set([...sets.map((w) => w[w.length - 1]), ...(own.length ? [own[0]] : [])]);
  const whole = new Set(sets.filter((w) => w.length === 1).map((w) => w[0]));
  const seen = new Map();
  for (const w of sets) {
    for (let len = w.length; len >= 1; len--) {
      for (let i = 0; i + len <= w.length; i++) {
        const gram = w.slice(i, i + len);
        if (gram.every((x) => STOP.has(x))) continue;
        if (len === 1 && !(heads.has(gram[0]) || whole.has(gram[0]))) continue;
        seen.set(gram.join(' '), gram);
      }
    }
  }
  return { grams: [...seen.values()].sort((a, b) => b.length - a.length), whole };
}

function occurrences(words, gram) {
  const out = [];
  for (let i = 0; i + gram.length <= words.length; i++) {
    let ok = true;
    for (let k = 0; k < gram.length; k++) if (words[i + k] !== gram[k]) { ok = false; break; }
    if (ok) out.push(i);
  }
  return out;
}

/**
 * For each step, the ingredients it names with their amounts for five.
 * → [[{ id, name, label: "2¼ lb boneless chicken breast", qty, unit, amount: "2¼ lb", again (an earlier step named it too) }]]
 *   (one list per step, in recipe order)
 */
export function stepIngredients(db, state, items, steps) {
  const scaled = scaleItems(db, state, items || {});
  const seen = new Set();
  const ings = Object.entries(scaled).map(([id, qty]) => {
    const meta = itemMeta(db, state, id);
    return { id, qty, meta, ...phrasesFor(meta, id) };
  });
  return (steps || []).map((step) => {
    const words = tokens(typeof step === 'string' ? step : step?.text);
    const hits = [];
    for (const ing of ings) {
      for (const gram of ing.grams) {
        const at = occurrences(words, gram);
        if (at.length) { hits.push({ ing, len: gram.length, at, word: gram.length === 1 ? gram[0] : null }); break; }
      }
    }
    // "sesame oil" belongs to the sesame oil, not to the cooking oil too.
    const free = hits.filter((h) => h.at.some((p) => !hits.some((o) => o !== h && o.len > h.len && o.at.some((q) => q <= p && p + h.len <= q + o.len))));
    // Two ingredients answering to one word ("chicken"): the one named exactly that wins, then the meat.
    const rank = (h) => (h.ing.whole.has(h.word) ? 2 : db.ingredients[h.ing.id]?.meat ? 1 : 0);
    const kept = free.filter((h) => !h.word || !free.some((o) => o !== h && o.word === h.word && rank(o) > rank(h)));
    return kept.map((h) => {
      const again = seen.has(h.ing.id);
      seen.add(h.ing.id);
      return { id: h.ing.id, name: h.ing.meta.name, label: ingredientLabel(h.ing.qty, h.ing.meta), qty: h.ing.qty, unit: h.ing.meta.unit, amount: unitText(h.ing.qty, h.ing.meta.unit), again };
    });
  });
}

// ---------------------------------------------------------------- what's already in the pantry

/**
 * A recipe's ingredients for five against the shelf.
 * → { rows: [{ id, name, unit, need, have (Infinity = a stocked staple), status: 'have'|'short'|'none', short, amount }],
 *     have, total, missing: [rows] }
 * `rem` (from coverage.onHand) can be passed in when checking many recipes.
 */
export function pantryCheck(db, state, items, rem = onHand(db, state)) {
  const rows = Object.entries(scaleItems(db, state, items || {})).map(([id, need]) => {
    const meta = itemMeta(db, state, id);
    // A staple follows readiness()'s rule: in the house unless switched off or marked low, so the
    // recipe page, Can make now and Cook from what we have give one answer (gauntlet r8).
    const have = meta.kind === 'staple' ? (stapleShort(state, id) ? 0 : Infinity) : rem[id] ?? 0;
    const ok = have === Infinity || have + 1e-9 >= need * ENOUGH;
    return {
      id, name: meta.name, unit: meta.unit, need: round2(need), have: have === Infinity ? Infinity : round2(have),
      status: ok ? 'have' : have > 0 ? 'short' : 'none', short: ok ? 0 : round2(need - have), amount: unitText(need, meta.unit), staple: meta.kind === 'staple',
    };
  });
  const missing = rows.filter((r) => r.status !== 'have');
  return { rows, have: rows.length - missing.length, total: rows.length, missing };
}

// ---------------------------------------------------------------- plate facts: calories, protein, lean

export { VEG_ON_PLATE }; // a plate "has a vegetable" at one 80 g serving or more (app/health.js)

/**
 * One plate of a dinner as served: nutrition.plateHealth (docs/spec/18 §18.5, the one lean rule:
 * LEAN_RULE) in the shape the screens read.
 * → { kcal, protein, proteinG, carbsG?, fatG?, fiberG?, vegServings, lean, why, complete } | null
 * `why` is plateHealth's sentence without its full stop ("A lean plate: 640 cal with 50 g protein").
 */
export function plateFacts(db, state, dinnerId, entry = null) {
  const h = N.plateHealth(db, state, dinnerId, entry);
  if (!h) return null;
  const n = N.plateNutrition(db, state, dinnerId, entry);
  return { ...h, protein: h.proteinG, why: String(h.why || '').replace(/\.$/, ''), complete: n ? n.complete !== false : true };
}

/**
 * The week's dinners at a glance. No targets, no scores: just what's on the table.
 * → { home (nights cooking at home), cooked (so far), away, leftoverNights, open, counted,
 *     avgKcal, avgProtein, withVeg, lean }
 */
export function weekSummary(db, state, dates) {
  const out = { home: 0, cooked: 0, away: 0, leftoverNights: 0, open: 0, counted: 0, avgKcal: null, avgProtein: null, withVeg: 0, lean: 0 };
  let kcal = 0;
  let protein = 0;
  for (const date of dates || []) {
    const e = state?.plan?.[date];
    if (e?.status === 'away') { if (e.away?.reason === LEFTOVER_REASON) out.leftoverNights++; else out.away++; continue; }
    const d = e?.dinner ? dinnerById(db, state, e.dinner) : null;
    if (!d) { out.open++; continue; }
    out.home++;
    if (e.status === 'cooked') out.cooked++;
    const f = plateFacts(db, state, d.id, e);
    const veg = f ? f.vegServings >= VEG_ON_PLATE : effectiveSides(db, state, d.id, e).some((s) => isVegSide(db, state, s.parsed));
    if (veg) out.withVeg++;
    if (!f) continue;
    out.counted++;
    kcal += f.kcal;
    protein += f.protein;
    if (f.lean) out.lean++;
  }
  if (out.counted) { out.avgKcal = kcal / out.counted; out.avgProtein = protein / out.counted; }
  return out;
}

// ---------------------------------------------------------------- why this dinner, tonight

/**
 * Up to three short, true reasons a dinner earns its night: it uses what should go first, the
 * pantry already covers it, it's lean, something in it is on sale, the family loves it.
 * The planner's own reasons (entry.why / entry.reasons) lead when a plan entry carries them.
 * → [{ kind: 'use'|'pantry'|'lean'|'sale'|'fav'|'quick'|'plan', text }]
 */
export function whyThisDinner(db, state, dinnerId, entry, { today, max = 3 } = {}) {
  const d = dinnerById(db, state, dinnerId);
  if (!d) return [];
  const out = [];
  for (const t of asList(entry?.why ?? entry?.reasons)) out.push({ kind: 'plan', text: t });
  const items = itemsForNight(db, state, dinnerId, entry);
  const ids = Object.keys(items);
  if (today) {
    const soon = useSoon(db, state, today).filter((u) => ids.includes(u.id)).slice(0, 2);
    for (const u of soon) {
      const since = sinceOf(state.pantry?.[u.id]);
      const from = since ? ` from ${shortDate(since)}` : '';
      const by = u.daysLeft < 0 ? 'it’s past its best' : u.daysLeft === 0 ? 'best today' : u.daysLeft === 1 ? 'best by tomorrow' : `best by ${weekdayName(u.useBy)}${u.daysLeft > 6 ? `, ${shortDate(u.useBy)}` : ''}`;
      out.push({ kind: 'use', text: `Uses up the ${plainName(u.name)}${from} (${by})` });
    }
    if (!soon.length) {
      // Nothing urgent: still worth saying when the meat is already in the house.
      const meat = ids.find((id) => db.ingredients[id]?.meat && typeof state?.pantry?.[id]?.qty === 'number' && state.pantry[id].qty >= items[id] * ENOUGH && !state.pantry[id].low);
      if (meat) {
        const since = sinceOf(state.pantry[meat]);
        out.push({ kind: 'use', text: `Uses the ${plainName(itemMeta(db, state, meat).name)} in the ${placeOf(db, state, meat)}${since ? ` from ${shortDate(since)}` : ''}` });
      }
    }
  }
  const f = plateFacts(db, state, dinnerId, entry);
  if (f?.lean) out.push({ kind: 'lean', text: f.why || 'A lean plate, high in protein' });
  const check = pantryCheck(db, state, items);
  if (check.total && !check.missing.length) out.push({ kind: 'pantry', text: 'Everything for it is already in the house' });
  if (today) {
    for (const id of ids) {
      const deal = ['jewel', 'sams'].map((s) => activeDeal(state, s, id, today)).find((x) => x && (x.sale || x.coupon));
      if (!deal || check.rows.find((r) => r.id === id)?.status === 'have') continue;
      const where = deal.store === 'sams' ? 'Sam’s Club' : 'Jewel-Osco';
      out.push({ kind: 'sale', text: `${plainName(itemMeta(db, state, id).name).replace(/^./, (c) => c.toUpperCase())} is ${deal.sale ? 'on sale' : 'on coupon'} at ${where}${deal.ends ? ` through ${weekdayName(deal.ends)}` : ''}` });
      break;
    }
  }
  if (isFavorite(state, d)) out.push({ kind: 'fav', text: 'A family favorite' });
  const t = recipeTimes(d).total;
  if (t && t <= 25) out.push({ kind: 'quick', text: `On the table in about ${fmtMinutes(t)}` });
  return out.slice(0, max);
}

// ---------------------------------------------------------------- leftovers

/** Cooked food keeps 3 days in the fridge here (USDA says 3–4; the planner uses the careful end). */
export const LEFTOVER_DAYS = 3;
/** The away reason a leftover night is saved under: plan[date] = { status: 'away', away: { reason: 'Leftovers', note, from } }. */
export const LEFTOVER_REASON = 'Leftovers';

/**
 * state.leftovers["YYYY-MM-DD" (the night it was cooked)] = {
 *   dinner (id), title, servings (left now), saved (how many were put away), useBy ("YYYY-MM-DD"),
 *   by, at, night? ("YYYY-MM-DD" when it's set aside for a leftover night) }
 * servings 0 with saved 0 means "asked, and there were none".
 */
export function leftoverRecord(db, state, { date, servings, who, at }) {
  const e = state?.plan?.[date];
  const d = e?.dinner ? dinnerById(db, state, e.dinner) : null;
  const n = Math.max(0, Math.min(20, Math.round(Number(servings) || 0)));
  return { dinner: e?.dinner || null, title: d?.title || 'Dinner', servings: n, saved: n, useBy: addDays(date, LEFTOVER_DAYS), by: who || 'Family', at: at || '' };
}

/** What's in the fridge to eat: → [{ date, dinner, title, servings, saved, useBy, daysLeft, night }], soonest first. */
export function leftoversOnHand(state, today) {
  const out = [];
  for (const [date, l] of Object.entries(state?.leftovers || {})) {
    if (!l || !(l.servings > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const useBy = /^\d{4}-\d{2}-\d{2}$/.test(String(l.useBy || '')) ? l.useBy : addDays(date, LEFTOVER_DAYS);
    const daysLeft = diffDays(useBy, today);
    if (daysLeft < -2) continue; // long gone: stop showing it
    // Set aside for a leftover night only while that night still says so (it can be brought back).
    const n = l.night ? state?.plan?.[l.night] : null;
    const night = n?.status === 'away' && n.away?.reason === LEFTOVER_REASON && n.away?.from === date ? l.night : null;
    out.push({ date, dinner: l.dinner || null, title: l.title || 'Leftovers', servings: l.servings, saved: l.saved ?? l.servings, useBy, daysLeft, night });
  }
  return out.sort((a, b) => a.useBy.localeCompare(b.useBy) || a.date.localeCompare(b.date));
}

/** A cooked night from today or yesterday that nobody has answered the leftovers question for. */
export function leftoversToAsk(state, today) {
  for (const date of [today, addDays(today, -1)]) {
    const e = state?.plan?.[date];
    if (e?.status === 'cooked' && e.dinner && !state?.leftovers?.[date]) return date;
  }
  return null;
}

/** "2 servings", "1 serving" */
export const servingsText = (n) => `${n} ${n === 1 ? 'serving' : 'servings'}`;

/** "good through Thursday" / "eat today" / "past its best: check it or toss it" */
export function useByText(l, today) {
  if (l.daysLeft < 0) return 'past its best: toss it';
  if (l.daysLeft === 0) return 'eat it today';
  if (l.daysLeft === 1) return 'good through tomorrow';
  return `good through ${weekdayName(l.useBy)}`;
}

/** The nights a batch of leftovers could be dinner: tomorrow (or tonight, if it isn't cooked) up to its use-by day. */
export function leftoverNightChoices(state, l, today) {
  const out = [];
  for (let d = today; d <= l.useBy; d = addDays(d, 1)) {
    if (d <= l.date) continue;
    const e = state?.plan?.[d];
    if (e?.status === 'cooked' || e?.status === 'away') continue;
    out.push(d);
  }
  return out;
}

// ---------------------------------------------------------------- timers

/** A kitchen timer. `endsAt` is a clock time (ms), so it keeps counting across steps, screens and reloads. */
export function newTimer({ id, label, seconds, step = null, title = '', now }) {
  const s = Math.max(1, Math.round(seconds));
  return { id, label: String(label || ''), title: String(title || ''), step, seconds: s, endsAt: now + s * 1000, left: null, acked: false };
}
/** Seconds left (0 when it's done; the frozen amount while paused). */
export const timerLeft = (t, now) => (t.left != null ? t.left : Math.max(0, Math.ceil((t.endsAt - now) / 1000)));
export const timerPhase = (t, now) => (t.left != null ? 'paused' : timerLeft(t, now) <= 0 ? 'done' : 'running');
export const pauseTimer = (t, now) => (t.left != null ? t : { ...t, left: timerLeft(t, now) });
export const resumeTimer = (t, now) => (t.left == null ? t : { ...t, endsAt: now + t.left * 1000, left: null, acked: false });
/** Adds time; a finished timer starts counting again from now. */
export function addTime(t, seconds, now) {
  if (t.left != null) return { ...t, left: Math.max(1, t.left + seconds) };
  return { ...t, endsAt: Math.max(t.endsAt, now) + seconds * 1000, acked: false };
}
/** "3:05", "1:02:03" */
export function fmtClock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
/** Timers that have rung and nobody has answered yet. */
export const ringing = (timers, now) => (timers || []).filter((t) => !t.acked && timerPhase(t, now) === 'done');

// ---------------------------------------------------------------- the recipe box: what matters to this family

export const TIME_FILTERS = [{ id: '20', label: '20 min or less' }, { id: '30', label: '30 min or less' }, { id: '45', label: '45 min or less' }];
export const RECIPE_SORTS = [{ id: 'az', label: 'A to Z' }, { id: 'quick', label: 'Quickest' }, { id: 'protein', label: 'Most protein' }, { id: 'light', label: 'Lightest' }, { id: 'cheap', label: 'Cheapest first' }];

/** What the recipe box needs to know about one dinner. `rem` = coverage.onHand(db, state), computed once. */
export function recipeFacts(db, state, d, rem) {
  const items = itemsForNight(db, state, d.id, null);
  // The same count as tonight's picker and Cook from what we have (gauntlet r7: one said 1 thing, the other 5).
  const r = readiness(db, state, d.id, rem);
  const f = plateFacts(db, state, d.id, null);
  return {
    minutes: recipeTimes(d).total || 0,
    kcal: f?.kcal ?? null, protein: f?.protein ?? null, lean: !!f?.lean, why: f?.why || '', veg: f ? f.vegServings >= VEG_ON_PLATE : false,
    missing: r.missing.length + r.sideOut.length, total: Object.keys(items).length, makeable: Object.keys(items).length > 0 && r.ready && !r.sideOut.length, ready: r,
    words: [d.title, d.subtitle, d.category, d.protein, ...d.tags, ...d.equipment.map(equipmentLabel), ...Object.keys(d.items).map((id) => itemMeta(db, state, id).name)].join(' ').toLowerCase(),
  };
}

/** filters: { fav, makeable, lean, equipment, time ('20'|'30'|'45'), protein, category }; q: search words (all must match). */
export function recipeMatches(d, facts, filters = {}, q = '', { favorite = false } = {}) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (words.some((w) => !facts.words.includes(w))) return false;
  if (filters.fav && !favorite) return false;
  if (filters.makeable && !facts.makeable) return false;
  if (filters.lean && !facts.lean) return false;
  if (filters.equipment && !d.equipment.includes(filters.equipment)) return false;
  if (filters.time && !(facts.minutes > 0 && facts.minutes <= Number(filters.time))) return false;
  if (filters.protein && d.protein !== filters.protein) return false;
  if (filters.category && d.category !== filters.category) return false;
  // Older saved filters: "quick" was 30 minutes, "healthy" the healthier tag.
  if (filters.quick && !(facts.minutes > 0 && facts.minutes <= 30)) return false;
  if (filters.healthy && !(d.tags.includes('healthier') || d.tags.includes('salad'))) return false;
  return true;
}

export function recipeCompare(sort) {
  const by = {
    quick: (a, b) => (a.facts.minutes || 999) - (b.facts.minutes || 999),
    protein: (a, b) => (b.facts.protein ?? -1) - (a.facts.protein ?? -1),
    light: (a, b) => (a.facts.kcal ?? 1e9) - (b.facts.kcal ?? 1e9),
    ready: (a, b) => a.facts.missing - b.facts.missing,
    // cost.cheapestFirst's order, kept on the facts as a rank (a dinner nothing can price is last).
    cheap: (a, b) => (a.facts.cheapRank ?? 1e9) - (b.facts.cheapRank ?? 1e9),
  }[sort];
  return (a, b) => (by ? by(a, b) : 0) || a.d.title.localeCompare(b.d.title);
}

export { listJoin };
