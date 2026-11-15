#!/usr/bin/env node
// Validates data/catalog.json + data/recipes.json against the family's rules (SPEC.md §1, §3).
// Plain Node (>=18), no dependencies.  Usage:  node scripts/validate-data.mjs [--quiet]
// Exit code 1 if any ERROR is found; WARNings are printed but do not fail.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUIET = process.argv.includes('--quiet');
const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

function load(rel, required = true) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) { if (required) err(`${rel}: file missing`); return null; }
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { err(`${rel}: JSON does not parse — ${e.message}`); return null; }
}

const catalog = load('data/catalog.json');
const recipes = load('data/recipes.json');
const ref = load('reference/chatgpt-v1-data.json', false);
if (!catalog || !recipes) {
  for (const e of errors) console.log('ERROR ' + e);
  console.log(`\nFAILED: ${errors.length} error(s).`);
  process.exit(1);
}

// ---------------------------------------------------------------- constants
const AISLES = ['Meat', 'Produce', 'Frozen', 'Dairy & Eggs', 'Bakery', 'Pasta & Grains', 'Canned & Jarred', 'Condiments & Sauces', 'Spices & Baking', 'Snacks & Extras'];
const STORAGE = ['freezer', 'fridge', 'pantry', 'counter'];
const KINDS = ['measured', 'staple'];
const STORES = ['sams', 'jewel'];
const CATEGORIES = ['Burgers', 'Asian-inspired', 'Pasta', 'Tex-Mex', 'Grill', 'Comfort', 'Salads'];
const PROTEINS = ['chicken', 'beef', 'pork', 'turkey', 'sausage', 'mixed'];
const EQUIPMENT = ['stovetop', 'blackstone', 'electric grill', 'outdoor grill', 'air fryer', 'microwave'];
const TAGS = ['burger', 'pizza', 'rice', 'family favorite', 'family usual', 'from your pantry', 'noodle night', 'taco night', 'grill night', 'salad', 'healthier', 'sandwiches', 'wraps'];
const SIDE_KINDS = ['vegetable', 'starch', 'salad', 'fruit', 'bread', 'soup'];
const RICE_IDS = ['jasmine', 'basmati'];
const MAX_COST = 28, MIN_COST = 6; // v2.2: recalibrated from $22 to real prices paid (93/7 beef $6.17/lb, ⅓-lb sirloin patties, pre-seasoned/cooked meats) — ≈ $5.60 a plate
const MIN_CORE = 50, MIN_BENCH = 20;

// Which catalog meat ids satisfy each "protein" value.
const PROTEIN_IDS = {
  chicken: ['chicken', 'chickenThighs', 'fajitaChicken', 'pulledChicken', 'chickenAlfredoDeli'],
  beef: ['beef', 'beefPatties', 'roastBeef', 'eyeRoundSteak'],
  pork: ['pork', 'porkLoin', 'groundPork', 'pulledPork'],
  turkey: ['groundTurkey'],
  sausage: ['italianSausage', 'smokedSausage', 'chorizo'],
};
// Safe-temperature rules: if a dinner uses one of these ids, its steps must state the temp.
const TEMP_RULES = [
  { ids: ['chicken', 'chickenThighs', 'fajitaChicken'], temp: '165°F', what: 'chicken' },
  { ids: ['groundTurkey'], temp: '165°F', what: 'ground turkey' },
  { ids: ['beef', 'beefPatties', 'groundPork', 'italianSausage', 'chorizo'], temp: '160°F', what: 'ground meat / sausage / patties' },
  { ids: ['eyeRoundSteak'], temp: '145°F', what: 'whole-cut beef' },
  { ids: ['pulledPork', 'pulledChicken', 'smokedSausage', 'chickenAlfredoDeli', 'roastBeef'], temp: '165°F', what: 'fully cooked meat (reheat)' },
  { ids: ['pork', 'porkLoin'], temp: '145°F', what: 'pork chops / loin', rest: true },
];

