#!/usr/bin/env node
// Validates the recipe box against the family's rules (docs/MISSION.md, SPEC.md §1, §3, §8,
// docs/spec/18-recipe-box.md, docs/spec/24-chicken-bulk-and-meal-cost.md): data/catalog.json, data/recipes.json, data/lunches.json,
// data/nutrition.json, img/photos.json and dev/photo-jobs.json.
// Plain Node (>=18), no packages.  Usage:  node scripts/validate-data.mjs [--quiet]
// Exit code 1 if any ERROR is found; WARNings are printed but do not fail.
// Tests call validateData() directly with doctored copies of the data (tests/recipes.test.mjs).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeSteps } from '../app/data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------- constants
const AISLES = ['Meat', 'Produce', 'Frozen', 'Dairy & Eggs', 'Bakery', 'Pasta & Grains', 'Canned & Jarred', 'Condiments & Sauces', 'Spices & Baking', 'Snacks & Extras'];
const STORAGE = ['freezer', 'fridge', 'pantry', 'counter'];
const KINDS = ['measured', 'staple'];
const STORES = ['sams', 'jewel'];
const CATEGORIES = ['Burgers', 'Asian-inspired', 'Pasta', 'Tex-Mex', 'Grill', 'Comfort', 'Salads'];
// No 'turkey': the family prefers chicken (Jeff, 2026-11-15), so no dinner is a turkey dinner.
// 'seafood' is fried shrimp night and nothing else (Jeff, 2026-11-22; see SHRIMP_NIGHT).
const PROTEINS = ['chicken', 'beef', 'pork', 'sausage', 'seafood', 'mixed'];
export const EQUIPMENT = ['stovetop', 'blackstone', 'electric grill', 'outdoor grill', 'air fryer', 'microwave', 'possible cooker'];
const TAGS = ['burger', 'pizza', 'rice', 'family favorite', 'family usual', 'from your pantry', 'noodle night', 'taco night', 'grill night', 'salad', 'healthier', 'sandwiches', 'wraps', 'soup', 'freezer friendly', 'bulk'];
const SIDE_KINDS = ['vegetable', 'starch', 'salad', 'fruit', 'bread', 'soup'];
const VEG_KINDS = ['vegetable', 'salad'];
const LUNCH_SLOTS = ['main', 'side', 'snack', 'drink'];
const RICE_IDS = ['jasmine', 'basmati'];
const MAX_COST = 28, MIN_COST = 6; // v2.2: recalibrated from $22 to real prices paid (93/7 beef $6.17/lb, ⅓-lb sirloin patties, pre-seasoned/cooked meats) — ≈ $5.60 a plate
// 2026-11-22: Jeff and Candi went through the box and took 22 dinners out, most of them bench dinners, so the bench is smaller now.
const MIN_CORE = 50, MIN_BENCH = 10;
const PLATES = 5;
// A dinner plate (main + default sides ÷ 5). v3 lightened the box: nothing over PLATE_MAX_KCAL may come back.
const PLATE_MIN_KCAL = 350, PLATE_MAX_KCAL = 1000, PLATE_MIN_PROTEIN = 25;
// Vegetable servings (80 g each) on a plate: every dinner carries at least one. A burger night is burgers and
// fries (Jeff's rule), so the burger itself has to carry some: lettuce, griddled onions, mushrooms or slaw.
const MIN_VEG = 1, MIN_VEG_BURGER = 0.4;

const NO_2026_11_22 = 'Jeff and Candi marked it No when they went through the recipe box on 2026-11-22';
/** Reference dinners that are gone for good, and why. The reference-id rule may never bring them back. */
export const RETIRED_DINNERS = {
  'sesame-tofu-noodles': 'the family never eats tofu, and the id (which shows in links and file names) said tofu',
  'orange-tofu-bowls': 'the family never eats tofu, and the id (which shows in links and file names) said tofu',
  // Jeff, 2026-11-15: "we prefer chicken over turkey". The dishes live on under ids that say chicken (recipes.renamed).
  'turkey-taco-salad': 'the family prefers chicken to turkey, and the id said turkey; it is chicken-taco-salad now',
  'turkey-chili': 'the family prefers chicken to turkey, and the id said turkey; it is chicken-bean-chili now',
  'cooker-turkey-meatballs': 'the family prefers chicken to turkey, and the id said turkey; it is cooker-chicken-meatballs now',
  // Jeff and Candi went through every dinner on 2026-11-22 and marked these No.
  'apple-glazed-pork-chops': NO_2026_11_22,
  'breaded-pork-sandwiches': NO_2026_11_22,
  'chicken-katsu': NO_2026_11_22,
  'chicken-pepper-plates': NO_2026_11_22,
  'chicken-tostadas': NO_2026_11_22,
  'cooker-beef-stew': NO_2026_11_22,
  'cooker-braised-pork-apples': NO_2026_11_22,
  'cooker-chicken-cacciatore': NO_2026_11_22,
  'cooker-italian-beef': NO_2026_11_22,
  'cooker-lasagna-soup': NO_2026_11_22,
  'cooker-sausage-minestrone': NO_2026_11_22,
  'cooker-sesame-ginger-chicken': NO_2026_11_22,
  'hibachi-chicken-noodles': NO_2026_11_22,
  'honey-garlic-pork-chops': NO_2026_11_22,
  'kung-pao-chicken': NO_2026_11_22,
  'mustard-pork-apples': NO_2026_11_22,
  'peanut-sweet-potatoes': NO_2026_11_22,
  'pork-carnitas-tacos': NO_2026_11_22,
  'pork-souvlaki-plates': NO_2026_11_22,
  'sausage-pepper-hoagies': NO_2026_11_22,
  'sweet-potato-tacos': NO_2026_11_22,
  'sweet-sour-pork': NO_2026_11_22,
};
// Removed on purpose (Jeff, 2026-11-15: no raw cucumbers).
// And these sides, marked No on 2026-11-22 (Candi: "we like french style green beans, and other simple, easy canned goods").
const REMOVED_SIDES = new Set(['tomato-cucumber', 'cucumber-spears', 'sesame-cucumber',
  'air-fryer-veggies', 'applesauce-cups', 'asian-slaw', 'lime-slaw', 'spinach-apple-salad', 'steamed-mixed-vegetables', 'sweet-potatoes',
  'cream-corn']); // Jeff, 2026-11-22: "no cream style corn, only regular"

// Which catalog meat ids satisfy each "protein" value.
const PROTEIN_IDS = {
  chicken: ['chicken', 'chickenThighs', 'groundChicken', 'fajitaChicken', 'pulledChicken', 'chickenAlfredoDeli', 'frozenTenders'],
  beef: ['beef', 'beefPatties', 'roastBeef', 'eyeRoundSteak', 'stewMeat', 'sirloinTip', 'chuckRoast'],
  pork: ['pork', 'porkLoin', 'groundPork', 'pulledPork'],
  sausage: ['italianSausage', 'smokedSausage', 'chorizo', 'chickenSausage'],
  seafood: ['seapakShrimp'],
};
// Safe-temperature rules: if a dinner uses one of these ids, its steps must state the temp.
const TEMP_RULES = [
  { ids: ['chicken', 'chickenThighs', 'groundChicken', 'fajitaChicken'], temp: '165°F', what: 'chicken' },
  { ids: ['groundTurkey', 'turkeySausage'], temp: '165°F', what: 'ground turkey / turkey sausage' },
  { ids: ['beef', 'beefPatties', 'groundPork', 'italianSausage', 'chorizo'], temp: '160°F', what: 'ground meat / sausage / patties' },
  { ids: ['eyeRoundSteak', 'sirloinTip', 'stewMeat', 'chuckRoast'], temp: '145°F', what: 'whole-cut beef' },
  { ids: ['pulledPork', 'pulledChicken', 'smokedSausage', 'chickenSausage', 'chickenAlfredoDeli', 'roastBeef'], temp: '165°F', what: 'fully cooked meat (reheat)' },
  { ids: ['pork', 'porkLoin'], temp: '145°F', what: 'pork chops / loin', rest: true },
];

