// The pure parts of recipes and cook mode (SPEC §22): reading steps, timing the plate, amounts per
// step, the pantry check, plate facts and the week's summary, leftovers, timers, recipe-box filters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tinyDb, realDb } from './helpers.mjs';
import { applyOps } from '../app/state.js';
import { addDays } from '../app/util.js';
import { onHand } from '../app/coverage.js';
import { markCookedOps, unmarkCookedOps, saveLeftoversOps, useLeftoverOps, clearLeftoversOps, leftoverNightOps, bringBackOps } from '../app/actions.js';
import {
  parseDurations, parseSetting, stepDetails, equipmentSettings, equipmentLabel, safeTemps, recipeTimes, recipeTips, leftoversNote, fmtMinutes,
  cookTracks, cookTimeline, plateRecipes, stepIngredients, ingredientLabel, pantryCheck, plateFacts, weekSummary, whyThisDinner,
  leftoverRecord, leftoversOnHand, leftoversToAsk, leftoverNightChoices, useByText, servingsText, LEFTOVER_REASON,
  newTimer, timerLeft, timerPhase, pauseTimer, resumeTimer, addTime, fmtClock, ringing,
  recipeFacts, recipeMatches, recipeCompare,
  settingOwner, timeLabel,
} from '../app/cooking.js';
import { plateHealth, LEAN_RULE } from '../app/nutrition.js';

const TODAY = '2026-11-16';

// ---------------------------------------------------------------- reading a step

test('durations: ranges take the low end for the timer, asides are not waits', () => {
  assert.deepEqual(parseDurations('Cook until crispy, 2–3 minutes, then flip.'), [{ seconds: 120, maxSeconds: 180, label: '2–3 min', per: null }]);
  assert.deepEqual(parseDurations('Brown the chicken, 2-3 minutes per side.').map((d) => [d.seconds, d.label, d.per]), [[120, '2–3 min per side', 'side']]);
  assert.deepEqual(parseDurations('Cover and cook 15 minutes. Rest, covered, 10 minutes off the heat.').map((d) => d.seconds), [900, 600]);
  assert.deepEqual(parseDurations('Stir in the turmeric for 30 seconds.').map((d) => [d.seconds, d.label]), [[30, '30 sec']]);
  assert.deepEqual(parseDurations('Slow cook on low for 4 hours.').map((d) => [d.seconds, d.label]), [[14400, '4 hr']]);
  assert.deepEqual(parseDurations('Air-fry 12 to 18 minutes per batch.').map((d) => [d.seconds, d.maxSeconds, d.per]), [[720, 1080, 'batch']]);
  // Not waits: a parenthetical alternative, "up to", "the last 2 minutes", "1 minute less than the box".
  assert.deepEqual(parseDurations('Grill 8–10 minutes (6–8 minutes if your grill closes like a press).').map((d) => d.label), ['8–10 min']);
  assert.deepEqual(parseDurations('Chill for up to 2 hours and toss again.'), []);
  assert.deepEqual(parseDurations('Brush with the sauce during the last 2 minutes.'), []);
  assert.deepEqual(parseDurations('Cook the pasta 1 minute less than the box says.'), []);
  assert.deepEqual(parseDurations('Cut into 1-inch pieces.'), []);
});

test('settings: burner heat and air-fryer temperature, never a doneness temperature', () => {
  assert.equal(parseSetting('Heat the Blackstone over medium-high for about 10 minutes.'), 'Medium-high heat');
  assert.equal(parseSetting('Cover, turn the heat to low and simmer.'), 'Low heat');
  assert.equal(parseSetting('Air-fry at 400°F in single layers.'), '400°F');
  assert.equal(parseSetting('Air-fry from frozen at the package temperature (usually 400°F).'), '400°F');
  assert.equal(parseSetting('Cook until a thermometer reads 165°F.'), '');
  assert.equal(parseSetting('Use low-sodium soy sauce.'), '');
  assert.equal(parseSetting('Chop the romaine.'), '');
});

test('stepDetails: uses stepDetail when the recipe has it, and reads plain steps when it doesn’t', () => {
  const plain = stepDetails({ steps: ['Heat the oil over medium-high. Brown the chicken, 2–3 minutes per side.', 'Slice and serve.'] });
  assert.equal(plain.length, 2);
  assert.equal(plain[0].setting, 'Medium-high heat');
  assert.deepEqual(plain[0].timers.map((t) => t.label), ['2–3 min per side']);
  assert.equal(plain[0].minutes, 6, 'both sides, at the long end');
  assert.equal(plain[1].minutes, null);
  assert.deepEqual(plain[1].timers, []);

  const rich = stepDetails({
    steps: ['Sear.', 'Slow cook.', 'Shred.'],
    stepDetail: [
      { text: 'Sear the pork on all sides.', minutes: 8, setting: 'Sear/Sauté, HI' },
      { text: 'Add the broth, lid on, and slow cook.', minutes: 240, setting: 'Slow Cook, LO' },
      { text: 'Shred with two forks.', minutes: 5 },
    ],
  });
  assert.deepEqual(rich.map((s) => s.setting), ['Sear/Sauté, HI', 'Slow Cook, LO', '']);
  assert.deepEqual(rich.map((s) => s.minutes), [8, 240, 5]);
  assert.deepEqual(rich[1].timers.map((t) => [t.seconds, t.label]), [[14400, '4 hr']], 'a waiting step gets its timer from minutes');
  assert.deepEqual(rich[2].timers, [], 'a hands-on step (shredding) gets no timer');
  // stepDetail entries without text fall back to the matching plain step; a custom dinner has neither.
  assert.equal(stepDetails({ steps: ['Boil 10 minutes.'], stepDetail: [{ minutes: 10 }] })[0].text, 'Boil 10 minutes.');
  assert.deepEqual(stepDetails({}), []);
  assert.deepEqual(stepDetails(null), []);
});