// Banned words (whole-text, case-insensitive). "seafood-free" is the one allowed seafood phrase.
const BANNED = [
  [/\bovens?\b/i, 'oven'], [/broil/i, 'broil'], [/\bbake in\b/i, 'bake in'], [/preheat the oven/i, 'preheat the oven'],
  [/fish/i, 'fish'], [/salmon/i, 'salmon'], [/shrimp/i, 'shrimp'], [/\btuna\b/i, 'tuna'], [/tilapia/i, 'tilapia'],
  [/\bcod\b/i, 'cod'], [/\bcrabs?\b/i, 'crab'], [/lobster/i, 'lobster'], [/scallop/i, 'scallop'], [/oyster/i, 'oyster'],
  [/anchov/i, 'anchovy'], [/fish sauce/i, 'fish sauce'], [/seafood(?!-free)/i, 'seafood'], [/tofu/i, 'tofu'],
  [/worcestershire(?!-free)/i, 'Worcestershire'], [/\bclams?\b/i, 'clam'], [/mussel/i, 'mussel'], [/prawn/i, 'prawn'],
  [/\bsquid\b/i, 'squid'], [/calamari/i, 'calamari'], [/sardine/i, 'sardine'],
  // Jeff, 2026-11-15: "I just don't like Caesar salads whatsoever, so please avoid those at all costs."
  [/caesar/i, 'Caesar'],
];
function scanText(where, text) {
  if (typeof text !== 'string') return;
  for (const [re, word] of BANNED) if (re.test(text)) err(`${where}: banned word "${word}" in: ${text.slice(0, 120)}`);
}

// ---------------------------------------------------------------- catalog
const ING = catalog.ingredients || {};
if (catalog.version !== 2) err('catalog.version must be 2');
if (!catalog.units || typeof catalog.units !== 'object') err('catalog.units missing');
scanText('catalog.notes', catalog.notes);

const unitCost = {}; // id -> { cost, store } using Sam's generic, falling back to Jewel generic
for (const [id, ing] of Object.entries(ING)) {
  const w = `catalog.${id}`;
  for (const f of ['name', 'unit', 'aisle', 'storage', 'kind', 'defaultStore']) if (!ing[f]) err(`${w}: missing ${f}`);
  if (ing.aisle && !AISLES.includes(ing.aisle)) err(`${w}: aisle "${ing.aisle}" not allowed`);
  if (ing.storage && !STORAGE.includes(ing.storage)) err(`${w}: storage "${ing.storage}" not allowed`);
  if (ing.kind && !KINDS.includes(ing.kind)) err(`${w}: kind "${ing.kind}" not allowed`);
  if (ing.defaultStore && !STORES.includes(ing.defaultStore)) err(`${w}: defaultStore "${ing.defaultStore}" not allowed`);
  if (catalog.units && !catalog.units[ing.unit]) err(`${w}: unit "${ing.unit}" not in catalog.units`);
  if (!Array.isArray(ing.aliases) || ing.aliases.length < 2) err(`${w}: needs at least 2 aliases`);
  scanText(`${w}.name`, ing.name);
  (ing.aliases || []).forEach((a, i) => scanText(`${w}.aliases[${i}]`, a));
  const packs = ing.packs || {};
  let validStores = 0;
  for (const st of Object.keys(packs)) {
    if (!STORES.includes(st)) { err(`${w}: unknown store "${st}" in packs`); continue; }
    let ok = true;
    for (const tier of ['generic', 'name']) {
      const p = packs[st][tier];
      if (!p) { err(`${w}: packs.${st}.${tier} missing`); ok = false; continue; }
      if (!(typeof p.size === 'number' && p.size > 0)) { err(`${w}: packs.${st}.${tier}.size must be > 0`); ok = false; }
      if (!(typeof p.price === 'number' && p.price > 0)) { err(`${w}: packs.${st}.${tier}.price must be > 0`); ok = false; }
      if (!p.label || typeof p.label !== 'string') { err(`${w}: packs.${st}.${tier}.label missing`); ok = false; }
      scanText(`${w}.packs.${st}.${tier}.label`, p.label);
    }
    if (ok) validStores++;
  }
  if (validStores === 0) err(`${w}: needs packs for at least one store with positive size/price`);
  if (ing.defaultStore && !packs[ing.defaultStore]) err(`${w}: defaultStore "${ing.defaultStore}" has no packs`);
  const g = packs.sams?.generic || packs.jewel?.generic;
  if (g && g.size > 0) unitCost[id] = { cost: g.price / g.size, store: packs.sams?.generic ? 'sams' : 'jewel' };
}

