// Bits of markup several views share.
import { html, ic, raw, photo, tf } from '../ui.js';
import { EQUIPMENT_LABELS } from '../config.js';
import { EQUIPMENT_ICON } from '../icons.js';
import { dinnerById, effectiveSides, sideInfo, isFavorite } from '../planner.js';
import { lunchVote } from '../lunch.js';
import { listJoin, midSentence, relativeDay, shortWeekday } from '../util.js';
import { AWAY_REASONS } from '../config.js';
import { fmtKcal, hasNutrition } from '../nutrition.js';
import { prepSchedule } from '../prep.js';
import { plateFacts, recipeTimes, fmtMinutes, equipmentLabel, LEFTOVER_REASON } from '../cooking.js';

/** Calories are shown when nutrition.json is there and this phone hasn't hidden them. */
export const showNutrition = (app) => hasNutrition(app.db) && !app.store?.device?.hideNutrition;

/** One plate of a dinner as served: calories, protein, lean (SPEC §22.6). null when there's no data. */
export const plate = (app, dinnerId, entry = null) => plateFacts(app.db, app.state, dinnerId, entry);

/** The quiet "Lean" marker: a leaf and a word, with the reason for anyone who asks. */
export function leanMark(facts, { compact = false } = {}) {
  if (!facts?.lean) return '';
  return html`<span class="lean-mark ${compact ? 'lean-mark-sm' : ''}" title="${facts.why || 'Lighter and high in protein'}">${ic('leaf', { size: compact ? 13 : 15 })}Lean</span>`;
}

/**
 * "≈ 720 cal  48 g protein" — or "—" when there's no data for it. A plate that's lean (plate
 * facts carry `lean`) gets the leaf marker; `lean: false` leaves it off.
 */
export function nutri(app, n, { suffix = '', compact = false, lean = true } = {}) {
  if (!showNutrition(app)) return '';
  if (!n) return html`<span class="nutri nutri-none" title="No calorie data for this">—</span>`;
  return html`<span class="nutri ${compact ? 'nutri-compact' : ''}"><span><b>≈ ${fmtKcal(n.kcal)}</b> cal</span><span><b>${Math.round(n.protein)} g</b> protein</span>${suffix ? html`<span class="nutri-suffix">${suffix}</span>` : ''}${lean ? leanMark(n, { compact }) : ''}${n.complete === false ? html`<span class="nutri-suffix">some items not counted</span>` : ''}</span>`;
}