test('times, tips and the leftovers note degrade gracefully', () => {
  assert.deepEqual(recipeTimes({ minutes: 30 }), { prep: null, cook: null, total: 30 });
  assert.deepEqual(recipeTimes({ prepMinutes: 10, cookMinutes: 25 }), { prep: 10, cook: 25, total: 35 });
  assert.deepEqual(recipeTimes({ prepMinutes: 10, cookMinutes: 25, minutes: 40 }), { prep: 10, cook: 25, total: 40 });
  assert.deepEqual(recipeTimes({}), { prep: null, cook: null, total: null });
  assert.deepEqual(recipeTips({ tips: ['Pat it dry.', ''] }), ['Pat it dry.']);
  assert.deepEqual(recipeTips({ tips: 'Rest it.' }), ['Rest it.']);
  assert.deepEqual(recipeTips({}), []);
  assert.equal(leftoversNote({ leftovers: 'Great cold in a wrap.' }), 'Great cold in a wrap.');
  assert.match(leftoversNote({}), /within 2 hours.*3–4 days.*165°F/);
  assert.equal(fmtMinutes(45), '45 min');
  assert.equal(fmtMinutes(240), '4 hr');
  assert.equal(fmtMinutes(70), '1 hr 10 min');
});

test('equipment: each appliance with the settings its steps call for; the PossibleCooker has a name', () => {
  const db = realDb();
  // The recipe box names the appliance in each step's setting ("Blackstone, medium-high"): it goes there, once, without the name.
  assert.deepEqual(equipmentSettings(db.dinners.smashburgers), [{ id: 'blackstone', label: 'Blackstone', settings: ['Medium-high'] }]);
  const tenders = equipmentSettings(db.dinners['chicken-tender-night']);
  assert.deepEqual(tenders.find((e) => e.id === 'air fryer').settings, ['400°F']);
  assert.ok(!equipmentSettings(db.dinners['honey-garlic-chicken-bites']).find((e) => e.id === 'stovetop').settings.includes('400°F'));
  assert.deepEqual(equipmentSettings(db.dinners['cooker-chicken-tortilla-soup']), [{ id: 'possible cooker', label: 'PossibleCooker', settings: ['SLOW COOK on LO'] }]);
  assert.deepEqual(settingOwner('Stovetop, medium-low, lid on'), { id: 'stovetop', what: 'Medium-low, lid on' });
  assert.deepEqual(settingOwner('sear/sauté, high'), { id: 'possible cooker', what: 'sear/sauté, high' });
  assert.equal(settingOwner('Medium-high heat'), null);
  // A dinner the family saved has plain sentences: the setting is read from them and goes by what the step mentions.
  assert.deepEqual(equipmentSettings({ equipment: ['blackstone'], steps: ['Heat the Blackstone over medium-high for about 10 minutes.'] }), [{ id: 'blackstone', label: 'Blackstone', settings: ['Medium-high heat'] }]);
  // Every dinner in the box: each appliance it lists gets at least one setting from its steps, and a slow cook reads as hands-on plus the total.
  for (const d of db.dinnerList) for (const e of equipmentSettings(d)) assert.ok(e.label && Array.isArray(e.settings), `${d.id}: ${e.id}`);
  assert.equal(timeLabel(db.dinners['cooker-pot-roast']), '20 min hands-on, 8 hr 40 min in all');
  assert.equal(timeLabel(db.dinners.smashburgers), fmtMinutes(db.dinners.smashburgers.minutes));
  assert.equal(timeLabel({}), '');
  assert.equal(equipmentLabel('possible cooker'), 'PossibleCooker');
  assert.deepEqual(equipmentSettings({ equipment: ['possible cooker'], stepDetail: [{ text: 'Slow cook the chili.', minutes: 240, setting: 'Slow Cook, LO' }] }),
    [{ id: 'possible cooker', label: 'PossibleCooker', settings: ['Slow Cook, LO'] }]);
  assert.deepEqual(equipmentSettings({}), []);
});

