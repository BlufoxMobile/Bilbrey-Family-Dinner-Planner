#!/usr/bin/env node
// Per-plate calories & protein for every dinner (entrée + default sides ÷ 5) and every lunch item,
// from data/nutrition.json (per ONE catalog unit). Plain Node, no dependencies.
// Usage: node scripts/nutrition-report.mjs [--quiet]   Exit 1 if coverage is incomplete or a plate is implausible.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUIET = process.argv.includes('--quiet');
const load = (rel, required = true) => {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) { if (required) { console.log(`ERROR ${rel} missing`); process.exit(1); } return null; }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
};
const catalog = load('data/catalog.json').ingredients;
const recipes = load('data/recipes.json');
const nutrition = load('data/nutrition.json').per;
const lunches = load('data/lunches.json', false);

const PLATES = 5;
const KCAL_MIN = 350, KCAL_MAX = 1500, PROTEIN_MIN = 20;
const errors = [], flags = [];

// Coverage + sanity of the table itself.
for (const id of Object.keys(catalog)) {
  const n = nutrition[id];
  if (!n) { errors.push(`nutrition: no entry for catalog id "${id}" (${catalog[id].name}, unit ${catalog[id].unit})`); continue; }
  if (!(Number.isFinite(n.kcal) && n.kcal >= 0 && Number.isFinite(n.protein) && n.protein >= 0)) errors.push(`nutrition.${id}: kcal/protein must be numbers >= 0`);
  if (n.unit && n.unit !== catalog[id].unit) errors.push(`nutrition.${id}: unit "${n.unit}" does not match catalog unit "${catalog[id].unit}"`);
  if (n.protein * 4 > n.kcal * 1.05 + 1) errors.push(`nutrition.${id}: protein ${n.protein} g gives more calories than the ${n.kcal} kcal total`);
}

const sum = (items) => {
  let kcal = 0, protein = 0;
  for (const [id, q] of Object.entries(items || {})) {
    const n = nutrition[id];
    if (!n) continue;
    kcal += n.kcal * q; protein += n.protein * q;
  }
  return { kcal, protein };
};
const SIDES = Object.fromEntries((recipes.sides || []).map(s => [s.id, s]));

const rows = recipes.dinners.map(d => {
  const e = sum(d.items);
  const sides = (d.sides || []).map(sid => ({ id: sid, ...sum(SIDES[sid]?.items) }));
  const kcal = (e.kcal + sides.reduce((a, s) => a + s.kcal, 0)) / PLATES;
  const protein = (e.protein + sides.reduce((a, s) => a + s.protein, 0)) / PLATES;
  return { id: d.id, title: d.title, rot: d.rotation, entreeKcal: e.kcal / PLATES, entreeProtein: e.protein / PLATES, sides, kcal, protein };
});
for (const r of rows) {
  if (r.kcal < KCAL_MIN) flags.push(`dinner ${r.id}: ${Math.round(r.kcal)} kcal per plate is under ${KCAL_MIN}`);
  if (r.kcal > KCAL_MAX) flags.push(`dinner ${r.id}: ${Math.round(r.kcal)} kcal per plate is over ${KCAL_MAX}`);
  if (r.protein < PROTEIN_MIN) flags.push(`dinner ${r.id}: ${Math.round(r.protein)} g protein per plate is under ${PROTEIN_MIN} g`);
}

const out = (s = '') => { if (!QUIET) console.log(s); };
out(`Per-plate calories & protein (entrée + default sides ÷ ${PLATES}; meat scale 1×)`);
out('id'.padEnd(28) + 'rot'.padEnd(7) + 'kcal'.padStart(6) + 'prot g'.padStart(8) + '   entrée kcal/g   sides (kcal per plate)');
out('-'.repeat(100));
for (const r of rows) {
  const f = (r.kcal < KCAL_MIN || r.kcal > KCAL_MAX || r.protein < PROTEIN_MIN) ? '  <<' : '';
  out(r.id.padEnd(28) + r.rot.padEnd(7) + String(Math.round(r.kcal)).padStart(6) + String(Math.round(r.protein)).padStart(8) +
    `   ${Math.round(r.entreeKcal)}/${Math.round(r.entreeProtein)}`.padEnd(18) + r.sides.map(s => `${s.id} ${Math.round(s.kcal / PLATES)}`).join(', ') + f);
}
const avg = (k) => rows.reduce((a, r) => a + r[k], 0) / rows.length;
const byKcal = [...rows].sort((a, b) => a.kcal - b.kcal);
out('-'.repeat(100));
out(`Average per plate: ${Math.round(avg('kcal'))} kcal, ${Math.round(avg('protein'))} g protein.`);
out(`Lightest: ${byKcal.slice(0, 3).map(r => `${r.id} ${Math.round(r.kcal)} kcal`).join('; ')}`);
out(`Heaviest: ${byKcal.slice(-3).reverse().map(r => `${r.id} ${Math.round(r.kcal)} kcal`).join('; ')}`);