// A few icons cook mode needs that the shared set doesn't have (same 24×24 hand-drawn stroke).
const COOK_ICONS = {
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  pause: '<path d="M8.5 5.5v13"/><path d="M15.5 5.5v13"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 1.5"/><path d="M9.5 3h5"/><path d="M12 3v3"/>',
  thermo: '<path d="M10 14.5V5.5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0z"/><path d="M12 9.5v7"/>',
  steps: '<path d="M9.5 6.5h10"/><path d="M9.5 12h10"/><path d="M9.5 17.5h10"/><path d="M4.5 6.5h.01"/><path d="M4.5 12h.01"/><path d="M4.5 17.5h.01"/>',
  box: '<path d="M4 8.5l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8.5l8 4 8-4"/><path d="M12 12.5v8"/>',
  plate: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/>',
  cooker: '<path d="M4.5 10.5h15v6a3.5 3.5 0 0 1-3.5 3.5H8a3.5 3.5 0 0 1-3.5-3.5z"/><path d="M3 10.5h18"/><path d="M8.5 7.5c0-1.5 3.5-2.5 3.5-2.5s3.5 1 3.5 2.5"/><path d="M12 5V3.5"/><path d="M10.5 15.5h3"/>',
};
/** An icon from the shared set, or one of cook mode's own. */
export function cic(name, { size = 22 } = {}) {
  const body = COOK_ICONS[name];
  if (!body) return ic(name, { size });
  return raw(`<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`);
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

/** This phone's person's thumb on a dinner, side or lunch item: 1, -1 or 0. */
export function myThumb(app, kind, id, person = null) {
  if (kind === 'lunch') return lunchVote(app.state, id, person);
  const who = app.who();
  const v = (kind === 'side' ? app.state.sideVotes : app.state.votes)?.[id]?.[who];
  return v === 1 || v === -1 ? v : 0;
}

/**
 * Thumbs up / thumbs down. Up keeps it in the rotation; one thumbs-down from anyone drops it
 * (Undo is on the message). kind: 'dinner' | 'side' | 'lunch' (lunch thumbs are for `person`).
 */
export function thumbs(app, { kind, id, label, person = null, compact = false }) {
  const mine = myThumb(app, kind, id, person);
  const whose = kind === 'lunch' && person ? `${person}’s ` : '';
  const data = `data-id="${String(id).replace(/"/g, '&quot;')}"${person ? ` data-person="${person}"` : ''}`;
  return html`<span class="thumbs ${compact ? 'thumbs-sm' : ''}" role="group" aria-label="${whose}thumbs for ${label}">
    <button type="button" class="thumb thumb-up ${mine === 1 ? 'is-on' : ''}" aria-pressed="${tf(mine === 1)}" data-action="vote:${kind}" ${raw(data)} data-value="1" aria-label="Thumbs up: keep ${label}${kind === 'lunch' ? ` in ${whose}lunches` : ' in the rotation'}">${ic('up_vote', { size: compact ? 18 : 20 })}</button>
    <button type="button" class="thumb thumb-down ${mine === -1 ? 'is-on' : ''}" aria-pressed="${tf(mine === -1)}" data-action="vote:${kind}" ${raw(data)} data-value="-1" aria-label="Thumbs down: drop ${label}${kind === 'lunch' ? ` from ${whose}lunches` : ''}">${ic('down_vote', { size: compact ? 18 : 20 })}</button>
  </span>`;
}

/** The dinner and each recipe side, each with thumbs for this phone's person. */
export function rateList(app, d, sides) {
  return html`<ul class="rate-list">
    <li class="rate-row"><span class="rate-name"><small>Dinner</small><b>${d.title}</b></span>${thumbs(app, { kind: 'dinner', id: d.id, label: d.title })}</li>
    ${sides.filter((s) => s.parsed.type === 'side' && app.db.sides[s.parsed.id]).map((s) => html`<li class="rate-row"><span class="rate-name"><small>Side</small><b>${s.info?.title}</b></span>${thumbs(app, { kind: 'side', id: s.parsed.id, label: s.info?.title || 'this side' })}</li>`)}
  </ul>`;
}

/** "In for the corn on the cob, which got a thumbs down" — when a dropped side was swapped on the fly. */
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

/** The name and icon for an appliance id, including ones newer than config.js knows (the PossibleCooker). */
export const equipLabel = (id) => EQUIPMENT_LABELS[id] || equipmentLabel(id);
export const equipIcon = (id, opts) => (EQUIPMENT_ICON[id] ? ic(EQUIPMENT_ICON[id], opts) : id === 'possible cooker' ? cic('cooker', opts) : ic('stovetop', opts));

export function equipment(d, { compact = false } = {}) {
  const eq = (d?.equipment || []).filter(Boolean);
  const t = recipeTimes(d);
  return html`<ul class="facts ${compact ? 'facts-compact' : ''}">
    ${t.total ? html`<li>${ic('clock', { size: 18 })}<span>${fmtMinutes(t.total)}</span></li>` : ''}
    ${eq.map((e) => html`<li>${equipIcon(e, { size: 18 })}<span>${equipLabel(e)}</span></li>`)}
  </ul>`;
}

export function favoriteBadge(app, d) {
  return isFavorite(app.state, d) ? html`<span class="badge badge-fav">${ic('star', { size: 14 })}Family favorite</span>` : '';
}

/** A leftover night is saved as a not-cooking night with its own reason (SPEC §22.5). */
const LEFTOVER_NIGHT = { id: LEFTOVER_REASON, label: 'Leftover night', note: 'Dinner is already in the fridge.' };
export const isLeftoverNight = (entry) => entry?.status === 'away' && entry.away?.reason === LEFTOVER_REASON;

export function awayReason(entry) {
  if (entry?.away?.reason === LEFTOVER_REASON) return LEFTOVER_NIGHT;
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

// ---------------------------------------------------------------- v3: recipes and cooking (SPEC §22)

const WHY_ICON = { use: 'box', pantry: 'pantry', lean: 'leaf', sale: 'budget', fav: 'star', quick: 'clock', plan: 'sparkle' };

/** Why this dinner earns its night: up to three short reasons (cooking.whyThisDinner). */
export function whyList(reasons, { label = 'Why tonight' } = {}) {
  if (!reasons?.length) return '';
  return html`<ul class="why" aria-label="${label}">${reasons.map((r) => html`<li class="why-${r.kind}">${cic(WHY_ICON[r.kind] || 'check', { size: 16 })}<span>${r.text}</span></li>`)}</ul>`;
}

/** The whole plate on one clock: a bar per dish, lined up to finish together. */
export function timelineChart(tl) {
  if (!tl?.tracks?.length || !tl.total) return '';
  const pct = (m) => Math.max(0, Math.min(100, Math.round((m / tl.total) * 1000) / 10));
  const said = tl.tracks.map((t) => `${t.title}: ${t.start ? `start about ${fmtMinutes(t.start)} in` : 'start first'}, ${fmtMinutes(t.minutes)}`).join('. ');
  return html`<div class="tl" role="img" aria-label="About ${fmtMinutes(tl.total)} in all. ${said}.">
    ${tl.tracks.map((t) => html`<div class="tl-row tl-${t.kind} tl-${t.id}" aria-hidden="true">
      <span class="tl-name">${t.title}</span>
      <span class="tl-lane"><span class="tl-bar" style="margin-left:${pct(t.start)}%;width:${Math.max(6, pct(t.minutes))}%"><b>${fmtMinutes(t.minutes)}</b></span></span>
    </div>`)}
    <div class="tl-axis" aria-hidden="true"><span>Start</span><span>Dinner, about ${fmtMinutes(tl.total)} later</span></div>
  </div>`;
}

/** After dinner: how many servings went in the fridge? (`then`: where cook mode goes once it's answered.) */
export function leftoversQuestion(app, date, { then = '', heading = 'Any leftovers?', dish = '' } = {}) {
  return html`<div class="lo-ask" role="group" aria-labelledby="lo-ask-h-${date}">
    <h2 id="lo-ask-h-${date}" class="section-title">${heading}</h2>
    <p class="muted small">${dish ? html`<b>${dish}.</b> ` : ''}How many servings went in the fridge? They’ll wait on Tonight for a lunch or a leftover night, so nothing gets forgotten at the back.</p>
    <div class="lo-nums">${[0, 1, 2, 3, 4, 5, 6].map((n) => html`<button type="button" class="chip chip-lg lo-num" data-action="leftovers:save" data-date="${date}" data-n="${n}" ${then ? html`data-then="${then}"` : ''} aria-label="${n === 0 ? 'No leftovers' : n === 6 ? 'Six or more servings' : `${n} ${n === 1 ? 'serving' : 'servings'}`}">${n === 0 ? 'None' : n === 6 ? '6+' : n}</button>`)}</div>
  </div>`;
}

/**
 * A lighter plate, in hands and halves. General guidance for whoever wants it: no numbers to hit,
 * no food is off the table, and nothing here is about the kids' plates.
 */
export function plateGuide({ dismissKey = '' } = {}) {
  return html`<section class="plate-guide" aria-labelledby="pg-h">
    <svg class="pg-plate" viewBox="0 0 120 120" width="112" height="112" role="img" aria-label="A plate: half vegetables, a quarter protein, a quarter starch">
      <circle cx="60" cy="60" r="56" class="pg-rim"/>
      <path d="M60 60V10A50 50 0 0 0 60 110Z" class="pg-veg"/>
      <path d="M60 60V10A50 50 0 0 1 110 60Z" class="pg-pro"/>
      <path d="M60 60H110A50 50 0 0 1 60 110Z" class="pg-starch"/>
      <path d="M60 10V110M60 60H110" class="pg-lines"/>
    </svg>
    <div class="pg-text">
      <h2 id="pg-h" class="section-title">A lighter plate, if you want one</h2>
      <ul class="pg-list">
        <li><span class="pg-key pg-key-veg" aria-hidden="true"></span><span><b>Half the plate</b> vegetables or salad</span></li>
        <li><span class="pg-key pg-key-pro" aria-hidden="true"></span><span><b>A palm</b> of the meat</span></li>
        <li><span class="pg-key pg-key-starch" aria-hidden="true"></span><span><b>A cupped hand</b> of rice, pasta, potatoes or bread</span></li>
      </ul>
      <p class="muted small">A rough guide for a grown-up who wants to eat a little lighter. Nothing to count, and seconds on the vegetables are always fine. The recipe still makes five full plates.</p>
      ${dismissKey ? html`<button type="button" class="btn btn-small btn-quiet" data-action="lighter:dismiss" data-key="${dismissKey}">Got it</button>` : ''}
    </div>
  </section>`;
}

// ---------------------------------------------------------------- v2.5: the prep schedule (SPEC §12.5)

const PREP_WHEN = { morning: 'Morning', anytime: 'Today', evening: 'Evening' };
const PREP_ICON = { thaw: 'snow', freeze: 'snow', cook: 'flame', lunch: 'lunch', buy: 'store' };

/** Thaw, cook-once and lunch-packing jobs for the next few days, from the plan and the pantry. */
export function prepCard(app, { days = 7, title = 'Prep schedule', empty = true, emptyText = 'Nothing to thaw or pack in the next few days.' } = {}) {
  const today = app.today();
  const sched = prepSchedule(app.db, app.state, { today, days });
  if (!sched.length && !empty) return '';
  return html`<section class="prep-card" aria-labelledby="prep-h-${days}">
    <h2 id="prep-h-${days}" class="section-title">${ic('clock', { size: 22 })}${title}</h2>
    ${sched.length ? html`<ol class="prep-days">${sched.map((d) => html`<li class="prep-day">
      <h3 class="prep-date">${d.date === today ? 'Today' : relativeDay(d.date, today)}</h3>
      <ul class="prep-tasks">${d.tasks.map((t) => html`<li class="prep-task prep-${t.kind}"><span class="prep-ic" aria-hidden="true">${ic(PREP_ICON[t.kind] || 'check', { size: 18 })}</span><span class="prep-text"><small>${PREP_WHEN[t.when] || ''}</small>${t.text}</span></li>`)}</ul>
    </li>`)}</ol>` : html`<p class="muted small">${emptyText}</p>`}
  </section>`;
}
