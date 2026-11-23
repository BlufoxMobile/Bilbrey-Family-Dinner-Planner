// Bits of markup several views share.
import { html, ic, raw, photo, tf, when } from '../ui.js';
import { EQUIPMENT_LABELS } from '../config.js';
import { EQUIPMENT_ICON } from '../icons.js';
import { dinnerById, effectiveSides, sideInfo, isFavorite, dinnerSignal, sideSignal } from '../planner.js';
import { lunchVote } from '../lunch.js';
import { listJoin, midSentence, relativeDay, shortWeekday, weekdayName, hourIn, fmtQty } from '../util.js';
import { AWAY_REASONS } from '../config.js';
import { fmtKcal, hasNutrition } from '../nutrition.js';
import { prepSchedule, thawNow, prepKey, prepDone } from '../prep.js';
import { dinnerCost, costLine } from '../cost.js';
import { plateFacts, timeLabel, fmtMinutes, equipmentLabel, LEFTOVER_REASON, leftoversOnHand, leftoversToAsk, leftoverNightChoices, servingsText, useByText } from '../cooking.js';

/** Calories are shown when nutrition.json is there and this phone hasn't hidden them. */
export const showNutrition = (app) => hasNutrition(app.db) && !app.store?.device?.hideNutrition;

// ---------------------------------------------------------------- what a meal costs (docs/spec/24 §24.7)

const COSTS = new WeakMap();
/**
 * What a dinner costs as it would be served that night, worked out once per change to the family's
 * data (a screen may ask for the same dinner many times, and the recipe box asks for all of them).
 * → cost.dinnerCost's result, or null for a dinner that isn't there.
 */
export function costOf(app, dinnerId, entry = null) {
  const state = app.state;
  if (!state || typeof state !== 'object' || !dinnerId) return null;
  const today = app.today();
  let m = COSTS.get(state);
  if (!m || m.db !== app.db || m.today !== today) COSTS.set(state, (m = { db: app.db, today, map: new Map() }));
  const k = `${dinnerId}|${Array.isArray(entry?.sides) ? entry.sides.join(',') : ''}`;
  if (!m.map.has(k)) m.map.set(k, dinnerCost(app.db, state, dinnerId, entry, { today }));
  return m.map.get(k);
}

const dollarsOf = (n) => `$${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`;
/**
 * The cost line for a card: "about $3.26 a serving · $16.30 for five", the plate's price in bold.
 * `short` is just the serving. `house` adds how much of it is already in the pantry. A fact beside
 * the calories, never a verdict: no colour, no target. '' when nothing prices the dinner.
 */
export function costNote(cost, { short = false, house = false, tag = 'p', cls = '' } = {}) {
  const text = costLine(cost, { short });
  if (!text) return '';
  const at = text.search(/\$[\d.,]+/);
  const amount = at < 0 ? '' : text.slice(at).match(/^\$[\d.,]+/)[0];
  const had = house && cost.pantryValue >= 0.5
    ? (cost.pantryValue >= cost.total - 0.005 ? ' All of it is already in the house.' : ` ${dollarsOf(cost.pantryValue)} of it is already in the house.`)
    : '';
  const body = at < 0 ? html`${text}` : html`${text.slice(0, at)}<b>${amount}</b>${text.slice(at + amount.length)}`;
  return html`<${raw(tag)} class="cost-line ${cls}">${body}${had ? html`<span class="cost-have">${short ? '' : '.'}${had}</span>` : ''}</${raw(tag)}>`;
}

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
export function thumbs(app, { kind, id, label, person = null, compact = false, labels = false }) {
  const mine = myThumb(app, kind, id, person);
  const lunch = kind === 'lunch';
  const whose = lunch && person ? `${person}’s ` : '';
  const data = `data-id="${String(id).replace(/"/g, '&quot;')}"${person ? ` data-person="${person}"` : ''}`;
  const state = mine === 1 ? (lunch ? 'liked' : 'loved') : mine === -1 ? (lunch ? 'out' : 'not for us') : (lunch ? 'no thumbs' : 'fine');
  const up = lunch ? `Thumbs up: keep ${label} in ${whose}lunches` : `Loved: ${label} is a family favorite`;
  const down = lunch ? `Thumbs down: drop ${label} from ${whose}lunches` : `Not for us: take ${label} off the menu`;
  // Labelled thumbs say what they do (gauntlet r1: bare thumbs were a guess); the words are the
  // family's two signals, "Loved" and "Not for us".
  const upWord = lunch ? 'Keep' : 'Loved';
  const downWord = lunch ? 'Drop' : 'Not for us';
  return html`<span class="thumbs ${compact ? 'thumbs-sm' : ''} ${labels ? 'thumbs-labelled' : ''}" role="group" data-signal="${state}" aria-label="${lunch ? `${whose}thumbs for ${label}` : `What the family thinks of ${label}: ${state}`}">
    <button type="button" class="thumb thumb-up ${mine === 1 ? 'is-on' : ''}" aria-pressed="${tf(mine === 1)}" data-action="vote:${kind}" ${raw(data)} data-value="1" aria-label="${up}" title="${lunch ? 'Thumbs up' : 'Loved'}">${ic('up_vote', { size: compact ? 18 : 20 })}${labels ? html`<span>${upWord}</span>` : ''}</button>
    <button type="button" class="thumb thumb-down ${mine === -1 ? 'is-on' : ''}" aria-pressed="${tf(mine === -1)}" data-action="vote:${kind}" ${raw(data)} data-value="-1" aria-label="${down}" title="${lunch ? 'Thumbs down' : 'Not for us'}">${ic('down_vote', { size: compact ? 18 : 20 })}${labels ? html`<span>${downWord}</span>` : ''}</button>
  </span>`;
}