// Reference ingredients: every id kept, unit unchanged.
if (ref) {
  for (const [id, r] of Object.entries(ref.ingredients || {})) {
    if (!ING[id]) err(`reference ingredient "${id}" missing from catalog`);
    else if (ING[id].unit !== r.unit) err(`catalog.${id}: unit changed from "${r.unit}" to "${ING[id].unit}"`);
  }
} else warn('reference/chatgpt-v1-data.json not found — skipped reference id/unit checks');

const MEAT_IDS = new Set(Object.entries(ING).filter(([, i]) => i.meat).map(([id]) => id));
if (MEAT_IDS.size === 0) err('catalog: no ingredient is flagged "meat": true');
const extras = Object.entries(ING).filter(([, i]) => i.extra).map(([id]) => id);

// ---------------------------------------------------------------- recipes
if (recipes.version !== 2) err('recipes.version must be 2');
scanText('recipes.notes', recipes.notes);
// lunches.json items: the same banned words (no Caesar salads, no seafood) in titles, subtitles, prep and photos.
{
  const lpath = new URL('../data/lunches.json', import.meta.url);
  if (fs.existsSync(lpath)) {
    const L = JSON.parse(fs.readFileSync(lpath, 'utf8'));
    for (const it of L.items || []) for (const f of ['title', 'subtitle', 'prep', 'photo']) if (it[f]) scanText(`lunches.${it.id}.${f}`, it[f]);
  }
}
const dinners = Array.isArray(recipes.dinners) ? recipes.dinners : (err('recipes.dinners must be an array'), []);
const sideList = Array.isArray(recipes.sides) ? recipes.sides : (err('recipes.sides must be an array'), []);
const SIDES = {};
for (const s of sideList) {
  if (SIDES[s.id]) err(`side "${s.id}" defined twice`);
  SIDES[s.id] = s;
}

