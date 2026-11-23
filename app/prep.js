// The prep schedule (SPEC §12.5): what to do and when, from the plan and the pantry.
//  - Thaw: meat that's in the freezer moves to the fridge the evening before (two evenings for
//    more than 5 lb). Too late? Thaw it sealed in cold water, about 30 minutes a pound.
//  - Cook once: ground beef on two nights within 3 days gets browned together the first night.
//  - Portion and freeze: 2 lb or more of fresh raw meat, the day it comes home (SPEC §13).
//  - Lunches: once-a-week jobs (portion the party bag) on the first day, then each evening the
//    next day's lunches, and a morning reminder for anything bought fresh that day.
//  - Slow cooker (SPEC §21): a dinner that cooks for hours in the PossibleCooker gets a morning
//    "start it by" job.
//  - Keeping the pantry true (SPEC §21): food past its date gets called out today, a dinner cooked
//    tonight asks about leftovers, and a night never marked cooked asks what happened. These carry
//    an `action` the card turns into a button.
// Pure: no DOM, no clock (today is passed in).

import { plannedNights, itemMeta, unitText } from './shopping.js';
import { itemsForNight, dinnerById } from './planner.js';
import { lunchesIn } from './lunch.js';
import { addDays, datesBetween, diffDays, weekdayName, listJoin, midSentence } from './util.js';
import { isSlowCooked } from './health.js';
import { useSoon } from './freshness.js';

const WHEN = { morning: 0, anytime: 1, evening: 2 };
/** Brown once, use twice: ground meats that go in the pan the same way every time. */
const COOK_AHEAD = { beef: 'ground beef' };

function dayName(date, today) {
  const d = diffDays(date, today);
  if (d === 0) return 'tonight';
  if (d === 1) return 'tomorrow';
  return weekdayName(date);
}
function possessive(date, today) {
  const n = dayName(date, today);
  return n === 'tonight' ? 'tonight’s' : n === 'tomorrow' ? 'tomorrow’s' : `${n}’s`;
}

/** Ground beef on two nights within 3 days: brown it together on the first night. */
function cookOncePairs(db, state, today, end) {
  const pairs = [];
  const nights = plannedNights(db, state, datesBetween(today, end)).sort((a, b) => a.date.localeCompare(b.date));
  for (const [id, label] of Object.entries(COOK_AHEAD)) {
    const uses = nights.map((n) => ({ ...n, qty: itemsForNight(db, state, n.entry.dinner, n.entry)[id] || 0 })).filter((u) => u.qty > 0);
    for (let i = 0; i + 1 < uses.length; i++) {
      const a = uses[i];
      const b = uses[i + 1];
      if (diffDays(b.date, a.date) > 3) continue;
      pairs.push({ id, label, a, b });
      i++; // pair each night once
    }
  }
  return pairs;
}

function cookOnceTasks(db, state, today, pairs) {
  return pairs.map(({ id, label, a, b }) => {
    const ad = dinnerById(db, state, a.entry.dinner);
    const bd = dinnerById(db, state, b.entry.dinner);
    return { date: a.date, when: 'evening', kind: 'cook', id, text: `Cook once: when you brown the ${label} for ${possessive(a.date, today)} ${ad?.title || 'dinner'}, brown ${unitText(b.qty, 'lb')} more and keep it in the fridge for ${possessive(b.date, today)} ${bd?.title || 'dinner'}. It saves a pan and about 10 minutes.` };
  });
}

function thawTasks(db, state, today, end, pairs) {
  const out = [];
  // A cook-once pair thaws together, the evening before the first night.
  const folded = new Map(pairs.map((p) => [`${p.b.date}|${p.id}`, p]));
  const joined = new Map(pairs.map((p) => [`${p.a.date}|${p.id}`, p]));
  const rem = {};
  for (const [id, p] of Object.entries(state?.pantry || {})) if (p && !p.low && typeof p.qty === 'number' && p.qty > 0) rem[id] = p.qty;
  const nights = plannedNights(db, state, datesBetween(today, addDays(end, 2))).sort((a, b) => a.date.localeCompare(b.date));
  for (const { date, entry } of nights) {
    const d = dinnerById(db, state, entry.dinner);
    for (const [id, need] of Object.entries(itemsForNight(db, state, entry.dinner, entry))) {
      const ing = db.ingredients[id];
      const meta = itemMeta(db, state, id);
      if (meta.storage !== 'freezer' || ing?.cookFromFrozen) continue;
      if (!(ing?.meat || meta.aisle === 'Meat')) continue;
      if (folded.has(`${date}|${id}`)) continue; // thawed with the first night of its pair
      const pair = joined.get(`${date}|${id}`);
      const want = need + (pair ? pair.b.qty : 0);
      const qty = Math.min(want, rem[id] || 0); // only what's actually in the freezer; the rest is bought fresh
      if (!(qty > 0)) continue;
      rem[id] -= qty;
      const amount = unitText(Math.round(qty * 100) / 100, meta.unit);
      const what = midSentence(meta.name.replace(/\s*\(.*?\)\s*/g, ' ').trim());
      const forWhat = `${possessive(date, today)} ${d?.title || 'dinner'}${pair ? ` and ${possessive(pair.b.date, today)} ${dinnerById(db, state, pair.b.entry.dinner)?.title || 'dinner'}` : ''}`;
      const lead = meta.unit === 'lb' && qty > 5 ? 2 : 1; // about a day for every 5 lb in the fridge
      const on = addDays(date, -lead);
      if (on >= today) {
        if (on <= end) out.push({ date: on, when: 'evening', kind: 'thaw', id, text: `Move ${amount} of ${what} from the freezer to the fridge for ${forWhat}.` });
      } else if (date >= today && date <= end) {
        const minutes = meta.unit === 'lb' ? Math.max(30, Math.round((qty * 30) / 15) * 15) : null;
        out.push({ date: today, when: 'morning', kind: 'thaw', id, forDate: date, qty, unit: meta.unit, what, minutes, text: `Still frozen? Thaw the ${what} for ${forWhat} sealed in a zip bag in cold water, about 30 minutes a pound, changing the water every 30 minutes.` });
      }
    }
  }
  return out;
}