test('safe temperatures come from the steps, or from the protein when the steps don’t say', () => {
  const db = realDb();
  assert.deepEqual(safeTemps(db.dinners.smashburgers), [{ temp: 160, food: 'Ground beef', note: 'no pink in the middle' }]);
  // The dinner's own meat, never a generic list (gauntlet r5: a pot roast read "Pork chops and steaks").
  assert.deepEqual(safeTemps({ protein: 'beef', items: { chuckRoast: 2.25 }, steps: ['Cook until it pulls apart, far past the safe 145°F.'] }).map((t) => [t.temp, t.food]), [[145, 'Beef roast']]);
  assert.deepEqual(safeTemps(db.dinners['tikka-masala']).map((t) => [t.temp, t.food]), [[165, 'Chicken']]);
  assert.deepEqual(safeTemps({ protein: 'pork', steps: ['Grill the chops.'] }).map((t) => [t.temp, t.note]), [[145, 'then rest 3 minutes']]);
  assert.deepEqual(safeTemps({ protein: 'mixed', steps: ['Warm it through.'] }), []);
});

// ---------------------------------------------------------------- the whole plate

test('timeline: every dish finishes together, and the steps come in the order to start them', () => {
  const db = realDb();
  const tl = cookTimeline(cookTracks(plateRecipes(db, {}, 'smashburgers', null)));
  assert.equal(tl.tracks.length, 2);
  const [burgers, fries] = tl.tracks;
  assert.equal(burgers.end, tl.total);
  assert.equal(fries.end, tl.total);
  // Whichever takes longest starts the clock; the other starts partway through.
  const [first, second] = burgers.minutes >= fries.minutes ? [burgers, fries] : [fries, burgers];
  assert.equal(first.start, 0);
  assert.ok(second.start > 0);
  assert.equal(tl.steps[0].track, first.id);
  assert.equal(tl.steps.length, db.dinners.smashburgers.steps.length + db.sides['jewel-fries'].steps.length);
  // Each dish keeps its own order.
  for (const id of ['main', 'side0']) assert.deepEqual(tl.steps.filter((s) => s.track === id).map((s) => s.index), tl.steps.filter((s) => s.track === id).map((s, i) => i));
  for (let i = 1; i < tl.steps.length; i++) assert.ok(tl.steps[i].at >= tl.steps[i - 1].at, 'in starting order');
  assert.deepEqual(tl.cues.map((c) => [c.id, c.title]), [['side0', 'Air-fryer fries']]);
  assert.match(tl.cues[0].text, /^(Start here\. About \d+ min, the longest thing on the plate\.|Start it about \d+ min before dinner is ready\.)$/);

  // One dish at a time, for a cook who'd rather not juggle.
  const byDish = cookTimeline(cookTracks(plateRecipes(db, {}, 'smashburgers', null)), { order: 'dish' });
  assert.deepEqual(byDish.steps.map((s) => s.key), [...db.dinners.smashburgers.steps.map((_, i) => `main:${i}`), ...db.sides['jewel-fries'].steps.map((_, i) => `side0:${i}`)]);
});

test('timeline cues: a side that starts partway through, and a quick one left for last', () => {
  const db = realDb();
  const tl = cookTimeline(cookTracks(plateRecipes(db, {}, 'teriyaki-chicken-bowls', null)));
  const broccoli = tl.cues.find((c) => /broccoli/i.test(c.title));
  assert.match(broccoli.text, /^Start it about 10 min before dinner is ready\.$/);
  const pineapple = tl.cues.find((c) => /pineapple/i.test(c.title));
  assert.match(pineapple.text, /Leave it for last/);
  // The night's own sides (a shelf item) are what gets timed.
  const state = { substitutions: { 'teriyaki-chicken-bowls': { 1: 'item:greenBeans@2' } } };
  const recs = plateRecipes(db, state, 'teriyaki-chicken-bowls', null);
  assert.equal(recs.length, 3);
  assert.equal(recs[2].recipe.steps.length, 1);
  assert.equal(cookTimeline(cookTracks(recs)).tracks.length, 3);
  assert.deepEqual(plateRecipes(db, {}, 'no-such-dinner', null), []);
});

test('tracks: steps that don’t say how long share the recipe’s time; a recipe with no steps has no track', () => {
  const [t] = cookTracks([{ id: 'main', title: 'Stew', kind: 'main', recipe: { minutes: 30, steps: ['Chop everything.', 'Simmer 20 minutes.', 'Serve.'] } }]);
  assert.equal(t.minutes, 30);
  assert.deepEqual(t.steps.map((s) => s.est), [5, 20, 5]);
  const tl = cookTimeline(cookTracks([{ id: 'main', title: 'Mystery', recipe: { minutes: 20, steps: [] } }]));
  assert.deepEqual([tl.total, tl.steps.length, tl.tracks.length], [0, 0, 0]);
});

// ---------------------------------------------------------------- amounts in the step that uses them

test('step ingredients: the amounts for five beside the step that names them', () => {
  const db = realDb();
  const d = db.dinners['teriyaki-chicken-bowls'];
  const per = stepIngredients(db, {}, d.items, stepDetails(d));
  const labels = per.map((list) => list.map((x) => x.label));
  assert.deepEqual(labels[0], ['1½ cups dry jasmine rice', '½ tsp table salt']);
  assert.ok(labels[1].includes('5 tbsp soy sauce'));
  assert.ok(labels[1].includes('2 tbsp light brown sugar'));
  assert.ok(labels[1].includes('3 cloves garlic') || labels[1].includes('3 garlic'), labels[1].join('; '));
  assert.deepEqual(labels[2], ['2¼ lb boneless skinless chicken thighs'], '"the chicken thighs"');
  // "a drizzle of sesame oil" is the sesame oil; the rice is named again (already out).
  const last = per[3];
  assert.ok(last.some((x) => x.id === 'sesame'));
  assert.equal(last.find((x) => x.id === 'jasmine').again, true);
  assert.equal(per[0].find((x) => x.id === 'jasmine').again, false);
});