const usedIngredients = new Set();
function checkItems(where, items) {
  if (!items || typeof items !== 'object' || Object.keys(items).length === 0) { err(`${where}: items missing/empty`); return; }
  for (const [id, q] of Object.entries(items)) {
    usedIngredients.add(id);
    if (!ING[id]) err(`${where}: item "${id}" is not in the catalog`);
    if (!(typeof q === 'number' && q > 0)) err(`${where}: item "${id}" quantity must be a positive number`);
  }
}
// Keywords that must appear in the steps for an item to count as "used in the steps" (warning only).
const STEP_WORDS = {
  starch: ['cornstarch'], parm: ['parmesan'], cornwrap: ['tortilla', 'tostada'], minis: ['pizza'], slaw: ['coleslaw', 'cabbage', 'slaw'],
  taco: ['taco seasoning'], pepper: ['pepper'], peppers: ['pepper'], cheese: ['cheddar', 'cheese'], oil: ['oil'], soy: ['soy'],
  sesame: ['sesame'], lettuce: ['romaine', 'lettuce'], beans: ['beans'], chickpeas: ['chickpea'], tomatoes: ['tomatoes'], tomato: ['tomato'],
  vegetables: ['vegetables'], jasmine: ['rice'], basmati: ['basmati', 'rice'], chickenThighs: ['chicken'], chicken: ['chicken'],
  beef: ['beef'], pork: ['chop', 'pork'], porkLoin: ['pork'], groundPork: ['pork'], groundTurkey: ['turkey'], italianSausage: ['sausage'],
  greenBeans: ['green beans'], cannedCorn: ['corn'], cannedCarrots: ['carrot'], corn: ['corn'], freshGreenBeans: ['green beans'],
  cornCobs: ['ears', 'corn'], buns: ['bun'], hoagies: ['roll'], bread: ['bread', 'slice'], naan: ['naan'], tortillas: ['tortilla'],
  yogurt: ['yogurt', 'tzatziki'], potatoes: ['potato'], sweet: ['sweet potato'], ginger: ['ginger'], garlic: ['garlic'], limes: ['lime'],
  lemons: ['lemon'], oranges: ['orange'], spaghetti: ['spaghetti', 'noodle'], penne: ['penne'], elbows: ['macaroni'], eggNoodles: ['noodle'],
  riceVinegar: ['rice vinegar'], ciderVinegar: ['cider vinegar'], brownSugar: ['brown sugar'], redPepperFlakes: ['red pepper'],
  garlicPowder: ['garlic powder'], italianSeasoning: ['italian seasoning'], chickenBroth: ['broth', 'stock'], porkBeans: ['pork and beans'],
  tortillaChips: ['chips'], sourCream: ['sour cream'], mayo: ['mayo'], bbq: ['barbecue'], tikka: ['tikka'], jalapenos: ['jalapeño', 'jalapeno'],
  eggs: ['egg'], milk: ['milk'], beefPatties: ['patt'], cookedBacon: ['bacon'], smokedSausage: ['sausage'], fajitaChicken: ['chicken'],
  pulledChicken: ['chicken'], pulledPork: ['pork'], chickenAlfredoDeli: ['alfredo'], fajitaSauce: ['fajita sauce'], cajunPotatoes: ['potatoes'],
  chiliBeans: ['chili beans'], knorrTeriyaki: ['teriyaki'], streetTacoFlour: ['tortilla'], streetTacoCorn: ['tortilla'], cheeseSlices: ['cheese slice'], butter: ['butter'], salt: ['salt'], honey: ['honey'], peanut: ['peanut'], applesauce: ['applesauce'],
  potstickers: ['potsticker'], edamame: ['edamame'], cilantro: ['cilantro'], panko: ['panko', 'crumbs'], flour: ['flour'],
};
const stem = (w) => w.toLowerCase().replace(/(es|s)$/, '');
function checkStepsMention(where, items, steps) {
  const text = steps.join(' ').toLowerCase();
  for (const id of Object.keys(items || {})) {
    // Explicit keywords win; otherwise accept the id, any alias, or any 4+ letter word of the name (singular or plural).
    const ing = ING[id] || {};
    const words = STEP_WORDS[id] || [
      stem(id), ...(ing.aliases || []).map(a => a.toLowerCase()),
      ...String(ing.name || '').toLowerCase().split(/[^a-zñé]+/).filter(w => w.length >= 4 && !['with', 'fresh', 'frozen', 'dried', 'ground', 'sliced', 'shredded', 'yellow', 'english', 'smoked', 'classic', 'plain'].includes(w)).map(stem),
    ];
    if (!words.some(w => w && text.includes(w))) warn(`${where}: item "${id}" is never mentioned in the steps`);
  }
}
const EQUIP_HINTS = [
  ['air fryer', /air[- ]fr/i], ['blackstone', /blackstone|griddle/i], ['electric grill', /electric grill|\bgrill\b/i],
  ['microwave', /microwave/i], ['stovetop', /skillet|saucepan|\bpot\b|boil|simmer/i], ['outdoor grill', /outdoor grill/i],
];
function checkEquipment(where, equipment, steps) {
  if (!Array.isArray(equipment)) { err(`${where}: equipment must be an array`); return; }
  for (const e of equipment) if (!EQUIPMENT.includes(e)) err(`${where}: equipment "${e}" not allowed`);
  const text = steps.join(' ');
  for (const [e, re] of EQUIP_HINTS) {
    const mentioned = re.test(text);
    if (mentioned && !equipment.includes(e)) {
      // "grill" also matches inside Blackstone griddle wording; only flag electric grill when no griddle is listed.
      if (e === 'electric grill' && equipment.includes('blackstone') && !/electric grill/i.test(text)) continue;
      warn(`${where}: steps use the ${e} but equipment does not list it`);
    }
    if (!mentioned && equipment.includes(e)) warn(`${where}: equipment lists ${e} but steps never use it`);
  }
}
function checkCommonText(where, o) {
  for (const f of ['title', 'subtitle', 'photo']) if (o[f] !== undefined) scanText(`${where}.${f}`, o[f]);
  (o.steps || []).forEach((s, i) => scanText(`${where}.steps[${i + 1}]`, s));
  if (!o.photo || o.photo.length < 30) err(`${where}: photo hint missing or too short`);
  if (!Array.isArray(o.steps) || o.steps.length === 0 || o.steps.some(s => typeof s !== 'string' || s.trim().length < 10)) err(`${where}: steps must be non-empty sentences`);
  if (!(typeof o.minutes === 'number' && o.minutes > 0)) err(`${where}: minutes must be > 0`);
}
const hasRice = (items) => RICE_IDS.some(r => items && items[r]);

