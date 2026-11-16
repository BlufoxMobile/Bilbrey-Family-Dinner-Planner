// Pure calorie, protein and plate math (SPEC §8.3, docs/spec/18-recipe-box.md) and the "lighter idea" suggestions.
// data/nutrition.json gives kcal, protein, carbs, fat, fiber (grams) and vegetable servings per ONE catalog unit.
// Dinner per plate = (entrée + effective sides, after the meat scale) ÷ 5. Lunch = its items.
// plateHealth() is the one call for planning and display: calories, protein, the other macros,
// vegetable servings and whether the plate is "lean" (LEAN_RULE).

import { itemsForNight, effectiveSides, scaleItems, dinnerById, isSideDropped } from './planner.js';
import { lunchFor, lunchSwapsFor } from './lunch.js';

export const PLATES = 5;

export function hasNutrition(db) {
  return !!db?.nutrition && Object.keys(db.nutrition.per || {}).length > 0;
}

/** { kcal, protein, missing: [ids], complete } for a bag of items; null when nothing is known. */
export function itemsNutrition(db, items, divide = 1) {
  if (!hasNutrition(db)) return null;
  let kcal = 0;
  let protein = 0;
  let known = 0;
  const missing = [];
  for (const [id, qty] of Object.entries(items || {})) {
    const per = db.nutrition.per[id];
    if (!per) { missing.push(id); continue; }
    kcal += per.kcal * qty;
    protein += per.protein * qty;
    known++;
  }
  if (!known && missing.length) return null;
  return { kcal: kcal / divide, protein: protein / divide, missing, complete: missing.length === 0 };
}

/** One adult plate of a night's dinner, with its sides as served (substitutions and meat scale included). */
export function plateNutrition(db, state, dinnerId, entry) {
  if (!dinnerById(db, state, dinnerId)) return null;
  return itemsNutrition(db, itemsForNight(db, state, dinnerId, entry), PLATES);
}

// ---------------------------------------------------------------- the whole plate (docs/spec/18-recipe-box.md)

/**
 * "Lean" is one plain rule about a dinner plate (main + sides, one of five): no more than
 * `maxKcal` calories and at least `minProteinG` grams of protein. It describes the plate, never a
 * person: nobody gets a calorie target, and a plate that isn't lean is just a heartier dinner.
 */
export const LEAN_RULE = Object.freeze({ maxKcal: 750, minProteinG: 35 });

/** One vegetable serving = 80 g of vegetables or beans (about ½ cup cooked, or a big handful raw). */
export const VEG_SERVING_GRAMS = 80;

const MACROS = ['carbs', 'fat', 'fiber'];

/**
 * Calories, protein, carbs, fat, fiber and vegetable servings for a bag of items.
 * → { kcal, protein, carbs, fat, fiber, veg, missing: [ids], complete } or null when nothing is known.
 * carbs / fat / fiber are null unless every item in the bag has that number; veg adds what is known.
 */
export function itemsMacros(db, items, divide = 1) {
  const base = itemsNutrition(db, items, divide);
  if (!base) return null;
  const sum = { carbs: 0, fat: 0, fiber: 0 };
  const have = { carbs: true, fat: true, fiber: true };
  let veg = 0;
  for (const [id, qty] of Object.entries(items || {})) {
    const per = db.nutrition.per[id];
    if (!per) continue;
    for (const k of MACROS) { if (per[k] == null) have[k] = false; else sum[k] += per[k] * qty; }
    veg += (per.veg || 0) * qty;
  }
  const out = { ...base, veg: veg / divide };
  for (const k of MACROS) out[k] = base.complete && have[k] ? sum[k] / divide : null;
  return out;
}