// ---------------------------------------------------------------- what Jeff said on 2026-11-15, 10 pm (docs/spec/24)
// "We don't use much pork, but we prefer chicken over turkey generally. I eat turkey for lunch meat but they
// don't like it much." So: no turkey in any dinner or side; turkey lunch items only in Jeff's rotation.
const TURKEY = /turkey/i;
const TURKEY_LUNCH_FOR = ['Jeff'];
// At most a handful of pork dinners in the core rotation, and the pulled pork in the freezer is one of them.
const PORK_MAIN_IDS = ['pork', 'porkLoin', 'groundPork', 'pulledPork', 'italianSausage', 'chorizo', 'smokedSausage'];
export const MAX_CORE_PORK = 4;
const CORE_PORK_KEEP = 'jd-pulled-pork-sandwiches';
// "I prefer Wishbone ranch btw, I just bought the wrong bottle." Hidden Valley stays an alias so that bottle matches.
const RANCH_BRAND = /wish-?\s?bone/i;
const RANCH_LABEL = /^\s*wish-?\s?bone\b/i; // a pack label names its product first
const WRONG_RANCH = /hidden valley/i;
// "For the BLT, we can do it minus the T for me." Packaged bowls that come with raw tomato stay out of the
// box, except the one lunch named here, for the people named, and only while it says to leave the tomatoes out.
const COMES_WITH_RAW_TOMATO = ['bonduelleBltBowl', 'tfBltChickenBowl'];
export const TOMATO_LEFT_OUT = { 'bonduelle-chicken-blt': ['Jeff'] };
const LEAVES_TOMATO_OUT = /\b(leave|hold|pick|take)\b[^.]*\btomato(es)?\b[^.]*\b(out|off)\b|\bwithout the tomato(es)?\b/i;

// Jeff, 2026-11-22: "I would be good with a fried shrimp night with some SeaPak fried shrimp. We usually eat two packs
// when we cook that and we cook that with fries." The one seafood dinner in the box, and the one shrimp in the catalog.
// Its plate is what the family eats (two bags for five), so the protein floor doesn't move it.
export const SHRIMP_NIGHT = { dinner: 'seapak-shrimp-night', item: 'seapakShrimp', where: /\bseapak-shrimp-night\b|\bcatalog\.seapakShrimp\b/ };

// ---------------------------------------------------------------- house rules in words
// Banned words (whole-text, case-insensitive). "seafood-free" is the one allowed seafood phrase.
const BANNED = [
  [/\bovens?\b/i, 'oven'], [/broil/i, 'broil'], [/\bbake in\b/i, 'bake in'], [/preheat the oven/i, 'preheat the oven'],
  [/\b(baking (sheet|dish|pan)|sheet[- ]pan|roasting pan)\b/i, 'oven pan'],
  [/fish/i, 'fish'], [/salmon/i, 'salmon'], [/shrimp/i, 'shrimp'], [/\btuna\b/i, 'tuna'], [/tilapia/i, 'tilapia'], [/halibut/i, 'halibut'],
  [/\bcod\b/i, 'cod'], [/\bcrabs?\b/i, 'crab'], [/lobster/i, 'lobster'], [/scallop/i, 'scallop'], [/oyster/i, 'oyster'],
  [/anchov/i, 'anchovy'], [/fish sauce/i, 'fish sauce'], [/seafood(?!-free)/i, 'seafood'], [/tofu/i, 'tofu'],
  [/worcestershire(?!-free)/i, 'Worcestershire'], [/\bclams?\b/i, 'clam'], [/mussel/i, 'mussel'], [/prawn/i, 'prawn'],
  [/\bsquid\b/i, 'squid'], [/calamari/i, 'calamari'], [/sardine/i, 'sardine'],
  // Jeff, 2026-11-15: "I just don't like Caesar salads whatsoever, so please avoid those at all costs."
  [/caesar/i, 'Caesar'],
];
/** The banned words in a piece of text (an id counts as text: "sesame-tofu-noodles" says tofu). */
export function bannedWords(text) {
  if (typeof text !== 'string') return [];
  return BANNED.filter(([re]) => re.test(text)).map(([, word]) => word);
}

// Jeff, 2026-11-15: "we don't really eat cucumbers raw... only pickles", and no raw onions or raw
// tomatoes (Candi eats tomatoes, the rest don't). Cooked onions and tomato sauces are fine.
const CUCUMBER = /cucumber|tzatziki/i;
const RAW_ONION = /\b(raw|red|white|green|spring|pickled|thin(ly)?[- ]sliced|sliced|diced|chopped|minced) onions?\b|\bscallions?\b|\bonion (slices|rings)\b/i;
const RAW_TOMATO = /\b(raw|sliced|fresh|cherry|grape|roma|quartered|chopped|halved) tomato(es)?\b|\btomato (slices|wedges|halves)\b/i;
/** A sentence that cooks what it mentions ("the onion cooks soft along with the meat"). */
const COOKED = /\b(cook|brown|saut|soft|caramel|griddle|grill|skillet|simmer|fry|fried|stir|char|blister|translucent|see-through|tender|wilt|boil|stew|melt|sear|air[- ]fr|microwave|heat|warm|steam|brais|slow[- ]cook|golden)/i;
const TOMATO_COOKED = /\b(sauce|soup|salsa|marinara|paste|broth|chili|masala|stew|simmered|cooked|canned|cans?|juice|crushed)\b/i;
// In a picture an onion has to be called cooked, right there: "charred peppers and onions", "cooked onion".
const PICTURE_ONION_OK = /\b(grilled|griddled|carameli[sz]ed|cooked|saut[ée]ed|charred|soft|softened|browned|fried|golden|stir-fried|simmered|braised|blistered)\b[^.;:]{0,60}\bonions?\b/i;
const sentences = (t) => String(t || '').split(/(?<=[.!?;:])\s+/);
/**
 * Raw cucumber, onion or tomato in a piece of recipe text → the offending words.
 * `picture: true` is for photo descriptions and image prompts, where any onion or tomato that the
 * same sentence doesn't cook (or turn into sauce, soup or salsa) would be drawn raw.
 */
export function rawProduce(text, { picture = false } = {}) {
  const out = new Set();
  if (typeof text !== 'string') return [];
  if (CUCUMBER.test(text)) out.add('cucumber');
  for (const s of sentences(text)) {
    if (picture ? (/scallion|green onion|spring onion/i.test(s) || (/onion/i.test(s) && !PICTURE_ONION_OK.test(s))) : (RAW_ONION.test(s) && !COOKED.test(s))) out.add('raw onion');
    if (RAW_TOMATO.test(s)) out.add('raw tomato');
    else if (picture && /tomato/i.test(s) && !TOMATO_COOKED.test(s)) out.add('raw tomato');
  }
  return [...out];
}

// ---------------------------------------------------------------- the PossibleCooker (docs/spec/18-recipe-box.md)
// Ninja Foodi Everyday PossibleCooker Pro 6.5 qt, MC1101. Functions and limits from Ninja's own
// quick-start guide and FAQ for the MC1100 series: SLOW COOK runs on HI or LO (LO 6–12 hours,
// HI 2–12 hours), SEAR/SAUTÉ on HI / MED / LO, BRAISE picks its own temperature (about 210°F),
// the grain programs set their own time. STEAM: Jeff confirmed his cooker has it (2026-11-15), so
// the steamed sides use it (a cup of water, lid on, a time).
export const COOKER_SETTING = /^(SLOW COOK on (LO|HI)|SEAR\/SAUTÉ on (HI|MED|LO)|BRAISE|STEAM|WHITE RICE|BROWN RICE|OATS|PASTA|KEEP WARM)$/;
const SLOW_LIMITS = { LO: [360, 720], HI: [120, 720] };

