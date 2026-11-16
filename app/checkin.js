// The weekly check-in (docs/spec/25). Two parts, both pure (no DOM, no clock: today is passed in):
//  - Money: what the week cost, where the month stands against the target, and one thing to do next.
//  - A weigh-in, for whoever wants one. Each person chooses what they're working toward (losing some,
//    gaining some back, staying about the same). There is no goal weight, no calorie number and no
//    score: only this week, last week, and the trend. Where the numbers are kept (this phone only, or
//    the family's private storage) is the person's own choice; app/views/checkin.js never shows them
//    on a TV.

import { addDays, diffDays, monIndex, round2, shortDate, cleanName, isISODate, money, listJoin } from './util.js';
import { settingsOf, set, del } from './state.js';
import { monthBudget } from './shopping.js';
import { wasteEntries } from './waste.js';
import { undoFor } from './actions.js';

// ---------------------------------------------------------------- the week

/** The check-in day, Monday = 0 … Sunday = 6. The family's week ends on it. */
export const CHECKIN_DAY = 6;
/** How long after the week ends Tonight keeps offering the check-in. */
export const GRACE_DAYS = 2;

export function checkinDay(state) {
  const n = Number(state?.settings?.checkinDay);
  return state?.settings?.checkinDay != null && Number.isInteger(n) && n >= 0 && n <= 6 ? n : CHECKIN_DAY;
}

/** The seven days ending on the check-in day that hold `date`. → { start, end } */
export function weekOf(date, day = CHECKIN_DAY) {
  const end = addDays(date, (day - monIndex(date) + 7) % 7);
  return { start: addDays(end, -6), end };
}

export const isChecked = (state, weekStart) => !!state?.checkin?.money?.[weekStart];

/**
 * The week that wants a check-in today: the one ending today, or the one that just ended (for a
 * couple of days) when nobody has looked at it yet. → { start, end } | null
 */
export function dueWeek(state, today) {
  const w = weekOf(today, checkinDay(state));
  if (w.end === today) return isChecked(state, w.start) ? null : w;
  const prev = { start: addDays(w.start, -7), end: addDays(w.end, -7) };
  return diffDays(today, prev.end) <= GRACE_DAYS && !isChecked(state, prev.start) ? prev : null;
}

/** The week the check-in page shows: the one that's due, else the week in progress. */
export function shownWeek(state, today) {
  return dueWeek(state, today) || weekOf(today, checkinDay(state));
}

// ---------------------------------------------------------------- money

