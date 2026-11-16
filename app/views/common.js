// Bits of markup several views share.
import { html, ic, raw, photo, tf } from '../ui.js';
import { EQUIPMENT_LABELS } from '../config.js';
import { EQUIPMENT_ICON } from '../icons.js';
import { dinnerById, effectiveSides, sideInfo, isFavorite, dinnerSignal, sideSignal } from '../planner.js';
import { lunchVote } from '../lunch.js';
import { listJoin, midSentence, relativeDay, shortWeekday } from '../util.js';
import { AWAY_REASONS } from '../config.js';
import { fmtKcal, hasNutrition } from '../nutrition.js';
import { prepSchedule } from '../prep.js';

/** Calories are shown when nutrition.json is there and this phone hasn't hidden them. */
export const showNutrition = (app) => hasNutrition(app.db) && !app.store?.device?.hideNutrition;

/** "≈ 720 cal  48 g protein" — or "—" when there's no data for it. */
export function nutri(app, n, { suffix = '', compact = false } = {}) {
  if (!showNutrition(app)) return '';
  if (!n) return html`<span class="nutri nutri-none" title="No calorie data for this">—</span>`;
  return html`<span class="nutri ${compact ? 'nutri-compact' : ''}"><span><b>≈ ${fmtKcal(n.kcal)}</b> cal</span><span><b>${Math.round(n.protein)} g</b> protein</span>${suffix ? html`<span class="nutri-suffix">${suffix}</span>` : ''}${n.complete === false ? html`<span class="nutri-suffix">some items not counted</span>` : ''}</span>`;
}

export const isDismissed = (app, key) => (app.store?.device?.dismissed || []).includes(key);

/** A small, kind suggestion. Never more than one sentence, always easy to wave off. */
export function lighterChip(app, { key, text, why = '', action, data = {}, label = 'Use it', kind = 'Lighter idea' }) {
  if (isDismissed(app, key)) return '';
  const attrs = Object.entries(data).map(([k, v]) => `data-${k}="${String(v).replace(/"/g, '&quot;')}"`).join(' ');
  return html`<div class="lighter" role="note">
    <span class="lighter-ic" aria-hidden="true">${ic('leaf', { size: 18 })}</span>
    <p class="lighter-text"><b>${kind}:</b> ${text}${why ? html` <span class="lighter-why">${why}</span>` : ''}</p>
    <span class="lighter-actions">
      <button type="button" class="btn btn-small btn-secondary" data-action="${action}" ${raw(attrs)}>${label}</button>
      <button type="button" class="icon-btn" data-action="lighter:dismiss" data-key="${key}" aria-label="Not now">${ic('close', { size: 18 })}</button>
    </span>
  </div>`;
}

// ---------------------------------------------------------------- thumbs (SPEC §9.2)

/** What each signal is called on screen. */
export const SIGNAL_LABELS = { loved: 'Loved', fine: 'Fine', no: 'Not for us' };

/** The family's one signal for a dinner or a side: 'loved' | 'fine' | 'no' (docs/spec/20). */
export function signalFor(app, kind, id) {
  return kind === 'side' ? sideSignal(app.state, id) : dinnerSignal(app.state, dinnerById(app.db, app.state, id));
}

/**
 * The pressed thumb: 1, -1 or 0. For a dinner or a side it is the family's signal (loved, not for
 * us, fine); a lunch item's thumbs belong to the person who packs that lunch.
 */
export function myThumb(app, kind, id, person = null) {
  if (kind === 'lunch') return lunchVote(app.state, id, person);
  const s = signalFor(app, kind, id);
  return s === 'loved' ? 1 : s === 'no' ? -1 : 0;
}

/**
 * Two thumbs, three answers, one for the whole family: thumbs up = loved (a family favorite),
 * thumbs down = not for us (off the menu), neither = fine. Tapping the pressed one goes back to
 * fine, and every change's message has Undo. kind: 'dinner' | 'side' | 'lunch' (a lunch item's
 * thumbs are for `person`, who packs it).
 */
export function thumbs(app, { kind, id, label, person = null, compact = false }) {
  const mine = myThumb(app, kind, id, person);
  const lunch = kind === 'lunch';
  const whose = lunch && person ? `${person}’s ` : '';
  const data = `data-id="${String(id).replace(/"/g, '&quot;')}"${person ? ` data-person="${person}"` : ''}`;
  const state = mine === 1 ? (lunch ? 'liked' : 'loved') : mine === -1 ? (lunch ? 'out' : 'not for us') : (lunch ? 'no thumbs' : 'fine');
  const up = lunch ? `Thumbs up: keep ${label} in ${whose}lunches` : `Loved: ${label} is a family favorite`;
  const down = lunch ? `Thumbs down: drop ${label} from ${whose}lunches` : `Not for us: take ${label} off the menu`;
  return html`<span class="thumbs ${compact ? 'thumbs-sm' : ''}" role="group" data-signal="${state}" aria-label="${lunch ? `${whose}thumbs for ${label}` : `What the family thinks of ${label}: ${state}`}">
    <button type="button" class="thumb thumb-up ${mine === 1 ? 'is-on' : ''}" aria-pressed="${tf(mine === 1)}" data-action="vote:${kind}" ${raw(data)} data-value="1" aria-label="${up}" title="${lunch ? 'Thumbs up' : 'Loved'}">${ic('up_vote', { size: compact ? 18 : 20 })}</button>
    <button type="button" class="thumb thumb-down ${mine === -1 ? 'is-on' : ''}" aria-pressed="${tf(mine === -1)}" data-action="vote:${kind}" ${raw(data)} data-value="-1" aria-label="${down}" title="${lunch ? 'Thumbs down' : 'Not for us'}">${ic('down_vote', { size: compact ? 18 : 20 })}</button>
  </span>`;
}

