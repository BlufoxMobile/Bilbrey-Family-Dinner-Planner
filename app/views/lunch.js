// LUNCH (SPEC §8, docs/spec/20): packed lunches for whoever packs one — Jeff and Knox to start
// with, plus anyone the family adds. Rotations per slot, weekdays by default, per-day swaps and
// skips, an editor for each person (pause or remove them there), lighter ideas where wanted.
import { html, ic, when, openSheet, closeSheet, renderSheet, avatar, personStyle, photo, switchToggle, tf, confirmSheet } from '../ui.js';
import { addDays, dateRange, money, rangeLabel, shortDate, startOfWeek, weekday, weekdayName, diffDays, dayWord, listJoin, hourIn } from '../util.js';
import {
  lunchPackers, personConfig, lunchFor, lunchLibrary, lunchSlots, lunchItem, SKIP_REASONS, hasLunchDay, lunchVote, newPackerName,
} from '../lunch.js';
import { lunchNutrition, lunchItemNutrition, lunchSwaps, fmtKcal } from '../nutrition.js';
import { lunchFoodCost } from '../shopping.js';
import {
  skipLunchOps, unskipLunchOps, pickLunchOps, resetLunchPickOps, toggleLunchItemOps, toggleLunchDayOps, setLunchEnabledOps,
  applyLunchSwapOps, addCustomLunchOps, addLunchPersonOps, pauseLunchPersonOps, removeLunchPersonOps, setLunchIdeasOps,
} from '../actions.js';
import { nutri, showNutrition, lighterChip, isDismissed, thumbs } from './common.js';

export const title = () => 'Lunch';
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAYS = [1, 2, 3, 4, 5];

/** The week the Lunch page opens on: this one, or next week once it's the weekend. */
export function lunchWeekStart(app) {
  if (app.ui.lunchAnchor) return startOfWeek(app.ui.lunchAnchor, 1);
  const today = app.today();
  const wd = weekday(today);
  return startOfWeek(wd === 0 || wd === 6 ? addDays(today, 2) : today, 1);
}

/** Whose week is showing: the one tapped, else the first person who packs (a paused one if that's all there is). */
function currentPerson(app, people) {
  const want = app.ui.lunchWho;
  if (want && people.some((p) => p.name === want)) return want;
  return people[0]?.name || null;
}

function lunchPhoto(app, item, slot, size = 'thumb') {
  return photo(app.db, 'lunch', item?.id || '', { sideKind: slot, size, alt: '' });
}

function slotRow(app, l, s, name, date) {
  const n = s.item ? lunchItemNutrition(app.db, s.item) : null;
  return html`<li><button type="button" class="ld-slot ${s.removed ? 'is-removed' : ''}" data-action="lunch:slot" data-who="${name}" data-date="${date}" data-slot="${s.slot}" aria-label="${s.label}: ${s.item ? s.item.title : 'left out'}. Change it for this day">
    ${lunchPhoto(app, s.item, s.slot)}
    <span class="ld-main"><small>${s.label}${s.override ? ' (just this day)' : ''}</small><b>${s.item ? s.item.title : 'Left out this day'}</b></span>
    ${when(showNutrition(app) && s.item, () => html`<span class="ld-kcal">${n ? `${fmtKcal(n.kcal)} cal` : '—'}</span>`)}
  </button></li>`;
}

