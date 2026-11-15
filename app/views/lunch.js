// LUNCH (SPEC §8): packed lunches per person — rotations per slot, weekdays by default,
// per-day swaps and skips, an editor for each person, lighter ideas for the grown-ups.
import { html, ic, when, openSheet, closeSheet, renderSheet, avatar, photo, switchToggle, tf } from '../ui.js';
import { FAMILY, PARENTS } from '../config.js';
import { addDays, dateRange, money, rangeLabel, shortDate, startOfWeek, weekday, weekdayName, diffDays, dayWord } from '../util.js';
import {
  lunchPeople, personConfig, lunchFor, lunchLibrary, lunchSlots, lunchItem, isKid, SKIP_REASONS, hasLunchDay,
} from '../lunch.js';
import { lunchNutrition, lunchItemNutrition, lunchSwaps, fmtKcal } from '../nutrition.js';
import { lunchFoodCost } from '../shopping.js';
import {
  skipLunchOps, unskipLunchOps, pickLunchOps, resetLunchPickOps, toggleLunchItemOps, toggleLunchDayOps, setLunchEnabledOps,
  applyLunchSwapOps, addCustomLunchOps,
} from '../actions.js';
import { nutri, showNutrition, lighterChip, isDismissed } from './common.js';

export const title = () => 'Lunch';
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The week the Lunch page opens on: this one, or next week once it's the weekend. */
export function lunchWeekStart(app) {
  if (app.ui.lunchAnchor) return startOfWeek(app.ui.lunchAnchor, 1);
  const today = app.today();
  const wd = weekday(today);
  return startOfWeek(wd === 0 || wd === 6 ? addDays(today, 2) : today, 1);
}

