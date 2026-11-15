import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDb } from '../app/data.js';
import { loadAdapted } from '../dev/adapter-v1.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const maybe = (p) => (existsSync(path.join(ROOT, p)) ? read(p) : null);

/** The real data files when the recipes agent has written them, else the v1 adapter. */
export function realDb() {
  const haveReal = existsSync(path.join(ROOT, 'data/catalog.json')) && existsSync(path.join(ROOT, 'data/recipes.json'));
  const { catalog, recipes } = haveReal ? { catalog: read('data/catalog.json'), recipes: read('data/recipes.json') } : loadAdapted();
  return buildDb({ catalog, recipes, prices: maybe('data/prices.json'), stores: maybe('data/stores.json'), photos: maybe('img/photos.json') });
}

export const usingRealData = () => existsSync(path.join(ROOT, 'data/catalog.json')) && existsSync(path.join(ROOT, 'data/recipes.json'));

/** A tiny hand-made db for exact math. */
export function tinyDb() {
  const pack = (size, price) => ({ generic: { size, price, label: `g${size}` }, name: { size, price: price * 1.5, label: `n${size}` } });
  const catalog = {
    ingredients: {
      chicken: { name: 'Chicken breast', unit: 'lb', aisle: 'Meat', storage: 'freezer', kind: 'measured', defaultStore: 'sams', aliases: ['chicken'], packs: { sams: pack(10, 30), jewel: pack(3, 12) } },
      beef: { name: 'Ground beef', unit: 'lb', aisle: 'Meat', storage: 'freezer', kind: 'measured', defaultStore: 'sams', packs: { sams: pack(10, 45), jewel: pack(3, 18) } },
      pasta: { name: 'Spaghetti', unit: 'oz', aisle: 'Pasta & Grains', storage: 'pantry', kind: 'measured', defaultStore: 'jewel', packs: { sams: pack(96, 7), jewel: pack(16, 1.5) } },
      salt: { name: 'Salt', unit: 'tsp', aisle: 'Spices & Baking', storage: 'pantry', kind: 'staple', defaultStore: 'jewel', packs: { jewel: pack(120, 1.29) } },
      broccoli: { name: 'Frozen broccoli', unit: 'lb', aisle: 'Frozen', storage: 'freezer', kind: 'measured', defaultStore: 'sams', packs: { sams: pack(4, 6.5), jewel: pack(1, 2.29) } },
      buns: { name: 'Hamburger buns', unit: 'buns', aisle: 'Bakery', storage: 'freezer', kind: 'measured', defaultStore: 'sams', packs: { sams: pack(12, 4.49), jewel: pack(8, 2.29) } },
      fries: { name: 'Frozen fries', unit: 'oz', aisle: 'Frozen', storage: 'freezer', kind: 'measured', defaultStore: 'jewel', packs: { jewel: pack(32, 3.99) } },
      greenBeans: { name: 'Green beans, 15 oz cans', unit: 'cans', aisle: 'Canned & Jarred', storage: 'pantry', kind: 'measured', defaultStore: 'sams', packs: { sams: pack(8, 8.49), jewel: pack(1, 1.09) } },
      samsOnly: { name: 'Bulk naan', unit: 'pieces', aisle: 'Bakery', storage: 'freezer', kind: 'measured', defaultStore: 'sams', packs: { sams: pack(10, 6.5) } },
      milk: { name: 'Milk', unit: 'cups', aisle: 'Dairy & Eggs', storage: 'fridge', kind: 'measured', defaultStore: 'jewel', extra: true, packs: { jewel: pack(16, 3.69) } },
    },
  };
  const D = (id, o) => ({ id, title: id, subtitle: '', category: 'Comfort', protein: 'chicken', minutes: 30, equipment: ['stovetop'], tags: [], rotation: 'core', steps: ['Cook.'], sides: ['broc', 'beans'], sideSlots: 2, ...o });
  const recipes = {
    dinners: [
      D('chix-pasta', { category: 'Pasta', items: { chicken: 2, pasta: 16, salt: 1 } }),
      D('chix-grill', { category: 'Grill', items: { chicken: 2.5 } }),
      D('beef-bowl', { category: 'Asian-inspired', protein: 'beef', items: { beef: 2 }, tags: ['rice'] }),
      D('burger', { category: 'Burgers', protein: 'beef', items: { beef: 2, buns: 5 }, tags: ['burger'], sides: ['fries'], sideSlots: 1 }),
      D('naan-chicken', { category: 'Asian-inspired', items: { chicken: 2, samsOnly: 5 } }),
      D('bench-beef', { category: 'Asian-inspired', protein: 'beef', items: { beef: 2 }, rotation: 'bench' }),
      D('bench-pasta', { category: 'Pasta', items: { chicken: 2, pasta: 16 }, rotation: 'bench' }),
    ],
    sides: [
      { id: 'broc', title: 'Steamed broccoli', kind: 'vegetable', items: { broccoli: 1.25 }, steps: ['Steam.'] },
      { id: 'beans', title: 'Green beans', kind: 'vegetable', items: { greenBeans: 2 }, steps: ['Warm.'] },
      { id: 'fries', title: 'Fries', kind: 'starch', items: { fries: 32 }, steps: ['Air fry.'] },
      { id: 'naan-side', title: 'Warm naan', kind: 'bread', items: { samsOnly: 5 }, steps: ['Warm.'] },
    ],
  };
  return buildDb({ catalog, recipes });
}