function lunchTasks(db, state, today, end) {
  const out = [];
  const dates = datesBetween(today, end);
  const lunches = lunchesIn(db, state, dates);
  // Once a week: portioning jobs for the coming week's lunches, on the first day. Always the whole
  // week, so Tonight's two-day list and the Plan's week say the same number of snack bags.
  const batch = new Map();
  for (const l of lunchesIn(db, state, datesBetween(today, addDays(today, 6)))) {
    for (const s of l.slots) {
      if (!s.item?.batch) continue;
      const k = s.item.id;
      if (!batch.has(k)) batch.set(k, { item: s.item, people: new Set(), n: 0 });
      const b = batch.get(k);
      b.people.add(l.name);
      b.n++;
    }
  }
  for (const { item, people, n } of batch.values()) {
    out.push({ date: today, when: 'anytime', kind: 'lunch', text: `${item.batch.replace(/\{n\}/g, String(n))} for ${listJoin([...people])}’s lunches.` });
  }
  // Each evening: tomorrow's lunches. Each morning: anything bought fresh that day.
  const byDate = new Map();
  for (const l of lunches) {
    if (!byDate.has(l.date)) byDate.set(l.date, []);
    byDate.get(l.date).push(l);
  }
  for (const [date, ls] of byDate) {
    const short = (title) => midSentence(title.replace(/\s*\(.*?\)\s*/g, ' ').split(',')[0].trim());
    const parts = ls.map((l) => `${l.name}: ${listJoin(l.slots.filter((s) => s.item).map((s) => short(s.item.title)))}`);
    const eve = addDays(date, -1);
    if (eve >= today) out.push({ date: eve, when: 'evening', kind: 'lunch', text: `Pack ${possessive(date, today)} lunches. ${parts.join('. ')}.` });
    for (const l of ls) {
      for (const s of l.slots) {
        const fresh = s.item && Object.keys(s.item.items).some((id) => db.ingredients[id]?.buyOnDay);
        if (fresh) out.push({ date, when: 'morning', kind: 'buy', text: `Pick up ${l.name}’s ${midSentence(s.item.title.replace(/\s*\((.*?)\)\s*/g, ' from the $1 ').trim())} on the way.` });
      }
    }
  }
  return out;
}

/** → [{ date, tasks: [{ when, kind, text }] }] for today and the next days-1 days. */
/**
 * Portion and freeze (SPEC §13): fresh raw meat bought in bulk (2 lb or more) keeps two days in the
 * fridge. The day it comes home: keep what the next two days need, freeze the rest in meal-size
 * bags, so nothing turns before its night and the freezer → fridge thaw plan works.
 */
function portionTasks(db, state, today, end) {
  const out = [];
  const nights = plannedNights(db, state, datesBetween(today, addDays(today, 13))).sort((a, b) => a.date.localeCompare(b.date));
  for (const [id, p] of Object.entries(state?.pantry || {})) {
    const ing = db.ingredients[id];
    const b = p?.bought;
    if (!ing?.meat || ing.cooked || !b || !(b.qty >= 2) || !(typeof p.qty === 'number' && p.qty > 0)) continue;
    const m = itemMeta(db, state, id);
    if (m.storage !== 'fridge' && m.storage !== 'freezer') continue;
    if (/deli|boar|sliced|bacon|sausage|hot dog|salami|pepperoni/i.test(m.name)) continue;
    const on = String(b.on || '').slice(0, 10);
    if (!on || diffDays(today, on) > 1 || on > end) continue;
    const uses = nights.map((n) => ({ date: n.date, qty: itemsForNight(db, state, n.entry.dinner, n.entry)[id] || 0 })).filter((u) => u.qty > 0);
    const soon = uses.filter((u) => diffDays(u.date, on) <= 2);
    const keep = Math.min(p.qty, soon.reduce((t, u) => t + u.qty, 0));
    const freeze = Math.round((p.qty - keep) * 100) / 100;
    if (freeze < 0.75) continue;
    const later = uses.filter((u) => diffDays(u.date, on) > 2).slice(0, 3);
    const bag = later.length ? later[0].qty : 1;
    const name = midSentence(m.name.replace(/\s*\(.*?\)\s*/g, ' ').trim());
    out.push({
      date: on < today ? today : on, when: 'evening', kind: 'freeze', id,
      text: `Portion the ${name}: ${keep > 0 ? `keep ${unitText(keep, 'lb')} in the fridge for ${listJoin(soon.map((u) => dayName(u.date, today)))}, then ` : ''}freeze ${unitText(freeze, 'lb')} flat in ${unitText(bag, 'lb')} bags${later.length ? ` (one each for ${listJoin(later.map((u) => weekdayName(u.date)))})` : ''}. Write today’s date on each bag.`,
    });
  }
  return out;
}