// ---- sides
for (const s of sideList) {
  const w = `side ${s.id}`;
  if (!s.id || !s.title) err(`${w}: id/title missing`);
  if (!SIDE_KINDS.includes(s.kind)) err(`${w}: kind "${s.kind}" not allowed`);
  checkItems(w, s.items);
  checkCommonText(w, s);
  checkEquipment(w, s.equipment || [], s.steps || []);
  checkStepsMention(w, s.items, s.steps || []);
  const tagged = (s.tags || []).includes('rice');
  if (hasRice(s.items) && !tagged) err(`${w}: contains rice but is not tagged "rice"`);
  if (tagged && !hasRice(s.items)) err(`${w}: tagged "rice" but has no rice`);
  for (const t of s.tags || []) if (!TAGS.includes(t)) warn(`${w}: unknown tag "${t}"`);
}

// ---- dinners
const ids = new Set();
let nCore = 0, nBench = 0;
for (const d of dinners) {
  const w = `dinner ${d.id}`;
  if (ids.has(d.id)) err(`${w}: duplicate id`);
  ids.add(d.id);
  for (const f of ['id', 'title', 'subtitle', 'category', 'protein', 'rotation']) if (!d[f]) err(`${w}: missing ${f}`);
  if (d.rotation === 'core') nCore++; else if (d.rotation === 'bench') nBench++; else err(`${w}: rotation must be core or bench`);
  if (!CATEGORIES.includes(d.category)) err(`${w}: category "${d.category}" not allowed`);
  if (!PROTEINS.includes(d.protein)) err(`${w}: protein "${d.protein}" not allowed`);
  if (!Array.isArray(d.tags)) err(`${w}: tags must be an array`);
  for (const t of d.tags || []) if (!TAGS.includes(t)) warn(`${w}: unknown tag "${t}"`);
  checkItems(w, d.items);
  checkCommonText(w, d);
  checkEquipment(w, d.equipment, d.steps || []);
  checkStepsMention(w, d.items, d.steps || []);

  // sides + sideSlots
  const isBurger = (d.tags || []).includes('burger');
  if ((d.category === 'Burgers') !== isBurger) err(`${w}: category Burgers and tag "burger" must go together`);
  if (!Array.isArray(d.sides)) err(`${w}: sides must be an array`);
  else {
    for (const sid of d.sides) if (!SIDES[sid]) err(`${w}: default side "${sid}" does not exist`);
    if (new Set(d.sides).size !== d.sides.length) err(`${w}: duplicate default side`);
    if (isBurger) {
      if (d.sideSlots !== 1) err(`${w}: burger dinners need sideSlots 1`);
      if (d.sides.length !== 1 || d.sides[0] !== 'jewel-fries') err(`${w}: burger dinners default to ["jewel-fries"]`);
    } else {
      if (d.sideSlots !== 2) err(`${w}: sideSlots must be 2`);
      if (d.sides.length !== 2) err(`${w}: needs exactly 2 default sides`);
    }
  }

  // the air fryer can only do one thing at a time: warn if the entrée and a default side both need it
  if ((d.equipment || []).includes('air fryer'))
    for (const sid of d.sides || []) if ((SIDES[sid]?.equipment || []).includes('air fryer')) warn(`${w}: entrée and default side "${sid}" both need the air fryer`);

  // meat in every dinner + protein consistency
  const meats = Object.keys(d.items || {}).filter(id => MEAT_IDS.has(id));
  if (meats.length === 0) err(`${w}: no meat ingredient (every dinner needs meat)`);
  if (d.protein && d.protein !== 'mixed' && PROTEIN_IDS[d.protein] && !meats.some(m => PROTEIN_IDS[d.protein].includes(m)))
    err(`${w}: protein "${d.protein}" but no matching meat item (${meats.join(', ') || 'none'})`);
  // Raw meat in pounds (countables like patties convert with lbPerUnit). Fully cooked / heat-and-serve meats are exempt.
  const rawMeats = meats.filter(id => !ING[id]?.cooked);
  const lbMeat = rawMeats.reduce((a, id) => a + (ING[id]?.unit === 'lb' ? d.items[id] : (ING[id]?.lbPerUnit || 0) * d.items[id]), 0);
  if (rawMeats.length && (lbMeat < 2 || lbMeat > 3.25)) warn(`${w}: ${lbMeat.toFixed(2)} lb raw meat (target ~2.25–2.5 lb for five hungry adults)`);

  // rice rule
  const sideRice = (d.sides || []).some(sid => SIDES[sid] && hasRice(SIDES[sid].items));
  const tagged = (d.tags || []).includes('rice');
  if ((hasRice(d.items) || sideRice) && !tagged) err(`${w}: contains rice (entrée or default side) but is not tagged "rice"`);
  if (tagged && !hasRice(d.items) && !sideRice) err(`${w}: tagged "rice" but has no rice`);

  // safe temperatures
  const text = (d.steps || []).join(' ');
  for (const rule of TEMP_RULES) {
    if (!rule.ids.some(id => d.items?.[id])) continue;
    if (!text.includes(rule.temp)) err(`${w}: uses ${rule.what} but steps never state ${rule.temp}`);
    if (rule.rest && !/rest[^.]*3 minutes|3 minutes[^.]*rest/i.test(text)) err(`${w}: pork must rest at least 3 minutes after 145°F`);
  }
}
if (nCore < MIN_CORE) err(`expected at least ${MIN_CORE} core dinners, found ${nCore}`);
if (nBench < MIN_BENCH) err(`expected at least ${MIN_BENCH} bench dinners, found ${nBench}`);

