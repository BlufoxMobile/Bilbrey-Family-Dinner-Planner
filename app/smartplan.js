// Plan with Claude (docs/spec/30). Jeff: "I would love for Claude to plan out each meal for me
// based on what I have, cost, and healthy eating", not the planner's weighted dice.
//
// smartPlanRequest() gathers what Claude needs to choose well, small enough to send every time:
// the nights to plan (and the ones it must leave alone), every dinner in the rotation with what
// the pantry says about it (all in, needs a thaw, short a side, or what's missing), its cost per
// serving, its plate (calories, protein, lean), what spoils soon, the freezer meat on hand, what
// the family ate lately, and the month's budget so far. The Worker (POST /api/plan) asks Claude and
// checks the answer against this list; smartPlanOps() checks it again here and writes the plan,
// one Undo for the lot, each night carrying Claude's one-line reason.
// Pure: no DOM, no clock (today and `at` are passed in).

import { set, applyOps } from './state.js';
import { rotationList, dinnerById, isFavorite, isFillable, itemsForNight } from './planner.js';
import { readiness, onHand } from './coverage.js';
import { dinnerCost } from './cost.js';
import { plateLean, leanOn, busyNightsOf, budgetPace } from './health.js';
import { useSoon, placeOf, isMeatItem, sinceOf } from './freshness.js';
import { itemMeta } from './shopping.js';
import { aheadStats, clampAheadEnd, planAheadOps } from './planahead.js';
import { undoFor } from './actions.js';
import { addDays, datesBetween, round2, weekdayName, shortDate } from './util.js';
import { plainName } from './cooking.js';