function currentPerson(app) {
  const people = lunchPeople(app.db, app.state, app.who());
  const enabled = people.filter((p) => p.cfg.enabled);
  const want = app.ui.lunchWho;
  if (want && enabled.some((p) => p.name === want)) return want;
  return enabled[0]?.name || null;
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

function dayCard(app, name, date) {
  const today = app.today();
  const l = lunchFor(app.db, app.state, name, date);
  if (!l) return '';
  const past = date < today;
  const n = lunchNutrition(app.db, l);
  const cls = ['lunch-day', l.skip && 'is-skipped', date === today && 'is-today', past && 'is-past'].filter(Boolean).join(' ');
  return html`<article class="${cls}" data-date="${date}">
    <header class="ld-head">
      <span class="ld-day"><b>${date === today ? 'Today' : weekdayName(date)}</b><small>${shortDate(date)}</small></span>
      ${when(!l.skip, () => nutri(app, n, { compact: true }))}
    </header>
    ${l.skip ? html`<div class="ld-skipped"><span>${ic('away', { size: 20 })}</span><p><b>${l.reason || 'No packed lunch'}</b><small>Nothing to pack, and its groceries are off the list.</small></p>
        <button type="button" class="btn btn-small btn-secondary" data-action="lunch:unskip" data-who="${name}" data-date="${date}">Pack it after all</button></div>`
      : l.empty ? html`<p class="muted small">Nothing in ${name}’s rotation yet. Edit ${name}’s lunches to pick items.</p>`
        : html`<ul class="ld-slots">${l.slots.map((s) => slotRow(app, l, s, name, date))}</ul>
        ${when(!past, () => html`<button type="button" class="btn btn-small btn-quiet ld-skip" data-action="lunch:skip" data-who="${name}" data-date="${date}">${ic('away', { size: 18 })}Skip this day</button>`)}`}
  </article>`;
}

const SWAP_KIND = { lighter: 'Lighter idea', protein: 'More protein', idea: 'Idea' };

/** Swap ideas: every one inside the editor; on the week page one at a time (dismiss shows the next). */
function swapIdeas(app, name, { inEditor = false } = {}) {
  // Kids' lunches get ideas only when a parent opens the editor (never on their week page, or on their own phone).
  if (isKid(name) && (!inEditor || !PARENTS.includes(app.who()))) return '';
  const key = (sw) => `lunch:${name}:${sw.from}>${sw.to}`;
  let sws = lunchSwaps(app.db, app.state, name);
  if (!inEditor) sws = sws.filter((sw) => !isDismissed(app, key(sw))).slice(0, 1);
  const extra = (sw) => {
    if (!showNutrition(app) || sw.saves == null) return '';
    if (sw.saves >= 20) return `About ${fmtKcal(sw.saves)} fewer calories a lunch.`;
    if (sw.proteinGain >= 5) return `About ${Math.round(sw.proteinGain)} g more protein${sw.saves <= -20 ? ` and ${fmtKcal(-sw.saves)} more calories` : ''} a lunch.`;
    return '';
  };
  return sws.map((sw) => lighterChip(app, {
    key: key(sw),
    kind: SWAP_KIND[sw.kind] || 'Idea',
    text: `${sw.toItem.title} instead of ${sw.fromItem.title}.`,
    why: [sw.why, extra(sw)].filter(Boolean).join(' '),
    action: 'lunch:swap',
    data: { who: name, from: sw.from, to: sw.to },
  }));
}

export function render(app) {
  const today = app.today();
  const start = lunchWeekStart(app);
  const week = dateRange(start, 7);
  const people = lunchPeople(app.db, app.state, app.who());
  const enabled = people.filter((p) => p.cfg.enabled);
  const off = people.filter((p) => !p.cfg.enabled);
  const name = currentPerson(app);
  if (!app.db.lunch?.available) {
    return html`<div class="page page-lunch"><header class="page-head"><h1 class="page-title">Lunch</h1></header>
      <div class="empty"><span class="empty-ic">${ic('lunch', { size: 28 })}</span><h3 class="empty-title">The lunch library hasn’t loaded</h3>
      <p class="empty-body">Check the connection and open this page again. Dinners, the list and everything else still work.</p></div></div>`;
  }
  const cfg = name ? personConfig(app.db, app.state, name) : null;
  const days = name ? week.filter((d) => hasLunchDay(cfg, d)) : [];
  const lunches = days.map((d) => lunchFor(app.db, app.state, name, d)).filter((l) => l && !l.skip && !l.empty);
  const food = lunches.reduce((t, l) => t + lunchFoodCost(app.db, app.state, l), 0);
  const isThisWeek = week.includes(today) || (start > today && diffDays(start, today) <= 2);
  return html`<div class="page page-lunch">
    <header class="page-head"><h1 class="page-title">Lunch</h1></header>
    <div class="people" role="tablist" aria-label="Whose lunches">
      ${enabled.map((p) => html`<button type="button" role="tab" class="person ${p.name === name ? 'is-on' : ''}" aria-selected="${tf(p.name === name)}" data-action="lunch:who" data-who="${p.name}">${avatar(p.name, { size: 'sm' })}<span>${p.name}</span></button>`)}
      ${when(off.length, () => html`<button type="button" class="person person-add" data-action="lunch:add">${ic('plus', { size: 18 })}<span>Add a person</span></button>`)}
    </div>
    ${!name ? html`<div class="empty"><span class="empty-ic">${ic('lunch', { size: 28 })}</span><h3 class="empty-title">No one’s lunches are planned</h3>
        <p class="empty-body">Lunches are optional. Add a person and pick what they like; it repeats every school or work day.</p>
        <div class="empty-actions"><button type="button" class="btn btn-primary" data-action="lunch:add">Add a person</button></div></div>`
      : html`
      <div class="period-nav period-nav-sm">
        <button type="button" class="icon-btn" data-action="lunch:shift" data-dir="-1" aria-label="Previous week">${ic('left')}</button>
        <p class="period-label" aria-live="polite"><b>${rangeLabel(days[0] || start, days[days.length - 1] || addDays(start, 6))}</b><small>${isThisWeek ? (start > today ? 'Next week' : 'This week') : start > today ? 'Coming up' : 'Past'}</small></p>
        <button type="button" class="icon-btn" data-action="lunch:shift" data-dir="1" aria-label="Next week">${ic('right')}</button>
      </div>
      <section class="lunch-person" aria-labelledby="lp-h">
        <div class="lp-head">
          <div><h2 id="lp-h" class="section-title">${name}’s lunches</h2>
            <p class="muted small">${lunches.length} packed this week${food > 0 ? `, about ${money(food)} of food` : ''}. ${cfg.days.length === 5 && [1, 2, 3, 4, 5].every((d) => cfg.days.includes(d)) ? 'Weekdays.' : `${cfg.days.map((d) => DAY_SHORT[d]).join(', ') || 'No days picked'}.`}</p></div>
          <button type="button" class="btn btn-small btn-secondary" data-action="lunch:edit" data-who="${name}">${ic('edit', { size: 18 })}Edit ${name}’s lunches</button>
        </div>
        ${swapIdeas(app, name)}
        ${days.length ? html`<div class="lunch-days">${days.map((d) => dayCard(app, name, d))}</div>`
          : html`<p class="empty-body pad">No lunch days picked for ${name}. Edit ${name}’s lunches to choose days.</p>`}
      </section>
      <p class="muted small lunch-foot">${showNutrition(app) ? 'Calories count packed lunches and dinners at home; breakfast and snacks aren’t tracked. ' : ''}Lunch groceries are on the <a href="#/list" data-action="lunch:tolist">shopping list</a>, marked Lunch.</p>`}
  </div>`;
}

// ---------------------------------------------------------------- sheets

function openEditor(app, name) {
  const st = { custom: false };
  openSheet({
    id: `lunch-edit:${name}`,
    live: true,
    size: 'tall',
    title: `Edit ${name}’s lunches`,
    subtitle: 'Pick items for each spot. They rotate in the order you pick them, one per lunch day.',
    render: () => {
      const cfg = personConfig(app.db, app.state, name);
      return html`
        <div class="set-row"><span class="set-label">Pack lunches for ${name}<small>${cfg.enabled ? 'On. Groceries go on the list.' : 'Off. Nothing is packed or bought.'}</small></span>
          ${switchToggle({ on: cfg.enabled, action: 'lunch:enable', data: { who: name }, label: `Pack lunches for ${name}` })}</div>
        <fieldset class="field"><legend class="field-label">Days</legend><div class="chip-grid days-pick">
          ${[1, 2, 3, 4, 5, 6, 0].map((d) => html`<button type="button" class="chip ${cfg.days.includes(d) ? 'is-on' : ''}" aria-pressed="${tf(cfg.days.includes(d))}" data-action="lunch:day" data-who="${name}" data-day="${d}">${DAY_SHORT[d]}</button>`)}
        </div></fieldset>
        ${swapIdeas(app, name, { inEditor: true })}
        ${lunchSlots(app.db).map((sl) => {
          const list = cfg.slots[sl.id] || [];
          const lib = lunchLibrary(app.db, app.state, sl.id);
          return html`<section class="ed-slot" aria-labelledby="ed-${sl.id}">
            <h3 id="ed-${sl.id}" class="sheet-h">${sl.label}<small>${list.length > 1 ? `${list.length} in rotation` : list.length ? 'Every day' : 'None packed'}</small></h3>
            <ul class="ed-list">${lib.map((it) => {
              const pos = list.indexOf(it.id);
              const n = lunchItemNutrition(app.db, it);
              return html`<li><button type="button" class="ed-item ${pos >= 0 ? 'is-on' : ''}" aria-pressed="${tf(pos >= 0)}" data-action="lunch:toggle" data-who="${name}" data-slot="${sl.id}" data-id="${it.id}">
                <span class="ed-pos" aria-hidden="true">${pos >= 0 ? pos + 1 : ''}</span>
                ${lunchPhoto(app, it, sl.id)}
                <span class="ed-main"><b>${it.title}</b><small>${[it.subtitle, showNutrition(app) && n ? `${fmtKcal(n.kcal)} cal, ${Math.round(n.protein)} g protein` : '', it.custom ? 'Added by the family' : ''].filter(Boolean).join(' ')}</small></span>
              </button></li>`;
            })}</ul>
          </section>`;
        })}
        <form class="form form-inline-card" data-submit="lunch:custom" data-who="${name}">
          <p class="field-label">Add your own</p>
          <input class="input" name="title" placeholder="Pickle spears" required maxlength="50" aria-label="Item name">
          <select class="input" name="slot" aria-label="Which spot">${lunchSlots(app.db).map((sl) => html`<option value="${sl.id}">${sl.label}</option>`)}</select>
          <button type="submit" class="btn btn-secondary btn-block">Add to ${name}’s lunches</button>
          <p class="muted small">It goes on the shopping list without a price; tap it there to add one.</p>
        </form>`;
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
      const lib = lunchLibrary(app.db, app.state, slot);
      return html`
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

function openAdd(app) {
  openSheet({
    id: 'lunch-add',
    title: 'Add a person',
    subtitle: 'Lunches are optional. Each person picks their own.',
    render: () => {
      const off = lunchPeople(app.db, app.state, app.who()).filter((p) => !p.cfg.enabled);
      return off.length ? html`<div class="who-grid">${off.map((p) => html`<button type="button" class="who-pick" data-action="lunch:enable-new" data-who="${p.name}">${avatar(p.name, { size: 'lg' })}<span>${p.name}</span></button>`)}</div>`
        : html`<p class="sheet-text">Everyone already packs lunch.</p>`;
    },
  });
}

export const actions = {
  'lunch:who': (app, el) => { app.ui.lunchWho = el.dataset.who; app.render(); },
  'lunch:shift': (app, el) => { app.ui.lunchAnchor = addDays(lunchWeekStart(app), 7 * Number(el.dataset.dir)); app.render(); },
  'lunch:edit': (app, el) => openEditor(app, el.dataset.who),
  'lunch:add': (app) => openAdd(app),
  'lunch:enable-new': (app, el) => {
    const name = el.dataset.who;
    app.commit(setLunchEnabledOps(app.db, app.state, { name, enabled: true }));
    app.ui.lunchWho = name;
    openEditor(app, name);
  },
  'lunch:enable': (app, el) => {
    const name = el.dataset.who;
    const on = personConfig(app.db, app.state, name).enabled;
    app.commit(setLunchEnabledOps(app.db, app.state, { name, enabled: !on }));
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

export { FAMILY, lunchItem };
