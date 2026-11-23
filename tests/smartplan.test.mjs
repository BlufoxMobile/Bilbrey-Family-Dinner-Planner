// Plan with Claude (docs/spec/30): what the app sends Claude, and how it checks and saves Claude's
// answer. The Worker's side (POST /api/plan, the prompt, its own check) is in worker/test/claude.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realDb } from './helpers.mjs';
import { applyOps } from '../app/state.js';
import { generatePlan, rotationList, dinnerById } from '../app/planner.js';
import { smartNights, smartPlanRequest, smartPlanOps, smartPlanHasWork, cleanWhy, RECENT_DAYS, WHY_MAX } from '../app/smartplan.js';
import { datesBetween, addDays } from '../app/util.js';

const db = realDb();
const TUE = '2026-11-17';
const WED = '2026-11-18';
const THU = '2026-11-19';
const FRI = '2026-11-20';
const SAT = '2026-11-21';
const SUN = '2026-11-22';
const MON = '2026-11-23';
const AT = '2026-11-17T14:00:00Z';
const noLunches = { people: { Knox: { enabled: false }, Jeff: { enabled: false } } };

/** A stocked kitchen (no meat), plus the meat given. */
function shelfWith(meat = {}) {
  const pantry = {};
  for (const ing of Object.values(db.ingredients)) {
    if (ing.meat) continue;
    pantry[ing.id] = ing.kind === 'staple' ? { qty: null, stocked: true } : { qty: 500, stocked: false, since: '2026-11-15' };
  }
  return { ...pantry, ...meat };
}

/**
 * The week as the app planned it: Tuesday is tonight, Wednesday the family is out, Thursday Candi
 * chose, Friday is open, the rest the planner picked. Last Friday they cooked something.
 */
function week() {
  const auto = generatePlan({ db, state: { lunch: noLunches, pantry: shelfWith() }, dates: datesBetween(TUE, MON), mode: 'fill', by: 'Family', at: 'x', today: TUE, seedKey: 'smart' }).entries;
  const lastWeek = rotationList(db, {}).find((d) => !Object.values(auto).some((e) => e.dinner === d.id)).id;
  const plan = {
    ...auto,
    '2026-11-13': { dinner: lastWeek, sides: [], status: 'cooked', by: 'Jeff', at: 'x' },
    [WED]: { dinner: null, sides: [], status: 'away', away: { reason: 'Date night' }, manual: true, by: 'Jeff', at: 'x' },
    [THU]: { ...auto[THU], manual: true, by: 'Candi' },
  };
  delete plan[FRI];
  return {
    lunch: noLunches,
    pantry: shelfWith({ chicken: { qty: 6, stocked: false, since: '2026-11-15' }, beef: { qty: 3, stocked: false, since: '2026-09-10' } }),
    plan,
  };
}
const opts = { start: TUE, end: MON, today: TUE };

test('smartNights: tonight, cooked, away and family-chosen nights stay; empty nights are open; the app’s own picks may change', () => {
  const state = week();
  const n = Object.fromEntries(smartNights(db, state, opts).map((x) => [x.date, x]));
  assert.deepEqual(Object.keys(n), datesBetween(TUE, MON));
  assert.equal(n[TUE].plan, 'keep');
  assert.equal(n[TUE].note, 'tonight');
  assert.equal(n[TUE].current, state.plan[TUE].dinner, 'tonight’s dinner still counts toward variety');
  assert.deepEqual([n[WED].plan, n[WED].current, n[WED].note], ['keep', null, 'not eating at home']);
  assert.deepEqual([n[THU].plan, n[THU].note], ['keep', 'the family picked it']);
  assert.deepEqual([n[FRI].plan, n[FRI].current], ['open', null]);
  for (const d of [SAT, SUN, MON]) assert.equal(n[d].plan, 'change', `${d}: the planner picked it`);
  assert.equal(n[SAT].day, 'Sat');
  // With changes off, only the open night is Claude's.
  const off = smartNights(db, state, { ...opts, change: false });
  assert.deepEqual(off.filter((x) => x.plan !== 'keep').map((x) => x.date), [FRI]);
  // Asked to, Claude may rethink the family's own picks too; never tonight, cooked or away.
  const fam = smartNights(db, state, { ...opts, family: true });
  assert.deepEqual(fam.filter((x) => x.plan === 'change').map((x) => x.date), [THU, SAT, SUN, MON]);
  assert.equal(fam.find((x) => x.date === THU).note, 'the family picked it');
  assert.deepEqual(fam.filter((x) => x.plan === 'keep').map((x) => x.date), [TUE, WED]);
  // Busy nights are marked (Mondays here: index 0 is Monday).
  const busy = smartNights(db, { ...state, settings: { busyNights: [0] } }, opts);
  assert.deepEqual(busy.filter((x) => x.busy).map((x) => x.date), [MON]);
});