function dayCard(app, name, date, { packTonight = false } = {}) {
  const today = app.today();
  const l = lunchFor(app.db, app.state, name, date);
  if (!l) return '';
  const past = date < today;
  const n = lunchNutrition(app.db, l);
  const cls = ['lunch-day', l.skip && 'is-skipped', (packTonight || (date === today && !packTonightAny(app))) && 'is-today', past && 'is-past'].filter(Boolean).join(' ');
  return html`<article class="${cls}" data-date="${date}">
    <header class="ld-head">
      <span class="ld-day"><b>${date === today ? 'Today' : date === addDays(today, 1) ? 'Tomorrow' : weekdayName(date)}</b><small>${packTonight ? 'Pack it tonight' : shortDate(date)}</small></span>
      ${when(!l.skip, () => nutri(app, n, { compact: true }))}
    </header>
    ${l.skip ? html`<div class="ld-skipped"><span>${ic('away', { size: 20 })}</span><p><b>${l.reason || 'No packed lunch'}</b><small>Nothing to pack, and its groceries are off the list.</small></p>
        <button type="button" class="btn btn-small btn-secondary" data-action="lunch:unskip" data-who="${name}" data-date="${date}">Pack it after all</button></div>`
      : l.empty ? html`<p class="muted small">Nothing in ${name}’s rotation yet. Edit ${name}’s lunches to pick items.</p>`
        : html`<ul class="ld-slots">${l.slots.map((s) => slotRow(app, l, s, name, date))}</ul>
        ${when(!past, () => html`<button type="button" class="btn btn-small btn-quiet ld-skip" data-action="lunch:skip" data-who="${name}" data-date="${date}">${ic('away', { size: 18 })}Skip this day</button>`)}`}
  </article>`;
}

/** After 2 PM, the lunch to think about is tomorrow's (gauntlet r1). */
const packTonightAny = (app) => hourIn(new Date()) >= 14;

/**
 * Everyone's next lunch on one card (gauntlet r4: packing meant reading one person, tapping the next,
 * reading again). Just what goes in the bag, no calories; the tabs below stay for changing things.
 */
function packCard(app, people) {
  const today = app.today();
  const day = packTonightAny(app) ? addDays(today, 1) : today;
  const rows = people.filter((p) => !p.paused).map((p) => ({ name: p.name, l: lunchFor(app.db, app.state, p.name, day) }))
    .filter((r) => r.l && !r.l.empty);
  if (!rows.length) return '';
  const label = day === today ? 'Today’s lunches' : day === addDays(today, 1) ? 'Tomorrow’s lunches' : `${weekdayName(day)}’s lunches`;
  return html`<section class="pack-card" aria-labelledby="pack-h">
    <h2 id="pack-h" class="section-title">${ic('lunch', { size: 22 })}<span>${label}</span>${day !== today ? html`<small class="pack-when">Pack them tonight</small>` : ''}</h2>
    <ul class="pack-list">${rows.map((r) => html`<li><b style="${personStyle(r.name)}">${r.name}</b><span>${r.l.skip ? html`<i>${r.l.reason || 'No packed lunch'}</i>` : listJoin(r.l.slots.filter((s) => s.item).map((s) => s.item.title))}</span></li>`)}</ul>
  </section>`;
}

const SWAP_KIND = { lighter: 'Lighter idea', protein: 'More protein', idea: 'Idea' };

/**
 * Swap ideas, only for a person whose lunches have them switched on (the grown-ups to start with;
 * never pushed at a kid's lunch). Every one inside the editor; on the week page one at a time
 * (dismiss shows the next).
 */
function swapIdeas(app, name, { inEditor = false } = {}) {
  const key = (sw) => `lunch:${name}:${sw.from}>${sw.to}`;
  let sws = lunchSwaps(app.db, app.state, name);
  if (!inEditor) sws = sws.filter((sw) => !isDismissed(app, key(sw))).slice(0, 1);
  const extra = (sw) => {
    if (!showNutrition(app) || sw.saves == null) return '';
    if (sw.saves >= 20) return ` (about ${fmtKcal(sw.saves)} fewer calories)`;
    if (sw.proteinGain >= 5) return ` (about ${Math.round(sw.proteinGain)} g more protein)`;
    return '';
  };
  // One line each (gauntlet r3): the swap and, when it's worth saying, the one number.
  return sws.map((sw) => lighterChip(app, {
    key: key(sw),
    kind: SWAP_KIND[sw.kind] || 'Idea',
    text: `${sw.toItem.title} instead of ${sw.fromItem.title}${extra(sw)}.`,
    why: '',
    action: 'lunch:swap',
    data: { who: name, from: sw.from, to: sw.to },
  }));
}

