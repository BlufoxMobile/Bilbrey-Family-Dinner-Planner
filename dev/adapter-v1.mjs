// Dev-only: converts the ChatGPT v1 reference data (reference/chatgpt-v1-data.json)
// into the v2 shapes from SPEC §3.1/§3.2, in memory. The dev server serves these
// as data/catalog.json and data/recipes.json ONLY when the real files don't exist yet.
// The app never imports this file.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const AISLE = {
  Meat: ['chicken', 'beef', 'pork'],
  'Dairy & Eggs': ['eggs', 'cheese', 'parm', 'yogurt', 'butter', 'milk'],
  Bakery: ['buns', 'bread', 'tortillas', 'cornwrap', 'naan'],
  'Pasta & Grains': ['spaghetti', 'penne', 'jasmine', 'basmati'],
  Produce: ['potatoes', 'sweet', 'carrots', 'onions', 'peppers', 'slaw', 'lettuce', 'tomato', 'cucumber', 'spinach',
    'mushrooms', 'apples', 'oranges', 'lemons', 'limes', 'garlic', 'ginger'],
  Frozen: ['broccoli', 'peas', 'vegetables', 'corn', 'minis', 'fries'],
  'Canned & Jarred': ['beans', 'chickpeas', 'tomatoes', 'marinara', 'greenBeans', 'cannedCorn', 'cannedCarrots', 'tikka', 'salsa', 'pickles', 'jalapenos'],
  'Condiments & Sauces': ['oil', 'soy', 'honey', 'peanut', 'sesame', 'bbq', 'mustard', 'ketchup', 'hummus'],
  'Spices & Baking': ['starch', 'taco', 'paprika', 'oregano', 'pepper', 'salt'],
};
const STAPLES = new Set(['oil', 'soy', 'honey', 'starch', 'sesame', 'bbq', 'mustard', 'ketchup', 'salt', 'pepper',
  'paprika', 'oregano', 'taco', 'peanut', 'pickles', 'jalapenos']);
const FREEZER = new Set(['chicken', 'beef', 'pork', 'broccoli', 'peas', 'vegetables', 'corn', 'minis', 'fries', 'buns', 'tortillas', 'naan']);
const FRIDGE = new Set(['eggs', 'cheese', 'parm', 'yogurt', 'butter', 'milk', 'slaw', 'lettuce', 'cucumber', 'spinach', 'mushrooms', 'carrots', 'hummus', 'cornwrap']);
const COUNTER = new Set(['potatoes', 'sweet', 'onions', 'tomato', 'apples', 'oranges', 'lemons', 'limes', 'garlic', 'ginger', 'peppers', 'bread']);
const EXTRA = new Set(['milk', 'bread', 'eggs', 'yogurt', 'cheese', 'apples', 'oranges']);
const ALIASES = {
  chicken: ['chicken breast', 'chicken breasts', 'chicken'], beef: ['ground beef', 'hamburger meat'], pork: ['pork chops'],
  greenBeans: ['green beans', 'canned green beans'], cannedCorn: ['canned corn', 'corn can'], beans: ['black beans'],
  spaghetti: ['spaghetti noodles', 'pasta'], penne: ['penne pasta'], jasmine: ['jasmine rice', 'rice'], basmati: ['basmati rice'],
  soy: ['soy sauce'], oil: ['vegetable oil', 'canola oil', 'cooking oil'], salt: ['salt'], pepper: ['black pepper'],
};

function aisleFor(id) {
  for (const [aisle, ids] of Object.entries(AISLE)) if (ids.includes(id)) return aisle;
  return 'Snacks & Extras';
}
const round2 = (n) => Math.round(n * 100) / 100;