/** Receipts dated start…end, each once (the same rule as the Budget). */
export function receiptsBetween(state, start, end) {
  const seen = new Set();
  return (Array.isArray(state?.receipts) ? state.receipts : [])
    .filter((r) => r && typeof r.date === 'string' && r.date >= start && r.date <= end && Number.isFinite(Number(r.amount)))
    .filter((r) => { const k = r.id || `${r.date}|${r.store}|${r.amount}|${r.note || ''}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** One week's groceries from its receipts. → { start, end, total, receipts, trips (days with a receipt) } */
export function weekSpend(state, week) {
  const receipts = receiptsBetween(state, week.start, week.end);
  return {
    start: week.start, end: week.end, receipts,
    total: round2(receipts.reduce((t, r) => t + Number(r.amount), 0)),
    trips: new Set(receipts.map((r) => r.date)).size,
  };
}

/** What a week can cost and still land on the monthly target (52 weeks, 12 months). */
export const weeklyShare = (target) => round2((Number(target) * 12) / 52);

/** How many of the weeks before this one the chart shows. */
export const HISTORY_WEEKS = 6;

/**
 * The money check-in for one week (the one that's due, or the week in progress).
 * → { week: { start, end, total, receipts, trips, share, over (above the weekly share), done (the week has ended) },
 *     last (the week before, same shape as weekSpend), history: [{ start, end, total }] oldest first,
 *     month: { target, spent, stillToBuy, projected, ifPlanned, unplanned, left, daysLeft, perWeekLeft, trips, tripGoal },
 *     year: { year, yearTarget, overYear },
 *     waste: { total, count, names },
 *     status: 'on' | 'tight' | 'over', verdict, tips: [{ text, href?, label? }], checked }
 */
export function moneyCheckin(db, state, today, week = shownWeek(state, today)) {
  const target = settingsOf(state).monthlyTarget;
  const share = weeklyShare(target);
  const w = weekSpend(state, week);
  const last = weekSpend(state, { start: addDays(week.start, -7), end: addDays(week.end, -7) });
  const history = Array.from({ length: HISTORY_WEEKS }, (_, i) => {
    const k = HISTORY_WEEKS - 1 - i;
    const s = weekSpend(state, { start: addDays(week.start, -7 * k), end: addDays(week.end, -7 * k) });
    return { start: s.start, end: s.end, total: s.total, trips: s.trips };
  });
  const b = monthBudget(db, state, today);
  const daysLeft = diffDays(b.end, today); // after today
  const left = round2(target - b.ifPlanned);
  const month = {
    target, spent: b.spent, stillToBuy: b.stillToBuy, projected: b.projected, ifPlanned: b.ifPlanned, unplanned: b.unplanned,
    left, daysLeft, perWeekLeft: left > 0 ? round2(daysLeft > 7 ? left / (daysLeft / 7) : left) : 0,
    trips: b.trips.count, tripGoal: b.trips.goal, tripsOver: b.trips.over, tripsLeft: b.trips.left, end: b.end,
  };
  const tossed = wasteEntries(state).filter((x) => x.reason === 'tossed' && x.date >= week.start && x.date <= week.end);
  const waste = { total: round2(tossed.reduce((t, x) => t + x.cost, 0)), count: tossed.length, names: [...new Set(tossed.map((x) => String(x.name || '').replace(/\s*\(.*?\)\s*/g, ' ').replace(/,.*$/, '').trim()).filter(Boolean))] };
  const status = b.projected > target ? 'over' : b.ifPlanned > target ? 'tight' : 'on';
  const nights = `${b.unplanned} open ${b.unplanned === 1 ? 'night' : 'nights'}`;
  const verdict = status === 'over'
    ? `Over budget: what’s bought and planned comes to ${money(b.projected)}, ${money(b.projected - target)} past the ${money(target, { whole: true })} target.`
    : status === 'tight'
      ? `Close to the line: ${money(b.projected)} so far, and the ${nights} left would take it to about ${money(b.ifPlanned)} at the usual ${money(b.average)} a dinner. That’s ${money(b.ifPlanned - target)} over.`
      : `On budget: the month is heading for about ${money(b.ifPlanned)} of ${money(target, { whole: true })}${left < target * 0.05 ? ', with very little room to spare' : ''}.`;

  const tips = [];
  const anyThisMonth = b.receipts.length > 0;
  if (!w.receipts.length && !anyThisMonth) tips.push({ text: 'No receipts are logged yet, so these numbers are only the plan. Scan one after each trip and the check-in shows what you really spent.', href: '#/budget', label: 'Scan a receipt' });
  if (status === 'over') tips.push({ text: 'To get back under, plan the nights left from what’s already in the house before buying more.', href: '#/plan', label: 'Plan from the pantry' });
  if (status === 'tight') tips.push({ text: `Plan the ${nights} from the pantry and freezer first. Every dinner the house already covers is about ${money(b.average)} that stays in the budget.`, href: '#/plan', label: 'Plan from the pantry' });
  if (month.tripsOver) tips.push({ text: `${month.trips} store trips so far this month; the goal is ${month.tripGoal}. Extra runs are where unplanned spending goes, so make the next list cover the ${daysLeft + 1} days left.`, href: '#/list', label: 'Open the list' });
  if (waste.count) tips.push({ text: `${money(waste.total)} went in the trash this week${waste.names.length ? ` (${listJoin(waste.names.slice(0, 3).map((n) => n.toLowerCase()))})` : ''}. Tonight’s “Use first” card shows what to cook next so it doesn’t happen twice.`, href: '#/tonight', label: 'See what to use first' });
  if (status !== 'over' && w.total > share * 1.5 && month.tripsLeft >= 0 && !month.tripsOver) tips.push({ text: `A big week (${money(w.total)}) is normal after a stock-up trip. What matters is the month, and it’s still on track.` });
  if (!tips.length) tips.push({ text: status === 'on' ? 'Nothing to change. Keep shopping from the list.' : 'Stick to the list on the next trip and the month lands on target.' });

  return {
    week: { ...w, share, over: w.total > share, done: week.end < today },
    last, history, month,
    year: { year: b.pace.year, yearTarget: b.pace.yearTarget, overYear: b.pace.overYear },
    waste, status, verdict, tips: tips.slice(0, 3),
    checked: state?.checkin?.money?.[week.start] || null,
  };
}

/** Mark a week's money check-in done (for the whole family). */
export function moneyCheckedOps(state, { week, spent = 0, who = 'Family', at = new Date().toISOString() }) {
  const ops = [set(['checkin', 'money', week.start], { end: week.end, spent: round2(spent), by: who, at })];
  return { ops, undo: undoFor(state, ops), message: `Checked in for ${shortDate(week.start)} to ${shortDate(week.end)}.` };
}

export function moneyUncheckedOps(state, { week }) {
  if (!isChecked(state, week.start)) return { ops: [], message: '' };
  const ops = [del(['checkin', 'money', week.start])];
  return { ops, undo: undoFor(state, ops), message: 'Check-in reopened.' };
}

// ---------------------------------------------------------------- the weigh-in

/** What a person is working toward. Never a number: only a direction. */
export const WEIGH_GOALS = [
  { id: 'lose', label: 'Lose some' },
  { id: 'gain', label: 'Gain some back' },
  { id: 'steady', label: 'Stay about the same' },
];
export const isWeighGoal = (g) => WEIGH_GOALS.some((x) => x.id === g);

export const LB_MIN = 50;
export const LB_MAX = 700;
/** Within this many pounds, two weigh-ins are "about the same" (a scale isn't finer than that week to week). */
export const SAME_LB = 0.4;
/** Losing faster than this, week after week, is worth saying something about. */
export const FAST_LOSS_LB = 2.5;

/** "182.4" → 182.4; anything a scale wouldn't say → null. */
export function parseLb(v) {
  const n = Math.round(Number(String(v ?? '').replace(',', '.').trim()) * 10) / 10;
  return Number.isFinite(n) && n >= LB_MIN && n <= LB_MAX ? n : null;
}

const fmtLb = (n) => `${(Math.round(Math.abs(n) * 10) / 10).toFixed(1).replace(/\.0$/, '')} lb`;
export { fmtLb };

/** Every weigh-in, oldest first. → [{ date, lb }] */
export function weighSeries(weights) {
  return Object.entries(weights && typeof weights === 'object' ? weights : {})
    .map(([date, lb]) => ({ date, lb: Number(lb) }))
    .filter((x) => isISODate(x.date) && Number.isFinite(x.lb) && x.lb >= LB_MIN && x.lb <= LB_MAX)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** One point a week (the week's last weigh-in), oldest first. → [{ week, date, lb }] */
export function weeklySeries(series, day = CHECKIN_DAY) {
  const by = new Map();
  for (const p of series) by.set(weekOf(p.date, day).start, { week: weekOf(p.date, day).start, date: p.date, lb: p.lb });
  return [...by.values()].sort((a, b) => a.week.localeCompare(b.week));
}

/**
 * Where a person's weigh-ins stand. Plain words, no judgment, and nothing to hit.
 * → { count, weeks: [{ week, date, lb }], first, latest, prev, change (since the week before), total (since the
 *     first), run: { dir: 'down'|'up'|'same', n } (weeks in a row moving the same way), perWeek (average weekly
 *     change over the last four weeks), doneThisWeek, headline, note, doctor (a sentence, or '') }
 */
export function weighTrend(weights, { today, goal = 'steady', day = CHECKIN_DAY } = {}) {
  const weeks = weeklySeries(weighSeries(weights), day);
  const out = { count: weeks.length, weeks, first: weeks[0] || null, latest: weeks[weeks.length - 1] || null, prev: weeks[weeks.length - 2] || null, change: null, total: null, run: { dir: 'same', n: 0 }, perWeek: null, doneThisWeek: false, headline: '', note: '', doctor: '' };
  if (!out.latest) { out.headline = 'No weigh-ins yet.'; return out; }
  out.doneThisWeek = !!today && out.latest.week === weekOf(today, day).start;
  if (!out.prev) {
    out.headline = `${fmtLb(out.latest.lb)} to start.`;
    out.note = 'Next week’s weigh-in starts the trend.';
    return out;
  }
  const r1 = (n) => Math.round(n * 10) / 10;
  out.change = r1(out.latest.lb - out.prev.lb);
  out.total = r1(out.latest.lb - out.first.lb);
  const dirOf = (d) => (d <= -SAME_LB ? 'down' : d >= SAME_LB ? 'up' : 'same');
  const dir = dirOf(out.change);
  let n = 0;
  for (let i = weeks.length - 1; i > 0 && dirOf(weeks[i].lb - weeks[i - 1].lb) === dir; i--) n++;
  out.run = { dir, n };
  const span = weeks.slice(-5); // up to four intervals
  const gapWeeks = Math.max(1, diffDays(span[span.length - 1].week, span[0].week) / 7);
  out.perWeek = r1((span[span.length - 1].lb - span[0].lb) / gapWeeks);

  out.headline = dir === 'same' ? 'About the same as last week.' : `${dir === 'down' ? 'Down' : 'Up'} ${fmtLb(out.change)} since last week.`;
  const sinceStart = Math.abs(out.total) >= SAME_LB && weeks.length > 2 ? ` ${out.total < 0 ? 'Down' : 'Up'} ${fmtLb(out.total)} since ${shortDate(out.first.date)}.` : '';
  const oneWeek = 'One week doesn’t say much: water and salt can move the scale a few pounds. The month is what counts.';
  if (goal === 'lose') {
    out.note = (dir === 'up' ? oneWeek : dir === 'same' ? 'A flat week is part of it.' : '') + sinceStart;
    if (span.length >= 4 && out.perWeek <= -FAST_LOSS_LB) out.doctor = 'That’s faster than the 1 to 2 lb a week most doctors suggest. Make sure you’re eating enough, and mention it at your next visit.';
  } else if (goal === 'gain') {
    out.note = (dir === 'up' ? 'That’s the direction you wanted.' : dir === 'same' ? 'Holding steady counts.' : 'Weeks vary. Small, easy food through the day counts as much as dinner does.') + sinceStart;
    if (dir === 'down' && n >= 2) out.doctor = `That’s ${n} weeks down in a row. Please call your doctor about it: weight that keeps dropping without trying is worth a visit.`;
  } else {
    out.note = (dir === 'same' ? '' : oneWeek) + sinceStart;
    if (dir === 'down' && n >= 3) out.doctor = `That’s ${n} weeks down in a row. If you aren’t trying to lose weight, mention it to your doctor.`;
  }
  out.note = out.note.trim();
  return out;
}

/** The weigh-ins the family's storage holds (only people who chose to keep theirs there). → [{ name, goal, weights }] */
export function sharedWeighIns(state) {
  const people = state?.checkin?.people || {};
  const weights = state?.checkin?.weights || {};
  return Object.keys({ ...people, ...weights })
    .filter((name) => people[name] || Object.keys(weights[name] || {}).length)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, goal: isWeighGoal(people[name]?.goal) ? people[name].goal : 'steady', weights: weights[name] || {} }));
}

/** Save one weigh-in in the family's storage (the person chose to keep theirs there). */
export function weighOps(state, { name, date, lb, goal }) {
  const who = cleanName(name);
  const n = parseLb(lb);
  if (!who || !isISODate(date) || n == null) return { ops: [], error: true, message: `Enter a weight between ${LB_MIN} and ${LB_MAX} lb.` };
  const ops = [set(['checkin', 'weights', who, date], n)];
  if (isWeighGoal(goal) && state?.checkin?.people?.[who]?.goal !== goal) ops.push(set(['checkin', 'people', who], { goal }));
  return { ops, undo: undoFor(state, ops), message: `Saved ${fmtLb(n)}.` };
}

export function removeWeighOps(state, { name, date }) {
  const who = cleanName(name);
  if (state?.checkin?.weights?.[who]?.[date] == null) return { ops: [], message: '' };
  const ops = [del(['checkin', 'weights', who, date])];
  return { ops, undo: undoFor(state, ops), message: 'Weigh-in removed.' };
}

export function weighGoalOps(state, { name, goal }) {
  const who = cleanName(name);
  if (!who || !isWeighGoal(goal)) return { ops: [], message: '' };
  const ops = [set(['checkin', 'people', who], { goal })];
  return { ops, undo: undoFor(state, ops), message: '' };
}

/** Move a person's weigh-ins into the family's storage (from this phone). */
export function shareWeighOps(state, { name, goal, weights }) {
  const who = cleanName(name);
  if (!who) return { ops: [], message: '' };
  const clean = Object.fromEntries(weighSeries(weights).map((p) => [p.date, p.lb]));
  const ops = [set(['checkin', 'people', who], { goal: isWeighGoal(goal) ? goal : 'steady' }), set(['checkin', 'weights', who], { ...(state?.checkin?.weights?.[who] || {}), ...clean })];
  return { ops, undo: undoFor(state, ops), message: '' };
}

/** Take a person's weigh-ins out of the family's storage, for good. */
export function forgetWeighOps(state, { name }) {
  const who = cleanName(name);
  const ops = [];
  if (state?.checkin?.weights?.[who]) ops.push(del(['checkin', 'weights', who]));
  if (state?.checkin?.people?.[who]) ops.push(del(['checkin', 'people', who]));
  return { ops, undo: undoFor(state, ops), message: '' };
}