const daysText = (cfg) => (cfg.days.length === 5 && WEEKDAYS.every((d) => cfg.days.includes(d)) ? 'Weekdays' : DAY_ORDER.filter((d) => cfg.days.includes(d)).map((d) => DAY_SHORT[d]).join(', ') || 'No days picked');

/** "Jeff and Knox" — the people lunch groceries are being bought for right now. */
export function packingLine(app) {
  return listJoin(lunchPackers(app.db, app.state).filter((p) => !p.paused).map((p) => p.name));
}

function pausedCard(name) {
  return html`<section class="lunch-person lunch-paused" aria-labelledby="lp-h">
    <h2 id="lp-h" class="section-title">${name}’s lunches are paused</h2>
    <p class="muted">Nothing is packed for ${name}, and their lunch groceries are off the shopping list. What ${name} likes is kept for when lunches start again.</p>
    <div class="lp-paused-actions">
      <button type="button" class="btn btn-primary" data-action="lunch:resume" data-who="${name}">Start ${name}’s lunches again</button>
      <button type="button" class="btn btn-secondary" data-action="lunch:edit" data-who="${name}">${ic('edit', { size: 18 })}Edit</button>
      <button type="button" class="btn btn-danger-quiet" data-action="lunch:remove" data-who="${name}">Remove ${name}</button>
    </div>
  </section>`;
}

export function render(app) {
  const today = app.today();
  const start = lunchWeekStart(app);
  const week = dateRange(start, 7);
  if (!app.db.lunch?.available) {
    return html`<div class="page page-lunch"><header class="page-head"><h1 class="page-title">Lunch</h1></header>
      <div class="empty"><span class="empty-ic">${ic('lunch', { size: 28 })}</span><h3 class="empty-title">The lunch library hasn’t loaded</h3>
      <p class="empty-body">Check the connection and open this page again. Dinners, the list and everything else still work.</p></div></div>`;
  }
  const people = lunchPackers(app.db, app.state);
  const name = currentPerson(app, people);
  const person = people.find((p) => p.name === name) || null;
  const cfg = person?.cfg || null;
  const days = person && !person.paused ? week.filter((d) => hasLunchDay(cfg, d)) : [];
  const lunches = days.map((d) => lunchFor(app.db, app.state, name, d)).filter((l) => l && !l.skip && !l.empty);
  const food = lunches.reduce((t, l) => t + lunchFoodCost(app.db, app.state, l), 0);
  const isThisWeek = week.includes(today) || (start > today && diffDays(start, today) <= 2);
  const packing = packingLine(app);
  // The next lunch to pack comes first: today's, or tomorrow's after 2 PM; days gone by go last.
  const focus = days.find((d) => d >= (packTonightAny(app) ? addDays(today, 1) : today)) || null;
  const ordered = focus ? [...days.filter((d) => d >= focus), ...days.filter((d) => d < focus)] : days;
  return html`<div class="page page-lunch">
    <header class="page-head"><h1 class="page-title">Lunch</h1></header>
    ${packCard(app, people)}
    <div class="people" role="tablist" aria-label="Whose lunches">
      ${people.map((p) => html`<button type="button" role="tab" class="person ${p.name === name ? 'is-on' : ''} ${p.paused ? 'is-paused' : ''}" style="${personStyle(p.name)}" aria-selected="${tf(p.name === name)}" data-action="lunch:who" data-who="${p.name}">${avatar(p.name, { size: 'sm' })}<span>${p.name}${p.paused ? html`<small> · paused</small>` : ''}</span></button>`)}
    </div>
    ${!person ? html`<div class="empty"><span class="empty-ic">${ic('lunch', { size: 28 })}</span><h3 class="empty-title">No one’s lunches are planned</h3>
        <p class="empty-body">Lunches are optional. Add whoever packs one and pick what they like; it repeats every school or work day, and its groceries join the shopping list.</p>
        <div class="empty-actions"><button type="button" class="btn btn-primary" data-action="lunch:add">Add a person</button></div></div>`
      : person.paused ? pausedCard(name)
      : html`
      <div class="period-nav period-nav-sm">
        <button type="button" class="icon-btn" data-action="lunch:shift" data-dir="-1" aria-label="Previous week">${ic('left')}</button>
        <p class="period-label" aria-live="polite"><b>${rangeLabel(days[0] || start, days[days.length - 1] || addDays(start, 6))}</b><small>${isThisWeek ? (start > today ? 'Next week' : 'This week') : start > today ? 'Coming up' : 'Past'}</small></p>
        <button type="button" class="icon-btn" data-action="lunch:shift" data-dir="1" aria-label="Next week">${ic('right')}</button>
      </div>
      <section class="lunch-person" aria-labelledby="lp-h">
        <div class="lp-head">
          <div><h2 id="lp-h" class="section-title">${name}’s lunches</h2>
            <p class="muted small">${lunches.length} packed this week${food > 0 ? `, about ${money(food)} of food` : ''}. ${daysText(cfg)}.</p></div>
          <button type="button" class="btn btn-small btn-secondary" data-action="lunch:edit" data-who="${name}">${ic('edit', { size: 18 })}Edit ${name}’s lunches</button>
        </div>
        ${days.length ? html`<div class="lunch-days">${days.filter((d) => !focus || d >= focus).map((d) => dayCard(app, name, d, { packTonight: d === focus && focus !== today }))}</div>
          ${when(focus && days.some((d) => d < focus), () => { const earlier = days.filter((d) => d < focus); return html`<details class="lunch-earlier"><summary>Earlier this week (${earlier.length})</summary><div class="lunch-days">${earlier.map((d) => dayCard(app, name, d))}</div></details>`; })}`
          : html`<p class="empty-body pad">No lunch days picked for ${name}. Edit ${name}’s lunches to choose days.</p>`}
      </section>`}
    ${when(person, () => html`<p class="muted small lunch-foot">${packing
      ? html`Lunch groceries go on the <a href="#/list" data-action="lunch:tolist">shopping list</a> for ${packing} only.`
      : html`No lunches are being packed, so no lunch groceries are on the <a href="#/list" data-action="lunch:tolist">shopping list</a>.`} <button type="button" class="link-btn" data-action="lunch:add">Add a person</button></p>`)}
  </div>`;
}

