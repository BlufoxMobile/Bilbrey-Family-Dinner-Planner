// SPEC §17: Claude in settings and "What can I make?" — the pure parts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realDb } from './helpers.mjs';
import { applyOps, settingsOf } from '../app/state.js';
import {
  buildIdeasRequest, normalizeIdea, normalizeIdeas, saveIdeaOps, qtyIn, missingCost, uniqueDinnerId, savedIdeaId,
  ideaAisle, openNightsAfter, pantryWords, NOTE_MAX,
} from '../app/ideas.js';
import { dinnerById, inRotation, allDinners, rotationList } from '../app/planner.js';
import { buildList } from '../app/shopping.js';
import { modelLabel, readByText, aiStatus, photoCostHint, claudeErrorText, AI_MODELS } from '../app/claude.js';
import { mockIdeas } from '../dev/mock-api.mjs';

const db = realDb();
const TODAY = '2026-11-16';
const night = (dinner, extra = {}) => ({ dinner, status: 'planned', by: 'Jeff', at: 'x', ...extra });

const pantryState = () => ({
  pantry: {
    chickenThighs: { qty: 3, stocked: false, since: '2026-11-15', at: '2026-11-15T12:00:00Z', place: 'fridge' },
    salt: { qty: null, stocked: true, at: '2026-11-01T12:00:00Z' },
    spaghetti: { qty: 32, stocked: false, label: 'Barilla Spaghetti', at: '2026-11-10T12:00:00Z' },
    lemons: { qty: 2, low: true },
    garlic: { qty: 0, stocked: false },
  },
  custom: { 'custom-rotel': { name: 'Rotel original', unit: 'cans', aisle: 'Canned & Jarred', kind: 'measured' } },
});

/** What a Claude idea looks like coming back from /api/ideas. */
const rawIdea = (o = {}) => ({
  title: 'Lemon garlic chicken thighs',
  subtitle: 'Crispy thighs with a bright pan sauce.',
  why: 'The thighs in the fridge should be used by tomorrow.',
  minutes: 35,
  equipment: ['stovetop', 'Air-Fryer', 'oven mitt'],
  protein: 'Chicken',
  category: 'grill',
  items: [
    { name: 'Chicken thighs', qty: 2.5, unit: 'lb', matchId: 'chickenThighs' },
    { name: 'Lemons', qty: 2, unit: 'lemons', matchId: 'lemons' },
    { name: 'Fresh basil', qty: 1, unit: 'bunch', matchId: null },
    { name: 'Salt', qty: 1, unit: 'tsp', matchId: 'salt' },
  ],
  sides: ['steamed-broccoli', 'not-a-side', 'steamed-broccoli'],
  steps: ['Season the thighs.', 'Sear on the stovetop until 165°F.', 'Finish with lemon and basil.'],
  usesPantry: ['chickenThighs', 'salt', 'nope'],
  missing: [
    { name: 'Lemons', qty: 2, unit: 'lemons', matchId: 'lemons' },
    { name: 'Fresh basil', qty: 1, unit: 'bunch', matchId: 'made-up-id' },
  ],
  ...o,
});

