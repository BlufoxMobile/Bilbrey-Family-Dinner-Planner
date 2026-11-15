// Bits of markup several views share.
import { html, ic, raw, photo } from '../ui.js';
import { EQUIPMENT_LABELS } from '../config.js';
import { EQUIPMENT_ICON } from '../icons.js';
import { dinnerById, effectiveSides, sideInfo, isFavorite } from '../planner.js';
import { listJoin, relativeDay, shortWeekday } from '../util.js';
import { AWAY_REASONS } from '../config.js';
import { fmtKcal, hasNutrition } from '../nutrition.js';

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

export function sidesFor(app, dinnerId, entry) {
  return effectiveSides(app.db, app.state, dinnerId, entry).map((s) => ({ ...s, info: sideInfo(app.db, app.state, s.parsed) }));
}

export function sidesText(app, dinnerId, entry) {
  return listJoin(sidesFor(app, dinnerId, entry).map((s) => s.info?.title).filter(Boolean));
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