// Keywords that must appear in the steps for an item to count as "used in the steps" (warning only).
const STEP_WORDS = {
  starch: ['cornstarch'], parm: ['parmesan'], cornwrap: ['tortilla', 'tostada'], minis: ['pizza'], slaw: ['coleslaw', 'cabbage', 'slaw'],
  taco: ['taco seasoning'], pepper: ['pepper'], peppers: ['pepper'], cheese: ['cheddar', 'cheese'], oil: ['oil'], soy: ['soy'],
  sesame: ['sesame'], lettuce: ['romaine', 'lettuce'], beans: ['beans'], chickpeas: ['chickpea'], tomatoes: ['tomatoes'], tomato: ['tomato'],
  vegetables: ['vegetables'], jasmine: ['rice'], basmati: ['basmati', 'rice'], chickenThighs: ['chicken', 'thighs'], chicken: ['chicken'],
  beef: ['beef'], pork: ['chop', 'pork'], porkLoin: ['pork'], groundPork: ['pork'], groundTurkey: ['turkey'], italianSausage: ['sausage'],
  turkeySausage: ['sausage'], groundChicken: ['ground chicken', 'chicken'], chickenSausage: ['sausage'], stewMeat: ['beef tips', 'stew meat', 'beef'],
  sirloinTip: ['sirloin', 'steak'], chuckRoast: ['chuck', 'roast'], stirFryVeg: ['stir-fry vegetables', 'vegetables'], normandyVeg: ['normandy', 'vegetables'], whiteBeans: ['white beans', 'beans'], greenChiles: ['green chiles'], celery: ['celery'], beefBroth: ['beef stock', 'beef broth'],
  seapakShrimp: ['shrimp'], frozenTenders: ['tenders'], biscuits: ['biscuit'], mexicorn: ['mexicorn'], newPotatoes: ['new potatoes', 'potatoes'],
  greenBeans: ['green beans'], cannedCorn: ['corn'], cannedCarrots: ['carrot'], corn: ['corn'], freshGreenBeans: ['green beans', 'beans'],
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
const EQUIP_HINTS = [
  ['air fryer', /air[- ]fr/i], ['blackstone', /blackstone|griddle/i], ['electric grill', /electric grill|\bgrill\b/i],
  ['microwave', /microwave/i], ['stovetop', /skillet|saucepan|\bpot\b|boil|simmer/i], ['outdoor grill', /outdoor grill/i],
  ['possible cooker', /possiblecooker|slow cook|sear\/saut/i],
];
// The PossibleCooker has a pot of its own and simmers and boils in it, so only a pan names the stove.
const STOVE_BESIDE_COOKER = /skillet|saucepan|on the stove|stovetop/i;

/** The data files on disk, as validateData() takes them. Missing optional files are null. */
export function loadData(root = ROOT) {
  const errors = [];
  const load = (rel, required = true) => {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) { if (required) errors.push(`${rel}: file missing`); return null; }
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (e) { errors.push(`${rel}: JSON does not parse — ${e.message}`); return null; }
  };
  return {
    catalog: load('data/catalog.json'), recipes: load('data/recipes.json'),
    lunches: load('data/lunches.json', false), nutrition: load('data/nutrition.json', false), prices: load('data/prices.json', false),
    photos: load('img/photos.json', false), photoJobs: load('dev/photo-jobs.json', false),
    ref: load('reference/chatgpt-v1-data.json', false),
    fileExists: (rel) => fs.existsSync(path.join(root, rel)),
    loadErrors: errors,
  };
}

/**
 * Every rule, over whatever data it is handed. → { errors, warnings, rows, stats }.
 * Pure apart from `fileExists(rel)` (photo files on disk); leave it out to skip that check.
 */