test('smartPlanRequest: the nights, every dinner in the box with what the pantry says, what spoils, the meat, lately and the budget', () => {
  const state = week();
  const req = smartPlanRequest(db, state, { ...opts, start: '2026-11-10' });
  assert.equal(req.start, TUE, 'never plans the past');
  assert.equal(req.end, MON);
  assert.equal(req.family, 5);
  assert.equal(req.lean, true);
  assert.equal(req.pantryFirst, true);
  assert.equal(req.nights.length, 7);
  assert.equal(req.dinners.length, rotationList(db, state).length, 'the whole recipe box');
  const READY = new Set(['all', 'thaw', 'side', 'short']);
  for (const d of req.dinners) {
    assert.ok(d.id && d.title, d.id);
    assert.ok(READY.has(d.ready), `${d.id}: ${d.ready}`);
    assert.equal(typeof d.lean, 'boolean');
    if (d.ready === 'short') assert.ok(d.needs?.length, `${d.id} says what it needs`);
  }
  // Chicken is in the house (fresh enough to count), so a chicken dinner is ready or a thaw away.
  assert.ok(req.dinners.some((d) => d.protein === 'chicken' && (d.ready === 'all' || d.ready === 'thaw')));
  // The freezer list names the meat with the date it came home.
  const beef = req.freezer.find((f) => /ground beef/i.test(f.name));
  assert.ok(beef, JSON.stringify(req.freezer));
  assert.equal(beef.since, '2026-09-10');
  assert.equal(beef.qty, 3);
  // What they ate lately, inside the window, and the dinner carries it too.
  const cooked = state.plan['2026-11-13'].dinner;
  assert.deepEqual(req.recent.find((r) => r.id === cooked), { date: '2026-11-13', id: cooked });
  assert.equal(req.dinners.find((d) => d.id === cooked).lastAte, '2026-11-13');
  assert.ok(RECENT_DAYS >= 14);
  const old = smartPlanRequest(db, { ...state, plan: { ...state.plan, [addDays(TUE, -(RECENT_DAYS + 3))]: { dinner: cooked, status: 'cooked' } } }, opts);
  assert.equal(old.recent.filter((r) => r.id === cooked).length, 1, 'older than the window is left out');
  assert.equal(typeof req.budget.target, 'number');
  // Small enough to send every time (the Worker takes up to 200 KB).
  const size = JSON.stringify(req).length;
  assert.ok(size < 120_000, `${size} characters`);
  assert.ok(!/passcode|familyKey|"key"/i.test(JSON.stringify(req)), 'nothing private beyond the kitchen');
});

