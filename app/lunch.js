// Pure lunch logic (SPEC §8, docs/spec/20): who packs lunch, on which days, and what's in it.
// A person's slot list is a rotation; the day's index counts that person's lunch days
// from a fixed Sunday, so every device shows the same lunch for the same day.
// No DOM, no clock.
//
// The family shares one profile, so the only people the app knows about are the ones who pack a
// lunch: Jeff and Knox to start with (lunches.json `defaults`), plus anyone the family adds.

import { PARENTS } from './config.js';
import { cleanName, diffDays, weekday } from './util.js';
import { LUNCH_SLOTS, normalizeLunchItem, normalizeLunchPerson } from './data.js';

/** A Sunday. Lunch day N counts this person's lunch days from here. */
export const LUNCH_EPOCH = '2026-01-04';

export const SKIP_REASONS = [
  { id: 'Buying lunch', label: 'Buying lunch' },
  { id: 'No school', label: 'No school or a day off' },
  { id: 'Other', label: 'Other' },
];


export function lunchSlots(db) {
  return db?.lunch?.slots?.length ? db.lunch.slots : LUNCH_SLOTS;
}

export function lunchItem(db, state, id) {
  if (!id) return null;
  if (db?.lunch?.items?.[id]) return db.lunch.items[id];
  const c = state?.lunch?.custom?.[id];
  return c ? normalizeLunchItem({ ...c, id }, { custom: true }) : null;
}

/** True when a lunch item is offered to this person: an item with `people` is only for the people it names (docs/spec/24 §24.3). */
export function lunchItemFor(item, name) {
  return !item?.people?.length || (!!name && item.people.includes(name));
}

/**
 * Everything that can go in a slot: the library first, then the family's own items.
 * `forName` (when given, even as '') leaves out the items that are only for someone else: the
 * BLT bowl with the tomatoes left out is Jeff's, so Knox's editor doesn't offer it.
 */
export function lunchLibrary(db, state, slot, forName) {
  const lib = (db?.lunch?.itemList || []).filter((x) => x.slot === slot && (forName === undefined || lunchItemFor(x, forName)));
  const custom = Object.entries(state?.lunch?.custom || {})
    .map(([id, c]) => normalizeLunchItem({ ...c, id }, { custom: true }))
    .filter((x) => x && x.slot === slot);
  return [...lib, ...custom];
}

/**
 * A person's lunch setup: the lunches.json default (else off), with whatever the family has
 * changed laid over it field by field: on/off, the days, and each slot's rotation. Edits are
 * saved one field at a time, so two phones changing different parts of Knox's lunches at the
 * same moment both keep their change, and nothing is ever written just to "seed" the defaults.
 */
export function personConfig(db, state, name) {
  const saved = state?.lunch?.people?.[name];
  const base = db?.lunch?.defaults?.[name] ?? { enabled: false, days: [1, 2, 3, 4, 5], slots: {} };
  const own = saved && typeof saved === 'object' ? saved : null;
  const has = (k) => !!own && Object.prototype.hasOwnProperty.call(own, k);
  const removed = own?.removed === true;
  const raw = {
    enabled: !removed && (has('enabled') ? own.enabled : base.enabled),
    days: has('days') && Array.isArray(own.days) ? own.days : base.days,
    slots: { ...(base.slots || {}), ...(own?.slots && typeof own.slots === 'object' ? own.slots : {}) },
  };
  const cfg = normalizeLunchPerson(raw, lunchSlots(db));
  // A thumbs-down on a lunch item takes it out of this person's rotation (§9.2), read lazily.
  const votes = state?.lunchVotes;
  if (votes && typeof votes === 'object') {
    for (const k of Object.keys(cfg.slots)) cfg.slots[k] = cfg.slots[k].filter((id) => votes[id]?.[name] !== -1);
  }
  // Lighter-swap ideas are for the grown-ups' lunches unless the family switches them on for someone.
  const ideas = has('ideas') ? own.ideas === true : PARENTS.includes(name);
  return { ...cfg, saved: !!own, removed, ideas };
}