/** How far back "ate lately" looks, so Claude can keep a dinner from coming round too soon. */
export const RECENT_DAYS = 21;
/** A reason is one short line under the dinner's name. */
export const WHY_MAX = 140;

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayOf = (iso) => WEEKDAY[new Date(`${iso}T12:00:00Z`).getUTCDay()];
const monIndex = (iso) => (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7;
const nameOf = (db, state, id) => plainName(db.ingredients?.[id]?.short || itemMeta(db, state, id).name);

/**
 * Which nights Claude plans, which it must leave as they are, and why.
 *   change: Claude may change dinners the planner picked (never tonight's, never one the family chose,
 *   never a cooked or away night).
 * → [{ date, day, plan: 'open'|'change'|'keep', current: id|null, busy, note }]
 */
export function smartNights(db, state, { start, end, today, change = true }) {
  const plan = state?.plan || {};
  const busy = busyNightsOf(state);
  return datesBetween(start, end).map((date) => {
    const e = plan[date];
    const night = { date, day: dayOf(date), busy: busy.includes(monIndex(date)), current: e?.dinner || null };
    if (e?.status === 'cooked') return { ...night, plan: 'keep', note: 'already cooked' };
    if (e?.status === 'away') return { ...night, plan: 'keep', current: null, note: 'not eating at home' };
    if (isFillable(e, 'fill')) return { ...night, plan: 'open', current: null };
    // Tonight's dinner may already be thawing or started.
    if (date === today) return { ...night, plan: 'keep', note: 'tonight' };
    // Like the quick way: only dinners the planner (or Claude) picked, never one the family chose.
    if (!change || !isFillable(e, 'replan')) return { ...night, plan: 'keep', note: e?.manual ? 'the family picked it' : 'already planned' };
    return { ...night, plan: 'change', note: 'planned before' };
  });
}

/**
 * The POST /api/plan body.
 * → { today, start, end, family, pantryFirst, lean, budget, nights, dinners, useSoon, freezer, recent }
 */
export function smartPlanRequest(db, state, { start, end, today, change = true, pantryFirst = true }) {
  const day0 = start < today ? today : start;
  const last = clampAheadEnd(today, end);
  const nights = smartNights(db, state, { start: day0, end: last, today, change });
  const rem = onHand(db, state);
  const soon = useSoon(db, state, today, { soon: 4, freezerSoon: 21 });
  const soonIds = new Set(soon.map((s) => s.id));
  const plan = state?.plan || {};
  // When each dinner was last on the table (or is next on the plan outside this stretch).
  const lastAte = new Map();
  for (const [d, e] of Object.entries(plan)) {
    if (!e?.dinner || d >= day0 || d < addDays(today, -RECENT_DAYS)) continue;
    if (e.status !== 'cooked' && !(e.status === 'planned' && d < today)) continue;
    if (!lastAte.has(e.dinner) || lastAte.get(e.dinner) < d) lastAte.set(e.dinner, d);
  }
  const dinners = rotationList(db, state).map((d) => {
    const r = readiness(db, state, d.id, rem, today);
    const cost = dinnerCost(db, state, d.id, null, { today });
    const h = plateLean(db, state, d.id, null);
    const items = Object.keys(itemsForNight(db, state, d.id, null));
    const uses = items.filter((id) => soonIds.has(id)).map((id) => nameOf(db, state, id));
    const ready = r.makeable ? (r.thaw.length ? 'thaw' : 'all') : r.ready ? 'side' : 'short';
    const o = {
      id: d.id, title: d.title, min: Number(d.minutes) || null, protein: d.protein || null, kind: d.category || null,
      cost: cost ? round2(cost.perServing) : null, toBuy: cost ? round2(cost.toBuy) : null,
      kcal: h?.kcal || null, proteinG: h?.proteinG ? Math.round(h.proteinG) : null, lean: !!h?.lean, heavy: !!h?.heavy,
      ready, fav: isFavorite(state, d) || undefined,
    };
    if (ready === 'short') o.needs = [...r.missing, ...r.sideOut].slice(0, 4);
    if (ready === 'side') o.needs = r.sideOut.slice(0, 3);
    if (r.keyMissing) o.missingMain = true;
    if (r.thaw.length) o.thawMin = Math.max(...r.thaw.map((x) => x.minutes));
    if (uses.length) o.usesSoon = uses.slice(0, 4);
    if (lastAte.has(d.id)) o.lastAte = lastAte.get(d.id);
    return o;
  });
  // The meat and ready-made mains on hand, so two nights don't count on the same pack.
  const freezer = [];
  for (const [id, p] of Object.entries(state?.pantry || {})) {
    if (!p || p.low || !(typeof p.qty === 'number' && p.qty > 0)) continue;
    const ing = db.ingredients?.[id];
    if (!ing || !(isMeatItem(db, state, id) || ing.prepared)) continue;
    freezer.push({ name: nameOf(db, state, id), qty: round2(p.qty), unit: itemMeta(db, state, id).unit || '', where: placeOf(db, state, id), since: sinceOf(p) || null });
  }
  const pace = budgetPace(state, today, 0);
  return {
    today, start: day0, end: last, family: 5, pantryFirst: !!pantryFirst, lean: leanOn(state),
    budget: { target: pace.target, spent: pace.spent, daysLeft: pace.daysLeft },
    nights,
    dinners,
    useSoon: soon.slice(0, 12).map((s) => ({ name: nameOf(db, state, s.id), daysLeft: s.daysLeft, where: s.place })),
    freezer: freezer.slice(0, 30),
    recent: [...lastAte.entries()].sort((a, b) => b[1].localeCompare(a[1])).slice(0, 14).map(([id, date]) => ({ date, id })),
  };
}

/**
 * Checks Claude's plan against the request and the family's data, and writes it.
 *   reply: { nights: [{ date, dinner, why }], summary, model }
 * Only nights the request let Claude plan are written; a dinner must be in the rotation and can't
 * be used twice in the stretch; a night Claude kept as it was just gets the reason. Open nights it
 * skipped and the packed lunches are then planned the usual way. One Undo for all of it.
 * → { ops, undo, message, count, kept, filled, lunches, start, end, nights: [{ date, dinner, why, changed }], before, after, summary }
 */
export function smartPlanOps(db, state, reply, { start, end, today, who = 'Claude', fillWho = '', at = null, change = true, pantryFirst = true, model = '' }) {
  const day0 = start < today ? today : start;
  const last = clampAheadEnd(today, end);
  const allowed = new Map(smartNights(db, state, { start: day0, end: last, today, change }).filter((n) => n.plan !== 'keep').map((n) => [n.date, n]));
  const rotation = new Set(rotationList(db, state).map((d) => d.id));
  const plan = state?.plan || {};
  const stamp = at || new Date().toISOString();
  // A dinner already on a night Claude can't touch counts as used.
  const used = new Set(datesBetween(day0, last).filter((d) => !allowed.has(d) && plan[d]?.dinner && plan[d].status !== 'away').map((d) => plan[d].dinner));
  const picked = [];
  const list = Array.isArray(reply?.nights) ? reply.nights : [];
  for (const n of [...list].sort((a, b) => String(a?.date).localeCompare(String(b?.date)))) {
    const date = String(n?.date || '');
    const dinner = String(n?.dinner || '');
    if (!allowed.has(date) || picked.some((p) => p.date === date)) continue;
    if (!rotation.has(dinner) || used.has(dinner)) continue;
    used.add(dinner);
    picked.push({ date, dinner, why: cleanWhy(n?.why) });
  }
  const span = { start: day0, end: last, today };
  // Before: the plan as it stood with its open nights filled the usual way, the same baseline the
  // quick way's result card compares against.
  const before = planAheadOps(db, state, { start: day0, end: last, who: fillWho || who, today, at: stamp, pantryFirst, replan: false, record: false }).before;
  const ops = [];
  const out = [];
  for (const p of picked) {
    const e = plan[p.date];
    const d = dinnerById(db, state, p.dinner);
    if (e?.dinner === p.dinner && e.status === 'planned') {
      // Kept as it was: same dinner and sides, now with Claude's reason.
      if (p.why && e.why !== p.why) ops.push(set(['plan', p.date, 'why'], p.why));
      out.push({ ...p, changed: false });
      continue;
    }
    ops.push(set(['plan', p.date], { dinner: p.dinner, sides: [...(d?.sides || [])], status: 'planned', manual: false, by: who, at: stamp, ...(p.why ? { why: p.why } : {}) }));
    out.push({ ...p, changed: true });
  }
  const changedN = out.filter((x) => x.changed).length;
  const kept = out.length - changedN;
  // A night Claude left open, and the packed lunches, are planned the usual way (pantry first), so
  // nothing is missing from the stretch. Never re-plans a night Claude chose.
  let filled = 0;
  let lunches = 0;
  if (out.length) {
    const rest = planAheadOps(db, applyOps(state, ops), { start: day0, end: last, who: fillWho || who, today, at: stamp, pantryFirst, replan: false, record: false });
    filled = rest.count;
    lunches = (rest.lunchPicks || []).length;
    ops.push(...rest.ops);
  }
  const after = aheadStats(db, applyOps(state, ops), span);
  const summary = cleanWhy(reply?.summary, 240);
  const through = `${weekdayName(last)}, ${shortDate(last)}`;
  let message;
  if (!out.length) message = 'Claude didn’t find anything to change. The plan stays as it is.';
  else message = `Claude planned ${changedN ? `${changedN} ${changedN === 1 ? 'dinner' : 'dinners'}` : 'no new dinners'}${kept ? `${changedN ? ' and kept' : ', kept'} ${kept}` : ''} through ${through}.`;
  if (out.length && filled) message += ` ${filled === 1 ? 'One more night was' : `${filled} more nights were`} planned the quick way.`;
  if (out.length) {
    ops.push(set(['planAhead'], {
      start: day0, end: last, pantryFirst: !!pantryFirst, replan: !!change, before, changed: changedN + filled, by: who, at: stamp,
      claude: { summary, model: String(model || '').slice(0, 40), filled, nights: out.map((x) => ({ date: x.date, dinner: x.dinner, why: x.why, changed: x.changed })) },
    }));
  }
  return { ops, undo: undoFor(state, ops), message, count: changedN, kept, filled, lunches, start: day0, end: last, nights: out, before, after, summary };
}

/** A reason Claude wrote, as one plain line. */
export function cleanWhy(s, max = WHY_MAX) {
  if (typeof s !== 'string') return '';
  const t = s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : t;
}

/** Is there anything Claude may plan in this stretch? */
export function smartPlanHasWork(db, state, { start, end, today, change = true }) {
  const day0 = start < today ? today : start;
  return smartNights(db, state, { start: day0, end: clampAheadEnd(today, end), today, change }).some((n) => n.plan !== 'keep');
}