export function validateData({ catalog, recipes, lunches = null, nutrition = null, prices = null, photos = null, photoJobs = null, ref = null, fileExists = null, loadErrors = [] }) {
  const errors = [...loadErrors];
  const warnings = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);
  if (!catalog || !recipes) return { errors: errors.length ? errors : ['catalog or recipes missing'], warnings, rows: [], stats: {} };

  /** Banned words in any text. Fried shrimp night (and its shrimp) may say shrimp; nothing else may. */
  function scanText(where, text) {
    const shrimpNight = SHRIMP_NIGHT.where.test(where);
    for (const word of bannedWords(text)) if (!(shrimpNight && (word === 'shrimp' || word === 'seafood'))) err(`${where}: banned word "${word}" in: ${String(text).slice(0, 120)}`);
  }
  /** fn(text, key) for every string inside a dish, the id included ("items" are ids and amounts, checked on their own). */
  function eachString(value, fn, key = '') {
    if (typeof value === 'string') fn(value, key || 'id');
    else if (Array.isArray(value)) value.forEach((v, i) => eachString(v, fn, `${key}[${i + 1}]`));
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) if (k !== 'items') eachString(v, fn, key ? `${key}.${k}` : k);
  }
  /** Every string inside a dish, whatever field it sits in: a new field can't dodge the rules. */
  function scanAll(where, value, key = '') {
    if (typeof value === 'string') scanText(key ? `${where}.${key}` : where, value);
    else if (Array.isArray(value)) value.forEach((v, i) => scanAll(where, v, `${key}[${i + 1}]`));
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) if (k !== 'items') scanAll(where, v, key ? `${key}.${k}` : k);
  }
  function scanRaw(where, text, opts) {
    for (const word of rawProduce(text, opts)) err(`${where}: no ${word} for this family: ${String(text).slice(0, 110)}`);
  }

  // ---------------------------------------------------------------- catalog
  const ING = catalog.ingredients || {};
  if (catalog.version !== 2) err('catalog.version must be 2');
  if (!catalog.units || typeof catalog.units !== 'object') err('catalog.units missing');

  const unitCost = {}; // id -> { cost, store } using Sam's generic, falling back to Jewel generic
  for (const [id, ing] of Object.entries(ING)) {
    const w = `catalog.${id}`;
    scanText(`${w} (id)`, id);
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
    // A price read off the store's own page says where: "confidence": "listed" needs the page.
    for (const st of Object.keys(packs)) for (const tier of ['generic', 'name']) {
      const p = packs[st]?.[tier];
      if (st === 'sams' && p?.confidence === 'listed' && !/^https:\/\//.test(String(p.url || ''))) err(`${w}: packs.${st}.${tier} says its price was read from the store ("listed") but has no url`);
    }
    // "bulk": a Sam's Club bulk pack, and how to portion it into meal-size freezer bags or keep it (docs/spec/24).
    if (ing.bulk !== undefined) {
      const b = ing.bulk;
      if (!b || typeof b !== 'object' || Array.isArray(b)) err(`${w}: bulk must be { freezes, portionLb?, note }`);
      else {
        for (const k of Object.keys(b)) if (!['freezes', 'portionLb', 'note'].includes(k)) err(`${w}: bulk has an unknown field "${k}"`);
        if (typeof b.freezes !== 'boolean') err(`${w}: bulk.freezes must be true or false`);
        if (typeof b.note !== 'string' || b.note.trim().length < 20) err(`${w}: bulk.note must say how to portion or keep the pack`);
        scanText(`${w}.bulk.note`, b.note);
        if (!packs.sams?.generic) err(`${w}: bulk needs a Sam's Club pack`);
        if (b.portionLb !== undefined) {
          if (ing.unit !== 'lb') err(`${w}: bulk.portionLb is for items sold by the pound (unit is "${ing.unit}")`);
          else if (!(typeof b.portionLb === 'number' && b.portionLb > 0 && b.portionLb <= (packs.sams?.generic?.size || 0))) err(`${w}: bulk.portionLb must be more than 0 and no more than the Sam's pack`);
          if (b.freezes !== true) err(`${w}: bulk.portionLb is a freezer-bag size, so bulk.freezes must be true`);
        } else if (ing.meat && ing.unit === 'lb') err(`${w}: bulk meat sold by the pound needs bulk.portionLb (the meal-size freezer bag)`);
      }
    }
  }
  // The family's ranch is Wish-Bone; the Hidden Valley bottle in the pantry still matches by alias.
  if (ING.ranch) {
    const r = ING.ranch;
    const usual = r.usual && r.packs?.[r.usual.store]?.[r.usual.tier];
    if (!RANCH_BRAND.test(String(r.brand || ''))) err('catalog.ranch: brand must be Wish-Bone (the family’s ranch)');
    if (!usual || !RANCH_LABEL.test(usual.label)) err('catalog.ranch: its usual pack must be the Wish-Bone bottle');
    if (!(r.aliases || []).some((a) => RANCH_BRAND.test(a))) err('catalog.ranch: needs a Wish-Bone alias');
    if (!(r.aliases || []).some((a) => WRONG_RANCH.test(a))) err('catalog.ranch: "hidden valley ranch" must stay an alias so the bottle in the pantry still matches');
    // data/prices.json lays its own pack over the catalog's (app/data.js), label included: it has to agree.
    const over = r.usual && prices?.prices?.ranch?.[r.usual.store]?.[r.usual.tier];
    if (over?.label && !RANCH_LABEL.test(over.label)) warn(`data/prices.json: ranch.${r.usual.store}.${r.usual.tier} is "${over.label}", which the app shows instead of the catalog's Wish-Bone bottle; price the Wish-Bone bottle there`);
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

  // ---------------------------------------------------------------- nutrition table
  const PER = nutrition?.per || null;
  if (!nutrition) warn('data/nutrition.json not found — skipped nutrition checks');
  const macroOk = (id) => PER?.[id] && ['kcal', 'protein', 'carbs', 'fat', 'fiber'].every((k) => Number.isFinite(PER[id][k]) && PER[id][k] >= 0);
  if (PER) {
    for (const id of Object.keys(ING)) {
      const n = PER[id];
      const w = `nutrition.${id}`;
      if (!n) { err(`${w}: no entry for this catalog id (${ING[id].name}, unit ${ING[id].unit}); calories and protein must be known for everything`); continue; }
      if (!(Number.isFinite(n.kcal) && n.kcal >= 0 && Number.isFinite(n.protein) && n.protein >= 0)) { err(`${w}: kcal/protein must be numbers >= 0`); continue; }
      if (n.unit && n.unit !== ING[id].unit) err(`${w}: unit "${n.unit}" differs from catalog unit "${ING[id].unit}"`);
      if (!n.source) warn(`${w}: no source`);
      for (const k of ['carbs', 'fat', 'fiber', 'veg']) if (n[k] !== undefined && !(Number.isFinite(n[k]) && n[k] >= 0)) err(`${w}: ${k} must be a number >= 0`);
      if (!macroOk(id)) { warn(`${w}: carbs / fat / fiber not all given`); continue; }
      if (n.fiber > n.carbs + 0.01) err(`${w}: fiber ${n.fiber} g is more than carbs ${n.carbs} g`);
      // Fiber is counted at 2 kcal/g, the rest of the carbs and the protein at 4, fat at 9.
      const fromMacros = 4 * n.protein + 4 * (n.carbs - n.fiber) + 2 * n.fiber + 9 * n.fat;
      if (Math.abs(fromMacros - n.kcal) > Math.max(12, n.kcal * 0.15)) err(`${w}: ${n.kcal} kcal does not match its protein/carbs/fat (${Math.round(fromMacros)} kcal)`);
    }
    for (const id of Object.keys(PER)) if (!ING[id]) warn(`nutrition.${id}: not in the catalog`);
  }
  /** kcal, protein, carbs, fat, fiber and veg for a bag of items; `missing` lists ids with no numbers. */
  const total = (items) => {
    const t = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, veg: 0, missing: [], noMacros: [] };
    for (const [id, q] of Object.entries(items || {})) {
      const n = PER?.[id];
      if (!n || !Number.isFinite(n.kcal)) { t.missing.push(id); continue; }
      t.kcal += n.kcal * q; t.protein += (n.protein || 0) * q; t.veg += (n.veg || 0) * q;
      if (macroOk(id)) { t.carbs += n.carbs * q; t.fat += n.fat * q; t.fiber += n.fiber * q; } else t.noMacros.push(id);
    }
    return t;
  };

  // ---------------------------------------------------------------- recipes
  if (recipes.version !== 2) err('recipes.version must be 2');
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
      if (PER && ING[id] && !macroOk(id)) err(`${where}: item "${id}" has no calories, protein, carbs, fat and fiber in data/nutrition.json`);
    }
  }
  function checkStepsMention(where, items, texts) {
    const text = texts.join(' ').toLowerCase();
    for (const id of Object.keys(items || {})) {
      // Explicit keywords win; otherwise accept the id, any alias, or any 4+ letter word of the name (singular or plural).
      const ing = ING[id] || {};
      const words = STEP_WORDS[id] || [
        stem(id), ...(ing.aliases || []).map((a) => a.toLowerCase()),
        ...String(ing.name || '').toLowerCase().split(/[^a-zñé]+/).filter((w) => w.length >= 4 && !['with', 'fresh', 'frozen', 'dried', 'ground', 'sliced', 'shredded', 'yellow', 'english', 'smoked', 'classic', 'plain'].includes(w)).map(stem),
      ];
      if (!words.some((w) => w && text.includes(w))) warn(`${where}: item "${id}" is never mentioned in the steps`);
    }
  }
  function checkEquipment(where, equipment, texts) {
    if (!Array.isArray(equipment)) { err(`${where}: equipment must be an array`); return; }
    for (const e of equipment) if (!EQUIPMENT.includes(e)) err(`${where}: equipment "${e}" not allowed`);
    const text = texts.join(' ');
    const cooker = equipment.includes('possible cooker');
    for (const [e, re] of EQUIP_HINTS) {
      const mentioned = (cooker && e === 'stovetop' ? STOVE_BESIDE_COOKER : re).test(text);
      if (mentioned && !equipment.includes(e)) {
        // "grill" also matches inside Blackstone griddle wording; only flag electric grill when no griddle is listed.
        if (e === 'electric grill' && equipment.includes('blackstone') && !/electric grill/i.test(text)) continue;
        warn(`${where}: steps use the ${e} but equipment does not list it`);
      }
      if (!mentioned && equipment.includes(e)) warn(`${where}: equipment lists ${e} but steps never use it`);
    }
  }
  /** Steps are sentences or { text, minutes?, setting? }. → [{ text, minutes, setting }] (minutes read from the words when not given). */
  function checkSteps(where, o) {
    const raw = o.steps;
    if (!Array.isArray(raw) || raw.length === 0) { err(`${where}: steps must be a non-empty list`); return []; }
    raw.forEach((s, i) => {
      const w = `${where}.steps[${i + 1}]`;
      if (typeof s === 'string') { if (s.trim().length < 10) err(`${w}: a step must be a full sentence`); return; }
      if (!s || typeof s !== 'object' || Array.isArray(s)) { err(`${w}: a step is a sentence or { text, minutes?, setting? }`); return; }
      if (typeof s.text !== 'string' || s.text.trim().length < 10) err(`${w}: text must be a full sentence`);
      for (const k of Object.keys(s)) if (!['text', 'minutes', 'setting'].includes(k)) err(`${w}: unknown field "${k}"`);
      if (s.minutes !== undefined && !(Number.isInteger(s.minutes) && s.minutes >= 0 && s.minutes <= 720)) err(`${w}: minutes must be a whole number from 0 to 720`);
      if (s.setting !== undefined && !(typeof s.setting === 'string' && s.setting.trim().length >= 3 && s.setting.length <= 60)) err(`${w}: setting must be a short string`);
    });
    return normalizeSteps(raw);
  }
  function checkCooker(where, equipment, steps) {
    const cookerSteps = steps.filter((s) => s.setting && /SLOW COOK|SEAR\/SAUT|BRAISE|STEAM|WHITE RICE|BROWN RICE|KEEP WARM|\bOATS\b|\bPASTA\b/.test(s.setting));
    const listed = (equipment || []).includes('possible cooker');
    if (listed && !cookerSteps.length) err(`${where}: uses the PossibleCooker but no step carries its setting (e.g. "SLOW COOK on LO")`);
    if (!listed && cookerSteps.length) err(`${where}: a step is set to "${cookerSteps[0].setting}" but equipment does not list "possible cooker"`);
    for (const s of cookerSteps) {
      if (!COOKER_SETTING.test(s.setting)) { err(`${where}: "${s.setting}" is not a PossibleCooker setting (SLOW COOK on LO|HI, SEAR/SAUTÉ on HI|MED|LO, BRAISE, STEAM, WHITE RICE, BROWN RICE, OATS, PASTA, KEEP WARM)`); continue; }
      const slow = /^SLOW COOK on (LO|HI)$/.exec(s.setting);
      if (slow) {
        const [lo, hi] = SLOW_LIMITS[slow[1]];
        if (!(s.minutes >= lo && s.minutes <= hi)) err(`${where}: ${s.setting} needs a time from ${lo / 60} to ${hi / 60} hours (it has ${s.minutes ?? 'none'} minutes)`);
      }
      if (s.setting === 'BRAISE' && !(s.minutes > 0)) err(`${where}: BRAISE needs a time`);
    }
  }
  function checkCommon(where, o) {
    scanText(`${where} (id)`, o.id);
    scanAll(where, o);
    const steps = checkSteps(where, o);
    const texts = steps.map((s) => s.text);
    for (const t of [o.title, o.subtitle, ...texts, ...(Array.isArray(o.tips) ? o.tips : []), o.leftovers]) scanRaw(where, t);
    scanRaw(`${where}.photo`, o.photo, { picture: true });
    for (const id of ['cucumber', 'tomato']) if (o.items && o.items[id]) err(`${where}: uses ${id} (the family doesn't eat raw cucumbers or tomatoes)`);
    for (const id of COMES_WITH_RAW_TOMATO) if (o.items && o.items[id]) err(`${where}: uses ${id}, which comes with raw tomato`);
    // chicken, not turkey (the id counts as text, like every other house rule)
    for (const id of Object.keys(o.items || {})) if (TURKEY.test(id)) err(`${where}: uses ${id}; the family prefers chicken to turkey, so no dinner or side has turkey`);
    eachString(o, (text, key) => {
      if (TURKEY.test(text)) err(`${where}.${key}: says turkey; the family prefers chicken (turkey is only Jeff's lunch meat): ${text.slice(0, 100)}`);
      if (WRONG_RANCH.test(text)) err(`${where}.${key}: names Hidden Valley; the family's ranch is Wish-Bone`);
    });
    // Jeff confirmed the cooker's STEAM button: a steamed PossibleCooker dish uses it.
    if ((o.equipment || []).includes('possible cooker') && /\bsteamed\b/i.test(String(o.title || '')) && !steps.some((s) => s.setting === 'STEAM'))
      err(`${where}: a steamed dish in the PossibleCooker uses its STEAM setting`);
    for (const s of steps) if (/^SEAR\/SAUTÉ/.test(String(s.setting || '')) && /steam is coming|\bto steam\b|\bsteams? (it|them|the)\b/i.test(s.text)) err(`${where}: a step steams on ${s.setting}; use the STEAM setting`);
    if (!o.photo || o.photo.length < 30) err(`${where}: photo hint missing or too short`);
    if (!(typeof o.minutes === 'number' && o.minutes > 0)) err(`${where}: minutes must be > 0`);
    if (o.tips !== undefined && !(Array.isArray(o.tips) && o.tips.length <= 4 && o.tips.every((t) => typeof t === 'string' && t.trim().length >= 10))) err(`${where}: tips must be up to 4 full sentences`);
    checkCooker(where, o.equipment, steps);
    return { steps, texts };
  }
  const hasRice = (items) => RICE_IDS.some((r) => items && items[r]);

  // ---- sides
  for (const s of sideList) {
    const w = `side ${s.id}`;
    if (!s.id || !s.title) err(`${w}: id/title missing`);
    if (!SIDE_KINDS.includes(s.kind)) err(`${w}: kind "${s.kind}" not allowed`);
    checkItems(w, s.items);
    const { texts } = checkCommon(w, s);
    checkEquipment(w, s.equipment || [], texts);
    checkStepsMention(w, s.items, texts);
    const tagged = (s.tags || []).includes('rice');
    if (hasRice(s.items) && !tagged) err(`${w}: contains rice but is not tagged "rice"`);
    if (tagged && !hasRice(s.items)) err(`${w}: tagged "rice" but has no rice`);
    for (const t of s.tags || []) if (!TAGS.includes(t)) warn(`${w}: unknown tag "${t}"`);
  }

  // ---- dinners
  const ids = new Set();
  let nCore = 0, nBench = 0;
  const plates = {};
  const corePork = [];
  for (const d of dinners) {
    const w = `dinner ${d.id}`;
    if (ids.has(d.id)) err(`${w}: duplicate id`);
    ids.add(d.id);
    if (RETIRED_DINNERS[d.id]) err(`${w}: this dinner was removed for good (${RETIRED_DINNERS[d.id]})`);
    for (const f of ['id', 'title', 'subtitle', 'category', 'protein', 'rotation']) if (!d[f]) err(`${w}: missing ${f}`);
    if (d.rotation === 'core') nCore++; else if (d.rotation === 'bench') nBench++; else err(`${w}: rotation must be core or bench`);
    if (!CATEGORIES.includes(d.category)) err(`${w}: category "${d.category}" not allowed`);
    if (!PROTEINS.includes(d.protein)) err(`${w}: protein "${d.protein}" not allowed`);
    if (!Array.isArray(d.tags)) err(`${w}: tags must be an array`);
    for (const t of d.tags || []) if (!TAGS.includes(t)) warn(`${w}: unknown tag "${t}"`);
    checkItems(w, d.items);
    const { steps, texts } = checkCommon(w, d);
    checkEquipment(w, d.equipment, texts);
    checkStepsMention(w, d.items, texts);

    // a recipe a nervous cook can follow: times, at least one timer, a tip, and what to do with what's left
    for (const k of ['prepMinutes', 'cookMinutes']) if (!(Number.isInteger(d[k]) && d[k] >= 0)) err(`${w}: ${k} must be a whole number of minutes`);
    if (Number.isInteger(d.prepMinutes) && Number.isInteger(d.cookMinutes) && d.prepMinutes + d.cookMinutes !== d.minutes) err(`${w}: minutes (${d.minutes}) must be prepMinutes + cookMinutes (${d.prepMinutes + d.cookMinutes})`);
    if (steps.length < 3) err(`${w}: needs at least 3 steps`);
    if (!steps.some((s) => s.minutes > 0)) err(`${w}: no step has a time worth a timer`);
    if (!(Array.isArray(d.tips) && d.tips.length >= 1)) err(`${w}: needs at least one tip`);
    if (!(typeof d.leftovers === 'string' && d.leftovers.trim().length >= 15)) err(`${w}: leftovers must say how to store or reuse what's left`);

    // "bulk": the raw meat comes from a Sam's Club bulk pack that is portioned and frozen (catalog "bulk").
    {
      const bulkMeat = Object.keys(d.items || {}).filter((id) => ING[id]?.meat && !ING[id]?.cooked && ING[id]?.bulk);
      const tagged = (d.tags || []).includes('bulk');
      if (tagged && !bulkMeat.length) err(`${w}: tagged "bulk" but none of its meat comes from a Sam's bulk pack (catalog "bulk")`);
      if (!tagged && bulkMeat.length) err(`${w}: its ${bulkMeat.join(', ')} comes from a Sam's bulk pack, so it must be tagged "bulk"`);
    }
    if ((d.tags || []).includes('freezer friendly') && !/freez/i.test(String(d.leftovers || ''))) err(`${w}: tagged "freezer friendly" but leftovers doesn't say how to freeze it`);
    if (d.rotation === 'core' && Object.keys(d.items || {}).some((id) => PORK_MAIN_IDS.includes(id))) corePork.push(d.id);
    if (d.items?.[SHRIMP_NIGHT.item] && d.id !== SHRIMP_NIGHT.dinner) err(`${w}: only fried shrimp night uses the shrimp; the family doesn't eat other seafood`);

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
        // v3: the default pair always brings a vegetable or a salad.
        if (!d.sides.some((sid) => VEG_KINDS.includes(SIDES[sid]?.kind))) err(`${w}: neither default side is a vegetable or a salad`);
      }
    }

    // one appliance can only do one thing at a time: warn if the entrée and a default side both need it
    for (const one of ['air fryer', 'possible cooker'])
      if ((d.equipment || []).includes(one))
        for (const sid of d.sides || []) if ((SIDES[sid]?.equipment || []).includes(one)) warn(`${w}: entrée and default side "${sid}" both need the ${one}`);

    // meat in every dinner + protein consistency
    const meats = Object.keys(d.items || {}).filter((id) => MEAT_IDS.has(id));
    if (meats.length === 0) err(`${w}: no meat ingredient (every dinner needs meat)`);
    if (d.protein && d.protein !== 'mixed' && PROTEIN_IDS[d.protein] && !meats.some((m) => PROTEIN_IDS[d.protein].includes(m)))
      err(`${w}: protein "${d.protein}" but no matching meat item (${meats.join(', ') || 'none'})`);
    // Raw meat in pounds (countables like patties convert with lbPerUnit). Fully cooked / heat-and-serve meats are exempt.
    const rawMeats = meats.filter((id) => !ING[id]?.cooked);
    // A skillet that mixes raw and cooked meat (chicken with smoked sausage) is judged on all of it.
    const lbMeat = (rawMeats.length < meats.length ? meats.filter((id) => ING[id]?.unit === 'lb') : rawMeats).reduce((a, id) => a + (ING[id]?.unit === 'lb' ? d.items[id] : (ING[id]?.lbPerUnit || 0) * d.items[id]), 0);
    if (rawMeats.length && (lbMeat < 1.5 || lbMeat > 3)) warn(`${w}: ${lbMeat.toFixed(2)} lb raw meat (target about 2–2.25 lb for five full plates)`);

    // rice rule
    const sideRice = (d.sides || []).some((sid) => SIDES[sid] && hasRice(SIDES[sid].items));
    const tagged = (d.tags || []).includes('rice');
    if ((hasRice(d.items) || sideRice) && !tagged) err(`${w}: contains rice (entrée or default side) but is not tagged "rice"`);
    if (tagged && !hasRice(d.items) && !sideRice) err(`${w}: tagged "rice" but has no rice`);

    // safe temperatures
    const text = texts.join(' ');
    for (const rule of TEMP_RULES) {
      if (!rule.ids.some((id) => d.items?.[id])) continue;
      if (!text.includes(rule.temp)) err(`${w}: uses ${rule.what} but steps never state ${rule.temp}`);
      if (rule.rest && !/rest[^.]*3 minutes|3 minutes[^.]*rest/i.test(text)) err(`${w}: pork must rest at least 3 minutes after 145°F`);
    }

    // the plate: calories, protein and vegetables (entrée + default sides ÷ 5)
    if (PER) {
      const all = { ...(d.items || {}) };
      for (const sid of d.sides || []) for (const [id, q] of Object.entries(SIDES[sid]?.items || {})) all[id] = (all[id] || 0) + q;
      const t = total(all);
      const p = { kcal: t.kcal / PLATES, protein: t.protein / PLATES, carbs: t.carbs / PLATES, fat: t.fat / PLATES, fiber: t.fiber / PLATES, veg: t.veg / PLATES };
      plates[d.id] = p;
      if (!t.missing.length) {
        if (p.kcal < PLATE_MIN_KCAL) err(`${w}: ${Math.round(p.kcal)} kcal a plate is under ${PLATE_MIN_KCAL} (portions stay normal)`);
        if (p.kcal > PLATE_MAX_KCAL) err(`${w}: ${Math.round(p.kcal)} kcal a plate is over ${PLATE_MAX_KCAL}`);
        if (p.protein < PLATE_MIN_PROTEIN && d.id !== SHRIMP_NIGHT.dinner) err(`${w}: ${Math.round(p.protein)} g protein a plate is under ${PLATE_MIN_PROTEIN} g`);
        const minVeg = isBurger ? MIN_VEG_BURGER : MIN_VEG;
        if (Math.round(p.veg * 10) / 10 < minVeg) err(`${w}: only ${p.veg.toFixed(1)} vegetable servings a plate (needs ${minVeg})`);
      }
    }
  }
  if (nCore < MIN_CORE) err(`expected at least ${MIN_CORE} core dinners, found ${nCore}`);
  if (nBench < MIN_BENCH) err(`expected at least ${MIN_BENCH} bench dinners, found ${nBench}`);
  // "We don't use much pork": a handful in the core rotation, the rest on the bench.
  if (corePork.length > MAX_CORE_PORK) err(`${corePork.length} pork dinners in the core rotation (${corePork.join(', ')}); the family eats little pork, so at most ${MAX_CORE_PORK}: move the rest to the bench`);
  if (ids.has(CORE_PORK_KEEP) && !corePork.includes(CORE_PORK_KEEP)) err(`dinner ${CORE_PORK_KEEP}: stays in the core rotation (the pulled pork is in the family's freezer)`);
  // recipes.renamed: old id → new id, so a saved plan or rating can follow a dish whose id changed.
  if (recipes.renamed !== undefined) {
    if (!recipes.renamed || typeof recipes.renamed !== 'object' || Array.isArray(recipes.renamed)) err('recipes.renamed must be { "old-id": "new-id" }');
    else for (const [from, to] of Object.entries(recipes.renamed)) {
      if (ids.has(from)) err(`recipes.renamed: "${from}" is still a dinner`);
      if (!RETIRED_DINNERS[from]) err(`recipes.renamed: "${from}" must be in RETIRED_DINNERS so the old id can't come back`);
      if (!ids.has(to)) err(`recipes.renamed: "${from}" points at "${to}", which is not a dinner`);
    }
  }

  // Reference ids. A retired dinner is the one way out, and it has to be named in RETIRED_DINNERS:
  // before v3 this rule forced "sesame-tofu-noodles" and "orange-tofu-bowls" to exist, and nothing read the id.
  if (ref) {
    for (const r of ref.recipes || []) if (!ids.has(r.id) && !RETIRED_DINNERS[r.id]) err(`reference dinner id "${r.id}" missing`);
    for (const sid of Object.keys(ref.sides || {})) if (!SIDES[sid] && !REMOVED_SIDES.has(sid)) err(`reference side id "${sid}" missing`);
    for (const r of ref.recipes || []) {
      const d = dinners.find((x) => x.id === r.id);
      if (d && d.rotation !== 'core') err(`reference dinner "${r.id}" must stay in the core rotation`);
    }
  }

  // ---------------------------------------------------------------- lunches (SPEC §8.2)
  const LUNCH = {};
  if (lunches) {
    for (const it of Array.isArray(lunches.items) ? lunches.items : []) {
      const w = `lunch ${it.id}`;
      if (!it.id || !it.title) err(`${w}: id/title missing`);
      if (LUNCH[it.id]) err(`${w}: defined twice`);
      LUNCH[it.id] = it;
      if (!LUNCH_SLOTS.includes(it.slot)) err(`${w}: slot "${it.slot}" not allowed`);
      scanText(`${w} (id)`, it.id);
      scanAll(w, it);
      for (const f of ['title', 'subtitle', 'prep', 'batch']) scanRaw(`${w}.${f}`, it[f]);
      scanRaw(`${w}.photo`, it.photo, { picture: true });
      if (!it.items || typeof it.items !== 'object' || !Object.keys(it.items).length) { err(`${w}: items missing/empty`); continue; }
      for (const [id, q] of Object.entries(it.items)) {
        usedIngredients.add(id);
        if (!ING[id]) err(`${w}: item "${id}" is not in the catalog`);
        if (!(typeof q === 'number' && q > 0)) err(`${w}: item "${id}" quantity must be a positive number`);
        if (id === 'cucumber' || id === 'tomato') err(`${w}: uses ${id} (the family doesn't eat raw cucumbers or tomatoes)`);
        // A packaged bowl that comes with raw tomato: only the lunch named in TOMATO_LEFT_OUT, for the people
        // named there, and only while its own words say to leave the tomatoes out.
        if (COMES_WITH_RAW_TOMATO.includes(id)) {
          const forWhom = TOMATO_LEFT_OUT[it.id];
          if (!forWhom) err(`${w}: uses ${id}, which comes with raw tomato (no raw tomatoes for this family)`);
          else {
            if (!LEAVES_TOMATO_OUT.test(String(it.prep || ''))) err(`${w}: comes with raw tomato, so its prep must say to leave the tomatoes out`);
            if (!(Array.isArray(it.people) && it.people.length === forWhom.length && forWhom.every((n) => it.people.includes(n)))) err(`${w}: comes with raw tomato, so it is for ${forWhom.join(' and ')} only ("people": ${JSON.stringify(forWhom)})`);
          }
        }
        if (PER && ING[id] && !macroOk(id)) err(`${w}: item "${id}" has no calories, protein, carbs, fat and fiber in data/nutrition.json`);
      }
      // A number printed in the words has to be the number the app works out and shows beside it.
      if (PER) {
        const t = total(it.items);
        const said = `${it.subtitle || ''} ${it.prep || ''}`;
        const cal = /(\d[\d,]*) cal(ories)?\b/i.exec(said);
        const pro = /(\d+) g (of )?protein/i.exec(said);
        if (!t.missing.length && cal && Math.abs(Number(cal[1].replace(/,/g, '')) - t.kcal) > Math.max(15, t.kcal * 0.08)) err(`${w}: says "${cal[0]}" but its items add up to ${Math.round(t.kcal)}`);
        if (!t.missing.length && pro && Math.abs(Number(pro[1]) - t.protein) > Math.max(3, t.protein * 0.12)) err(`${w}: says "${pro[0]}" but its items add up to ${Math.round(t.protein)} g`);
      }
    }
    // "people": the only people an item is for (left off = anyone).
    const lunchNames = Object.keys(lunches.defaults || {});
    for (const it of Object.values(LUNCH)) {
      if (it.people === undefined) continue;
      const w = `lunch ${it.id}`;
      if (!Array.isArray(it.people) || !it.people.length || it.people.some((n) => typeof n !== 'string')) { err(`${w}: people must be a list of names`); continue; }
      for (const n of it.people) if (lunchNames.length && !lunchNames.includes(n)) err(`${w}: people names "${n}", who is not in lunches.defaults`);
    }
    for (const [name, d] of Object.entries(lunches.defaults || {}))
      for (const [slot, list] of Object.entries(d?.slots || {}))
        for (const id of list || []) {
          const it = LUNCH[id];
          if (!it) { err(`lunches.defaults.${name}.${slot}: "${id}" is not a lunch item`); continue; }
          if (Array.isArray(it.people) && !it.people.includes(name)) err(`lunches.defaults.${name}.${slot}: "${id}" is for ${it.people.join(' and ')} only`);
          // Turkey is Jeff's lunch meat; the others don't like it much.
          const turkey = TURKEY.test(id) || Object.keys(it.items || {}).some((x) => TURKEY.test(x));
          if (turkey && !TURKEY_LUNCH_FOR.includes(name)) err(`lunches.defaults.${name}.${slot}: "${id}" is turkey, which only ${TURKEY_LUNCH_FOR.join(' and ')} eats for lunch`);
        }
    for (const it of Object.values(LUNCH)) eachString(it, (text, key) => { if (WRONG_RANCH.test(text)) err(`lunch ${it.id}.${key}: names Hidden Valley; the family's ranch is Wish-Bone`); });
    for (const sw of lunches.swaps || []) {
      for (const k of ['from', 'to']) if (!LUNCH[sw[k]]) err(`lunches.swaps: "${sw[k]}" is not a lunch item`);
      scanText('lunches.swaps.why', sw.why);
      scanRaw('lunches.swaps.why', sw.why);
    }
  }

  // catalog ingredients nobody uses (fine for extras)
  for (const id of Object.keys(ING)) if (!usedIngredients.has(id) && !ING[id].extra && !ING[id].lunch) warn(`catalog.${id}: not used by any dinner, side or lunch (and not marked extra or lunch)`);

  // ---------------------------------------------------------------- pictures (img/photos.json, dev/photo-jobs.json)
  const KINDS_OF_DISH = {
    dinner: { key: 'dinners', dir: 'img/dinners', has: (id) => ids.has(id) },
    side: { key: 'sides', dir: 'img/sides', has: (id) => !!SIDES[id] },
    lunch: { key: 'lunch', dir: 'img/lunch', has: (id) => !!LUNCH[id] },
  };
  const jobs = new Map();
  if (photoJobs != null) {
    if (!Array.isArray(photoJobs)) err('dev/photo-jobs.json must be a list of { kind, id, file, prompt }');
    else for (const [i, j] of photoJobs.entries()) {
      const w = `photo-jobs[${i + 1}]${j?.id ? ` ${j.kind} ${j.id}` : ''}`;
      const k = KINDS_OF_DISH[j?.kind];
      if (!k) { err(`${w}: kind must be dinner, side or lunch`); continue; }
      if (!k.has(j.id)) err(`${w}: there is no ${j.kind} with that id`);
      if (jobs.has(`${j.kind}:${j.id}`)) err(`${w}: listed twice`);
      jobs.set(`${j.kind}:${j.id}`, j);
      if (j.file !== `${k.dir}/${j.id}.webp`) err(`${w}: file must be ${k.dir}/${j.id}.webp`);
      if (typeof j.prompt !== 'string' || j.prompt.length < 60) err(`${w}: prompt missing or too short`);
      scanText(`${w}.prompt`, j.prompt);
      // "Do not show cucumber…" at the end of a prompt is an instruction to the image model, not an ingredient
      const positive = String(j.prompt || '').split(/\b(?:Do not show|Never show|No )\b/)[0];
      scanRaw(`${w}.prompt`, positive, { picture: true });
    }
  }
  if (photos) {
    for (const [kind, k] of Object.entries(KINDS_OF_DISH)) {
      const listed = photos[k.key] || {};
      for (const [id, rel] of Object.entries(listed)) {
        if (!k.has(id)) { err(`img/photos.json: ${k.key}.${id} is a picture of a ${kind} that isn't in the recipe box`); continue; }
        const file = typeof rel === 'string' ? rel : rel?.src;
        if (fileExists && !fileExists(file)) err(`img/photos.json: ${k.key}.${id} points at ${file}, which is not on disk (a missing picture must stay out of photos.json so the app shows its placeholder)`);
      }
      const all = kind === 'dinner' ? [...ids] : kind === 'side' ? Object.keys(SIDES) : Object.keys(LUNCH);
      for (const id of all) if (!listed[id]) (jobs.has(`${kind}:${id}`) ? warn : err)(`${kind} ${id}: no picture yet${jobs.has(`${kind}:${id}`) ? ' (queued in dev/photo-jobs.json; the app shows its placeholder)' : ' and no job in dev/photo-jobs.json'}`);
    }
  }

  // ---------------------------------------------------------------- cost table
  const costOf = (items, uc = unitCost) => Object.entries(items || {}).reduce((a, [id, q]) => a + (uc[id]?.cost || 0) * q, 0);
  // Optional second opinion: data/prices.json (pricing agent) overrides catalog packs where it lists them.
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
  const rows = dinners.map((d) => {
    const entree = costOf(d.items);
    const sides = (d.sides || []).reduce((a, sid) => a + costOf(SIDES[sid]?.items), 0);
    const res = researched ? costOf(d.items, researched) + (d.sides || []).reduce((a, sid) => a + costOf(SIDES[sid]?.items, researched), 0) : null;
    const fam = costOf(d.items, usualCost) + (d.sides || []).reduce((a, sid) => a + costOf(SIDES[sid]?.items, usualCost), 0);
    return { id: d.id, rot: d.rotation, protein: d.protein, entree, sides, total: entree + sides, res, fam, plate: plates[d.id] || null };
  });
  for (const r of rows) {
    // Fried shrimp night is what the family already buys (two bags of SeaPak), so the cap doesn't push it around.
    if (r.total > MAX_COST && r.id !== SHRIMP_NIGHT.dinner) err(`dinner ${r.id}: estimated cost $${r.total.toFixed(2)} is over $${MAX_COST}`);
    if (r.total < MIN_COST) err(`dinner ${r.id}: estimated cost $${r.total.toFixed(2)} is under $${MIN_COST}`);
  }

  // Sam's-only / Jewel-only availability (informational). Staples (stocked-until-low) are assumed to be in the pantry.
  const onlyAt = (st) => Object.entries(ING).filter(([, i]) => !i.packs?.[st] && i.kind === 'measured').map(([id]) => id);
  const notAtSams = new Set(onlyAt('sams'));
  const notAtJewel = new Set(onlyAt('jewel'));
  const allIds = (d) => [...Object.keys(d.items || {}), ...(d.sides || []).flatMap((s) => Object.keys(SIDES[s]?.items || {}))];
  const blockers = (d, set) => [...new Set(allIds(d).filter((id) => set.has(id)))];
  const needsJewel = dinners.map((d) => [d.id, blockers(d, notAtSams)]).filter(([, b]) => b.length);
  const needsSams = dinners.map((d) => [d.id, blockers(d, notAtJewel)]).filter(([, b]) => b.length);

  return {
    errors, warnings, rows,
    stats: { ingredients: Object.keys(ING).length, meat: MEAT_IDS.size, extras: extras.length, sides: sideList.length, core: nCore, bench: nBench, lunches: Object.keys(LUNCH).length, researched: !!researched, needsJewel, needsSams },
  };
}