// ---------------------------------------------------------------- who packs (docs/spec/20)

const START_ORDER = ['Jeff', 'Candi', 'Knox', 'Jordan', 'Jackson'];
const orderOf = (name) => { const i = START_ORDER.indexOf(name); return i < 0 ? START_ORDER.length : i; };

/** The people lunches.json packs for until the family says otherwise (Jeff and Knox). */
export function defaultPackers(db) {
  return Object.entries(db?.lunch?.defaults || {}).filter(([, d]) => d?.enabled).map(([name]) => name);
}

/**
 * Everyone the Lunch page lists: the default packers and anyone the family added, unless removed.
 * A paused person stays listed (nothing packed or bought until resumed). A name that only has an
 * old "off" record from the days of five profiles is not listed: nobody ever packed for them.
 * → [{ name, cfg, paused, isDefault }], packing first, then paused; Jeff and Knox lead.
 */
export function lunchPackers(db, state) {
  const defaults = defaultPackers(db);
  const names = new Set(defaults);
  for (const [name, p] of Object.entries(state?.lunch?.people || {})) {
    if (!p || typeof p !== 'object' || cleanName(name) !== name) continue;
    if (p.enabled === true || p.paused === true) names.add(name);
  }
  const out = [];
  for (const name of names) {
    const cfg = personConfig(db, state, name);
    if (cfg.removed) continue;
    out.push({ name, cfg, paused: !cfg.enabled, isDefault: defaults.includes(name) });
  }
  return out.sort((a, b) => (a.paused - b.paused) || orderOf(a.name) - orderOf(b.name) || a.name.localeCompare(b.name));
}

/** The names lunches are packed (and groceries bought) for right now. */
export function packingNames(db, state) {
  return lunchPackers(db, state).filter((p) => !p.paused).map((p) => p.name);
}

/** Is this someone the Lunch page lists (packing or paused)? */
export function isPacker(db, state, name) {
  return lunchPackers(db, state).some((p) => p.name === name);
}

/**
 * The name a new packer would be saved under, or why not. A removed person's name can be used
 * again; a name that differs only in capitals from one already there is the same person.
 * → { name } | { error }
 */
export function newPackerName(db, state, typed) {
  const name = cleanName(typed);
  if (!name) return { error: 'Type a name first.' };
  const lower = name.toLowerCase();
  const listed = lunchPackers(db, state).find((p) => p.name.toLowerCase() === lower);
  if (listed) return { error: listed.paused ? `${listed.name}’s lunches are paused. Resume them instead.` : `${listed.name} already packs a lunch.` };
  const known = [...Object.keys(db?.lunch?.defaults || {}), ...Object.keys(state?.lunch?.people || {})].find((k) => k.toLowerCase() === lower);
  return { name: known || name };
}

/** This person's thumbs on a lunch item: 1, -1 or 0. */
export function lunchVote(state, itemId, name) {
  const v = state?.lunchVotes?.[itemId]?.[name];
  return v === 1 || v === -1 ? v : 0;
}

/** The older name for lunchPackers(): everyone listed, the ones packing first. */
export function lunchPeople(db, state) {
  return lunchPackers(db, state);
}

export function hasLunchDay(cfg, date) {
  return !!cfg?.enabled && cfg.days.includes(weekday(date));
}

/**
 * How many of this person's packed lunches come before `date` (counting from LUNCH_EPOCH).
 * Skipped days (`skipped`: dates) don't count, so the rotation picks up where it left off:
 * Yoo-hoo Tuesday, no school Wednesday, Capri Sun Thursday — never the same drink twice running.
 */
export function lunchDayIndex(cfg, date, skipped = null) {
  const days = cfg?.days || [];
  if (!days.length) return 0;
  const diff = diffDays(date, LUNCH_EPOCH);
  const weeks = Math.floor(diff / 7);
  const rem = diff - weeks * 7; // 0..6, the weekday since the epoch is a Sunday
  let n = weeks * days.length;
  for (let i = 0; i < rem; i++) if (days.includes(i)) n++;
  for (const d of skipped || []) if (d >= LUNCH_EPOCH && d < date && days.includes(weekday(d))) n--;
  return n;
}