// ---------------------------------------------------------------- sheets

function openEditor(app, name) {
  openSheet({
    id: `lunch-edit:${name}`,
    live: true,
    size: 'tall',
    title: `Edit ${name}’s lunches`,
    subtitle: 'Pick items for each spot. They rotate in the order you pick them, one per lunch day.',
    render: () => {
      const cfg = personConfig(app.db, app.state, name);
      if (cfg.removed) return html`<p class="sheet-text">${name} is off the lunch plan. Tap Undo on the message, or add them again from the Lunch page.</p>`;
      return html`
        <div class="set-row"><span class="set-label">Pack lunches for ${name}<small>${cfg.enabled ? 'On. Groceries go on the list.' : 'Paused. Nothing is packed or bought.'}</small></span>
          ${switchToggle({ on: cfg.enabled, action: 'lunch:enable', data: { who: name }, label: `Pack lunches for ${name}` })}</div>
        <fieldset class="field"><legend class="field-label">Days</legend><div class="chip-grid days-pick">
          ${DAY_ORDER.map((d) => html`<button type="button" class="chip ${cfg.days.includes(d) ? 'is-on' : ''}" aria-pressed="${tf(cfg.days.includes(d))}" data-action="lunch:day" data-who="${name}" data-day="${d}">${DAY_SHORT[d]}</button>`)}
        </div></fieldset>
        <div class="set-row"><span class="set-label">Lighter swap ideas<small>${cfg.ideas ? `On. A gentle idea now and then for ${name}’s lunches.` : `Off. No swap ideas for ${name}’s lunches.`}</small></span>
          ${switchToggle({ on: cfg.ideas, action: 'lunch:ideas', data: { who: name }, label: `Lighter swap ideas for ${name}’s lunches` })}</div>
        ${lunchSlots(app.db).map((sl) => {
          const list = cfg.slots[sl.id] || [];
          const lib = lunchLibrary(app.db, app.state, sl.id, name);
          return html`<section class="ed-slot" aria-labelledby="ed-${sl.id}">
            <h3 id="ed-${sl.id}" class="sheet-h">${sl.label}<small>${list.length > 1 ? `${list.length} in rotation` : list.length ? 'Every day' : 'None packed'}</small></h3>
            <ul class="ed-list">${lib.map((it) => {
              const pos = list.indexOf(it.id);
              const n = lunchItemNutrition(app.db, it);
              return html`<li><button type="button" class="ed-item ${pos >= 0 ? 'is-on' : ''}" aria-pressed="${tf(pos >= 0)}" data-action="lunch:toggle" data-who="${name}" data-slot="${sl.id}" data-id="${it.id}">
                <span class="ed-pos" aria-hidden="true">${pos >= 0 ? pos + 1 : ''}</span>
                ${lunchPhoto(app, it, sl.id)}
                <span class="ed-main"><b>${it.title}</b><small>${[lunchVote(app.state, it.id, name) === -1 ? `${name} gave it a thumbs down. Tap to put it back.` : '', it.subtitle, showNutrition(app) && n ? `${fmtKcal(n.kcal)} cal, ${Math.round(n.protein)} g protein` : '', it.custom ? 'Added by the family' : ''].filter(Boolean).join(' ')}</small></span>
              </button></li>`;
            })}</ul>
          </section>`;
        })}
        ${swapIdeas(app, name, { inEditor: true })}
        <form class="form form-inline-card" data-submit="lunch:custom" data-who="${name}">
          <p class="field-label">Add your own</p>
          <input class="input" name="title" placeholder="Pickle spears" required maxlength="50" aria-label="Item name">
          <select class="input" name="slot" aria-label="Which spot">${lunchSlots(app.db).map((sl) => html`<option value="${sl.id}">${sl.label}</option>`)}</select>
          <button type="submit" class="btn btn-secondary btn-block">Add to ${name}’s lunches</button>
          <p class="muted small">It goes on the shopping list without a price; tap it there to add one.</p>
        </form>
        <div class="ed-remove">
          <button type="button" class="btn btn-danger-quiet btn-block" data-action="lunch:remove" data-who="${name}">${ic('trash', { size: 18 })}Remove ${name} from lunches</button>
          <p class="muted small">To stop for a while and keep these picks, switch “Pack lunches for ${name}” off instead.</p>
        </div>`;
    },
  });
}

