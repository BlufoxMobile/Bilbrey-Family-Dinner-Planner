// "Easy tonight" (docs/spec/25 §25.4): on a night nobody has the energy, the least work that is
// still a real dinner, from what is already in the house. Pure: no DOM, no clock.

import { rotationList, benchList, itemsForNight, isMeat, dinnerSignal, scaleItems } from './planner.js';
import { addDays } from './util.js';
import { onHand, backups, ENOUGH } from './coverage.js';
import { itemMeta } from './shopping.js';
import { placeOf } from './freshness.js';
import { handsOnMinutes } from './data.js';
import { isSlowCooked } from './health.js';
import { leftoversOnHand } from './cooking.js';

/** At most this much hands-on work, and on the table within this long. */
export const EASY_MAX_WORK = 25;
export const EASY_MAX_TOTAL = 45;
/** Before this hour a slow-cooker dinner still makes it to the table (and is the least work of all). */
export const COOKER_BY_HOUR = 11;
/** A dinner missing more than this many things isn't "what's in the house": it only shows when nothing else does. */
export const EASY_MAX_MISSING = 2;

const plain = (name) => String(name || '').replace(/\s*\(.*?\)\s*/g, ' ').replace(/,.*$/, '').trim();

/**
 * The easiest dinners for tonight, best first. Everything in the house beats a short thing to pick
 * up; nothing frozen solid beats a thaw; then the least hands-on work, with a loved dinner breaking ties.
 * → { picks: [{ dinner, work, total, cooker, ready (the main is in the house), missing: [names], sideOut: [names], thaw: [names], loved }],
 *     backups: [{ id, name }] (ready-made meals on the shelf), leftovers: [{ date, title, servings }] }
 */
export function easyTonight(db, state, today, { limit = 3, hour = 17 } = {}) {
  const rem = onHand(db, state);
  const current = state?.plan?.[today]?.status === 'planned' ? state.plan[today].dinner : null;
  // What the family just ate isn't an idea for tonight.
  const recent = new Set([1, 2, 3].map((k) => state?.plan?.[addDays(today, -k)]).filter((e) => e?.dinner && e.status !== 'away').map((e) => e.dinner));
  const rate = (d, bench) => {
    if (d.id === current || recent.has(d.id)) return null;
    const cooker = isSlowCooked(d);
    const work = handsOnMinutes(d);
    const total = Number(d.minutes) || work;
    if (cooker ? hour >= COOKER_BY_HOUR : total > EASY_MAX_TOTAL) return null;
    if (work > EASY_MAX_WORK) return null;
    const items = itemsForNight(db, state, d.id, null);
    const ids = Object.keys(items);
    if (!ids.length) return null;
    const missing = [];
    const sideOut = []; // only a side is short: the dinner is still on, with another side
    const thaw = [];
    const main = scaleItems(db, state, d.items || {});
    for (const id of ids) {
      const have = rem[id] ?? 0;
      if (!(have === Infinity || have + 1e-9 >= items[id] * ENOUGH)) (id in main ? missing : sideOut).push(plain(itemMeta(db, state, id).name));
      else if (isMeat(db, id) && have !== Infinity && placeOf(db, state, id) === 'freezer' && !cooker) thaw.push(plain(itemMeta(db, state, id).name));
    }
    const loved = dinnerSignal(state, d) === 'loved';
    const score = missing.length * 100 + (thaw.length ? 30 : 0) + sideOut.length * 6 + work + (bench ? 15 : 0) - (loved ? 8 : 0);
    return { dinner: d, work, total, cooker, ready: !missing.length, missing, sideOut, thaw, loved, score };
  };
  const rated = [
    ...rotationList(db, state).map((d) => rate(d, false)),
    ...benchList(db, state).map((d) => rate(d, true)),
  ].filter(Boolean).sort((a, b) => a.score - b.score || a.dinner.title.localeCompare(b.dinner.title));
  // One of each kind of dinner, so the three choices are really three choices.
  // When the house covers nothing quick, the quickest dinners still show, with what each needs.
  const picks = [];
  const seen = new Set();
  for (const strict of [true, false]) {
    for (const p of rated) {
      const kind = `${p.dinner.category}|${p.dinner.protein}`;
      if (picks.length >= limit || seen.has(kind) || (strict && p.missing.length > EASY_MAX_MISSING)) continue;
      seen.add(kind);
      picks.push(p);
    }
    if (picks.length) break; // only fall back when nothing at all is close
  }
  return {
    picks: picks.map(({ score, ...p }) => p),
    backups: backups(db, state).map((b) => ({ id: b.id, name: plain(b.name), storage: b.storage })).slice(0, 4),
    leftovers: leftoversOnHand(state, today).filter((l) => !l.night && l.daysLeft >= 0).map((l) => ({ date: l.date, title: l.title, servings: l.servings })),
  };
}