test('step ingredients: one word, two ingredients — the longer name wins, then the one named exactly that', () => {
  const db = tinyDb();
  db.ingredients.oil = { ...db.ingredients.salt, id: 'oil', name: 'Neutral cooking oil', unit: 'tbsp' };
  db.ingredients.sesame = { ...db.ingredients.salt, id: 'sesame', name: 'Toasted sesame oil', unit: 'tsp' };
  db.ingredients.chickenBroth = { ...db.ingredients.salt, id: 'chickenBroth', name: 'Chicken broth', unit: 'cups' };
  const items = { chicken: 2, oil: 2, sesame: 1, chickenBroth: 2 };
  const [a, b, c] = stepIngredients(db, {}, items, ['Heat the oil and brown the chicken.', 'Pour in the chicken broth.', 'Finish with the sesame oil.']);
  assert.deepEqual(a.map((x) => x.id).sort(), ['chicken', 'oil']);
  assert.deepEqual(b.map((x) => x.id), ['chickenBroth']);
  assert.deepEqual(c.map((x) => x.id), ['sesame']);
  // The lighter-meat setting scales the amount shown.
  const light = stepIngredients(db, { settings: { meatScale: 0.85 } }, { chicken: 2 }, ['Grill the chicken.']);
  assert.equal(light[0][0].amount, '1.7 lb');
});

test('ingredient labels say the amount and the food once', () => {
  assert.equal(ingredientLabel(2.25, { name: 'Boneless chicken breast', unit: 'lb' }), '2¼ lb boneless chicken breast');
  assert.equal(ingredientLabel(3, { name: 'Oranges', unit: 'oranges' }), '3 oranges');
  assert.equal(ingredientLabel(1, { name: 'Limes', unit: 'limes' }), '1 lime');
  assert.equal(ingredientLabel(5, { name: 'Hamburger buns', unit: 'buns' }), '5 hamburger buns');
  assert.equal(ingredientLabel(3, { name: 'Soy sauce (Kikkoman)', unit: 'tbsp' }), '3 tbsp soy sauce');
});

// ---------------------------------------------------------------- the pantry

test('pantry check: have, short, none; a stocked staple counts, and salt is assumed', () => {
  const db = tinyDb();
  const state = { pantry: { chicken: { qty: 1 }, pasta: { qty: 16 } } };
  const check = pantryCheck(db, state, { chicken: 2, pasta: 16, salt: 1, broccoli: 1 });
  assert.deepEqual(check.rows.map((r) => [r.id, r.status, r.short]), [['chicken', 'short', 1], ['pasta', 'have', 0], ['salt', 'have', 0], ['broccoli', 'none', 1]]);
  assert.equal(check.have, 2);
  assert.equal(check.total, 4);
  assert.deepEqual(check.missing.map((r) => r.id), ['chicken', 'broccoli']);
  assert.equal(pantryCheck(db, { pantry: { salt: { low: true } } }, { salt: 1 }).rows[0].status, 'none', 'salt marked running low is not assumed');
  assert.deepEqual(pantryCheck(db, {}, {}), { rows: [], have: 0, total: 0, missing: [] });
});

// ---------------------------------------------------------------- plate facts and the week

test('plate facts: calories, protein, vegetables and a lean marker with its reason', () => {
  const db = tinyDb();
  const f = plateFacts(db, {}, 'chix-grill', null);
  assert.ok(f.kcal > 0 && f.protein > 0);
  assert.equal(f.protein, f.proteinG);
  assert.equal(f.vegServings, 2.6, 'broccoli and green beans, in 80 g servings a plate');
  // One lean rule everywhere: nutrition.plateHealth's (LEAN_RULE), with its own sentence.
  assert.deepEqual(f, { ...plateHealth(db, {}, 'chix-grill', null), protein: f.proteinG, why: f.why, complete: true });
  assert.equal(f.lean, f.kcal <= LEAN_RULE.maxKcal && f.proteinG >= LEAN_RULE.minProteinG);
  assert.equal(f.why, 'A lean plate: 340 cal with 56 g protein', 'no full stop: it sits in a list of reasons');
  const burger = plateFacts(db, {}, 'burger', null);
  assert.equal(burger.vegServings, 0, 'fries are not a vegetable');
  assert.equal(burger.lean, false);
  assert.equal(plateFacts(db, {}, 'nope', null), null);
  assert.equal(plateFacts({ ...db, nutrition: null }, {}, 'chix-grill', null), null, 'no nutrition data, no facts');
  // The real box: some dinners are lean, most aren't, and every lean one says why.
  const real = realDb();
  const all = real.dinnerList.map((d) => plateFacts(real, {}, d.id, null)).filter(Boolean);
  const lean = all.filter((x) => x.lean);
  assert.ok(lean.length >= 5 && lean.length < all.length / 2, `${lean.length} of ${all.length} lean`);
  assert.ok(all.every((x) => x.vegServings >= 0.4), 'every plate in the box carries some vegetable');
  assert.ok(lean.every((x) => x.why));
});