/** The dinner and each recipe side, each with the family's thumbs; the row says so once a signal is set. */
export function rateList(app, d, sides) {
  const tag = (what, kind, id) => { const s = signalFor(app, kind, id); return s === 'fine' ? what : `${what} · ${SIGNAL_LABELS[s]}`; };
  return html`<ul class="rate-list">
    <li class="rate-row"><span class="rate-name"><small>${tag('Dinner', 'dinner', d.id)}</small><b>${d.title}</b></span>${thumbs(app, { kind: 'dinner', id: d.id, label: d.title })}</li>
    ${sides.filter((s) => s.parsed.type === 'side' && app.db.sides[s.parsed.id]).map((s) => html`<li class="rate-row"><span class="rate-name"><small>${tag('Side', 'side', s.parsed.id)}</small><b>${s.info?.title}</b></span>${thumbs(app, { kind: 'side', id: s.parsed.id, label: s.info?.title || 'this side' })}</li>`)}
  </ul>`;
}

/** "In for the corn on the cob, which got a thumbs down" — when a side marked "not for us" was swapped on the fly. */
export function replacedText(app, s) {
  const was = s?.replaced ? app.db.sides[s.droppedId]?.title : '';
  return was ? `In for ${was.charAt(0).toLowerCase() + was.slice(1)}, which got a thumbs down` : '';
}
export function replacedNote(app, s) {
  const t = replacedText(app, s);
  return t ? html`<small class="replaced">${t}</small>` : '';
}

export function sidesFor(app, dinnerId, entry) {
  return effectiveSides(app.db, app.state, dinnerId, entry).map((s) => ({ ...s, info: sideInfo(app.db, app.state, s.parsed) }));
}

export function sidesText(app, dinnerId, entry) {
  return listJoin(sidesFor(app, dinnerId, entry).map((s) => s.info?.title).filter(Boolean).map((t, i) => (i ? midSentence(t) : t)));
}

export function dinnerPhoto(app, d, opts = {}) {
  if (!d) return photo(app.db, 'dinner', '', { category: 'Comfort', ...opts });
  return photo(app.db, 'dinner', d.id, { category: d.category, alt: opts.alt ?? '', ...opts });
}

export function sidePhoto(app, s, opts = {}) {
  const kind = s.parsed?.type === 'side' ? 'side' : 'side';
  return photo(app.db, kind, s.parsed?.type === 'side' ? s.parsed.id : '', { sideKind: s.info?.kind || 'vegetable', ...opts });
}

export function equipment(d, { compact = false } = {}) {
  const eq = (d?.equipment || []).filter((e) => EQUIPMENT_LABELS[e]);
  return html`<ul class="facts ${compact ? 'facts-compact' : ''}">
    ${d?.minutes ? html`<li>${ic('clock', { size: 18 })}<span>${d.minutes} min</span></li>` : ''}
    ${eq.map((e) => html`<li>${ic(EQUIPMENT_ICON[e] || 'stovetop', { size: 18 })}<span>${EQUIPMENT_LABELS[e]}</span></li>`)}
  </ul>`;
}

export function favoriteBadge(app, d) {
  return isFavorite(app.state, d) ? html`<span class="badge badge-fav">${ic('star', { size: 14 })}Family favorite</span>` : '';
}

export function awayReason(entry) {
  const r = AWAY_REASONS.find((x) => x.id === entry?.away?.reason) || AWAY_REASONS[4];
  return r;
}

export function nightTitle(app, date) {
  return relativeDay(date, app.today());
}

export function dayStamp(date, today) {
  const isToday = date === today;
  return html`<span class="daystamp ${isToday ? 'is-today' : ''}"><span class="ds-wd">${isToday ? 'Tonight' : shortWeekday(date)}</span><span class="ds-d">${Number(date.slice(8))}</span></span>`;
}

export function entryDinner(app, entry) {
  return entry?.dinner ? dinnerById(app.db, app.state, entry.dinner) : null;
}

export { raw };

// ---------------------------------------------------------------- v2.5: the prep schedule (SPEC §12.5)

const PREP_WHEN = { morning: 'Morning', anytime: 'Today', evening: 'Evening' };
const PREP_ICON = { thaw: 'snow', freeze: 'snow', cook: 'flame', lunch: 'lunch', buy: 'store' };

/** Thaw, cook-once and lunch-packing jobs for the next few days, from the plan and the pantry. */
export function prepCard(app, { days = 7, title = 'Prep schedule', empty = true } = {}) {
  const today = app.today();
  const sched = prepSchedule(app.db, app.state, { today, days });
  if (!sched.length && !empty) return '';
  return html`<section class="prep-card" aria-labelledby="prep-h-${days}">
    <h2 id="prep-h-${days}" class="section-title">${ic('clock', { size: 22 })}${title}</h2>
    ${sched.length ? html`<ol class="prep-days">${sched.map((d) => html`<li class="prep-day">
      <h3 class="prep-date">${d.date === today ? 'Today' : relativeDay(d.date, today)}</h3>
      <ul class="prep-tasks">${d.tasks.map((t) => html`<li class="prep-task prep-${t.kind}"><span class="prep-ic" aria-hidden="true">${ic(PREP_ICON[t.kind] || 'check', { size: 18 })}</span><span class="prep-text"><small>${PREP_WHEN[t.when] || ''}</small>${t.text}</span></li>`)}</ul>
    </li>`)}</ol>` : html`<p class="muted small">Nothing to thaw or pack in the next few days.</p>`}
  </section>`;
}