/** The dinner and each recipe side, each with the family's thumbs; the row says so once a signal is set. */
export function rateList(app, d, sides) {
  const tag = (what, kind, id) => { const s = signalFor(app, kind, id); return s === 'fine' ? what : `${what} · ${SIGNAL_LABELS[s]}`; };
  return html`<ul class="rate-list">
    <li class="rate-row"><span class="rate-name"><small>${tag('Dinner', 'dinner', d.id)}</small><b>${d.title}</b></span>${thumbs(app, { kind: 'dinner', id: d.id, label: d.title, labels: true })}</li>
    ${sides.filter((s) => s.parsed.type === 'side' && app.db.sides[s.parsed.id]).map((s) => html`<li class="rate-row"><span class="rate-name"><small>${tag('Side', 'side', s.parsed.id)}</small><b>${s.info?.title}</b></span>${thumbs(app, { kind: 'side', id: s.parsed.id, label: s.info?.title || 'this side', labels: true })}</li>`)}
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

/** The name and icon for an appliance id (a pot for one config.js doesn't know yet). */
export const equipLabel = (id) => EQUIPMENT_LABELS[id] || equipmentLabel(id);
export const equipIcon = (id, opts) => ic(EQUIPMENT_ICON[id] || 'stovetop', opts);

export function equipment(d, { compact = false } = {}) {
  const eq = (d?.equipment || []).filter(Boolean);
  const time = timeLabel(d);
  return html`<ul class="facts ${compact ? 'facts-compact' : ''}">
    ${time ? html`<li>${ic('clock', { size: 18 })}<span>${time}</span></li>` : ''}
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
    <h2 id="lo-ask-h-${date}" class="section-title" tabindex="-1">${heading}</h2>
    <p class="muted small">${dish ? html`<b>${dish}.</b> ` : ''}How many servings went in the fridge?</p>
    <div class="lo-nums">${[0, 1, 2, 3, 4, 5, 6].map((n) => html`<button type="button" class="chip chip-lg lo-num" data-action="leftovers:save" data-date="${date}" data-n="${n}" ${then ? html`data-then="${then}"` : ''} aria-label="${n === 0 ? 'No leftovers' : n === 6 ? 'Six or more servings' : `${n} ${n === 1 ? 'serving' : 'servings'}`}">${n === 0 ? 'None' : n === 6 ? '6+' : n}</button>`)}</div>
  </div>`;
}

/**
 * The one leftovers question for a cooked night nobody has answered (tonight's, or last night's),
 * as a card: shown on Tonight, Plan and Pantry, and gone everywhere once it's answered.
 */
export function leftoversAskCard(app) {
  const today = app.today();
  const date = leftoversToAsk(app.state, today);
  if (!date || isDismissed(app, `leftovers:${date}`)) return '';
  const d = dinnerById(app.db, app.state, app.state.plan[date].dinner);
  return html`<section class="tcard lo-card">
    ${leftoversQuestion(app, date, { heading: date === today ? 'Any leftovers tonight?' : 'Any leftovers from last night?', dish: d?.title || '' })}
    <button type="button" class="btn btn-small btn-quiet" data-action="lighter:dismiss" data-key="leftovers:${date}">Don’t ask</button>
  </section>`;
}

/**
 * Leftovers in the fridge, each with what can be done with it: eat one, a leftover night, a lunch
 * or the freezer, or gone (thrown out goes in the waste log). Shared by Tonight and Plan. '' when none.
 */
export function leftoverRows(app) {
  const today = app.today();
  const left = leftoversOnHand(app.state, today);
  if (!left.length) return '';
  return html`<ul class="lo-list">${left.map((l) => {
    const nights = l.night ? [] : leftoverNightChoices(app.state, l, today);
    return html`<li class="lo-row ${l.daysLeft < 0 ? 'is-late' : l.daysLeft <= 0 ? 'is-due' : ''}">
      <span class="lo-main"><b>${l.title}</b><small>Leftovers: ${servingsText(l.servings)}, ${useByText(l, today)}${l.night ? `. Set for ${l.night === today ? 'tonight' : weekdayName(l.night)}’s leftover night` : ''}.</small></span>
      <span class="lo-acts">
        ${when(l.daysLeft >= 0, () => html`<button type="button" class="btn btn-small btn-secondary" data-action="leftovers:more" data-date="${l.date}" aria-haspopup="dialog" aria-label="Use the ${l.title} leftovers: a serving, a leftover night, a lunch or the freezer">Use them…</button>`)}
        ${l.daysLeft < 0
          ? html`<button type="button" class="btn btn-small btn-quiet" data-action="leftovers:gone" data-date="${l.date}" data-tossed="1" aria-label="The ${l.title} leftovers were thrown out">Tossed</button>`
          : html`<button type="button" class="btn btn-small btn-quiet" data-action="leftovers:gone" data-date="${l.date}" aria-label="The ${l.title} leftovers are all gone">All gone</button>`}
      </span>
    </li>`;
  })}</ul>`;
}

/**
 * One dinner, two plates (docs/spec/25 §25.5): the same pot feeds the grown-up who wants a lighter
 * plate and the one who needs a fuller one. In hands and halves: no numbers to hit, no food is off
 * the table, and nothing here is about the kids' plates.
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
      <h2 id="pg-h" class="section-title">One dinner, two plates</h2>
      <h3 class="pg-sub">A lighter plate, if you want one</h3>
      <ul class="pg-list">
        <li><span class="pg-key pg-key-veg" aria-hidden="true"></span><span><b>Half the plate</b> vegetables or salad</span></li>
        <li><span class="pg-key pg-key-pro" aria-hidden="true"></span><span><b>A palm</b> of the meat</span></li>
        <li><span class="pg-key pg-key-starch" aria-hidden="true"></span><span><b>A cupped hand</b> of rice, pasta, potatoes or bread</span></li>
      </ul>
      <h3 class="pg-sub">A fuller plate, if you need one</h3>
      <ul class="pg-list pg-fuller">
        <li><span class="pg-key pg-key-starch" aria-hidden="true"></span><span><b>Start with what sounds best</b>, and take a full scoop of the rice, pasta, potatoes or bread</span></li>
        <li><span class="pg-key pg-key-pro" aria-hidden="true"></span><span><b>Add something rich</b>: butter or cheese on the vegetables, extra sauce, a glass of milk</span></li>
        <li><span class="pg-key pg-key-veg" aria-hidden="true"></span><span><b>A small plate still counts</b>: eat what you can now and have the rest as a snack later</span></li>
      </ul>
      <p class="muted small">Rough guides for the grown-ups, from the same pot. Nothing to count, seconds are always fine, and the recipe still makes five full plates.</p>
      ${dismissKey ? html`<button type="button" class="btn btn-small btn-quiet" data-action="lighter:dismiss" data-key="${dismissKey}">Got it</button>` : ''}
    </div>
  </section>`;
}