/** Macros for one lunch (its items, one person). */
export function lunchMacros(db, lunch) {
  if (!lunch || lunch.skip) return null;
  return itemsMacros(db, lunch.items, 1);
}

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * One plate of a night's dinner, summed up for planning and display:
 * → { kcal, proteinG, carbsG?, fatG?, fiberG?, vegServings, lean, why }, or null when the dinner is
 * unknown or there is no nutrition data at all.
 *
 * The plate is the main plus the sides as they'll be served that night (the family's remembered
 * substitutions, the night's own sides and the meat setting all count), divided by five.
 *  - kcal and grams are whole numbers; carbsG / fatG / fiberG are left off when any ingredient on
 *    the plate has no number for them (never guessed).
 *  - vegServings: vegetable servings on the plate, to one decimal (80 g each; potatoes and fries
 *    are the starch, fruit isn't counted).
 *  - lean: true when the plate is at or under LEAN_RULE.maxKcal calories with at least
 *    LEAN_RULE.minProteinG grams of protein. False when an ingredient has no calorie data, because
 *    the total would be short.
 *  - why: one plain sentence a card can show under the numbers.
 */
export function plateHealth(db, state, dinnerId, entry) {
  if (!hasNutrition(db) || !dinnerById(db, state, dinnerId)) return null;
  const m = itemsMacros(db, itemsForNight(db, state, dinnerId, entry), PLATES);
  if (!m) return null;
  const kcal = Math.round(m.kcal);
  const proteinG = Math.round(m.protein);
  const out = { kcal, proteinG };
  if (m.carbs != null) out.carbsG = Math.round(m.carbs);
  if (m.fat != null) out.fatG = Math.round(m.fat);
  if (m.fiber != null) out.fiberG = Math.round(m.fiber);
  out.vegServings = round1(m.veg);
  out.lean = m.complete && kcal <= LEAN_RULE.maxKcal && proteinG >= LEAN_RULE.minProteinG;
  if (!m.complete) {
    const names = m.missing.map((id) => db.ingredients[id]?.name || state?.custom?.[id]?.name || 'a shelf item');
    out.why = `About ${fmtKcal(kcal)} cal counted so far. No numbers yet for ${names.slice(0, 2).join(' or ')}.`;
  } else if (out.lean) {
    out.why = `A lean plate: ${fmtKcal(kcal)} cal with ${proteinG} g protein.`;
  } else if (proteinG < LEAN_RULE.minProteinG) {
    out.why = `Lighter on protein: ${proteinG} g a plate, ${fmtKcal(kcal)} cal.`;
  } else {
    out.why = `A heartier plate: ${fmtKcal(kcal)} cal with ${proteinG} g protein.`;
  }
  return out;
}

/** One plate's worth of a single side. null → show "—" (e.g. a shelf item with no data). */
export function sideNutrition(db, state, parsed) {
  if (!parsed) return null;
  const items = parsed.type === 'side' ? db.sides[parsed.id]?.items || {} : { [parsed.id]: parsed.qty };
  const n = itemsNutrition(db, scaleItems(db, state, items), PLATES);
  return n && n.complete ? n : null;
}

/** The entrée alone, one plate. */
export function entreeNutrition(db, state, dinnerId) {
  const d = dinnerById(db, state, dinnerId);
  return d ? itemsNutrition(db, scaleItems(db, state, d.items), PLATES) : null;
}

export function lunchNutrition(db, lunch) {
  if (!lunch || lunch.skip) return null;
  return itemsNutrition(db, lunch.items, 1);
}

export function lunchItemNutrition(db, item) {
  return item ? itemsNutrition(db, item.items, 1) : null;
}

/**
 * What one person eats today from the plan: lunch (if packed) + one dinner plate (if home).
 * Breakfast and snacks aren't tracked.
 */
export function dayNutrition(db, state, name, date) {
  if (!hasNutrition(db) || !name) return null; // anyone who packs a lunch, not only the five names
  const e = state?.plan?.[date];
  const dinner = e?.dinner && e.status !== 'away' ? plateNutrition(db, state, e.dinner, e) : null;
  const lunchObj = lunchFor(db, state, name, date);
  const lunch = lunchObj && !lunchObj.skip ? lunchNutrition(db, lunchObj) : null;
  if (!dinner && !lunch) return null;
  return {
    dinner, lunch,
    kcal: (dinner?.kcal || 0) + (lunch?.kcal || 0),
    protein: (dinner?.protein || 0) + (lunch?.protein || 0),
    complete: (!dinner || dinner.complete) && (!lunch || lunch.complete),
  };
}

/** "1,350" — calories rounded to the nearest 10. */
export function fmtKcal(n) {
  return Number.isFinite(n) ? (Math.round(n / 10) * 10).toLocaleString('en-US') : '—';
}
export function fmtProtein(n) {
  return Number.isFinite(n) ? `${Math.round(n)} g` : '—';
}

/** A lighter side of the same kind, saving at least `min` kcal a plate; the biggest saving wins. */
export function lighterSide(db, state, dinnerId, entry, { min = 80 } = {}) {
  if (!hasNutrition(db)) return null;
  const sides = effectiveSides(db, state, dinnerId, entry);
  const used = new Set(sides.map((s) => s.ref));
  const d = dinnerById(db, state, dinnerId);
  // Vegetables, salads and fruit go with anything; a starch or bread swap has to be one the
  // recipe box already serves with this kind of dinner (no potstickers with burgers).
  const paired = new Set(db.dinnerList.filter((x) => x.category === d?.category).flatMap((x) => x.sides));
  const fits = (alt) => ['vegetable', 'salad', 'fruit'].includes(alt.kind) || paired.has(alt.id);
  let best = null;
  for (const s of sides) {
    if (s.parsed.type !== 'side') continue;
    const cur = db.sides[s.parsed.id];
    const curN = sideNutrition(db, state, s.parsed);
    if (!cur || !curN) continue;
    for (const alt of db.sideList) {
      if (alt.kind !== cur.kind || used.has(alt.id) || !fits(alt) || isSideDropped(state, alt.id)) continue;
      const altN = sideNutrition(db, state, { type: 'side', id: alt.id });
      if (!altN) continue;
      const saves = curN.kcal - altN.kcal;
      if (saves >= min && (!best || saves > best.saves || (saves === best.saves && alt.title < best.to.title))) {
        best = { slot: s.slot, from: cur, to: alt, saves };
      }
    }
  }
  return best;
}

/**
 * Lunch swaps with the calories they save and protein they add each lunch (null without data).
 * kind: 'lighter' (saves 20+ kcal), 'protein' (adds 5+ g protein, not lighter) or 'idea' (unknown).
 * Lighter swaps come first, biggest saving first.
 */
export function lunchSwaps(db, state, name) {
  const out = lunchSwapsFor(db, state, name).map((sw) => {
    const a = itemsNutrition(db, sw.fromItem.items, 1);
    const b = itemsNutrition(db, sw.toItem.items, 1);
    const known = !!(a && b && a.complete && b.complete);
    const saves = known ? a.kcal - b.kcal : null;
    const proteinGain = known ? b.protein - a.protein : null;
    const kind = saves == null ? 'idea' : saves >= 20 ? 'lighter' : proteinGain >= 5 ? 'protein' : 'idea';
    return { ...sw, saves, proteinGain, kind };
  });
  const rank = { lighter: 0, protein: 1, idea: 2 };
  return out.sort((x, y) => rank[x.kind] - rank[y.kind] || (y.saves ?? 0) - (x.saves ?? 0));
}