// Side dishes per plate (helps the "lighter swap" chip pick a same-kind side).
out();
out('Sides per plate (kcal / protein g):');
const sideRows = (recipes.sides || []).map(s => ({ id: s.id, kind: s.kind, ...sum(s.items) })).sort((a, b) => a.kind.localeCompare(b.kind) || a.kcal - b.kcal);
out('  ' + sideRows.map(s => `${s.id} [${s.kind}] ${Math.round(s.kcal / PLATES)}/${Math.round(s.protein / PLATES)}`).join('\n  '));

// Lunch items (one person's lunch item = sum of its items, catalog units per lunch).
// Plausibility per slot (kcal): main 150–900, side 20–450, snack 40–450, drink 0–300; any item over 1,000 is flagged.
const LUNCH_RANGE = { main: [150, 900], side: [20, 450], snack: [40, 450], drink: [0, 300] };
if (lunches && Array.isArray(lunches.items)) {
  const ITEMS = Object.fromEntries(lunches.items.map(it => [it.id, it]));
  out();
  out('Lunch items (per lunch, one person):');
  for (const it of lunches.items) {
    const missing = Object.keys(it.items || {}).filter(id => !nutrition[id]);
    const s = sum(it.items);
    const [lo, hi] = LUNCH_RANGE[it.slot] || [0, 1000];
    const bad = s.kcal < lo || s.kcal > hi || s.kcal > 1000;
    out(`  ${it.id.padEnd(40)} ${String(it.slot).padEnd(6)} ${String(Math.round(s.kcal)).padStart(5)} kcal ${String(Math.round(s.protein)).padStart(4)} g` + (missing.length ? `   (no nutrition for: ${missing.join(', ')})` : '') + (bad ? '  <<' : ''));
    if (missing.length) errors.push(`lunch ${it.id}: items without nutrition: ${missing.join(', ')}`);
    if (bad) flags.push(`lunch ${it.id} (${it.slot}): ${Math.round(s.kcal)} kcal is outside the plausible ${lo}–${hi} kcal for a ${it.slot}`);
    if (it.slot === 'main' && s.protein < 8) flags.push(`lunch ${it.id}: main with only ${Math.round(s.protein)} g protein`);
  }
  // Default lunch week for each enabled person: day N uses slots[slot][N % list.length].
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  out();
  out('Default lunches by person (Mon–Fri rotation):');
  for (const [person, d] of Object.entries(lunches.defaults || {})) {
    if (!d.enabled) { out(`  ${person}: off`); continue; }
    const week = (d.days || []).map((day, n) => {
      let kcal = 0, protein = 0;
      const picks = [];
      for (const [slot, list] of Object.entries(d.slots || {})) {
        if (!list || !list.length) continue;
        const id = list[n % list.length];
        const it = ITEMS[id];
        if (!it) { errors.push(`lunches.defaults.${person}.${slot}: unknown item "${id}"`); continue; }
        const s = sum(it.items);
        kcal += s.kcal; protein += s.protein; picks.push(id);
      }
      if (kcal > 1500) flags.push(`${person}'s default ${DAYS[day]} lunch is ${Math.round(kcal)} kcal (over 1,500)`);
      return `${DAYS[day]} ${Math.round(kcal)} kcal/${Math.round(protein)} g`;
    });
    out(`  ${person}: ${week.join(' · ')}`);
  }
}

for (const f of flags) console.log('FLAG  ' + f);
for (const e of errors) console.log('ERROR ' + e);
console.log(errors.length || flags.length ? `\nNEEDS ATTENTION: ${errors.length} error(s), ${flags.length} flag(s).` : `\nOK: ${Object.keys(nutrition).length} nutrition entries, ${rows.length} dinners checked, no flags.`);
process.exit(errors.length || flags.length ? 1 : 0);