function openSlot(app, name, date, slot) {
  openSheet({
    id: `lunch-slot:${name}:${date}:${slot}`,
    live: true,
    size: 'tall',
    get title() { return `${dayWord(date, app.today()) === 'Tonight' ? 'Today' : weekdayName(date)}: ${name}’s ${lunchSlots(app.db).find((s) => s.id === slot)?.label.toLowerCase() || 'item'}`; },
    subtitle: 'Changes just this day. The rotation picks up again tomorrow.',
    render: () => {
      const l = lunchFor(app.db, app.state, name, date);
      const cur = l?.slots.find((s) => s.slot === slot);
      const lib = lunchLibrary(app.db, app.state, slot, name).filter((it) => lunchVote(app.state, it.id, name) !== -1 || it.id === cur?.id);
      return html`
        ${when(cur?.item, () => html`<div class="rate-row rate-row-lunch"><span class="rate-name"><small>Does ${name} like it?</small><b>${cur.item.title}</b></span>${thumbs(app, { kind: 'lunch', id: cur.id, person: name, label: cur.item.title })}</div>
          <p class="muted small">A thumbs down takes it out of ${name}’s lunches for good (it’s still in the library to add back).</p>`)}
        <ul class="pick-list">${lib.map((it) => {
          const n = lunchItemNutrition(app.db, it);
          const on = cur?.id === it.id;
          return html`<li><button type="button" class="pick-row ${on ? 'is-current' : ''}" data-action="lunch:pick" data-who="${name}" data-date="${date}" data-slot="${slot}" data-id="${it.id}" ${on ? html`aria-current="true"` : ''}>
            ${lunchPhoto(app, it, slot)}
            <span class="pick-main"><b>${it.title}</b><small>${[it.id === cur?.rotation ? 'The usual for this day' : '', showNutrition(app) && n ? `${fmtKcal(n.kcal)} cal` : ''].filter(Boolean).join(', ')}</small></span>
          </button></li>`;
        })}</ul>
        <div class="sheet-actions">
          ${when(cur?.override, () => html`<button type="button" class="btn btn-secondary btn-block" data-action="lunch:reset" data-who="${name}" data-date="${date}" data-slot="${slot}">Back to the usual rotation</button>`)}
          ${when(cur?.item, () => html`<button type="button" class="btn btn-quiet btn-block" data-action="lunch:pick" data-who="${name}" data-date="${date}" data-slot="${slot}" data-id="">Leave it out this day</button>`)}
        </div>`;
    },
  });
}

