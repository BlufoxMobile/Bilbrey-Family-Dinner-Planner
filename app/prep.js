// The prep schedule (SPEC §12.5): what to do and when, from the plan and the pantry.
//  - Thaw: meat that's in the freezer moves to the fridge the evening before (two evenings for
//    more than 5 lb). Too late? Thaw it sealed in cold water, about 30 minutes a pound.
//  - Cook once: ground beef on two nights within 3 days gets browned together the first night.
//  - Lunches: once-a-week jobs (portion the party bag) on the first day, then each evening the
//    next day's lunches, and a morning reminder for anything bought fresh that day.
// Pure: no DOM, no clock (today is passed in).

import { plannedNights, itemMeta, unitText } from './shopping.js';
import { itemsForNight, dinnerById } from './planner.js';
import { lunchesIn } from './lunch.js';
import { addDays, datesBetween, diffDays, weekdayName, listJoin, midSentence } from './util.js';

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
        out.push({ date: today, when: 'morning', kind: 'thaw', id, text: `Is the ${what} for ${forWhat} thawed? If not, seal it in a zip bag and thaw it in cold water, about 30 minutes a pound, changing the water every 30 minutes.` });
      }
    }
  }
  return out;
}

function lunchTasks(db, state, today, end) {
  const out = [];
  const dates = datesBetween(today, end);
  const lunches = lunchesIn(db, state, dates);
  // Once a week: portioning jobs for the lunches in the window, on the first day.
  const batch = new Map();
  for (const l of lunches) {
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
    out.push({ date: today, when: 'anytime', kind: 'lunch', text: `${item.batch.replace(/\{n\}/g, String(n))} (${listJoin([...people])}’s lunches this week).` });
  }
  // Each evening: tomorrow's lunches. Each morning: anything bought fresh that day.
  const byDate = new Map();
  for (const l of lunches) {
    if (!byDate.has(l.date)) byDate.set(l.date, []);
    byDate.get(l.date).push(l);
  }
  for (const [date, ls] of byDate) {
    const parts = ls.map((l) => `${l.name}: ${listJoin(l.slots.filter((s) => s.item).map((s) => midSentence(s.item.title.replace(/\s*\(.*?\)\s*/g, ' ').trim())))}`);
    const eve = addDays(date, -1);
    if (eve >= today) out.push({ date: eve, when: 'evening', kind: 'lunch', text: `Pack ${possessive(date, today)} lunches. ${parts.join('. ')}.` });
    for (const l of ls) {
      for (const s of l.slots) {
        const fresh = s.item && Object.keys(s.item.items).some((id) => db.ingredients[id]?.buyOnDay);
        if (fresh) out.push({ date, when: 'morning', kind: 'buy', text: `Pick up ${l.name}’s ${midSentence(s.item.title)} on the way.` });
      }
    }
  }
  return out;
}

/** → [{ date, tasks: [{ when, kind, text }] }] for today and the next days-1 days. */
export function prepSchedule(db, state, { today, days = 7 }) {
  const end = addDays(today, days - 1);
  const pairs = cookOncePairs(db, state, today, end);
  const all = [...thawTasks(db, state, today, end, pairs), ...cookOnceTasks(db, state, today, pairs), ...lunchTasks(db, state, today, end)];
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