// reference ids
if (ref) {
  for (const r of ref.recipes || []) if (!ids.has(r.id)) err(`reference dinner id "${r.id}" missing`);
  for (const sid of Object.keys(ref.sides || {})) if (!SIDES[sid]) err(`reference side id "${sid}" missing`);
  for (const r of ref.recipes || []) {
    const d = dinners.find(x => x.id === r.id);
    if (d && d.rotation !== 'core') err(`reference dinner "${r.id}" must stay in the core rotation`);
  }
}

// nutrition coverage (data/nutrition.json, per ONE catalog unit). Per-plate numbers: scripts/nutrition-report.mjs
const nutrition = load('data/nutrition.json', false);
if (nutrition) {
  const per = nutrition.per || {};
  for (const id of Object.keys(ING)) {
    const n = per[id];
    if (!n) { warn(`nutrition: no kcal/protein for catalog id "${id}"`); continue; }
    if (!(Number.isFinite(n.kcal) && n.kcal >= 0 && Number.isFinite(n.protein) && n.protein >= 0)) err(`nutrition.${id}: kcal/protein must be numbers >= 0`);
    if (n.unit && n.unit !== ING[id].unit) err(`nutrition.${id}: unit "${n.unit}" differs from catalog unit "${ING[id].unit}"`);
    if (!n.source) warn(`nutrition.${id}: no source`);
  }
  for (const id of Object.keys(per)) if (!ING[id]) warn(`nutrition.${id}: not in the catalog`);
} else warn('data/nutrition.json not found — skipped nutrition coverage');