test('the week’s summary: average plate, vegetables, nights at home — and nothing to hit', () => {
  const db = tinyDb();
  const state = {
    plan: {
      '2026-11-16': { dinner: 'chix-grill', sides: ['broc', 'beans'], status: 'cooked' },
      '2026-11-17': { dinner: 'burger', sides: ['fries'], status: 'planned' },
      '2026-11-18': { dinner: 'chix-pasta', sides: ['broc', 'beans'], status: 'away', away: { reason: 'Date night' } },
      '2026-11-19': { dinner: null, status: 'away', away: { reason: LEFTOVER_REASON, from: '2026-11-16' } },
    },
  };
  const w = weekSummary(db, state, ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20']);
  assert.deepEqual([w.home, w.cooked, w.away, w.leftoverNights, w.open, w.counted, w.withVeg], [2, 1, 1, 1, 1, 2, 1]);
  const a = plateFacts(db, state, 'chix-grill', state.plan['2026-11-16']);
  const b = plateFacts(db, state, 'burger', state.plan['2026-11-17']);
  assert.ok(Math.abs(w.avgKcal - (a.kcal + b.kcal) / 2) < 1e-6);
  assert.ok(Math.abs(w.avgProtein - (a.protein + b.protein) / 2) < 1e-6);
  assert.deepEqual(Object.keys(w).sort(), ['avgKcal', 'avgProtein', 'away', 'cooked', 'counted', 'home', 'lean', 'leftoverNights', 'open', 'withVeg']);
  const empty = weekSummary(db, {}, ['2026-11-16']);
  assert.deepEqual([empty.home, empty.open, empty.avgKcal], [0, 1, null]);
  // Without nutrition data the vegetable count still works.
  assert.equal(weekSummary({ ...db, nutrition: null }, state, ['2026-11-16']).withVeg, 1);
});

test('why this dinner: what it uses up, what the pantry covers, lean, on sale, the planner’s own reasons', () => {
  const db = tinyDb();
  const state = {
    pantry: { chicken: { qty: 3, since: '2026-11-03' }, broccoli: { qty: 2 }, greenBeans: { qty: 4 } },
  };
  const why = whyThisDinner(db, state, 'chix-grill', null, { today: TODAY });
  assert.equal(why[0].kind, 'use');
  assert.equal(why[0].text, 'Uses the chicken breast in the freezer from Nov 3');
  assert.ok(why.some((r) => r.kind === 'pantry' && r.text === 'Everything for it is already in the house'));
  assert.ok(why.length <= 3);
  // Something in the fridge close to its date leads.
  const soon = whyThisDinner(db, { pantry: { chicken: { qty: 3, since: '2026-11-15', place: 'fridge' } } }, 'chix-grill', null, { today: TODAY });
  assert.match(soon[0].text, /^Uses up the chicken breast from Nov 15 \(best by tomorrow\)$/);
  // A sale on something still to buy.
  const sale = whyThisDinner(db, { deals: { 'jewel/chicken': { size: 3, price: 6, was: 12, ends: '2026-11-18', checked: '2026-11-15' } } }, 'chix-grill', null, { today: TODAY });
  assert.ok(sale.some((r) => r.kind === 'sale' && /^Chicken breast is on sale at Jewel-Osco through Wednesday$/.test(r.text)), JSON.stringify(sale));
  // The planner's reasons, when a plan entry carries them, come first.
  assert.deepEqual(whyThisDinner(db, {}, 'chix-grill', { why: ['Finishes the 10 lb pack'] }, { today: TODAY })[0], { kind: 'plan', text: 'Finishes the 10 lb pack' });
  assert.deepEqual(whyThisDinner(db, {}, 'nope', null, { today: TODAY }), []);
});

// ---------------------------------------------------------------- cooked, and leftovers

test('leftovers: saved after dinner with a use-by day, eaten down, gone', () => {
  const db = tinyDb();
  let state = { plan: { [TODAY]: { dinner: 'chix-grill', sides: ['broc', 'beans'], status: 'planned' } }, pantry: { chicken: { qty: 4 } } };
  assert.equal(leftoversToAsk(state, TODAY), null, 'not until it’s cooked');
  state = applyOps(state, markCookedOps(db, state, { date: TODAY, who: 'Jeff', at: '2026-11-16T23:30:00.000Z' }).ops);
  assert.equal(state.pantry.chicken.qty, 1.5);
  assert.equal(leftoversToAsk(state, TODAY), TODAY);
  assert.equal(leftoversToAsk(state, '2026-11-17'), TODAY, 'still asked the next day');
  assert.equal(leftoversToAsk(state, '2026-11-18'), null);

  const save = saveLeftoversOps(db, state, { date: TODAY, servings: 3, who: 'Jeff', at: '2026-11-16T23:40:00.000Z' });
  assert.equal(save.message, 'chix-grill: 3 servings of leftovers saved, good through Thursday.');
  state = applyOps(state, save.ops);
  assert.deepEqual(state.leftovers[TODAY], { dinner: 'chix-grill', title: 'chix-grill', servings: 3, saved: 3, useBy: '2026-11-19', by: 'Jeff', at: '2026-11-16T23:40:00.000Z' });
  assert.equal(leftoversToAsk(state, TODAY), null, 'answered');
  assert.deepEqual(applyOps(state, save.undo).leftovers?.[TODAY], undefined, 'Undo takes it back');

  const [l] = leftoversOnHand(state, '2026-11-17');
  assert.deepEqual([l.date, l.title, l.servings, l.useBy, l.daysLeft, l.night], [TODAY, 'chix-grill', 3, '2026-11-19', 2, null]);
  assert.equal(useByText(l, '2026-11-17'), 'good through Thursday');
  assert.equal(useByText(leftoversOnHand(state, '2026-11-19')[0], '2026-11-19'), 'eat it today');
  assert.equal(useByText(leftoversOnHand(state, '2026-11-20')[0], '2026-11-20'), 'past its best: toss it');
  assert.deepEqual(leftoversOnHand(state, '2026-11-23'), [], 'long gone: no longer shown');

  const ate = useLeftoverOps(db, state, { date: TODAY });
  assert.equal(ate.message, 'chix-grill: 2 servings left.');
  state = applyOps(state, ate.ops);
  state = applyOps(state, useLeftoverOps(db, state, { date: TODAY, servings: 5 }).ops);
  assert.equal(state.leftovers[TODAY].servings, 0);
  assert.deepEqual(leftoversOnHand(state, '2026-11-17'), []);
  assert.equal(useLeftoverOps(db, state, { date: TODAY }).ops.length, 0);
  assert.equal(clearLeftoversOps(db, state, { date: TODAY }).ops.length, 0);
  assert.equal(servingsText(1), '1 serving');

  // "None" is an answer too.
  const none = saveLeftoversOps(db, state, { date: TODAY, servings: 0, who: 'Jeff', at: 'x' });
  assert.equal(none.message, 'No leftovers. Nothing to keep track of.');
  assert.deepEqual([none.ops[0].value.servings, none.ops[0].value.saved], [0, 0]);
  assert.ok(saveLeftoversOps(db, state, { date: '2026-12-01', servings: 2 }).error);
  assert.equal(leftoverRecord(db, state, { date: TODAY, servings: 99 }).servings, 20, 'a sane ceiling');
});

test('a leftover night takes a planned dinner’s place, moves that dinner to the next open night, and unmarking cooked undoes it all', () => {
  const db = tinyDb();
  const TUE = '2026-11-17';
  let state = {
    plan: {
      [TODAY]: { dinner: 'chix-grill', sides: ['broc', 'beans'], status: 'planned' },
      [TUE]: { dinner: 'burger', sides: ['fries'], status: 'planned' },
      '2026-11-18': { dinner: 'beef-bowl', sides: ['broc', 'beans'], status: 'cooked' },
      '2026-11-19': { dinner: 'chix-pasta', sides: ['broc', 'beans'], status: 'away', away: { reason: 'Date night' } },
    },
    pantry: { chicken: { qty: 4 } },
  };
  state = applyOps(state, markCookedOps(db, state, { date: TODAY, who: 'Jeff', at: 'a' }).ops);
  state = applyOps(state, saveLeftoversOps(db, state, { date: TODAY, servings: 5, who: 'Jeff', at: 'b' }).ops);
  const l = leftoversOnHand(state, TODAY)[0];
  assert.deepEqual(leftoverNightChoices(state, l, TODAY), [TUE], 'tomorrow; not the cooked night, the night out, or past its use-by day');

  const res = leftoverNightOps(db, state, { from: TODAY, night: TUE, who: 'Candi', at: 'c', today: TODAY });
  // Wednesday is cooked and Thursday is a night out, so the burgers go to Friday (gauntlet r9).
  assert.equal(res.message, 'Tomorrow is a leftover night: chix-grill. burger moved to Friday.');
  state = applyOps(state, res.ops);
  assert.deepEqual(state.plan[TUE].away, { reason: LEFTOVER_REASON, note: 'chix-grill, from Monday', from: TODAY });
  assert.equal(state.plan[TUE].status, 'away');
  assert.equal(state.plan[TUE].dinner, null);
  assert.equal(state.plan['2026-11-20'].dinner, 'burger');
  assert.deepEqual(state.plan['2026-11-20'].sides, ['fries']);
  assert.equal(leftoversOnHand(state, TODAY)[0].night, TUE);
  assert.deepEqual(leftoverNightChoices(state, leftoversOnHand(state, TODAY)[0], TODAY), []);
  assert.ok(leftoverNightOps(db, state, { from: TODAY, night: '2026-11-18', today: TODAY }).error, 'not over a cooked night');

  // Bringing the night back by hand: the leftovers are no longer set aside for it, and it's open.
  const back = applyOps(state, bringBackOps(db, state, { date: TUE, who: 'Jeff', today: TODAY }).ops);
  assert.equal(back.plan[TUE], undefined);
  assert.equal(leftoversOnHand(back, TODAY)[0].night, null);

  // "Not cooked" after all: the pantry gets the chicken back, the leftovers go, Tuesday opens up, and
  // the burgers stay on Friday.
  const undone = applyOps(state, unmarkCookedOps(db, state, { date: TODAY }).ops);
  assert.equal(undone.plan[TODAY].status, 'planned');
  assert.equal(undone.pantry.chicken.qty, 4);
  assert.equal(undone.leftovers[TODAY], undefined);
  assert.equal(undone.plan[TUE], undefined);
  assert.equal(undone.plan['2026-11-20'].dinner, 'burger');

  // With no open night in six weeks, the dinner stays with the night, to bring back (the old way).
  let full = { plan: {}, leftovers: { [TODAY]: { dinner: 'chix-grill', title: 'chix-grill', servings: 5, useBy: '2026-11-19' } } };
  for (let i = 1; i <= 50; i++) full.plan[addDays(TODAY, i)] = { dinner: 'beef-bowl', status: 'planned' };
  full.plan[TUE] = { dinner: 'burger', status: 'planned' };
  const f = leftoverNightOps(db, full, { from: TODAY, night: TUE, today: TODAY });
  assert.match(f.message, /burger comes off that night/);
  full = applyOps(full, f.ops);
  assert.equal(full.plan[TUE].dinner, 'burger');
});

// ---------------------------------------------------------------- timers

test('timers count against the clock, so they survive steps, screens and reloads', () => {
  const t0 = 1_800_000_000_000;
  const t = newTimer({ id: 'cook:x|main:1|0', label: '2–3 min', seconds: 120, step: 'main:1', title: 'Burgers', now: t0 });
  assert.equal(timerLeft(t, t0), 120);
  assert.equal(timerLeft(t, t0 + 30_500), 90);
  assert.equal(timerPhase(t, t0 + 119_000), 'running');
  assert.equal(timerPhase(t, t0 + 120_000), 'done');
  assert.equal(timerLeft(t, t0 + 500_000), 0);
  // A reload is just JSON and back.
  const again = JSON.parse(JSON.stringify(t));
  assert.equal(timerLeft(again, t0 + 60_000), 60);

  const paused = pauseTimer(t, t0 + 20_000);
  assert.equal(timerPhase(paused, t0 + 999_000), 'paused');
  assert.equal(timerLeft(paused, t0 + 999_000), 100);
  const resumed = resumeTimer(paused, t0 + 1_000_000);
  assert.equal(timerLeft(resumed, t0 + 1_000_000), 100);
  assert.equal(timerLeft(resumed, t0 + 1_040_000), 60);
  assert.equal(pauseTimer(paused, t0), paused);
  assert.equal(resumeTimer(t, t0), t);

  assert.equal(timerLeft(addTime(t, 60, t0 + 10_000), t0 + 10_000), 170, '+1 min while it runs');
  assert.equal(timerLeft(addTime(t, 60, t0 + 200_000), t0 + 200_000), 60, '+1 min after it rang starts from now');
  assert.equal(timerLeft(addTime(paused, 60, t0), t0), 160);

  assert.deepEqual(ringing([t, paused], t0 + 130_000).map((x) => x.id), [t.id], 'paused timers never ring');
  assert.deepEqual(ringing([{ ...t, acked: true }], t0 + 130_000), []);
  assert.deepEqual(ringing([], t0), []);
  assert.equal(fmtClock(185), '3:05');
  assert.equal(fmtClock(0), '0:00');
  assert.equal(fmtClock(3723), '1:02:03');
  assert.equal(fmtClock(-5), '0:00');
});

// ---------------------------------------------------------------- the recipe box

test('recipe box: makeable from the pantry, lean, appliance, time, protein, favorites, and words', () => {
  const db = tinyDb();
  const state = { pantry: { chicken: { qty: 5 }, broccoli: { qty: 3 }, greenBeans: { qty: 4 } } };
  const rem = onHand(db, state);
  const facts = Object.fromEntries(db.dinnerList.map((d) => [d.id, recipeFacts(db, state, d, rem)]));
  assert.equal(facts['chix-grill'].makeable, true);
  assert.equal(facts['chix-grill'].missing, 0);
  assert.equal(facts['chix-pasta'].makeable, false, 'no pasta in the house');
  assert.equal(facts['chix-pasta'].missing, 1);
  assert.equal(facts.burger.makeable, false);
  assert.ok(facts['chix-grill'].kcal > 0);

  const match = (id, f, q = '', opts) => recipeMatches(db.dinners[id], facts[id], f, q, opts);
  assert.equal(match('chix-grill', { makeable: true }), true);
  assert.equal(match('chix-pasta', { makeable: true }), false);
  assert.equal(match('chix-grill', { equipment: 'stovetop' }), true);
  assert.equal(match('chix-grill', { equipment: 'possible cooker' }), false);
  assert.equal(match('chix-grill', { time: '30' }), true);
  assert.equal(match('chix-grill', { time: '20' }), false);
  assert.equal(match('beef-bowl', { protein: 'beef' }), true);
  assert.equal(match('chix-grill', { protein: 'beef' }), false);
  assert.equal(match('chix-grill', { category: 'Grill' }), true);
  assert.equal(match('chix-grill', { fav: true }), false);
  assert.equal(match('chix-grill', { fav: true }, '', { favorite: true }), true);
  assert.equal(match('chix-grill', { lean: true }), facts['chix-grill'].lean);
  // Search reads ingredients and appliances too; every word must match.
  assert.equal(match('chix-pasta', {}, 'spaghetti'), true);
  assert.equal(match('chix-grill', {}, 'spaghetti'), false);
  assert.equal(match('chix-pasta', {}, 'stovetop pasta'), true);
  assert.equal(match('chix-pasta', {}, 'pasta blackstone'), false);

  const rows = db.dinnerList.map((d) => ({ d, facts: facts[d.id] }));
  assert.equal([...rows].sort(recipeCompare('ready'))[0].d.id, 'chix-grill');
  assert.deepEqual([...rows].sort(recipeCompare('az')).map((r) => r.d.id), [...rows].map((r) => r.d.id).sort());
  const light = [...rows].sort(recipeCompare('light'));
  assert.ok(light[0].facts.kcal <= light[light.length - 1].facts.kcal);
  const protein = [...rows].sort(recipeCompare('protein'));
  assert.ok(protein[0].facts.protein >= protein[protein.length - 1].facts.protein);
});

test('readiness: what the dinner is made of counts as far, a side keeps it off "ready", staples follow one rule (gauntlet r8)', async () => {
  const db = realDb();
  const { readiness } = await import('../app/coverage.js');
  // Pulled pork is the dinner: missing it is the "main" missing, however few other things are.
  const pork = readiness(db, { pantry: {} }, 'jd-pulled-pork-sandwiches');
  assert.ok(pork.missing.length >= 1);
  assert.ok(pork.keyMissing >= 1, 'the pulled pork itself');
  // The chicken is in: only garlic (not what it's made of) can be missing.
  const pepper = readiness(db, { pantry: { chickenThighs: { qty: 6 } } }, 'pepper-chicken-potatoes');
  assert.equal(pepper.keyMissing, 0);
  assert.equal(pepper.makeable, pepper.ready && !pepper.sideOut.length, 'makeable means the sides too');
  // An unrecorded staple is in the house for the recipe page as for readiness; switched off, it isn't.
  assert.equal(pantryCheck(db, {}, { honey: 1 }).rows[0].status, 'have');
  assert.equal(pantryCheck(db, { pantry: { honey: { qty: null, stocked: false } } }, { honey: 1 }).rows[0].status, 'none');
});

test('a meat pack bought in the last day is fresh, not frozen, and a freezer lot keeps its older date (gauntlet r10)', async () => {
  const db = realDb();
  const { readiness } = await import('../app/coverage.js');
  const { freshMeatQty, mergedSince } = await import('../app/freshness.js');
  const old = { pantry: { chicken: { qty: 6, since: '2026-09-10' } } };
  const fresh = { pantry: { chicken: { qty: 12.5, since: '2026-09-10', bought: { qty: 6.5, on: '2026-11-15' } } } };
  assert.equal(freshMeatQty(db, fresh, 'chicken', '2026-11-16'), 6.5);
  assert.equal(freshMeatQty(db, fresh, 'chicken', '2026-11-18'), 0, 'two days later it has been bagged and frozen');
  const id = 'blackened-cajun-chicken';
  assert.ok(readiness(db, old, id, undefined, '2026-11-16').thaw.length, 'old chicken thaws');
  assert.equal(readiness(db, fresh, id, undefined, '2026-11-16').thaw.length, 0, 'the new pack is in the fridge');
  assert.equal(mergedSince(db, old, 'chicken', '2026-11-15'), '2026-09-10', 'the freezer lot keeps its date');
  assert.equal(mergedSince(db, { pantry: { milk: { qty: 4, since: '2026-11-01' } } }, 'milk', '2026-11-15'), '2026-11-15', 'fridge food takes the new date');
});

test('the fresh pack covers tonight before the freezer lot, and only what came home is portioned (gauntlet r11)', async () => {
  const db = realDb();
  const { thawNow, prepSchedule } = await import('../app/prep.js');
  const state = {
    plan: { [TODAY]: { dinner: 'blackened-cajun-chicken', status: 'planned' } },
    pantry: { chicken: { qty: 12.5, since: '2026-09-10', bought: { qty: 6.5, on: '2026-11-15' } } },
  };
  assert.deepEqual(thawNow(db, state, TODAY).filter((t) => t.id === 'chicken'), [], 'nothing to thaw: the new pack is in the fridge');
  const jobs = prepSchedule(db, state, { today: TODAY, days: 2 }).flatMap((d) => d.tasks).filter((t) => t.kind === 'freeze' && t.id === 'chicken');
  assert.equal(jobs.length, 1);
  assert.match(jobs[0].text, /freeze 4¼ lb/, jobs[0].text);
  // Without the new pack, the freezer lot thaws as before.
  const old = { ...state, pantry: { chicken: { qty: 6, since: '2026-09-10' } } };
  assert.equal(thawNow(db, old, TODAY).filter((t) => t.id === 'chicken').length, 1);
});