/** The dates this person's lunch is skipped. */
export function skippedDates(state, name) {
  return Object.entries(state?.lunch?.days || {}).filter(([d, byName]) => byName?.[name]?.skip && /^\d{4}-\d{2}-\d{2}$/.test(d)).map(([d]) => d);
}

const mod = (n, m) => ((n % m) + m) % m;

/**
 * One person's lunch on a date, or null if they don't pack lunch that day.
 * → { name, date, skip, reason, note, slots: [{ slot, label, id, item, override, removed, rotation }], items }
 */
export function lunchFor(db, state, name, date) {
  const cfg = personConfig(db, state, name);
  if (!hasLunchDay(cfg, date)) return null;
  const day = state?.lunch?.days?.[date]?.[name] || {};
  const n = lunchDayIndex(cfg, date, skippedDates(state, name));
  const slots = [];
  const items = {};
  for (const sl of lunchSlots(db)) {
    const list = (cfg.slots[sl.id] || []).filter((id) => lunchItem(db, state, id));
    const rotation = list.length ? list[mod(n, list.length)] : null;
    const picks = day.picks || {};
    const override = Object.prototype.hasOwnProperty.call(picks, sl.id);
    const id = override ? picks[sl.id] : rotation;
    const item = id ? lunchItem(db, state, id) : null;
    if (!item && !override) continue;
    slots.push({ slot: sl.id, label: sl.label, id: item ? id : null, item, override, removed: override && !item, rotation, rotationSize: list.length });
    if (item && !day.skip) for (const [k, q] of Object.entries(item.items)) items[k] = (items[k] || 0) + q;
  }
  return { name, date, skip: !!day.skip, reason: day.reason || '', note: day.note || '', slots, items, empty: !slots.some((s) => s.item) };
}

/** Every packed (not skipped) lunch for everyone who packs across the dates. */
export function lunchesIn(db, state, dates) {
  const out = [];
  if (!db?.lunch) return out;
  const names = packingNames(db, state);
  for (const date of dates) {
    for (const name of names) {
      const l = lunchFor(db, state, name, date);
      if (l && !l.skip && !l.empty) out.push(l);
    }
  }
  return out;
}

/** Ingredient needs for the lunches packed on these dates, with where each amount goes. */
export function lunchNeeds(db, state, dates) {
  const needs = {};
  const uses = {};
  const lunches = lunchesIn(db, state, dates);
  for (const l of lunches) {
    for (const [id, qty] of Object.entries(l.items)) {
      needs[id] = (needs[id] || 0) + qty;
      (uses[id] ||= []).push({ date: l.date, person: l.name, qty });
    }
  }
  return { needs, uses, lunches };
}

/** Lighter swaps that apply to this person's rotation (lunches.json `swaps`). */
export function lunchSwapsFor(db, state, name) {
  const cfg = personConfig(db, state, name);
  if (!cfg.enabled || !cfg.ideas) return [];
  const out = [];
  for (const sw of db?.lunch?.swaps || []) {
    const from = lunchItem(db, state, sw.from);
    const to = lunchItem(db, state, sw.to);
    if (!from || !to) continue;
    const list = cfg.slots[from.slot] || [];
    if (list.includes(sw.from) && !list.includes(sw.to)) out.push({ ...sw, slot: from.slot, fromItem: from, toItem: to });
  }
  return out;
}

/** The person's config with `from` replaced by `to` in its slot rotation (order kept). */
export function swappedConfig(db, state, name, from, to) {
  const cfg = personConfig(db, state, name);
  const item = lunchItem(db, state, from);
  if (!item) return null;
  const list = cfg.slots[item.slot] || [];
  const next = [];
  for (const id of list) {
    const v = id === from ? to : id;
    if (!next.includes(v)) next.push(v);
  }
  const { saved, removed, ideas, ...plain } = cfg;
  return { ...plain, slots: { ...plain.slots, [item.slot]: next } };
}
