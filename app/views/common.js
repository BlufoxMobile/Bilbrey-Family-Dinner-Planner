// Bits of markup several views share.
import { html, ic, raw, photo } from '../ui.js';
import { EQUIPMENT_LABELS } from '../config.js';
import { EQUIPMENT_ICON } from '../icons.js';
import { dinnerById, effectiveSides, sideInfo, isFavorite } from '../planner.js';
import { listJoin, relativeDay, shortWeekday } from '../util.js';
import { AWAY_REASONS } from '../config.js';

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