/** "by 10 AM" for a dinner at 6 that cooks 8 hours; long cooks start "first thing in the morning". */
function startBy(minutes) {
  const hours = Math.max(1, Math.round(minutes / 60));
  const at = 18 - hours;
  if (at <= 8) return { hours, text: 'first thing in the morning' };
  return { hours, text: `by ${at > 12 ? `${at - 12} PM` : at === 12 ? 'noon' : `${at} AM`}` };
}

/** The slow cooker does the work, but only if it's started in time. */
function slowTasks(db, state, today, end) {
  const out = [];
  for (const { date, entry } of plannedNights(db, state, datesBetween(today, end))) {
    const d = dinnerById(db, state, entry.dinner);
    if (!isSlowCooked(d) || !(d.minutes >= 90)) continue;
    const s = startBy(d.minutes);
    out.push({ date, when: 'morning', kind: 'slow', text: `Start ${possessive(date, today)} ${d.title} in the PossibleCooker ${s.text}. It cooks about ${s.hours} ${s.hours === 1 ? 'hour' : 'hours'} on its own.` });
  }
  return out;
}

const plain = (name) => midSentence(String(name || '').replace(/\s*\(.*?\)\s*/g, ' ').replace(/,.*$/, '').trim());

/** Today's jobs that keep the pantry honest: nothing past its date sits unseen, nothing cooked goes uncounted. */
function pantryTasks(db, state, today) {
  const out = [];
  const due = useSoon(db, state, today, { soon: 0, freezerSoon: 0 });
  const fresh = due.filter((x) => x.place !== 'freezer');
  const frozen = due.filter((x) => x.place === 'freezer');
  if (fresh.length) {
    out.push({ date: today, when: 'anytime', kind: 'use', text: `Use today or check: ${listJoin(fresh.slice(0, 3).map((x) => `the ${plain(x.name)}`))}${fresh.length > 3 ? ` and ${fresh.length - 3} more` : ''}. ${fresh.length === 1 ? 'It’s' : 'They’re'} at the usual use-by.`, action: { name: 'nav', label: 'See the pantry', data: { href: '#/pantry' } } });
  }
  if (frozen.length) {
    out.push({ date: today, when: 'anytime', kind: 'use', text: `In the freezer too long: ${listJoin(frozen.slice(0, 3).map((x) => `the ${plain(x.name)}`))}${frozen.length > 3 ? ` and ${frozen.length - 3} more` : ''}. Plan ahead puts ${frozen.length === 1 ? 'it' : 'them'} first.`, action: { name: 'nav', label: 'Plan it', data: { href: '#/plan' } } });
  }
  // Leftovers and dinners never marked cooked are asked about once, on their own cards (Tonight,
  // Plan and Pantry: docs/spec/22 §22.1), not as prep jobs as well.
  return out;
}

/**
 * Meat for tonight's dinner that's still in the freezer and should be thawing now (cold water),
 * → [{ id, what, qty, unit, minutes }]. Tonight and cook mode say it above "Start cooking".
 */
export function thawNow(db, state, today) {
  return thawTasks(db, state, today, today, []).filter((t) => t.forDate === today).map(({ id, what, qty, unit, minutes }) => ({ id, what, qty, unit, minutes }));
}

export function prepSchedule(db, state, { today, days = 7 }) {
  const end = addDays(today, days - 1);
  const pairs = cookOncePairs(db, state, today, end);
  const all = [...pantryTasks(db, state, today), ...slowTasks(db, state, today, end), ...portionTasks(db, state, today, end), ...thawTasks(db, state, today, end, pairs), ...cookOnceTasks(db, state, today, pairs), ...lunchTasks(db, state, today, end)];
  const byDate = new Map();
  for (const t of all) {
    if (t.date < today || t.date > end) continue;
    if (!byDate.has(t.date)) byDate.set(t.date, []);
    byDate.get(t.date).push(t);
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, tasks]) => ({ date, tasks: tasks.sort((a, b) => WHEN[a.when] - WHEN[b.when]) }));
}