test('smartPlanOps: writes only the nights Claude may plan, with its reason; refuses the rest; one Undo', () => {
  const state = week();
  const box = rotationList(db, state).map((d) => d.id);
  const used = new Set(Object.values(state.plan).map((e) => e.dinner).filter(Boolean));
  const fresh = box.filter((id) => !used.has(id));
  const reply = {
    nights: [
      { date: TUE, dinner: fresh[0], why: 'Tonight is not Claude’s to change.' },
      { date: WED, dinner: fresh[0], why: 'They are out.' },
      { date: THU, dinner: fresh[0], why: 'Candi chose Thursday.' },
      { date: FRI, dinner: 'not-a-dinner', why: 'Not in the box.' },
      { date: FRI, dinner: state.plan[TUE].dinner, why: 'Tonight’s dinner again.' },
      { date: FRI, dinner: fresh[0], why: 'Uses the beef from September before it gets old.' },
      { date: SAT, dinner: fresh[0], why: 'The same dinner twice.' },
      { date: SAT, dinner: state.plan[SAT].dinner, why: 'Already the best fit\nfor Saturday.' },
      { date: SUN, dinner: fresh[1], why: 'Light and quick.' },
      { date: '2026-11-30', dinner: fresh[2], why: 'Outside the stretch.' },
    ],
    summary: 'Uses the old beef first and keeps the week light.',
  };
  const r = smartPlanOps(db, state, reply, { ...opts, at: AT, model: 'claude-opus-5-5' });
  assert.deepEqual(r.nights.map((n) => [n.date, n.dinner, n.changed]), [[FRI, fresh[0], true], [SAT, state.plan[SAT].dinner, false], [SUN, fresh[1], true]]);
  assert.equal(r.count, 2);
  assert.equal(r.kept, 1);
  const s = applyOps(state, r.ops);
  for (const d of [TUE, WED, THU]) assert.deepEqual(s.plan[d], state.plan[d], `${d} is exactly as it was`);
  assert.deepEqual(s.plan[FRI], { dinner: fresh[0], sides: [...dinnerById(db, state, fresh[0]).sides], status: 'planned', manual: false, by: 'Claude', at: AT, why: 'Uses the beef from September before it gets old.' });
  assert.equal(s.plan[SAT].dinner, state.plan[SAT].dinner);
  assert.equal(s.plan[SAT].why, 'Already the best fit for Saturday.', 'a kept night only gains the reason');
  assert.equal(s.plan[SAT].by, state.plan[SAT].by);
  assert.equal(s.plan[SUN].why, 'Light and quick.');
  // Monday wasn't in Claude's answer: it stays as the planner had it.
  assert.deepEqual(s.plan[MON], state.plan[MON]);
  assert.equal(s.plan['2026-11-30'], undefined);
  // The result card's record.
  assert.equal(s.planAhead.start, TUE);
  assert.equal(s.planAhead.end, MON);
  assert.equal(s.planAhead.by, 'Claude');
  assert.equal(s.planAhead.changed, 2);
  assert.equal(s.planAhead.claude.summary, reply.summary);
  assert.equal(s.planAhead.claude.model, 'claude-opus-5-5');
  assert.deepEqual(s.planAhead.claude.nights.map((n) => n.date), [FRI, SAT, SUN]);
  assert.ok(s.planAhead.before && typeof s.planAhead.before.groceries === 'number');
  assert.match(r.message, /^Claude planned 2 dinners and kept 1 through Monday, Nov 23\.$/);
  // One Undo puts the week back, record and all.
  assert.deepEqual(applyOps(s, r.undo), state);
});

test('smartPlanOps: a night Claude skipped is planned the quick way, never left empty', () => {
  const state = week();
  const used = new Set(Object.values(state.plan).map((e) => e.dinner).filter(Boolean));
  const fresh = rotationList(db, state).map((d) => d.id).filter((id) => !used.has(id));
  const r = smartPlanOps(db, state, { nights: [{ date: SUN, dinner: fresh[0], why: 'Quick.' }] }, { ...opts, at: AT, fillWho: 'Jeff' });
  const s = applyOps(state, r.ops);
  assert.equal(r.filled, 1);
  assert.ok(s.plan[FRI]?.dinner, 'Friday was open; it has a dinner now');
  assert.equal(s.plan[FRI].by, 'Jeff');
  assert.equal(s.plan[FRI].why, undefined, 'no reason Claude didn’t give');
  assert.notEqual(s.plan[FRI].dinner, fresh[0], 'and never a dinner Claude used');
  assert.equal(s.planAhead.claude.filled, 1);
  assert.match(r.message, /One more night was planned the quick way\.$/);
  assert.deepEqual(applyOps(s, r.undo), state);
});