// ---------------------------------------------------------------- v2.5: the prep schedule (SPEC §12.5)

const PREP_WHEN = { morning: 'Morning', anytime: 'Any time', evening: 'Evening' };
const PREP_ICON = { thaw: 'snow', freeze: 'snow', cook: 'flame', lunch: 'lunch', buy: 'store', slow: 'clock', use: 'info', leftovers: 'bowl', catchup: 'pantry' };
/** A prep job with something to tap (SPEC §21): a link to the pantry or the plan (`nav`), or an action. */
const prepAction = (a) => (a.name === 'nav'
  ? html`<a class="btn btn-small btn-secondary prep-act" href="${a.data?.href || '#/tonight'}">${a.label}</a>`
  : prepActionButton(a));
const prepActionButton = (a) => html`<button type="button" class="btn btn-small btn-secondary prep-act" data-action="${a.name}" ${raw(Object.entries(a.data || {}).map(([k, v]) => `data-${k}="${String(v).replace(/"/g, '&quot;')}"`).join(' '))}>${a.label}</button>`;

/** Thaw, cook-once and lunch-packing jobs for the next few days, from the plan and the pantry. */
// The folded Thaw & prep (Plan) stays open while ticking jobs off: a redraw would close it (gauntlet r5).
let prepFoldOpen = false;
if (typeof document !== 'undefined') document.addEventListener('toggle', (ev) => { if (ev.target?.classList?.contains('prep-fold')) prepFoldOpen = ev.target.open; }, true);