// catalog ingredients nobody uses (fine for extras)
for (const id of Object.keys(ING)) if (!usedIngredients.has(id) && !ING[id].extra && !ING[id].lunch) warn(`catalog.${id}: not used by any dinner or side (and not marked extra or lunch)`);

// ---------------------------------------------------------------- cost table
const costOf = (items, uc = unitCost) => Object.entries(items || {}).reduce((a, [id, q]) => a + (uc[id]?.cost || 0) * q, 0);
// Optional second opinion: data/prices.json (pricing agent) overrides catalog packs where it lists them.
const prices = load('data/prices.json', false);
let researched = null;
if (prices && prices.prices) {
  researched = {};
  for (const id of Object.keys(ING)) {
    const p = prices.prices[id] || {};
    const g = p.sams?.generic || (ING[id].packs?.sams ? null : p.jewel?.generic);
    researched[id] = g && g.size > 0 && g.price > 0 ? { cost: g.price / g.size } : unitCost[id];
  }
}
// Family-usual cost: the pack the family actually buys ("usual": {store, tier}) where the catalog names one.
const usualCost = {};
for (const [id, ing] of Object.entries(ING)) {
  const u = ing.usual && ing.packs?.[ing.usual.store]?.[ing.usual.tier];
  usualCost[id] = u && u.size > 0 ? { cost: u.price / u.size } : unitCost[id];
}
const rows = dinners.map(d => {
  const entree = costOf(d.items);
  const sides = (d.sides || []).reduce((a, sid) => a + costOf(SIDES[sid]?.items), 0);
  const res = researched ? costOf(d.items, researched) + (d.sides || []).reduce((a, sid) => a + costOf(SIDES[sid]?.items, researched), 0) : null;
  const fam = costOf(d.items, usualCost) + (d.sides || []).reduce((a, sid) => a + costOf(SIDES[sid]?.items, usualCost), 0);
  return { id: d.id, rot: d.rotation, protein: d.protein, entree, sides, total: entree + sides, res, fam };
});
const avg = (list) => list.reduce((a, r) => a + r.total, 0) / (list.length || 1);
for (const r of rows) {
  if (r.total > MAX_COST) err(`dinner ${r.id}: estimated cost $${r.total.toFixed(2)} is over $${MAX_COST}`);
  if (r.total < MIN_COST) err(`dinner ${r.id}: estimated cost $${r.total.toFixed(2)} is under $${MIN_COST}`);
}

// Sam's-only / Jewel-only availability (informational). Staples (stocked-until-low) are assumed to be in the pantry.
const onlyAt = (st) => Object.entries(ING).filter(([, i]) => !i.packs?.[st] && i.kind === 'measured').map(([id]) => id);
const notAtSams = new Set(onlyAt('sams'));
const notAtJewel = new Set(onlyAt('jewel'));
const allIds = (d) => [...Object.keys(d.items || {}), ...(d.sides || []).flatMap(s => Object.keys(SIDES[s]?.items || {}))];
const blockers = (d, set) => [...new Set(allIds(d).filter(id => set.has(id)))];
const needsJewel = dinners.map(d => [d.id, blockers(d, notAtSams)]).filter(([, b]) => b.length);
const needsSams = dinners.map(d => [d.id, blockers(d, notAtJewel)]).filter(([, b]) => b.length);

