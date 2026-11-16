// One shared profile (docs/spec/20): the family's one signal per dinner and side, lunches for
// whoever packs, the first-open screen, and every calendar day in Chicago time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT, realDb, tinyDb } from './helpers.mjs';
import { applyOps, Store, makeStorage, normalizeDevice } from '../app/state.js';
import {
  todayISO, chicagoDay, chicagoMonth, byLabel, cleanName, SHARED_PROFILE, dateRange, addDays,
} from '../app/util.js';
import {
  dinnerSignal, sideSignal, signalOfVotes, votesForSignal, voteInfo, sideVoteInfo, isFavorite, isRetired, isSideDropped,
  downVoters, rotationList, generatePlan, dinnerById, FAVORITE_UPS,
} from '../app/planner.js';
import {
  voteOps, rateDinnerOps, sideVoteOps, rateSideOps, restoreOps, restoreSideOps, retireOps, lunchVoteOps,
  setPantryOps, doneShoppingOps, markCookedOps, addLunchPersonOps, pauseLunchPersonOps, removeLunchPersonOps,
  setLunchEnabledOps, setLunchIdeasOps, toggleLunchItemOps, addReceiptOps,
} from '../app/actions.js';
import {
  lunchPackers, packingNames, defaultPackers, isPacker, newPackerName, personConfig, lunchesIn, lunchNeeds, lunchFor,
  lunchPeople, lunchSwapsFor, lunchLibrary,
} from '../app/lunch.js';
import { buildList } from '../app/shopping.js';
import { importReceipt, receiptPantryOps } from '../app/receipts.js';
import { sinceOf } from '../app/freshness.js';
import { pantryStretch } from '../app/planahead.js';
import * as onboarding from '../app/views/onboarding.js';
import { passcodeForm } from '../app/views/family.js';

const run = (state, res) => applyOps(state, res.ops);
const memStorage = () => makeStorage({ getItem: () => null, setItem() {}, removeItem() {} });

// ---------------------------------------------------------------- dates in Chicago time