export function prepCard(app, { days = 7, title = 'Thaw & prep', countSuffix = '', empty = true, emptyText = 'Nothing to thaw or pack in the next few days.', skip = [], collapsed = false, skipTonightThaw = false } = {}) {
  const today = app.today();
  // skipTonightThaw: Tonight already says it right above "Start cooking".
  const all = prepSchedule(app.db, app.state, { today, days })
    .map((d) => ({ ...d, tasks: d.tasks.filter((t) => !skip.includes(t.kind) && !(skipTonightThaw && t.kind === 'thaw' && t.forDate === today && t.date === today)) }));
  // A job ticked off is gone for everyone (gauntlet r4); the count of done ones stays as a quiet line.
  const doneCount = all.reduce((k, d) => k + d.tasks.filter((t) => prepDone(app.state, d.date, t)).length, 0);
  const sched = all.map((d) => ({ ...d, tasks: d.tasks.filter((t) => !prepDone(app.state, d.date, t)) })).filter((d) => d.tasks.length);
  if (!sched.length && !empty && !doneCount) return '';
  // A morning job still undone in the afternoon is a "now" job, not a "morning" one.
  const late = hourIn(new Date()) >= 12;
  const whenLabel = (d, t) => (d.date === today && t.when === 'morning' && late ? 'Now' : PREP_WHEN[t.when] || '');
  const body = sched.length ? html`<ol class="prep-days">${sched.map((d) => html`<li class="prep-day">
      <h3 class="prep-date">${d.date === today ? 'Today' : relativeDay(d.date, today)}</h3>
      <ul class="prep-tasks">${d.tasks.map((t) => html`<li class="prep-task prep-${t.kind}"><span class="prep-ic" aria-hidden="true">${ic(PREP_ICON[t.kind] || 'check', { size: 18 })}</span><span class="prep-text"><small>${whenLabel(d, t)}</small>${t.text}${t.action ? prepAction(t.action) : ''}</span>${when(t.kind !== 'use', () => html`<button type="button" class="prep-check" role="checkbox" aria-checked="false" data-action="prep:done" data-date="${d.date}" data-key="${prepKey(t)}" aria-label="Done: ${t.text}"><span class="check-box">${ic('check', { size: 18 })}</span></button>`)}</li>`)}</ul>
    </li>`)}</ol>${when(doneCount, () => html`<p class="muted small prep-done-line" id="prep-done-${days}" tabindex="-1">${ic('checkCircle', { size: 16 })}${doneCount} ${doneCount === 1 ? 'job' : 'jobs'} done</p>`)}` : html`<p class="muted small prep-done-line" id="prep-done-${days}" tabindex="-1">${doneCount ? `All done${days === 1 ? ' for today' : ''}.` : emptyText}</p>`;
  if (collapsed) {
    const n = sched.reduce((k, d) => k + d.tasks.length, 0);
    return html`<details class="prep-card prep-fold" id="prep-card-${days}" ${prepFoldOpen ? 'open' : ''}><summary class="section-title">${ic('clock', { size: 22 })}<span>${title}</span><small>${n ? `${n} ${n === 1 ? 'job' : 'jobs'}${countSuffix}` : 'nothing yet'}</small></summary>${body}</details>`;
  }
  return html`<section class="prep-card" id="prep-card-${days}" aria-labelledby="prep-h-${days}">
    <h2 id="prep-h-${days}" class="section-title">${ic('clock', { size: 22 })}${title}</h2>
    ${body}
  </section>`;
}

/** "Still frozen? Thaw the 2 lb lean ground beef in cold water now, about 1 hr." (Tonight and cook mode's Get ready.) */
export function thawLine(app, today, { skip = [] } = {}) {
  // skip: meat Tonight's "Only ¾ lb of the 2 lb … is here, and it's frozen" already speaks for.
  const t = thawNow(app.db, app.state, today).filter((x) => !skip.includes(x.id));
  if (!t.length) return '';
  const time = (m) => (m >= 60 ? `${Math.round((m / 60) * 2) / 2} ${m >= 90 ? 'hrs' : 'hr'}` : `${m} min`);
  const what = listJoin(t.map((x) => `${x.unit === 'lb' ? `${fmtQty(Math.round(x.qty * 4) / 4)} lb ` : ''}${x.what}`));
  const longest = Math.max(0, ...t.map((x) => x.minutes || 0));
  return html`<p class="hero-thaw" role="note">${ic('snow', { size: 20 })}<span><b>Still frozen?</b> Thaw the ${what} in cold water now${longest ? `, about ${time(longest)}` : ''}.</span></p>`;
}