finish();

function finish() {
  const line = (s = '') => console.log(s);
  if (!QUIET) {
    line('Estimated ingredient cost per dinner (entrée + default sides, Sam’s generic unit cost; Jewel generic if Sam’s has no pack)');
    line('id'.padEnd(28) + 'rotation'.padEnd(9) + 'protein'.padEnd(9) + 'entrée'.padStart(8) + 'sides'.padStart(8) + 'total'.padStart(9) + 'family'.padStart(9) + (researched ? 'prices.json'.padStart(13) : ''));
    line('-'.repeat(researched ? 93 : 80));
    for (const r of rows) {
      const flag = r.total > MAX_COST ? '  << over' : r.total < MIN_COST ? '  << under' : '';
      line(r.id.padEnd(28) + r.rot.padEnd(9) + r.protein.padEnd(9) + `$${r.entree.toFixed(2)}`.padStart(8) + `$${r.sides.toFixed(2)}`.padStart(8) + `$${r.total.toFixed(2)}`.padStart(9) + `$${r.fam.toFixed(2)}`.padStart(9) + (researched ? `$${r.res.toFixed(2)}`.padStart(13) : '') + flag);
    }
    line('-'.repeat(researched ? 93 : 80));
    line('"total" = cheapest catalog pack (Sam\u2019s generic, else Jewel generic) and is what the $' + MAX_COST + ' / $' + MIN_COST + ' flags use; "family" = the pack the family usually buys (catalog "usual").');
    const core = rows.filter(r => r.rot === 'core'), bench = rows.filter(r => r.rot === 'bench');
    line(`Average, all ${rows.length} dinners: $${avg(rows).toFixed(2)}   core (${core.length}): $${avg(core).toFixed(2)}   bench (${bench.length}): $${avg(bench).toFixed(2)}`);
    line(`Range: $${Math.min(...rows.map(r => r.total)).toFixed(2)} – $${Math.max(...rows.map(r => r.total)).toFixed(2)}`);
    { const fa = (l) => l.reduce((a, r) => a + r.fam, 0) / (l.length || 1); line(`As the family usually buys ("usual" packs): all $${fa(rows).toFixed(2)}   core $${fa(core).toFixed(2)}   bench $${fa(bench).toFixed(2)}`); }
    if (researched) {
      const ra = (l) => l.reduce((a, r) => a + r.res, 0) / (l.length || 1);
      line(`With data/prices.json overrides (informational, not flagged): all $${ra(rows).toFixed(2)}   core $${ra(core).toFixed(2)}   bench $${ra(bench).toFixed(2)}`);
    }
    line();
    line(`Catalog: ${Object.keys(ING).length} ingredients (${MEAT_IDS.size} meat, ${extras.length} marked extra). Sides: ${sideList.length}. Dinners: ${nCore} core + ${nBench} bench.`);
    if (needsJewel.length) line(`Need a Jewel-only measured item (not plannable as Sam’s-only; staples assumed stocked) — ${needsJewel.length}:\n  ` + needsJewel.map(([id, b]) => `${id} [${b.join(', ')}]`).join('\n  '));
    if (needsSams.length) line(`Need a Sam’s-only measured item — ${needsSams.length}:\n  ` + needsSams.map(([id, b]) => `${id} [${b.join(', ')}]`).join('\n  '));
    line();
  }
  for (const w of warnings) console.log('WARN  ' + w);
  for (const e of errors) console.log('ERROR ' + e);
  console.log(errors.length ? `\nFAILED: ${errors.length} error(s), ${warnings.length} warning(s).` : `\nPASSED with ${warnings.length} warning(s).`);
  process.exit(errors.length ? 1 : 0);
}