function openSkip(app, name, date) {
  openSheet({
    id: `lunch-skip:${name}:${date}`,
    title: `No packed lunch for ${name}?`,
    subtitle: `${weekdayName(date)}, ${shortDate(date)}. Its groceries come off the list.`,
    render: () => html`<div class="action-list">${SKIP_REASONS.map((r) => html`<button type="button" class="action-row" data-action="lunch:skip-save" data-who="${name}" data-date="${date}" data-reason="${r.id}">${ic(r.id === 'Buying lunch' ? 'store' : r.id === 'No school' ? 'home' : 'away')}<span><b>${r.label}</b></span></button>`)}</div>`,
  });
}

// ---------------------------------------------------------------- add a person (docs/spec/20)

/** What's been filled in on the "Add a person" sheet so far (it redraws as spots and items are tapped). */
let adding = null;
const freshAdd = () => ({ name: '', days: [...WEEKDAYS], on: { main: true, drink: true }, slots: {}, error: '' });

function openAdd(app) {
  adding = freshAdd();
  openSheet({
    id: 'lunch-add',
    size: 'tall',
    title: 'Add a person',
    subtitle: 'Anyone who packs a lunch. Their items join the shopping list; change, pause or remove them any time.',
    onClose: () => { adding = null; },
    render: () => {
      const st = adding || freshAdd();
      const slots = lunchSlots(app.db);
      const count = slots.reduce((t, sl) => t + (st.on[sl.id] ? (st.slots[sl.id] || []).length : 0), 0);
      return html`<form class="form add-person" data-submit="lunch:add-save" autocomplete="off">
        <label class="field"><span class="field-label">Name</span>
          <input class="input" id="lunch-add-name" name="name" required maxlength="24" value="${st.name}" placeholder="Candi" data-input="lunch:add-name" autocapitalize="words" autocorrect="off" spellcheck="false" enterkeyhint="done" autofocus></label>
        <fieldset class="field"><legend class="field-label">Lunch days</legend><div class="chip-grid days-pick">
          ${DAY_ORDER.map((d) => html`<button type="button" class="chip ${st.days.includes(d) ? 'is-on' : ''}" aria-pressed="${tf(st.days.includes(d))}" data-action="lunch:add-day" data-day="${d}">${DAY_SHORT[d]}</button>`)}
        </div></fieldset>
        <fieldset class="field"><legend class="field-label">What they pack<small> Tap a spot to add it, then pick from the lunch list.</small></legend><div class="chip-grid">
          ${slots.map((sl) => html`<button type="button" class="chip ${st.on[sl.id] ? 'is-on' : ''}" aria-pressed="${tf(!!st.on[sl.id])}" data-action="lunch:add-slot" data-slot="${sl.id}">${sl.label}</button>`)}
        </div></fieldset>
        ${slots.filter((sl) => st.on[sl.id]).map((sl) => {
          const list = st.slots[sl.id] || [];
          return html`<section class="ed-slot" aria-labelledby="add-${sl.id}">
            <h3 id="add-${sl.id}" class="sheet-h">${sl.label}<small>${list.length > 1 ? `${list.length} in rotation` : list.length ? 'Every day' : 'Pick one or more'}</small></h3>
            <ul class="ed-list">${lunchLibrary(app.db, app.state, sl.id, st.name.trim()).map((it) => {
              const pos = list.indexOf(it.id);
              const n = lunchItemNutrition(app.db, it);
              return html`<li><button type="button" class="ed-item ${pos >= 0 ? 'is-on' : ''}" aria-pressed="${tf(pos >= 0)}" data-action="lunch:add-item" data-slot="${sl.id}" data-id="${it.id}">
                <span class="ed-pos" aria-hidden="true">${pos >= 0 ? pos + 1 : ''}</span>
                ${lunchPhoto(app, it, sl.id)}
                <span class="ed-main"><b>${it.title}</b><small>${[it.subtitle, showNutrition(app) && n ? `${fmtKcal(n.kcal)} cal, ${Math.round(n.protein)} g protein` : ''].filter(Boolean).join(' ')}</small></span>
              </button></li>`;
            })}</ul>
          </section>`;
        })}
        ${when(st.error, () => html`<p class="form-error" role="alert">${st.error}</p>`)}
        <div class="sheet-actions add-person-actions">
          <button type="submit" class="btn btn-primary btn-block">${st.name.trim() ? `Add ${st.name.trim()}` : 'Add this person'}${count ? ` with ${count} ${count === 1 ? 'item' : 'items'}` : ''}</button>
        </div>
      </form>`;
    },
  });
}