test('smartPlanOps: an answer with nothing usable changes nothing and saves no card', () => {
  const state = week();
  for (const reply of [null, {}, { nights: 'x' }, { nights: [{ date: TUE, dinner: state.plan[SAT].dinner }] }]) {
    const r = smartPlanOps(db, state, reply, { ...opts, at: AT });
    assert.equal(r.ops.length, 0, JSON.stringify(reply));
    assert.equal(r.message, 'Claude didn’t find anything to change. The plan stays as it is.');
  }
});

test('smartPlanOps checks against the plan as it is now: a night the family filled while Claude thought stays theirs', () => {
  const state = week();
  const used = new Set(Object.values(state.plan).map((e) => e.dinner).filter(Boolean));
  const fresh = rotationList(db, state).map((d) => d.id).filter((id) => !used.has(id));
  const reply = { nights: [{ date: FRI, dinner: fresh[0], why: 'Uses the beef.' }, { date: SUN, dinner: fresh[1], why: 'Light.' }] };
  const meanwhile = applyOps(state, [{ op: 'set', path: ['plan', FRI], value: { dinner: fresh[2], sides: [], status: 'planned', manual: true, by: 'Candi', at: 'x' } }]);
  const r = smartPlanOps(db, meanwhile, reply, { ...opts, at: AT });
  const s = applyOps(meanwhile, r.ops);
  assert.equal(s.plan[FRI].dinner, fresh[2]);
  assert.equal(s.plan[FRI].by, 'Candi');
  assert.equal(s.plan[SUN].dinner, fresh[1]);
});

test('smartPlanHasWork and cleanWhy', () => {
  const state = week();
  assert.equal(smartPlanHasWork(db, state, opts), true);
  // Only tonight in the stretch: nothing for Claude to do.
  assert.equal(smartPlanHasWork(db, state, { ...opts, end: TUE }), false);
  // Everything kept: every night chosen by the family or away.
  const all = { ...state, plan: Object.fromEntries(datesBetween(TUE, MON).map((d) => [d, { dinner: rotationList(db, state)[0].id, status: 'planned', manual: true }])) };
  assert.equal(smartPlanHasWork(db, all, opts), false);
  assert.equal(smartPlanHasWork(db, all, { ...opts, family: true }), true, 'unless Claude may rethink the family’s picks');
  // A family pick Claude rethinks is written like any other night it plans, and Undo puts it back.
  const used = new Set(Object.values(state.plan).map((e) => e.dinner).filter(Boolean));
  const fresh = rotationList(db, state).map((d) => d.id).filter((id) => !used.has(id));
  const r = smartPlanOps(db, state, { nights: [{ date: THU, dinner: fresh[0], why: 'Uses the beef.' }] }, { ...opts, family: true, at: AT });
  const s2 = applyOps(state, r.ops);
  assert.equal(s2.plan[THU].dinner, fresh[0]);
  assert.equal(s2.plan[THU].by, 'Claude');
  assert.equal(s2.planAhead.family, true);
  assert.deepEqual(applyOps(s2, r.undo), state);
  const no = smartPlanOps(db, state, { nights: [{ date: THU, dinner: fresh[0], why: 'Uses the beef.' }] }, { ...opts, at: AT });
  assert.equal(applyOps(state, no.ops).plan[THU].dinner, state.plan[THU].dinner, 'not without asking');
  assert.equal(cleanWhy('  Uses the\u0007 beef.\n\nCheap. '), 'Uses the beef. Cheap.');
  assert.equal(cleanWhy(42), '');
  const long = cleanWhy('word '.repeat(60));
  assert.ok(long.length <= WHY_MAX && long.endsWith('…'), long);
});