export function adaptV1(v1) {
  const ingredients = {};
  for (const [id, ing] of Object.entries(v1.ingredients)) {
    const other = ing.store === 'sams' ? 'jewel' : 'sams';
    const mult = v1.nameBrandMultiplier[id] || 1.25;
    const packs = {};
    packs[ing.store] = {
      generic: { size: ing.pack, price: ing.price, label: `${ing.name} (store brand)` },
      name: { size: ing.pack, price: round2(ing.price * mult), label: `${ing.name} (name brand)` },
    };
    const alt = v1.jewelOrAltPacks[id];
    if (alt) {
      packs[other] = {
        generic: { size: alt[0], price: alt[1], label: `${ing.name} (store brand)` },
        name: { size: alt[0], price: round2(alt[1] * mult), label: `${ing.name} (name brand)` },
      };
    }
    if (id === 'fries') {
      for (const s of ['jewel', 'sams']) {
        const fb = v1.friesBrandPacks[s];
        packs[s] = {
          generic: { size: fb.generic.pack, price: fb.generic.price, label: 'Frozen French fries (store brand)' },
          name: { size: fb.name.pack, price: fb.name.price, label: 'Frozen French fries (name brand)' },
        };
      }
    }
    ingredients[id] = {
      name: ing.name,
      unit: ing.unit,
      aisle: aisleFor(id),
      storage: FREEZER.has(id) ? 'freezer' : FRIDGE.has(id) ? 'fridge' : COUNTER.has(id) ? 'counter' : 'pantry',
      kind: STAPLES.has(id) ? 'staple' : 'measured',
      defaultStore: id === 'fries' ? 'jewel' : ing.store,
      aliases: ALIASES[id] || [ing.name.toLowerCase()],
      packs,
      ...(EXTRA.has(id) ? { extra: true } : {}),
    };
  }

  const meatOrder = ['chicken', 'beef', 'pork'];
  const SIDE_KIND = {
    'jewel-fries': 'starch', 'potato-wedges': 'starch', 'sweet-potatoes': 'starch', 'smashed-potatoes': 'starch',
    'warm-naan': 'bread', 'garlic-toast': 'bread', 'tomato-soup': 'soup', 'apple-slices': 'fruit', 'orange-wedges': 'fruit',
    'grilled-apples': 'fruit', 'romaine-salad': 'salad', 'lime-slaw': 'salad', 'tomato-cucumber': 'salad', 'sesame-cucumber': 'salad',
    'black-beans': 'starch', 'lemon-chickpeas': 'starch',
  };
  const equipmentFrom = (method = '') => {
    const m = method.toLowerCase();
    const out = [];
    if (m.includes('blackstone')) out.push('blackstone');
    if (m.includes('electric grill') || m.includes('indoor grill')) out.push('electric grill');
    if (m.includes('air fryer')) out.push('air fryer');
    if (m.includes('microwave')) out.push('microwave');
    return out.length ? out : ['stovetop'];
  };
  const BENCH = new Set(['orange-tofu-bowls', 'sesame-tofu-noodles', 'veggie-chow-mein', 'bean-cheddar-quesadillas', 'corn-black-bean-flatbreads', 'chickpea-pepper-pasta']);
  const dinners = v1.recipes.map((r) => {
    const protein = meatOrder.find((m) => r.items[m]) || (r.items.eggs ? 'mixed' : 'mixed');
    const tags = [...r.tags];
    if (r.items.jasmine || r.items.basmati) { if (!tags.includes('rice')) tags.push('rice'); }
    if (r.category === 'Salads' || /salad/.test(r.id)) tags.push('salad');
    if (['steamed-broccoli', 'romaine-salad'].some((s) => r.sides.includes(s)) && r.minutes <= 40 && r.category !== 'Burgers') tags.push('healthier');
    return {
      id: r.id,
      title: r.title,
      subtitle: r.subtitle,
      category: r.category,
      protein,
      minutes: r.minutes,
      equipment: equipmentFrom(r.method),
      tags,
      rotation: BENCH.has(r.id) ? 'bench' : 'core',
      items: r.items,
      steps: r.steps,
      sides: r.sides,
      sideSlots: r.category === 'Burgers' ? 1 : 2,
      photo: r.subtitle,
    };
  });
  const sides = Object.entries(v1.sides).map(([id, s]) => ({
    id,
    title: s.title,
    kind: SIDE_KIND[id] || 'vegetable',
    minutes: id === 'jewel-fries' ? 20 : 10,
    equipment: id === 'jewel-fries' || id === 'potato-wedges' || id === 'sweet-potatoes' ? ['air fryer'] : ['microwave'],
    items: s.items,
    steps: s.steps,
    photo: s.title,
  }));
  return {
    catalog: { version: 2, units: Object.fromEntries([...new Set(Object.values(ingredients).map((i) => i.unit))].map((u) => [u, u])), ingredients },
    recipes: { version: 2, dinners, sides },
  };
}

export function loadAdapted() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const v1 = JSON.parse(readFileSync(path.join(here, '..', 'reference', 'chatgpt-v1-data.json'), 'utf8'));
  return adaptV1(v1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { catalog, recipes } = loadAdapted();
  const which = process.argv[2] || 'summary';
  if (which === 'catalog') console.log(JSON.stringify(catalog, null, 2));
  else if (which === 'recipes') console.log(JSON.stringify(recipes, null, 2));
  else console.log(`${Object.keys(catalog.ingredients).length} ingredients, ${recipes.dinners.length} dinners, ${recipes.sides.length} sides`);
}