test('chicagoDay: the family’s calendar day, not the UTC one', () => {
  // 6:30 pm Central on Nov 15 is already Nov 16 in UTC. This is the bug: it must stay Nov 15.
  assert.equal(chicagoDay('2026-11-16T00:30:00.000Z'), '2026-11-15');
  assert.equal(chicagoDay(new Date('2026-11-16T00:30:00.000Z')), '2026-11-15');
  assert.equal(chicagoDay(Date.parse('2026-11-16T00:30:00.000Z')), '2026-11-15');
  // Around midnight UTC, winter (CST = UTC−6): the day turns at 06:00Z.
  assert.equal(chicagoDay('2026-11-15T23:59:59Z'), '2026-11-15');
  assert.equal(chicagoDay('2026-11-16T00:00:00Z'), '2026-11-15');
  assert.equal(chicagoDay('2026-11-16T05:59:59Z'), '2026-11-15');
  assert.equal(chicagoDay('2026-11-16T06:00:00Z'), '2026-11-16');
  // Summer (CDT = UTC−5): the day turns at 05:00Z.
  assert.equal(chicagoDay('2026-07-05T00:00:00Z'), '2026-07-04');
  assert.equal(chicagoDay('2026-07-05T04:59:59Z'), '2026-07-04');
  assert.equal(chicagoDay('2026-07-05T05:00:00Z'), '2026-07-05');
  // A plain day is already a calendar day; a timestamp with its own offset is still a moment.
  assert.equal(chicagoDay('2026-11-15'), '2026-11-15');
  assert.equal(chicagoDay('2026-11-15T23:30:00-06:00'), '2026-11-15');
  assert.equal(chicagoDay('2026-11-16T07:30:00+09:00'), '2026-11-15', 'a phone travelling in Tokyo still dates things in Glen Ellyn');
  // Unreadable input never throws or returns "Invalid Date".
  assert.match(chicagoDay('not a date'), /^\d{4}-\d{2}-\d{2}$/);
  assert.match(chicagoDay(null), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(chicagoDay(), todayISO());
});

test('chicagoDay across daylight-saving changes (2026: Mar 8 forward, Nov 1 back)', () => {
  // Spring forward: 2:00 CST → 3:00 CDT at 08:00Z on Mar 8.
  assert.equal(chicagoDay('2026-03-08T05:59:59Z'), '2026-03-07', '11:59 pm CST the night before');
  assert.equal(chicagoDay('2026-03-08T06:00:00Z'), '2026-03-08', 'midnight CST');
  assert.equal(chicagoDay('2026-03-08T07:59:59Z'), '2026-03-08');
  assert.equal(chicagoDay('2026-03-08T08:00:00Z'), '2026-03-08', '3:00 am CDT');
  assert.equal(chicagoDay('2026-03-09T04:59:59Z'), '2026-03-08', '11:59 pm CDT: the day is 23 hours long');
  assert.equal(chicagoDay('2026-03-09T05:00:00Z'), '2026-03-09');
  // Fall back: 2:00 CDT → 1:00 CST at 07:00Z on Nov 1.
  assert.equal(chicagoDay('2026-11-01T04:59:59Z'), '2026-10-31', 'Halloween, 11:59 pm CDT');
  assert.equal(chicagoDay('2026-11-01T05:00:00Z'), '2026-11-01');
  assert.equal(chicagoDay('2026-11-01T06:30:00Z'), '2026-11-01', '1:30 am, the first time');
  assert.equal(chicagoDay('2026-11-01T07:30:00Z'), '2026-11-01', '1:30 am, the second time');
  assert.equal(chicagoDay('2026-11-02T05:59:59Z'), '2026-11-01', '11:59 pm CST: the day is 25 hours long');
  assert.equal(chicagoDay('2026-11-02T06:00:00Z'), '2026-11-02');
  // Every hour of both long weekends lands on a real, consecutive day (no skipped or repeated date).
  for (const start of ['2026-03-07T06:00:00Z', '2026-10-31T05:00:00Z']) {
    const seen = [];
    for (let h = 0; h < 72; h++) {
      const d = chicagoDay(Date.parse(start) + h * 3600_000);
      if (seen[seen.length - 1] !== d) seen.push(d);
    }
    for (let i = 1; i < seen.length; i++) assert.equal(seen[i], addDays(seen[i - 1], 1));
  }
});

test('chicagoMonth and year ends: New Year’s Eve dinner is still December', () => {
  assert.equal(chicagoDay('2027-01-01T03:00:00Z'), '2026-12-31');
  assert.equal(chicagoMonth('2027-01-01T03:00:00Z'), '2026-12');
  assert.equal(chicagoMonth('2027-01-01T06:00:00Z'), '2027-01');
  assert.equal(chicagoMonth('2026-12-01T05:59:00Z'), '2026-11', 'the budget month turns over at midnight in Glen Ellyn');
  assert.equal(chicagoDay('2028-03-01T05:30:00Z'), '2028-02-29', 'leap day');
});

test('an evening shop, pantry edit, receipt and cooked night are dated today in Glen Ellyn', () => {
  const db = tinyDb();
  const evening = '2026-11-16T01:15:00.000Z'; // 7:15 pm Central on Sunday Nov 15
  // Pantry: "came home" date.
  let s = run({}, setPantryOps(db, {}, { id: 'chicken', qty: 4, at: evening }));
  assert.equal(s.pantry.chicken.since, '2026-11-15');
  assert.equal(s.pantry.chicken.at, evening, 'the timestamp itself is untouched');
  // Done shopping: since and bought.on.
  const list = { listKey: 'k', items: [{ id: 'beef', key: 'beef', checked: true, kind: 'measured', packsToBuy: 1, pack: { size: 10 }, need: 2 }] };
  const done = doneShoppingOps(db, {}, { list, at: evening });
  for (const op of done.ops.filter((o) => o.path[0] === 'pantry')) {
    assert.equal(op.value.since, '2026-11-15');
    if (op.value.bought) assert.equal(op.value.bought.on, '2026-11-15');
  }
  // A receipt with no readable date falls back to today, the family's today.
  const ops = importReceipt({}, { store: 'jewel', total: 12.34, lines: [{ raw: 'BREAD', product: 'Bread', price: 3.5, qty: 1 }] }, { db, at: evening });
  assert.equal(ops.date, '2026-11-15');
  // Receipt → pantry when the saved receipt has no date.
  const logState = { receiptLog: { r1: { store: 'sams', lines: [{ matchId: 'chicken', qty: 1, packSize: 10, price: 30, product: 'Chicken' }] } } };
  for (const op of receiptPantryOps(db, logState, 'r1', { at: evening }).filter((o) => o.path[0] === 'pantry')) assert.equal(op.value.since, '2026-11-15');
});

test('use-it-first reads the real day off entries saved with the old UTC date (nothing rewritten)', () => {
  // Saved by an older version at 7:15 pm Central: `since` was cut from the UTC stamp, a day late.
  assert.equal(sinceOf({ qty: 2, since: '2026-11-16', at: '2026-11-16T01:15:00.000Z' }), '2026-11-15');
  // Daytime saves were always right.
  assert.equal(sinceOf({ qty: 2, since: '2026-11-16', at: '2026-11-16T18:00:00.000Z' }), '2026-11-16');
  // A `since` from a receipt date, or kept from an earlier trip, is left alone.
  assert.equal(sinceOf({ qty: 2, since: '2026-11-10', at: '2026-11-16T01:15:00.000Z' }), '2026-11-10');
  // No `since`: the date isn't known (docs/spec/21 §21.3). The last time the amount was edited is
  // not the day it came home, so the stamp never stands in for one; the pantry asks instead.
  assert.equal(sinceOf({ qty: 2, at: '2026-11-16T01:15:00.000Z' }), null);
  assert.equal(sinceOf({ qty: 2 }), null);
  assert.equal(sinceOf({ qty: 2, at: 'garbage' }), null);
});

test('no app code derives a calendar day from the UTC timestamp', () => {
  const files = [
    ...readdirSync(path.join(ROOT, 'app')).filter((f) => f.endsWith('.js')).map((f) => `app/${f}`),
    ...readdirSync(path.join(ROOT, 'app/views')).filter((f) => f.endsWith('.js')).map((f) => `app/views/${f}`),
    'dev/mock-api.mjs', 'sw.js',
  ];
  const bad = [];
  for (const f of files) {
    readFileSync(path.join(ROOT, f), 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return; // a comment explaining the rule
      // toISOString().slice(0, 10 | 7), or slicing a day off a timestamp variable (now / at / *.at).
      const utcDay = /toISOString\(\)\s*\.(slice|substring|substr)\(0,\s*(10|7)\)/.test(line)
        || /\b(now|at|stamp|when)\.(slice|substring|substr)\(0,\s*(10|7)\)/.test(line)
        || /\.at\.(slice|substring|substr)\(0,\s*(10|7)\)/.test(line)
        || /\.split\(['"]T['"]\)\[0\]/.test(line);
      // The one allowed spot: util.js fromDate(), which only ever sees UTC-midnight dates from toDate().
      if (utcDay && !(f === 'app/util.js' && /return d\.toISOString\(\)\.slice\(0, 10\);/.test(line))) bad.push(`${f}:${i + 1}: ${line.trim()}`);
      if (/\.(getDate|getDay|getMonth|getFullYear|getHours)\(\)/.test(line)) bad.push(`${f}:${i + 1}: device-local date part: ${line.trim()}`);
    });
  }
  assert.deepEqual(bad, [], 'use chicagoDay() / todayISO() from app/util.js');
});

// ---------------------------------------------------------------- the family's signal

test('votes saved by each person are read as one family voice, with nothing rewritten', () => {
  const db = tinyDb();
  const d = (id) => dinnerById(db, {}, id);
  const old = {
    votes: {
      'chix-pasta': { Jeff: 1, Candi: 1 },            // two ups: a favorite before, loved now
      'chix-grill': { Knox: 1 },                       // one up: someone told the app they like it → loved
      'beef-bowl': { Jeff: 1, Candi: 1, Jackson: -1 }, // any thumbs-down already dropped it
      burger: {},                                      // a vote that was taken back leaves an empty record
    },
    sideVotes: { broc: { Jordan: -1 }, beans: { Jeff: 1 } },
  };
  const snapshot = JSON.stringify(old);
  assert.equal(dinnerSignal(old, d('chix-pasta')), 'loved');
  assert.equal(dinnerSignal(old, d('chix-grill')), 'loved');
  assert.equal(dinnerSignal(old, d('beef-bowl')), 'no');
  assert.equal(dinnerSignal(old, d('burger')), 'fine');
  assert.equal(dinnerSignal(old, d('naan-chicken')), 'fine');
  assert.ok(isFavorite(old, d('chix-pasta')) && isFavorite(old, d('chix-grill')));
  assert.ok(isRetired(old, 'beef-bowl') && !isFavorite(old, d('beef-bowl')));
  assert.equal(sideSignal(old, 'broc'), 'no');
  assert.ok(isSideDropped(old, 'broc'));
  assert.equal(sideSignal(old, 'beans'), 'loved');
  assert.equal(sideSignal(old, 'fries'), 'fine');
  // The numbers the planner scores with are one voice: never 2 or 3 "ups".
  assert.deepEqual([voteInfo(old, 'chix-pasta').up, voteInfo(old, 'chix-pasta').down], [1, 0]);
  assert.deepEqual([voteInfo(old, 'beef-bowl').up, voteInfo(old, 'beef-bowl').down], [0, 1]);
  assert.equal(sideVoteInfo(old, 'beans').up, 1);
  assert.equal(FAVORITE_UPS, 1);
  assert.deepEqual(downVoters(old, 'beef-bowl'), [], 'nobody is named any more');
  assert.equal(JSON.stringify(old), snapshot, 'reading converts nothing in place');
});

test('setting the signal replaces the old per-person record whole, so old votes can’t outvote the family', () => {
  const db = tinyDb();
  let s = { votes: { 'beef-bowl': { Jeff: 1, Candi: 1, Jackson: -1 } } };
  // The family taps the pressed thumbs-down: back to fine, and Jeff's and Candi's old ups don't make it "loved".
  const back = voteOps(db, s, { dinnerId: 'beef-bowl', value: -1, today: '2026-11-16' });
  assert.equal(back.restored, true);
  s = run(s, back);
  assert.equal(s.votes['beef-bowl'], undefined);
  assert.equal(dinnerSignal(s, dinnerById(db, s, 'beef-bowl')), 'fine');
  // Loved, then not for us, then fine again, each a whole-record write.
  s = run(s, rateDinnerOps(db, s, { dinnerId: 'beef-bowl', signal: 'loved' }));
  assert.deepEqual(s.votes['beef-bowl'], { Family: 1 });
  const no = rateDinnerOps(db, s, { dinnerId: 'beef-bowl', signal: 'no', at: '2026-11-16T12:00:00Z', today: '2026-11-16' });
  s = run(s, no);
  assert.deepEqual(s.votes['beef-bowl'], { Family: -1 });
  assert.equal(s.retired['beef-bowl'].by, SHARED_PROFILE);
  assert.equal(no.promoted, 'bench-beef');
  assert.equal(rateDinnerOps(db, s, { dinnerId: 'beef-bowl', signal: 'no' }).ops.length, 0, 'already there: nothing to do');
  const loved = rateDinnerOps(db, s, { dinnerId: 'beef-bowl', signal: 'loved' });
  assert.match(loved.message, /back on the menu, as a family favorite/);
  s = run(s, loved);
  assert.ok(!s.retired['beef-bowl'] && isFavorite(s, dinnerById(db, s, 'beef-bowl')));
  assert.ok(rotationList(db, s).some((x) => x.id === 'bench-beef'), 'the dinner that came in stays');
  // Undo of any change puts the exact old record back.
  const before = { votes: { 'chix-grill': { Knox: 1, Jordan: 1 } } };
  const r = rateDinnerOps(db, before, { dinnerId: 'chix-grill', signal: 'no', today: '2026-11-16' });
  assert.deepEqual(applyOps(run(before, r), r.undo).votes, before.votes);
  assert.ok(rateDinnerOps(db, {}, { dinnerId: 'chix-grill', signal: 'meh' }).error);
  assert.ok(rateDinnerOps(db, {}, { dinnerId: 'nope', signal: 'loved' }).error);
});

test('retire is “not for us”, and restore is a fresh start', () => {
  const db = tinyDb();
  let s = run({}, retireOps(db, {}, { dinnerId: 'chix-pasta', today: '2026-11-16' }));
  assert.equal(dinnerSignal(s, dinnerById(db, s, 'chix-pasta')), 'no');
  assert.deepEqual(s.votes['chix-pasta'], { Family: -1 });
  assert.match(retireOps(db, s, { dinnerId: 'chix-pasta' }).message, /Already out/);
  s = run(s, restoreOps(db, s, { dinnerId: 'chix-pasta' }));
  assert.equal(dinnerSignal(s, dinnerById(db, s, 'chix-pasta')), 'fine');
  assert.equal(s.votes['chix-pasta'], undefined);
  // An old manual retire (no votes at all) reads as "not for us" too, and the thumbs can take it back.
  const old = { retired: { 'chix-grill': { by: 'Candi', at: 'x', manual: true } } };
  assert.equal(dinnerSignal(old, dinnerById(db, old, 'chix-grill')), 'no');
  const back = voteOps(db, old, { dinnerId: 'chix-grill', value: -1 });
  assert.ok(!isRetired(run(old, back), 'chix-grill'));
});

test('the recipe box’s own “family favorite” tag starts as loved, and the family can still say “fine”', () => {
  const db = tinyDb();
  const fav = { ...db.dinners['chix-pasta'], tags: ['family favorite'] };
  db.dinners['chix-pasta'] = fav;
  db.dinnerList[db.dinnerList.findIndex((x) => x.id === 'chix-pasta')] = fav;
  assert.equal(dinnerSignal({}, fav), 'loved');
  // Tapping the pressed thumbs-up has to do something: an explicit "fine" is saved.
  const off = voteOps(db, {}, { dinnerId: 'chix-pasta', value: 1 });
  let s = run({}, off);
  assert.deepEqual(s.votes['chix-pasta'], { Family: 0 });
  assert.equal(dinnerSignal(s, fav), 'fine');
  assert.ok(!isFavorite(s, fav));
  s = run(s, voteOps(db, s, { dinnerId: 'chix-pasta', value: 1 }));
  assert.ok(isFavorite(s, fav));
  assert.deepEqual(votesForSignal('fine'), null);
  assert.equal(signalOfVotes({ Family: 0 }), 'fine');
});

test('the planner still uses the signal: loved is planned more, “not for us” never', () => {
  const db = realDb();
  const dates = dateRange('2026-11-16', 28);
  const count = (state, id) => Object.values(generatePlan({ db, state, dates, today: '2026-11-16' }).entries).filter((e) => e.dinner === id).length;
  const rot = rotationList(db, {}).filter((d) => !d.tags.includes('burger') && !d.tags.includes('pizza') && !d.tags.includes('family favorite'));
  // Mark five ordinary dinners loved: together they show up at least as often as before, and none drops out.
  const picks = rot.slice(0, 5).map((d) => d.id);
  const loved = picks.reduce((s, id) => run(s, rateDinnerOps(db, s, { dinnerId: id, signal: 'loved' })), {});
  const before = picks.reduce((t, id) => t + count({}, id), 0);
  const after = picks.reduce((t, id) => t + count(loved, id), 0);
  assert.ok(after >= before, `loved dinners are planned at least as often (${before} → ${after})`);
  assert.ok(after > 0);
  // And one marked "not for us" is never planned.
  const no = run({}, rateDinnerOps(db, {}, { dinnerId: picks[0], signal: 'no', today: '2026-11-16' }));
  assert.equal(count(no, picks[0]), 0);
});

test('sides: one signal, a whole-record write, and Restore puts it back as fine', () => {
  const db = tinyDb();
  let s = { sideVotes: { broc: { Jeff: 1, Knox: -1 } } };
  assert.equal(sideSignal(s, 'broc'), 'no');
  s = run(s, sideVoteOps(db, s, { sideId: 'broc', value: -1 }));
  assert.equal(s.sideVotes.broc, undefined, 'back to fine: Jeff’s old thumbs-up doesn’t turn it into loved');
  const up = sideVoteOps(db, s, { sideId: 'broc', value: 1 });
  assert.match(up.message, /favorite side/);
  s = run(s, up);
  assert.deepEqual(s.sideVotes.broc, { Family: 1 });
  const no = rateSideOps(db, s, { sideId: 'broc', signal: 'no' });
  assert.equal(no.dropped, true);
  s = run(s, no);
  assert.ok(isSideDropped(s, 'broc'));
  s = run(s, restoreSideOps(db, s, { sideId: 'broc' }));
  assert.equal(sideSignal(s, 'broc'), 'fine');
  assert.match(restoreSideOps(db, s, { sideId: 'broc' }).message, /already on the menu/);
  assert.ok(sideVoteOps(db, s, { sideId: 'nope', value: 1 }).error);
});

// ---------------------------------------------------------------- lunches for whoever packs

const ldb = realDb();
const WEEK = dateRange('2026-11-16', 7);
const idsFor = (slot, n = 1) => lunchLibrary(ldb, {}, slot).slice(0, n).map((x) => x.id);

test('lunches are planned for Jeff and Knox by default, and nobody else’s groceries are bought', () => {
  assert.deepEqual(defaultPackers(ldb).sort(), ['Jeff', 'Knox']);
  assert.deepEqual(lunchPackers(ldb, {}).map((p) => p.name), ['Jeff', 'Knox']);
  assert.deepEqual(packingNames(ldb, {}), ['Jeff', 'Knox']);
  assert.deepEqual(lunchPeople(ldb, {}).map((p) => p.name), ['Jeff', 'Knox'], 'the older name gives the same list');
  const who = new Set(lunchesIn(ldb, {}, WEEK).map((l) => l.name));
  assert.deepEqual([...who].sort(), ['Jeff', 'Knox']);
  const { uses } = lunchNeeds(ldb, {}, WEEK);
  for (const list of Object.values(uses)) for (const u of list) assert.ok(['Jeff', 'Knox'].includes(u.person), `${u.person} is not being bought for`);
  // An old "off" record from the days of five profiles lists nobody and buys nothing.
  const off = { lunch: { people: { Candi: { enabled: false }, Jordan: { enabled: false, slots: { main: idsFor('main') } } } } };
  assert.deepEqual(lunchPackers(ldb, off).map((p) => p.name), ['Jeff', 'Knox']);
  assert.deepEqual(lunchNeeds(ldb, off, WEEK).needs, lunchNeeds(ldb, {}, WEEK).needs);
});

test('existing lunch data keeps working: someone already switched on is listed, never bought for silently', () => {
  const old = { lunch: { people: { Candi: { enabled: true, slots: { main: idsFor('main'), drink: idsFor('drink') } }, Knox: { enabled: false } } } };
  const people = lunchPackers(ldb, old);
  assert.deepEqual(people.map((p) => [p.name, p.paused]), [['Jeff', false], ['Candi', false], ['Knox', true]]);
  assert.deepEqual(packingNames(ldb, old), ['Jeff', 'Candi']);
  assert.ok(lunchesIn(ldb, old, WEEK).some((l) => l.name === 'Candi'));
  assert.ok(!lunchesIn(ldb, old, WEEK).some((l) => l.name === 'Knox'), 'Knox was switched off in the old editor: paused, and listed so it can be resumed');
  // Everyone whose groceries are bought is on the page.
  const bought = new Set(lunchesIn(ldb, old, WEEK).map((l) => l.name));
  for (const name of bought) assert.ok(people.some((p) => p.name === name && !p.paused));
  // Garbage in the saved data is ignored.
  assert.deepEqual(lunchPackers(ldb, { lunch: { people: { '<b>': { enabled: true }, x: null, Jeff: 'yes' } } }).map((p) => p.name), ['Jeff', 'Knox']);
});

test('add a person: name, days, the spots they pack and their items; the shopping list follows', () => {
  const main = idsFor('main', 2);
  const drink = idsFor('drink');
  const side = idsFor('side');
  const res = addLunchPersonOps(ldb, {}, { name: '  candi ', days: [1, 3, 5], slots: { main, drink, snack: side /* wrong spot: dropped */ }, at: '2026-11-16T01:15:00.000Z' });
  assert.equal(res.name, 'Candi', 'a name the app already knows keeps its capitals');
  assert.equal(res.count, 3);
  assert.match(res.message, /Candi’s lunches are planned/);
  const s = run({}, res);
  assert.deepEqual(s.lunch.people.Candi, { enabled: true, added: '2026-11-15', days: [1, 3, 5], slots: { main, side: [], snack: [], drink } });
  assert.deepEqual(packingNames(ldb, s), ['Jeff', 'Candi', 'Knox']);
  const hers = lunchesIn(ldb, s, WEEK).filter((l) => l.name === 'Candi');
  assert.deepEqual(hers.map((l) => l.date), ['2026-11-16', '2026-11-18', '2026-11-20']);
  assert.ok(hers.every((l) => l.slots.every((x) => ['main', 'drink'].includes(x.slot))), 'only the spots she packs');
  // The shopping list and its lunch cost follow.
  const opts = { dates: WEEK };
  const base = buildList(ldb, {}, opts);
  const more = buildList(ldb, s, opts);
  assert.equal(more.lunches.length, base.lunches.length + 3);
  assert.ok(more.lunchCost > base.lunchCost, 'her lunch groceries are on the list');
  assert.ok(more.items.some((i) => i.lunchUses.some((u) => u.person === 'Candi')));
  // Pantry math follows too: the "how far does the pantry stretch" count includes her lunches.
  const span = { start: '2026-11-16', end: '2026-11-22' };
  assert.equal(pantryStretch(ldb, s, span).lunches, pantryStretch(ldb, {}, span).lunches + 3);
  // Someone new entirely, with nothing picked yet.
  const g = addLunchPersonOps(ldb, s, { name: 'Grandma Jo', slots: {} });
  assert.equal(g.count, 0);
  assert.match(g.message, /Pick what goes in/);
  const s2 = run(s, g);
  assert.deepEqual(lunchPackers(ldb, s2).map((p) => p.name), ['Jeff', 'Candi', 'Knox', 'Grandma Jo']);
  assert.equal(lunchesIn(ldb, s2, WEEK).filter((l) => l.name === 'Grandma Jo').length, 0, 'nothing picked, nothing bought');
  assert.equal(personConfig(ldb, s2, 'Grandma Jo').ideas, false, 'no lighter-swap nudges unless the family asks');
  assert.equal(personConfig(ldb, s2, 'Jeff').ideas, true);
  // Undo removes her again.
  assert.deepEqual(applyOps(s2, g.undo), s);
});

test('adding a person: names are checked, and nothing strange can be saved', () => {
  assert.match(addLunchPersonOps(ldb, {}, { name: 'jeff' }).message, /Jeff already packs a lunch/);
  assert.match(addLunchPersonOps(ldb, {}, { name: '   ' }).message, /Type a name/);
  assert.equal(addLunchPersonOps(ldb, {}, { name: '__proto__' }).name, 'proto', 'punctuation that could confuse the saved data is dropped');
  assert.ok(addLunchPersonOps(ldb, {}, { name: 'constructor' }).error);
  assert.equal(addLunchPersonOps(ldb, {}, { name: '<script>' }).name, 'script');
  assert.match(addLunchPersonOps(ldb, {}, { name: 'Sam', days: [] }).message, /at least one day/);
  assert.equal(cleanName('  grandma   jo<> '), 'grandma jo');
  assert.equal(cleanName('O’Neil-Smith Jr.'), 'O’Neil-Smith Jr.');
  assert.equal(cleanName('x'.repeat(60)).length, 24);
  assert.equal(cleanName('constructor'), '');
  const paused = run({}, pauseLunchPersonOps(ldb, {}, { name: 'Knox' }));
  assert.match(newPackerName(ldb, paused, 'KNOX').error, /paused\. Resume/);
  assert.ok(!isPacker(ldb, {}, 'Candi') && isPacker(ldb, {}, 'Knox'));
});

test('pause keeps the picks and stops the groceries; resume brings them back; remove forgets', () => {
  const custom = idsFor('snack');
  let s = run({}, toggleLunchItemOps(ldb, {}, { name: 'Knox', slot: 'snack', id: custom[0] }));
  const knoxSnacks = personConfig(ldb, s, 'Knox').slots.snack;
  const base = buildList(ldb, s, { dates: WEEK });
  // Pause.
  const p = pauseLunchPersonOps(ldb, s, { name: 'Knox' });
  assert.match(p.message, /paused/);
  s = run(s, p);
  assert.deepEqual(lunchPackers(ldb, s).map((x) => [x.name, x.paused]), [['Jeff', false], ['Knox', true]]);
  assert.equal(lunchFor(ldb, s, 'Knox', '2026-11-16'), null);
  const paused = buildList(ldb, s, { dates: WEEK });
  assert.ok(paused.lunches.every((l) => l.name === 'Jeff'));
  assert.ok(paused.lunchCost < base.lunchCost, 'his groceries are off the list');
  assert.deepEqual(personConfig(ldb, s, 'Knox').slots.snack, knoxSnacks, 'the picks are kept');
  // The editor's switch is the same thing.
  assert.deepEqual(setLunchEnabledOps(ldb, run({}, toggleLunchItemOps(ldb, {}, { name: 'Knox', slot: 'snack', id: custom[0] })), { name: 'Knox', enabled: false }).ops, p.ops);
  // Resume.
  s = run(s, pauseLunchPersonOps(ldb, s, { name: 'Knox', paused: false }));
  assert.equal(s.lunch.people.Knox.paused, undefined);
  assert.equal(buildList(ldb, s, { dates: WEEK }).lunchCost, base.lunchCost);
  // Remove: gone from the page and the list, and the picks are forgotten.
  const r = removeLunchPersonOps(ldb, s, { name: 'Knox' });
  const gone = run(s, r);
  assert.deepEqual(lunchPackers(ldb, gone).map((x) => x.name), ['Jeff']);
  assert.deepEqual(packingNames(ldb, gone), ['Jeff']);
  assert.ok(buildList(ldb, gone, { dates: WEEK }).lunches.every((l) => l.name === 'Jeff'));
  assert.deepEqual(applyOps(gone, r.undo), s, 'Undo puts everything back');
  assert.ok(removeLunchPersonOps(ldb, gone, { name: 'Knox' }).error);
  assert.ok(pauseLunchPersonOps(ldb, gone, { name: 'Knox' }).error);
  // Removed, then added again: a clean start with what's picked now, not the old defaults.
  const again = run(gone, addLunchPersonOps(ldb, gone, { name: 'knox', slots: { drink: idsFor('drink') } }));
  const cfg = personConfig(ldb, again, 'Knox');
  assert.ok(cfg.enabled && !cfg.removed);
  assert.deepEqual([cfg.slots.main, cfg.slots.side, cfg.slots.snack, cfg.slots.drink], [[], [], [], idsFor('drink')]);
  // Removing both leaves nobody, and nothing bought.
  const none = run(gone, removeLunchPersonOps(ldb, gone, { name: 'Jeff' }));
  assert.deepEqual(lunchPackers(ldb, none), []);
  assert.equal(buildList(ldb, none, { dates: WEEK }).lunchCost, 0);
});

test('lunch thumbs belong to the person who packs; a thumbs-down left behind doesn’t hide a newly chosen item', () => {
  const id = idsFor('drink')[0];
  assert.ok(lunchVoteOps(ldb, {}, { itemId: id, person: 'Candi', value: -1 }).error, 'not a packer');
  let s = run({}, addLunchPersonOps(ldb, {}, { name: 'Candi', slots: { drink: [id] } }));
  s = run(s, lunchVoteOps(ldb, s, { itemId: id, person: 'Candi', value: -1 }));
  assert.ok(!personConfig(ldb, s, 'Candi').slots.drink.includes(id));
  s = run(s, removeLunchPersonOps(ldb, s, { name: 'Candi' }));
  s = run(s, addLunchPersonOps(ldb, s, { name: 'Candi', slots: { drink: [id] } }));
  assert.ok(personConfig(ldb, s, 'Candi').slots.drink.includes(id), 'picked again by hand: the old thumbs-down is cleared');
});

test('lighter-swap ideas: on for the grown-ups, off for a kid’s lunch unless the family switches them on', () => {
  assert.equal(personConfig(ldb, {}, 'Knox').ideas, false);
  assert.deepEqual(lunchSwapsFor(ldb, {}, 'Knox'), []);
  const on = run({}, setLunchIdeasOps(ldb, {}, { name: 'Jeff', on: false }));
  assert.deepEqual(lunchSwapsFor(ldb, on, 'Jeff'), []);
  assert.equal(personConfig(ldb, run(on, setLunchIdeasOps(ldb, on, { name: 'Jeff', on: true })), 'Jeff').ideas, true);
});

// ---------------------------------------------------------------- one shared profile: devices and stamps

test('a device has no “who”: old devices keep working, and every change syncs as the family', async () => {
  // A phone set up as "Candi's phone" before the shared profile: nothing to migrate.
  const old = normalizeDevice({ who: 'Candi', key: 'k'.repeat(64), clientId: 'c1', theme: 'dark', hideNutrition: true, dismissed: ['a'] });
  assert.equal(old.key, 'k'.repeat(64));
  assert.equal(old.theme, 'dark');
  assert.equal(old.hideNutrition, true);
  assert.equal(old.textSize, 'regular');
  assert.equal(normalizeDevice({ textSize: 'large' }).textSize, 'large');
  assert.equal(normalizeDevice(null).key, null);
  // Whatever the old device says about who it is, ops are sent as the family.
  const sent = [];
  const fetchFn = async (url, init) => {
    if (init?.body) sent.push(JSON.parse(init.body));
    const body = url.includes('/api/ops') ? { revision: 1, state: {} } : { revision: 1, unchanged: true };
    return { ok: true, status: 200, json: async () => body, headers: { get: () => null } };
  };
  const storage = memStorage();
  storage.set('bfdp.v2.device', { who: 'Candi', key: 'k'.repeat(64), clientId: 'c1' });
  const store = new Store({ storage, fetchFn, apiBase: 'http://x', autoSync: false });
  store.commit([{ op: 'set', path: ['plan', '2026-11-16'], value: { dinner: 'x' } }]);
  await store.sync();
  assert.equal(sent[0].by, 'Family');
  assert.equal(SHARED_PROFILE, 'Family');
});

test('joining: a wrong passcode never looks connected; changes made before joining can be left behind or sent', async () => {
  const { startMockApi } = await import('../dev/mock-api.mjs');
  const api = await startMockApi({ port: 0, quiet: true, passcode: 'tacos' });
  const apiBase = `http://127.0.0.1:${api.server.address().port}`;
  const op = (date) => ({ op: 'set', path: ['plan', date], value: { dinner: 'local-pick', status: 'planned' } });
  try {
    api.db.state = { plan: { '2026-11-16': { dinner: 'family-pick', status: 'planned' } } };
    api.db.revision = 3;
    // Left behind.
    const a = new Store({ storage: memStorage(), apiBase, autoSync: false });
    a.commit([op('2026-11-16'), op('2026-11-17')]);
    let keyDuring = 'unset';
    const realApi = a.api.bind(a);
    a.api = async (...args) => { keyDuring = a.device.key; return realApi(...args); };
    await assert.rejects(() => a.enterPasscode('nope', { dropPending: true }), /doesn't match/);
    assert.equal(keyDuring, null, 'the key being tried is not stored while the server checks it');
    assert.equal(a.device.key, null);
    assert.equal(a.pending.length, 2, 'a wrong passcode drops nothing');
    await a.enterPasscode('Tacos', { dropPending: true });
    assert.equal(a.pending.length, 0);
    assert.equal(a.state.plan['2026-11-16'].dinner, 'family-pick');
    assert.equal(api.db.state.plan['2026-11-16'].dinner, 'family-pick', 'the family’s plan is untouched');
    assert.equal(api.db.state.plan['2026-11-17'], undefined);
    assert.equal(a.status, 'synced');
    // Sent along (what joining always did before).
    const b = new Store({ storage: memStorage(), apiBase, autoSync: false });
    b.commit([op('2026-11-18')]);
    await b.enterPasscode('tacos');
    assert.equal(b.pending.length, 0);
    assert.equal(api.db.state.plan['2026-11-18'].dinner, 'local-pick');
    assert.equal(api.db.state.plan['2026-11-16'].dinner, 'family-pick');
  } finally {
    api.server.close();
  }
});

test('old “by” stamps stay readable; the app’s own stamps are the family', () => {
  const db = tinyDb();
  const s = { plan: { '2026-11-16': { dinner: 'chix-grill', sides: ['broc', 'beans'], status: 'planned', by: 'Jeff', at: 'x' } }, pantry: { chicken: { qty: 5, by: 'Candi', at: '2026-11-10T18:00:00Z' } } };
  const cooked = run(s, markCookedOps(db, s, { date: '2026-11-16', today: '2026-11-16' }));
  assert.equal(cooked.plan['2026-11-16'].cookedBy, 'Family');
  assert.equal(cooked.plan['2026-11-16'].by, 'Jeff', 'what was saved before is left as it was');
  assert.equal(run({}, setPantryOps(db, {}, { id: 'beef', qty: 1 })).pantry.beef.by, 'Family');
  assert.equal(addReceiptOps({}, { date: '2026-11-16', store: 'jewel', amount: 10 }).ops[0].value.by, 'Family');
  // Something that isn't a person at a screen still stamps its own name.
  assert.equal(run({}, setPantryOps(db, {}, { id: 'beef', qty: 1, who: 'Jeff (Claude chat)' })).pantry.beef.by, 'Jeff (Claude chat)');
  // What a screen shows for a stamp: nothing for people or the family, the source when there is one.
  for (const by of ['Jeff', 'Candi', 'Knox', 'Jordan', 'Jackson', 'Family', 'votes', '', null, undefined]) assert.equal(byLabel(by), '');
  assert.equal(byLabel('Jeff (Claude chat)'), 'Claude chat');
  assert.equal(byLabel('import'), 'import');
});

// ---------------------------------------------------------------- first open

function fakeApp({ device = {}, status = 'offline', checked = false, ui = {} } = {}) {
  return { store: { device: normalizeDevice(device), status, checked, statusDetail: '' }, ui: { ...ui } };
}

test('first open: no “who’s using this phone”, just the passcode, on every device', () => {
  // A brand-new device: the screen shows from the first frame and says what it is doing.
  const fresh = fakeApp();
  assert.equal(onboarding.gateActive(fresh), true);
  assert.equal(onboarding.gateStep(fresh), 'checking');
  const looking = onboarding.render(fresh).s;
  assert.match(looking, /Looking for the family’s plan/);
  assert.match(looking, /There are no separate profiles/);
  assert.ok(!/who-pick|Who’s using/.test(looking));
  // The server answered: enter the passcode. One box; nothing asks who you are.
  const enter = onboarding.render(fakeApp({ status: 'needs-passcode', checked: true })).s;
  assert.match(enter, /Enter the family passcode/);
  assert.equal((enter.match(/<input /g) || []).length, 1, 'one field to type with a remote');
  assert.match(enter, /id="pc-enter"[^>]*type="password"|type="password"[^>]*id="pc-enter"/);
  assert.match(enter, /autocapitalize="none"/);
  assert.match(enter, /enterkeyhint="go"/);
  assert.match(enter, /Show the passcode/);
  assert.ok(!/who-pick|data-who=/.test(enter));
  // Nobody has made a passcode yet.
  assert.equal(onboarding.gateStep(fakeApp({ status: 'needs-setup', checked: true })), 'create');
  // Offline on first open: says so, and offers a way in.
  const offline = fakeApp({ status: 'offline', checked: true });
  assert.equal(onboarding.gateStep(offline), 'offline');
  const off = onboarding.render(offline).s;
  assert.match(off, /Can’t reach the family’s plan/);
  assert.match(off, /data-action="gate:retry"/);
  assert.match(off, /data-action="gate:later"/);
  assert.match(off, /data-action="gate:local"/);
  // A quiet retry in the background doesn't swap the screen; a tap on Try again does.
  assert.equal(onboarding.gateStep(fakeApp({ status: 'offline', checked: true, ui: { gateBusy: true } })), 'checking');
});

test('existing devices never see the first-open screen again, whoever they said they were', () => {
  assert.equal(onboarding.gateActive(fakeApp({ device: { who: 'Jeff', key: 'k'.repeat(64) } })), false);
  assert.equal(onboarding.gateActive(fakeApp({ device: { key: 'k'.repeat(64) } })), false, 'no “who” needed');
  assert.equal(onboarding.gateActive(fakeApp({ device: { who: 'Knox', localOnly: true } })), false);
  assert.equal(onboarding.gateActive(fakeApp({ device: { who: 'Jordan', dismissedGate: true } })), false);
});

test('a wrong passcode: the error is tied to the field, and showing the passcode drops “type it again”', () => {
  const wrong = { ui: { passErr: 'That passcode doesn’t match.' } };
  const html = passcodeForm(wrong, 'enter', { compact: true }).s;
  assert.match(html, /aria-invalid="true"/);
  assert.match(html, /aria-describedby="pc-err-enter"/);
  assert.match(html, /id="pc-err-enter" role="alert">That passcode doesn’t match\./);
  const hidden = passcodeForm({ ui: {} }, 'create').s;
  assert.match(hidden, /id="pc-again"/);
  const shown = passcodeForm({ ui: { passShow: true } }, 'create').s;
  assert.ok(!/id="pc-again"/.test(shown), 'you can see what you typed: no second field');
  assert.match(shown, /id="pc-new"[^>]*type="text"|type="text"[^>]*id="pc-new"/);
  assert.match(shown, /aria-pressed="true"/);
});