function main() {
  const QUIET = process.argv.includes('--quiet');
  const { errors, warnings, rows, stats } = validateData(loadData());
  const line = (s = '') => console.log(s);
  if (!QUIET && rows.length) {
    const avg = (list) => list.reduce((a, r) => a + r.total, 0) / (list.length || 1);
    const researched = stats.researched;
    line('Estimated ingredient cost per dinner (entrée + default sides, Sam’s generic unit cost; Jewel generic if Sam’s has no pack), and one plate of five');
    line('id'.padEnd(30) + 'rotation'.padEnd(9) + 'protein'.padEnd(9) + 'entrée'.padStart(8) + 'sides'.padStart(8) + 'total'.padStart(9) + 'family'.padStart(9) + (researched ? 'prices.json'.padStart(13) : '') + 'kcal'.padStart(7) + 'prot'.padStart(6) + 'veg'.padStart(6));
    line('-'.repeat(researched ? 114 : 101));
    for (const r of rows) {
      const flag = r.total > MAX_COST ? '  << over' : r.total < MIN_COST ? '  << under' : '';
      line(r.id.padEnd(30) + r.rot.padEnd(9) + r.protein.padEnd(9) + `$${r.entree.toFixed(2)}`.padStart(8) + `$${r.sides.toFixed(2)}`.padStart(8) + `$${r.total.toFixed(2)}`.padStart(9) + `$${r.fam.toFixed(2)}`.padStart(9) + (researched ? `$${r.res.toFixed(2)}`.padStart(13) : '')
        + (r.plate ? String(Math.round(r.plate.kcal)).padStart(7) + String(Math.round(r.plate.protein)).padStart(6) + r.plate.veg.toFixed(1).padStart(6) : '') + flag);
    }
    line('-'.repeat(researched ? 114 : 101));
    line('"total" = cheapest catalog pack (Sam’s generic, else Jewel generic) and is what the $' + MAX_COST + ' / $' + MIN_COST + ' flags use; "family" = the pack the family usually buys (catalog "usual").');
    const core = rows.filter((r) => r.rot === 'core'), bench = rows.filter((r) => r.rot === 'bench');
    line(`Average, all ${rows.length} dinners: $${avg(rows).toFixed(2)}   core (${core.length}): $${avg(core).toFixed(2)}   bench (${bench.length}): $${avg(bench).toFixed(2)}`);
    line(`Range: $${Math.min(...rows.map((r) => r.total)).toFixed(2)} – $${Math.max(...rows.map((r) => r.total)).toFixed(2)}`);
    { const fa = (l) => l.reduce((a, r) => a + r.fam, 0) / (l.length || 1); line(`As the family usually buys ("usual" packs): all $${fa(rows).toFixed(2)}   core $${fa(core).toFixed(2)}   bench $${fa(bench).toFixed(2)}`); }
    if (researched) {
      const ra = (l) => l.reduce((a, r) => a + r.res, 0) / (l.length || 1);
      line(`With data/prices.json overrides (informational, not flagged): all $${ra(rows).toFixed(2)}   core $${ra(core).toFixed(2)}   bench $${ra(bench).toFixed(2)}`);
    }
    const withPlate = rows.filter((r) => r.plate);
    if (withPlate.length) {
      const m = (k) => withPlate.reduce((a, r) => a + r.plate[k], 0) / withPlate.length;
      line(`One plate, on average: ${Math.round(m('kcal'))} kcal, ${Math.round(m('protein'))} g protein, ${Math.round(m('carbs'))} g carbs, ${Math.round(m('fat'))} g fat, ${Math.round(m('fiber'))} g fiber, ${m('veg').toFixed(1)} vegetable servings.`);
    }
    line();
    line(`Catalog: ${stats.ingredients} ingredients (${stats.meat} meat, ${stats.extras} marked extra). Sides: ${stats.sides}. Dinners: ${stats.core} core + ${stats.bench} bench. Lunch items: ${stats.lunches}.`);
    if (stats.needsJewel.length) line(`Need a Jewel-only measured item (not plannable as Sam’s-only; staples assumed stocked) — ${stats.needsJewel.length}:\n  ` + stats.needsJewel.map(([id, b]) => `${id} [${b.join(', ')}]`).join('\n  '));
    if (stats.needsSams.length) line(`Need a Sam’s-only measured item — ${stats.needsSams.length}:\n  ` + stats.needsSams.map(([id, b]) => `${id} [${b.join(', ')}]`).join('\n  '));
    line();
  }
  for (const w of warnings) console.log('WARN  ' + w);
  for (const e of errors) console.log('ERROR ' + e);
  console.log(errors.length ? `\nFAILED: ${errors.length} error(s), ${warnings.length} warning(s).` : `\nPASSED with ${warnings.length} warning(s).`);
  process.exit(errors.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