async function removePerson(app, name) {
  const ok = await confirmSheet({
    title: `Remove ${name} from lunches?`,
    body: `${name}’s lunches come off the plan and their lunch groceries come off the shopping list. Their picks are forgotten; to keep them, pause instead.`,
    confirm: `Remove ${name}`,
    danger: true,
  });
  if (!ok) return;
  if (app.commit(removeLunchPersonOps(app.db, app.state, { name })) && app.ui.lunchWho === name) app.ui.lunchWho = null;
  app.render();
}

export const actions = {
  'lunch:who': (app, el) => { app.ui.lunchWho = el.dataset.who; app.render(); },
  'lunch:shift': (app, el) => { app.ui.lunchAnchor = addDays(lunchWeekStart(app), 7 * Number(el.dataset.dir)); app.render(); },
  'lunch:edit': (app, el) => openEditor(app, el.dataset.who),
  'lunch:add': (app) => openAdd(app),
  'lunch:add-name': (app, el) => {
    if (!adding) return;
    adding.name = el.value;
    // Only the button's words follow the typing; redrawing the sheet would fight the keyboard.
    const btn = el.form?.querySelector('button[type=submit]');
    const n = Object.entries(adding.slots).reduce((t, [k, v]) => t + (adding.on[k] ? v.length : 0), 0);
    if (btn) btn.textContent = `${el.value.trim() ? `Add ${el.value.trim()}` : 'Add this person'}${n ? ` with ${n} ${n === 1 ? 'item' : 'items'}` : ''}`;
  },
  'lunch:add-day': (app, el) => {
    if (!adding) return;
    const d = Number(el.dataset.day);
    adding.days = adding.days.includes(d) ? adding.days.filter((x) => x !== d) : [...adding.days, d].sort();
    renderSheet();
  },
  'lunch:add-slot': (app, el) => {
    if (!adding) return;
    adding.on[el.dataset.slot] = !adding.on[el.dataset.slot];
    renderSheet();
  },
  'lunch:add-item': (app, el) => {
    if (!adding) return;
    const { slot, id } = el.dataset;
    const list = adding.slots[slot] || [];
    adding.slots[slot] = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
    adding.error = '';
    renderSheet();
  },
  'lunch:add-save': (app, form) => {
    if (!adding) return;
    delete form.dataset.submitted;
    adding.name = String(new FormData(form).get('name') || adding.name || '');
    const check = newPackerName(app.db, app.state, adding.name);
    const slots = Object.fromEntries(Object.entries(adding.slots).filter(([k]) => adding.on[k]));
    const res = check.error ? { error: true, message: check.error } : addLunchPersonOps(app.db, app.state, { name: adding.name, days: adding.days, slots, at: new Date() });
    if (res.error) { adding.error = res.message; renderSheet(); return; }
    const { name, count } = res;
    closeSheet();
    app.commit(res);
    app.ui.lunchWho = name;
    app.render();
    if (!count) openEditor(app, name); // nothing picked yet: go straight to choosing
  },
  // An older page still open may send this: it lands on the same "Add a person" sheet.
  'lunch:enable-new': (app) => openAdd(app),
  'lunch:enable': (app, el) => {
    const name = el.dataset.who;
    const on = personConfig(app.db, app.state, name).enabled;
    app.commit(setLunchEnabledOps(app.db, app.state, { name, enabled: !on }));
  },
  'lunch:resume': (app, el) => app.commit(pauseLunchPersonOps(app.db, app.state, { name: el.dataset.who, paused: false })),
  'lunch:remove': (app, el) => removePerson(app, el.dataset.who),
  'lunch:ideas': (app, el) => {
    const name = el.dataset.who;
    app.commit(setLunchIdeasOps(app.db, app.state, { name, on: !personConfig(app.db, app.state, name).ideas }), { quiet: true });
  },
  'lunch:day': (app, el) => app.commit(toggleLunchDayOps(app.db, app.state, { name: el.dataset.who, day: Number(el.dataset.day) }), { quiet: true }),
  'lunch:toggle': (app, el) => app.commit(toggleLunchItemOps(app.db, app.state, { name: el.dataset.who, slot: el.dataset.slot, id: el.dataset.id }), { quiet: true }),
  'lunch:custom': (app, form) => {
    const f = new FormData(form);
    const res = addCustomLunchOps(app.db, app.state, { title: f.get('title'), slot: String(f.get('slot') || 'main'), name: form.dataset.who });
    if (app.commit(res)) { form.reset(); delete form.dataset.submitted; }
  },
  'lunch:slot': (app, el) => openSlot(app, el.dataset.who, el.dataset.date, el.dataset.slot),
  'lunch:pick': (app, el) => {
    app.commit(pickLunchOps(app.db, app.state, { name: el.dataset.who, date: el.dataset.date, slot: el.dataset.slot, id: el.dataset.id || null }));
    closeSheet();
  },
  'lunch:reset': (app, el) => { app.commit(resetLunchPickOps(app.db, app.state, { name: el.dataset.who, date: el.dataset.date, slot: el.dataset.slot })); closeSheet(); },
  'lunch:skip': (app, el) => openSkip(app, el.dataset.who, el.dataset.date),
  'lunch:skip-save': (app, el) => {
    app.commit(skipLunchOps(app.db, app.state, { name: el.dataset.who, date: el.dataset.date, reason: el.dataset.reason, today: app.today() }));
    closeSheet();
  },
  'lunch:unskip': (app, el) => app.commit(unskipLunchOps(app.db, app.state, { name: el.dataset.who, date: el.dataset.date })),
  'lunch:swap': (app, el) => { app.commit(applyLunchSwapOps(app.db, app.state, { name: el.dataset.who, from: el.dataset.from, to: el.dataset.to })); renderSheet(); },
  'lunch:tolist': (app, el, ev) => { ev.preventDefault(); app.ui.listFilter = 'lunches'; app.navigate('#/list'); },
};

export { lunchItem };