test('settings: the Claude model defaults to Opus 5.5 and only takes the three models', () => {
  assert.equal(settingsOf({}).aiModel, 'claude-opus-5-5');
  assert.equal(settingsOf({ settings: { aiModel: 'claude-haiku-5-5' } }).aiModel, 'claude-haiku-5-5');
  assert.equal(settingsOf({ settings: { aiModel: 'gpt-9' } }).aiModel, 'claude-opus-5-5');
  assert.deepEqual(AI_MODELS.map((m) => m.id), ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
});

test('model names, “Read by …”, the status line and the cost hints', () => {
  assert.equal(modelLabel('claude-sonnet-5-5'), 'Claude Sonnet 5.5');
  assert.equal(modelLabel('claude-opus-4-1-20250805'), 'Claude Opus 4.1');
  assert.equal(readByText('claude', 'claude-opus-5-5'), 'Read by Claude Opus 5.5');
  assert.equal(readByText('workers-ai', '@cf/meta/llama-4-scout'), 'Read by the free scanner');
  assert.equal(readByText(undefined, 'claude-haiku-5-5'), 'Read by Claude Haiku 5.5', 'an older server without engine');
  assert.equal(readByText(undefined, 'mock-vision'), 'Read by the free scanner');
  assert.equal(readByText(undefined, undefined), '', 'nothing said, nothing shown');

  const info = { keySet: true, engine: 'claude', model: 'claude-opus-5-5', spentUsd: 1.2, capUsd: 5, capped: false };
  const on = aiStatus(info, 'claude-sonnet-5-5');
  assert.equal(on.tone, 'on');
  assert.equal(on.text, 'Claude Sonnet 5.5 reads your photos', 'the family’s pick, even before the server has synced it');
  assert.equal(on.spend.text, '$1.20 of $5.00');
  assert.equal(on.spend.pct, 24);
  assert.equal(aiStatus({ ...info, keySet: false }).text, 'Using the free scanner — add the Claude key to turn Claude on');
  const capped = aiStatus({ ...info, capped: true, spentUsd: 5.02 });
  assert.equal(capped.text, 'This month’s $5 is used up; back on the 1st');
  assert.equal(capped.spend.pct, 100);
  assert.equal(aiStatus(null).tone, 'unknown');

  assert.equal(photoCostHint({ inUsd: 4, outUsd: 20, cacheWriteUsd: 5, cacheReadUsd: 0.2 }), 'About 2–6¢ a photo', 'Opus: the first photo of a scan stores the list, the rest read it back');
  assert.equal(photoCostHint({ inUsd: 2, outUsd: 10, cacheWriteUsd: 2.5, cacheReadUsd: 0.1 }), 'About 1–3¢ a photo');
  assert.equal(photoCostHint({ inUsd: 5, outUsd: 25 }), 'About 3–8¢ a photo', 'an older server without cache prices: the standard 1.25x and 0.1x');
  assert.equal(photoCostHint({ inUsd: 0.1, outUsd: 0.4 }), 'Under 1¢ a photo');
  assert.equal(photoCostHint({}), '', 'no prices from the server, no number');
});

test('friendly words for every way an ideas request fails', () => {
  assert.match(claudeErrorText({ status: 503 }), /Claude isn’t turned on yet/);
  assert.match(claudeErrorText({ status: 402, data: { capped: true } }), /budget is used up.*back on the 1st/);
  assert.match(claudeErrorText({ status: 0 }), /internet connection/);
  assert.match(claudeErrorText({ status: 401 }), /passcode/);
  assert.match(claudeErrorText({ status: 429 }), /Wait a minute/);
  for (const s of [0, 401, 402, 404, 413, 429, 500, 502, 503]) assert.doesNotMatch(claudeErrorText({ status: s, message: 'x' }), /undefined|null|NaN/);
});

test('the request: pantry with amounts and use-by dates, sides that aren’t dropped, the whole catalog, the note', () => {
  const state = { ...pantryState(), sideVotes: { 'steamed-broccoli': { Knox: -1 } } };
  const req = buildIdeasRequest(db, state, { images: ['data:image/jpeg;base64,AAA', 'not-an-image', 'data:image/png;base64,B', 'data:image/jpeg;base64,C', 'data:image/jpeg;base64,D', 'data:image/jpeg;base64,E'], note: `  use the   chicken thighs ${'x'.repeat(400)}` });
  assert.equal(req.images.length, 4, 'four photos at most, data URLs only');
  assert.ok(req.note.startsWith('use the chicken thighs '));
  assert.equal(req.note.length, NOTE_MAX);
  const ids = req.pantry.map((p) => p.id);
  assert.deepEqual([...ids].sort(), ['chickenThighs', 'salt', 'spaghetti'], 'in stock only: no running-low lemons, no empty garlic');
  const thighs = req.pantry.find((p) => p.id === 'chickenThighs');
  assert.deepEqual({ ...thighs }, { id: 'chickenThighs', name: 'Boneless skinless chicken thighs', qty: 3, unit: 'lb', useBy: '2026-11-17' }, 'raw chicken in the fridge: two days from when it came home');
  assert.equal(req.pantry[0].id, 'chickenThighs', 'use-it-first items lead');
  assert.deepEqual(req.pantry.find((p) => p.id === 'salt'), { id: 'salt', name: 'Table salt', qty: null, unit: 'tsp' }, 'staples have no amount and no use-by');
  assert.match(req.pantry.find((p) => p.id === 'spaghetti').name, /\(Barilla Spaghetti\)$/, 'the label read off the package helps Claude');
  assert.ok(!req.sides.some((s) => s.id === 'steamed-broccoli'), 'a thumbs-downed side is never offered');
  assert.ok(req.sides.every((s) => s.id && s.title && s.kind));
  assert.equal(req.catalog.length, Object.keys(db.ingredients).length + 1, 'every catalog item and the family’s shelf items');
  assert.ok(req.catalog.some((c) => c.id === 'custom-rotel' && c.name === 'Rotel original'));
  assert.equal(req.count, 3);
});

test('an idea from Claude is checked against the recipe box and the house rules', () => {
  const state = pantryState();
  const idea = normalizeIdea(db, state, rawIdea());
  assert.equal(idea.protein, 'chicken');
  assert.equal(idea.category, 'Grill');
  assert.deepEqual(idea.equipment, ['stovetop', 'air fryer'], 'known equipment only');
  assert.deepEqual(idea.sides, ['steamed-broccoli'], 'real sides, once each');
  assert.deepEqual(idea.usesPantry, ['chickenThighs', 'salt'], 'only what’s in the pantry');
  assert.equal(idea.missing.find((m) => m.name === 'Fresh basil').matchId, null, 'a made-up match is dropped');
  assert.equal(normalizeIdea(db, state, rawIdea({ title: 'Garlic shrimp skillet' })), null, 'no seafood');
  assert.equal(normalizeIdea(db, state, rawIdea({ items: [{ name: 'Extra-firm tofu', qty: 1 }] })), null, 'no tofu');
  assert.equal(normalizeIdea(db, state, rawIdea({ steps: ['Bake at 400°F for 25 minutes.'] })), null, 'no oven, ever');
  assert.equal(normalizeIdea(db, state, rawIdea({ title: 'Chicken Caesar wraps' })), null, 'never Caesar');
  assert.equal(normalizeIdea(db, state, rawIdea({ title: '' })), null);
  const two = normalizeIdeas(db, state, { ideas: [rawIdea(), rawIdea(), rawIdea({ title: 'Grilled salmon' }), null] });
  assert.equal(two.length, 1, 'duplicates and rule-breakers are left out');
});

test('units: amounts become the catalog’s unit before they’re saved', () => {
  assert.equal(qtyIn(db, {}, 'chickenThighs', 40, 'oz'), 2.5);
  assert.equal(qtyIn(db, {}, 'chickenThighs', 2, 'pounds'), 2);
  assert.equal(qtyIn(db, {}, 'salt', 1, 'tbsp'), 3);
  assert.equal(qtyIn(db, {}, 'lemons', 2, 'lemon'), 2, 'singular and plural are the same unit');
  assert.equal(qtyIn(db, {}, 'garlic', 4, ''), 4);
  assert.equal(qtyIn(db, {}, 'garlic', 0, 'cloves'), null);
});

test('detail: the app asks for timed steps, tips and the two times, and saves them on the dinner', () => {
  const state = pantryState();
  assert.equal(buildIdeasRequest(db, state, {}).detail, true);
  const raw = rawIdea({
    title: 'Slow cooker salsa chicken', minutes: 380, prepMinutes: 20, cookMinutes: 360, equipment: ['possible cooker', 'stovetop'],
    steps: ['Sear the chicken.', 'Pour in the salsa.', 'Slow cook until it reaches 165°F.'],
    stepDetails: [{ text: 'Sear the chicken.', minutes: 6, setting: 'sear/sauté, high' }, { text: 'Pour in the salsa.' }, { text: 'Slow cook until it reaches 165°F.', minutes: 360, setting: 'slow cook, low' }, { text: '   ' }, 7],
    tips: ['Start it by noon for a 6 pm dinner.', '', 42],
  });
  const idea = normalizeIdea(db, state, raw);
  assert.equal(idea.minutes, 380, 'an all-day slow cook keeps its real total (it used to fall back to 30)');
  assert.equal(idea.prepMinutes, 20);
  assert.equal(idea.cookMinutes, 360);
  assert.deepEqual(idea.equipment, ['possible cooker', 'stovetop'], 'the PossibleCooker is a known appliance');
  assert.deepEqual(idea.steps, ['Sear the chicken.', 'Pour in the salsa.', 'Slow cook until it reaches 165°F.']);
  assert.deepEqual(idea.stepDetails, [{ text: 'Sear the chicken.', minutes: 6, setting: 'sear/sauté, high' }, { text: 'Pour in the salsa.' }, { text: 'Slow cook until it reaches 165°F.', minutes: 360, setting: 'slow cook, low' }]);
  assert.deepEqual(idea.tips, ['Start it by noon for a 6 pm dinner.']);
  const res = saveIdeaOps(db, state, idea, { to: 'box', who: 'Family', at: '2026-11-16T22:00:00Z', today: TODAY });
  const saved = applyOps(state, res.ops).customDinners[res.id];
  assert.deepEqual(saved.steps, idea.steps, 'plain sentences stay, for every screen and older copies of the app');
  assert.deepEqual(saved.stepDetails, idea.stepDetails);
  assert.deepEqual(saved.tips, idea.tips);
  assert.deepEqual([saved.minutes, saved.prepMinutes, saved.cookMinutes], [380, 20, 360]);
  // An older server (plain steps, no times): nothing extra is saved, and a silly total still falls back.
  const plain = normalizeIdea(db, state, rawIdea({ minutes: 9999 }));
  assert.equal(plain.minutes, 30);
  assert.deepEqual([plain.prepMinutes, plain.cookMinutes, plain.stepDetails, plain.tips], [null, null, [], []]);
  const old = applyOps(state, saveIdeaOps(db, state, plain, { to: 'box', today: TODAY }).ops).customDinners;
  const o = Object.values(old)[0];
  assert.ok(!('stepDetails' in o) && !('tips' in o) && !('prepMinutes' in o) && !('cookMinutes' in o));
  assert.equal(normalizeIdea(db, state, rawIdea({ stepDetails: [{ text: 'Cook the chicken.', setting: 'oven, 400°F' }] })), null, 'no oven in a setting either');
});

test('Make it tonight: a one-off dinner on tonight, matched items by id, the rest as shelf items for the list', () => {
  const state = { ...pantryState(), plan: { [TODAY]: night('brown-butter-spaghetti') } };
  const idea = normalizeIdea(db, state, rawIdea());
  const res = saveIdeaOps(db, state, idea, { to: 'night', date: TODAY, who: 'Candi', at: '2026-11-16T22:00:00Z', today: TODAY });
  assert.equal(res.id, 'lemon-garlic-chicken-thighs');
  const next = applyOps(state, res.ops);
  const saved = next.customDinners[res.id];
  assert.equal(saved.rotation, 'bench', 'a one-off stays out of the rotation');
  assert.equal(saved.source, 'claude');
  assert.equal(saved.items.chickenThighs, 2.5);
  assert.equal(saved.items.lemons, 2);
  assert.equal(saved.items.salt, 1);
  const basilId = Object.keys(next.custom).find((k) => next.custom[k].name === 'Fresh basil');
  assert.ok(basilId, 'unmatched basil is a shelf item');
  assert.deepEqual({ unit: next.custom[basilId].unit, aisle: next.custom[basilId].aisle }, { unit: 'bunches', aisle: 'Produce' });
  assert.equal(saved.items[basilId], 1);
  assert.equal(saved.sides.length, 2, 'every dinner has two sides');
  assert.equal(saved.sides[0], 'steamed-broccoli');
  assert.deepEqual(saved.tags, ['from your pantry']);
  assert.deepEqual(next.plan[TODAY], { dinner: res.id, sides: saved.sides, status: 'planned', manual: true, by: 'Candi', at: '2026-11-16T22:00:00Z' });
  assert.equal(res.displaced, 'brown-butter-spaghetti');
  assert.match(res.message, /^Lemon garlic chicken thighs is on for tonight\. It replaces Brown butter spaghetti with grilled chicken\. The list has the 2 things it needs\.$/);
  // The planner reads it like any dinner, and the list buys what's missing.
  const d = dinnerById(db, next, res.id);
  assert.equal(d.title, 'Lemon garlic chicken thighs');
  assert.ok(d.custom);
  assert.equal(inRotation(next, d, db), false);
  assert.ok(!rotationList(db, next).some((x) => x.id === res.id));
  const list = buildList(db, next, { dates: [TODAY], today: TODAY });
  const names = list.items.map((i) => i.id);
  assert.ok(names.includes('lemons'), 'lemons are on the list');
  assert.ok(names.includes(basilId), 'the basil shelf item is on the list');
  assert.ok(!names.includes('chickenThighs'), 'the thighs come from the pantry');
  // Undo puts everything back.
  const undone = applyOps(next, res.undo);
  assert.deepEqual(undone.plan, state.plan);
  assert.deepEqual(undone.custom, state.custom);
  assert.deepEqual(undone.customDinners, {});
});

test('Save to the recipe box: in the rotation; saving it again, or putting it on a night after, reuses it', () => {
  const state = pantryState();
  const idea = normalizeIdea(db, state, rawIdea());
  const box = saveIdeaOps(db, state, idea, { to: 'box', who: 'Jeff', at: 'x', today: TODAY });
  const s1 = applyOps(state, box.ops);
  assert.equal(s1.customDinners[box.id].rotation, 'core');
  assert.ok(rotationList(db, s1).some((x) => x.id === box.id), 'it joins the rotation');
  assert.ok(!box.ops.some((o) => o.path[0] === 'plan'), 'no night changes');
  assert.equal(savedIdeaId(s1, idea), box.id);
  const again = saveIdeaOps(db, s1, idea, { to: 'box', today: TODAY });
  assert.equal(again.ops.length, 0);
  assert.match(again.message, /already in the recipe box/);
  const thu = saveIdeaOps(db, s1, idea, { to: 'night', date: '2026-11-19', who: 'Jeff', at: 'x', today: TODAY });
  assert.deepEqual(thu.ops.map((o) => o.path.join('/')), ['plan/2026-11-19'], 'only the night: the dinner is already saved');
  assert.equal(allDinners(db, applyOps(s1, thu.ops)).filter((d) => d.title === idea.title).length, 1, 'never a duplicate');
  // A one-off made tonight, then saved to the box, moves into the rotation.
  const t = saveIdeaOps(db, state, idea, { to: 'night', date: TODAY, today: TODAY });
  const s2 = applyOps(state, t.ops);
  const promote = saveIdeaOps(db, s2, idea, { to: 'box', today: TODAY });
  assert.deepEqual(promote.ops, [{ op: 'set', path: ['customDinners', t.id, 'rotation'], value: 'core' }]);
});

test('ids are unique, a cooked night is left alone, and a bumped dinner can move to an open night', () => {
  const state = { ...pantryState(), customDinners: { 'chicken-tikka-masala': { title: 'Something else' } } };
  assert.equal(uniqueDinnerId(db, state, 'Smashburgers'), 'smashburgers-2', 'never the id of a recipe-box dinner');
  assert.equal(uniqueDinnerId(db, state, 'Chicken tikka masala'), 'chicken-tikka-masala-2');
  const idea = normalizeIdea(db, state, rawIdea());
  const cooked = saveIdeaOps(db, { ...state, plan: { [TODAY]: night('smashburgers', { status: 'cooked' }) } }, idea, { to: 'night', date: TODAY, today: TODAY });
  assert.ok(cooked.error);
  assert.match(cooked.message, /already marked cooked/);
  const planned = { ...state, plan: { [TODAY]: night('smashburgers'), '2026-11-17': night('tikka-masala') } };
  assert.deepEqual(openNightsAfter(planned, TODAY, { limit: 2 }), ['2026-11-18', '2026-11-19']);
  const res = saveIdeaOps(db, planned, idea, { to: 'night', date: TODAY, moveTo: '2026-11-18', who: 'Jeff', at: 'x', today: TODAY });
  const next = applyOps(planned, res.ops);
  assert.equal(next.plan['2026-11-18'].dinner, 'smashburgers', 'the bumped dinner moved');
  assert.match(res.message, / moved to Wednesday\./);
  assert.equal(saveIdeaOps(db, planned, idea, { to: 'night', today: TODAY }).error, true, 'a night is needed');
});

test('what the missing things cost, and the words for the pantry items', () => {
  const state = pantryState();
  const idea = normalizeIdea(db, state, rawIdea());
  const c = missingCost(db, state, idea);
  assert.equal(c.priced, 1, 'lemons have a price');
  assert.deepEqual(c.unpriced, ['Fresh basil'], 'basil isn’t in the catalog yet');
  assert.ok(c.cost > 0 && c.cost < 15, `a sensible price for 2 lemons (${c.cost})`);
  assert.deepEqual(pantryWords(db, state, ['chickenThighs', 'greenBeans']), ['boneless skinless chicken thighs', 'green beans']);
  assert.deepEqual(ideaAisle('Fresh basil'), { aisle: 'Produce', storage: 'fridge' });
  assert.equal(ideaAisle('Heavy cream').aisle, 'Dairy & Eggs');
  assert.equal(ideaAisle('Frozen peas').aisle, 'Frozen');
});

test('the dev mock’s ideas are built from what it was sent, and one breaks the house rules', () => {
  const state = pantryState();
  const req = buildIdeasRequest(db, state, { note: 'use the chicken thighs' });
  const raw = mockIdeas(req);
  assert.equal(raw.length, 3);
  assert.ok(raw[0].usesPantry.includes('chickenThighs'));
  assert.ok(raw[0].sides.every((id) => req.sides.some((s) => s.id === id)));
  const ideas = normalizeIdeas(db, state, { ideas: raw });
  assert.deepEqual(ideas.map((i) => i.title), ['Lemon garlic chicken skillet', 'Smoky chicken rice bowls']);
});
