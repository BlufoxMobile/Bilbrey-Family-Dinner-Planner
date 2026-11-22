// Sheets shared by Tonight, Plan and Recipes: a night's actions, picking a dinner,
// moving/swapping, not eating at home, substituting sides, the family's signal, sync.
import { html, ic, when, openSheet, closeSheet, toast, renderSheet, confirmSheet, stepper, sheetId, tf } from '../ui.js';
import { AWAY_REASONS } from '../config.js';
import {
  addDays, datesBetween, diffDays, fmtQty, longDay, relativeDay, shortDate, shortWeekday, isISODate, weekdayName, dayWord, dayAndDate, byLabel,
} from '../util.js';
import {
  dinnerById, rotationList, findInPlan, openNights, parseSideRef, shelfRef, sideInfo, isFavorite, kindOf,
  dinnerFeasibleAt, sideSlotsFor, isRetired, isSideDropped,
} from '../planner.js';
import {
  placeDinnerOps, moveDisplacedOps, markAwayOps, bringBackOps, markCookedOps, unmarkCookedOps, substituteOps,
  resetSideOps, clearNightOps, generateOps, customItemOps, setPantryOps, nightName, awayBlock, bringBackTripOps,
  voteOps, sideVoteOps, lunchVoteOps, saveLeftoversOps, useLeftoverOps, clearLeftoversOps, leftoverNightOps,
  leftoverLunchChoices, leftoverLunchOps, freezeLeftoversOps, tossLeftoversOps,
} from '../actions.js';
import {
  sidesFor, dinnerPhoto, sidePhoto, equipment, favoriteBadge, awayReason, nutri, showNutrition, lighterChip, thumbs, replacedNote,
  plate, leanMark, isLeftoverNight, leftoversQuestion, costOf, costNote,
} from './common.js';
import { sideNutrition, lighterSide, fmtKcal } from '../nutrition.js';
import { leftoversOnHand, leftoverNightChoices, servingsText, useByText, timeLabel } from '../cooking.js';
import { finishCooking } from './cook.js';
import { waitText } from '../state.js';
import { fmtMinutes } from '../data.js';

const STORE_NAMES = { sams: "Sam's Club", jewel: 'Jewel-Osco' };

// ---------------------------------------------------------------- "not for us" asks first

/** "Take X off the menu for everyone?" Reopens the night sheet it came from, either way. */
async function confirmOff(app, { title, promoted = null, nights = 0, side = false }) {
  const from = sheetId();
  const night = /^night:(\d{4}-\d{2}-\d{2})$/.exec(from || '')?.[1];
  const name = title || (side ? 'This side' : 'This dinner');
  const what = side ? 'Dinners that have it get a similar side.'
    : promoted ? `${promoted} joins the menu${nights ? ` and takes its ${nights === 1 ? 'planned night' : `${nights} planned nights`} after tonight` : ''}. Tonight stays as it is.` : 'Tonight stays as it is.';
  const ok = await confirmSheet({
    title: `Take ${name} off the menu for everyone?`,
    body: `It won’t be planned again. ${what} You can bring it back from Recipes, Not for us.`,
    confirm: 'Take it off the menu',
    cancel: 'Keep it',
  });
  if (night) openNight(app, night);
  return ok;
}

// ---------------------------------------------------------------- night sheet

export function openNight(app, date) {
  openSheet({
    id: `night:${date}`,
    live: true,
    size: 'tall',
    get title() { return relativeDay(date, app.today()) === 'Tonight' ? `Tonight, ${shortDate(date)}` : `${weekdayName(date)}, ${shortDate(date)}`; },
    render: () => nightBody(app, date),
  });
}

function nightBody(app, date) {
  const today = app.today();
  const e = app.state.plan?.[date];
  const d = e?.dinner ? dinnerById(app.db, app.state, e.dinner) : null;
  const past = date < today;
  if (e?.status === 'away') {
    const r = awayReason(e);
    const trip = awayBlock(app.state, date).filter((x) => x >= today);
    if (isLeftoverNight(e)) {
      return html`
        <div class="away-card away-card-sheet">
          <span class="away-ic">${ic('bowl', { size: 26 })}</span>
          <div><p class="away-title">${r.label}</p><p class="away-note">${e.away?.note || r.note}</p></div>
        </div>
        <p class="sheet-text">Reheat it until it’s steaming hot all the way through (165°F).${d ? ` ${d.title} was planned; its groceries are off the list.` : ''}</p>
        <div class="action-list">
          <button type="button" class="action-row" data-action="night:back" data-date="${date}">${ic('flame')}<span><b>${d ? `Cook ${d.title} after all` : 'Cook something after all'}</b><small>${d ? 'Its groceries go back on the list.' : 'Then pick a dinner for the night.'}</small></span></button>
        </div>`;
    }
    return html`
      <div class="away-card away-card-sheet">
        <span class="away-ic">${ic('moon', { size: 26 })}</span>
        <div><p class="away-title">${r.label}</p><p class="away-note">${e.away?.note || r.note}</p></div>
      </div>
      ${when(d, () => html`<p class="sheet-text">${d.title} was planned. Its groceries are off the list while you’re away.</p>`)}
      <div class="action-list">
        ${when(trip.length > 1, () => html`<button type="button" class="action-row" data-action="night:back-trip" data-date="${date}">${ic('home')}<span><b>We’re home all ${trip.length} nights</b><small>${shortDate(trip[0])} – ${shortDate(trip[trip.length - 1])} go back on the plan.</small></span></button>`)}
        <button type="button" class="action-row" data-action="night:back" data-date="${date}">${ic('home')}<span><b>${d ? `Bring back ${d.title}` : 'We’re home after all'}</b><small>${d ? 'Its groceries go back on the list.' : 'Then pick a dinner for the night.'}</small></span></button>
        <button type="button" class="action-row" data-action="night:away" data-date="${date}">${ic('edit')}<span><b>Change the nights or reason</b></span></button>
      </div>`;
  }
  if (!d) {
    return html`
      <p class="sheet-text">Nothing is planned ${past ? 'for that night' : 'yet'}.</p>
      <div class="action-list">
        ${when(!past, () => html`<button type="button" class="action-row" data-action="night:auto" data-date="${date}">${ic('sparkle')}<span><b>Pick one for me</b><small>Uses the house rules and the pantry.</small></span></button>`)}
        <button type="button" class="action-row" data-action="night:pick" data-date="${date}">${ic('recipes')}<span><b>Choose a dinner</b></span></button>
        ${when(!past, () => html`<button type="button" class="action-row" data-action="night:away" data-date="${date}">${ic('away')}<span><b>Not eating at home</b></span></button>`)}
      </div>`;
  }
  const sides = sidesFor(app, d.id, e);
  const cooked = e.status === 'cooked';
  const slots = sideSlotsFor(d);
  return html`
    <div class="night-head">
      ${dinnerPhoto(app, d, { size: 'thumb' })}
      <div>
        <p class="night-title">${d.title}</p>
        ${equipment(d, { compact: true })}
        ${favoriteBadge(app, d)}
        ${when(showNutrition(app), () => html`<p class="night-nutri">${nutri(app, plate(app, d.id, e), { suffix: 'a plate', compact: true })}</p>`)}
        ${costNote(costOf(app, d.id, e), { house: true, cls: 'night-cost' })}
      </div>
    </div>
    <div class="night-rate"><span class="night-rate-q">What does the family think?</span>${thumbs(app, { kind: 'dinner', id: d.id, label: d.title, labels: true })}</div>
    ${when(isRetired(app.state, d.id) && !cooked, () => html`<p class="hint">${ic('down_vote', { size: 18 })}<span>${d.title} is off the menu, so it won’t be planned again. <button type="button" class="link-btn" data-action="night:pick" data-date="${date}">Change dinner</button></span></p>`)}
    ${when(cooked, () => html`<p class="status-note status-cooked">${ic('checkCircle', { size: 18 })}Cooked${byLabel(e.cookedBy) ? ` by ${byLabel(e.cookedBy)}` : ''}.</p>`)}
    ${when(cooked && !app.state.leftovers?.[date] && diffDays(today, date) <= 3, () => leftoversQuestion(app, date))}
    ${when(cooked && app.state.leftovers?.[date], () => { const l = app.state.leftovers[date]; return html`<p class="muted small lo-line">${l.servings > 0 ? `${servingsText(l.servings)} of leftovers in the fridge.` : l.saved ? 'The leftovers are gone.' : 'No leftovers that night.'} <button type="button" class="link-btn" data-action="leftovers:edit" data-date="${date}">Change</button></p>`; })}
    <h3 class="sheet-h">Sides</h3>
    <ul class="side-rows">
      ${sides.map((s) => html`<li class="side-row">
        ${sidePhoto(app, s, { size: 'thumb' })}
        <span class="side-name">${s.info?.title}${replacedNote(app, s)}${when(s.remembered && !s.replaced, () => html`<small class="remembered">${ic('check', { size: 14 })}Remembered for ${d.title}</small>`)}${when(showNutrition(app), () => { const sn = sideNutrition(app.db, app.state, s.parsed); return html`<small class="side-kcal">${sn ? `${fmtKcal(sn.kcal)} cal a plate` : '—'}</small>`; })}</span>
        <span class="side-acts">
          ${when(!cooked, () => html`<button type="button" class="btn btn-small btn-secondary" data-action="side:sub" data-date="${date}" data-dinner="${d.id}" data-slot="${s.slot}" aria-label="Change ${s.info?.title || 'this side'}">Change side</button>`)}
        </span>
      </li>`)}
    </ul>
 ${when(!cooked, () => {
      const idea = lighterSide(app.db, app.state, d.id, e);
      return idea ? lighterChip(app, {
        key: `side:${d.id}:${idea.slot}:${idea.to.id}`,
        text: `${idea.to.title} instead of ${idea.from.title}.`,
        why: showNutrition(app) ? `About ${fmtKcal(idea.saves)} fewer calories a plate.` : '',
        action: 'lighter:side', data: { dinner: d.id, slot: idea.slot, ref: idea.to.id }, label: 'Swap it',
      }) : '';
    })}
    ${when(!cooked && slots === 1 && sides.length < 2, () => html`<button type="button" class="btn btn-quiet btn-small add-side" data-action="side:sub" data-date="${date}" data-dinner="${d.id}" data-slot="1">${ic('plus', { size: 18 })}Add a side</button>`)}
    <div class="action-list">
      ${when(!cooked, () => html`<a class="action-row" href="#/cook/${date}">${ic('flame')}<span><b>Start cooking</b><small>Step by step, with timers.</small></span></a>`)}
      ${when(!cooked && date !== today && !past, () => html`<button type="button" class="action-row" data-action="night:tonight" data-date="${date}">${ic('tonight')}<span><b>Make this tonight</b><small>Tonight’s dinner moves to ${diffDays(date, today) === 1 ? 'tomorrow' : dayAndDate(date, today)}.</small></span></button>`)}
      ${when(!cooked, () => html`<button type="button" class="action-row" data-action="night:pick" data-date="${date}">${ic('swap')}<span><b>Change dinner</b></span></button>`)}
      ${when(!cooked, () => html`<button type="button" class="action-row" data-action="night:move" data-date="${date}">${ic('move')}<span><b>Move to another night</b><small>Trades places if that night has a dinner.</small></span></button>`)}
      ${when(!cooked && !past, () => html`<button type="button" class="action-row" data-action="night:away" data-date="${date}">${ic('away')}<span><b>Not eating at home</b></span></button>`)}
      ${cooked
        ? html`<button type="button" class="action-row" data-action="night:uncook" data-date="${date}">${ic('undo')}<span><b>Mark as not cooked</b><small>Puts it back in the pantry.</small></span></button>`
        : html`<button type="button" class="action-row" data-action="night:cooked" data-date="${date}">${ic('checkCircle')}<span><b>Mark cooked</b><small>Takes it out of the pantry.</small></span></button>`}
      <a class="action-row" href="#/recipe/${d.id}">${ic('recipes')}<span><b>Open the recipe</b></span></a>
      ${when(!cooked, () => html`<button type="button" class="action-row action-quiet" data-action="night:clear" data-date="${date}">${ic('trash')}<span><b>Clear this night</b></span></button>`)}
    </div>`;
}

// ---------------------------------------------------------------- pick a dinner

function pickBody(app, { date, query }) {
  const today = app.today();
  const q = (query || '').trim().toLowerCase();
  const planStore = app.settings.planStore;
  const list = rotationList(app.db, app.state)
    .filter((d) => !q || d.title.toLowerCase().includes(q) || d.category.toLowerCase().includes(q) || d.protein.includes(q))
    .sort((a, b) => (isFavorite(app.state, b) - isFavorite(app.state, a)) || a.title.localeCompare(b.title));
  const current = app.state.plan?.[date]?.dinner;
  return html`
    <label class="search">${ic('search', { size: 20 })}<input type="search" placeholder="Search dinners" value="${query || ''}" data-input="pick:query" data-date="${date}" aria-label="Search dinners" autocomplete="off"></label>
    <ul class="pick-list">
      ${list.length ? list.map((d) => {
        const where = findInPlan(app.state, d.id, { exclude: date, from: today, near: date })[0];
        const off = planStore !== 'both' && !dinnerFeasibleAt(app.db, app.state, d.id, planStore);
        const facts = showNutrition(app) ? plate(app, d.id, null) : null;
        return html`<li><button type="button" class="pick-row ${d.id === current ? 'is-current' : ''}" data-action="pick:choose" data-date="${date}" data-dinner="${d.id}" ${d.id === current ? html`aria-current="true"` : ''}>
          ${dinnerPhoto(app, d, { size: 'thumb' })}
          <span class="pick-main"><b>${d.title}</b>
            <small>${timeLabel(d)}${isFavorite(app.state, d) ? ', family favorite' : ''}${where ? `, on ${relativeDay(where, today).toLowerCase() === 'tonight' ? 'tonight' : shortWeekday(where)} (they’ll trade)` : ''}${off ? `, needs ${planStore === 'jewel' ? "Sam's" : 'Jewel'}` : ''}</small>
            ${when(facts, () => html`<small class="pick-nutri">≈ ${fmtKcal(facts.kcal)} cal, ${Math.round(facts.protein)} g protein a plate${leanMark(facts, { compact: true })}</small>`)}
            ${costNote(costOf(app, d.id, null), { short: true, tag: 'small', cls: 'pick-cost' })}</span>
        </button></li>`;
      }) : html`<li class="muted pad">${q ? `No dinners match “${query}”. Try another word, or browse the recipe box.` : 'Nothing is on the menu. Bring some back from Recipes, Not for us.'}</li>`}
    </ul>`;
}

export function openPick(app, date, title) {
  const st = { date, query: '' };
  openSheet({
    id: `pick:${date}`,
    size: 'tall',
    title: title || `Choose a dinner for ${relativeDay(date, app.today()).toLowerCase() === 'tonight' ? 'tonight' : weekdayName(date)}`,
    render: () => pickBody(app, st),
    onMount: (el) => {
      const input = el.querySelector('input[type=search]');
      input?.addEventListener('input', () => {
        st.query = input.value;
        const ul = el.querySelector('.pick-list');
        const tmp = document.createElement('div');
        tmp.innerHTML = pickBody(app, st).s;
        ul.replaceWith(tmp.querySelector('.pick-list'));
      });
    },
  });
}

/** Places a dinner on a night with Jeff's swap semantics, then deals with whatever it displaced. */
export async function place(app, { dinnerId, date, fromDate }) {
  const today = app.today();
  const target = app.state.plan?.[date];
  if (target?.status === 'away') {
    const ok = await confirmSheet({
      title: `${relativeDay(date, today)} is marked ${awayReason(target).label.toLowerCase()}`,
      body: `Cook ${dinnerById(app.db, app.state, dinnerId)?.title || 'this dinner'} at home that night instead?`,
      confirm: 'Yes, we’re home',
    });
    if (!ok) return;
  }
  const res = placeDinnerOps(app.db, app.state, { dinnerId, date, fromDate, who: app.who(), today });
  // Undo puts the bumped dinner back, so "What about …?" no longer applies.
  if (!app.commit(res, { onUndo: () => { if (sheetId() === 'displaced') closeSheet(); } })) return;
  if (res.displaced) openDisplaced(app, res.displaced, date);
  else closeSheet();
}

function openDisplaced(app, displaced, fromDate) {
  const today = app.today();
  const d = dinnerById(app.db, app.state, displaced.dinner);
  const open = openNights(app.state, today, { limit: 6, exclude: [fromDate] });
  openSheet({
    id: 'displaced',
    title: `What about ${d?.title || 'the other dinner'}?`,
    subtitle: `It was on the plan for ${nightName(fromDate, today)}.`,
    render: () => html`
      <h3 class="sheet-h">Move it to an open night</h3>
      ${open.length ? html`<div class="chip-grid">${open.map((x) => html`<button type="button" class="chip chip-lg" data-action="displaced:move" data-to="${x}" data-dinner="${displaced.dinner}">${dayWord(x, today)}<small>${shortDate(x)}</small></button>`)}</div>`
        : html`<p class="sheet-text">No open nights in the next six weeks.</p>`}
      <div class="sheet-actions">
        <button type="button" class="btn btn-quiet btn-block" data-action="sheet:close">Drop it from the plan</button>
      </div>`,
    onMount: (el) => {
      el.querySelectorAll('[data-action="displaced:move"]').forEach((b) => b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const res = moveDisplacedOps(app.db, app.state, { dinner: displaced.dinner, sides: displaced.sides, toDate: b.dataset.to, who: app.who(), today });
        app.commit(res);
        closeSheet();
      }));
    },
  });
}

// ---------------------------------------------------------------- move to another night

export function openMove(app, fromDate) {
  const today = app.today();
  const e = app.state.plan?.[fromDate];
  const d = dinnerById(app.db, app.state, e?.dinner);
  if (!d) return;
  const start = today;
  const nights = datesBetween(start, addDays(start, 27)).filter((x) => x !== fromDate);
  openSheet({
    id: `move:${fromDate}`,
    size: 'tall',
    title: `Move ${d.title}`,
    subtitle: 'If that night has a dinner, they trade places.',
    render: () => html`<ul class="move-list">${nights.map((x) => {
      const t = app.state.plan?.[x];
      const td = t?.dinner ? dinnerById(app.db, app.state, t.dinner) : null;
      const cooked = t?.status === 'cooked';
      const what = t?.status === 'away' ? `Away: ${awayReason(t).label}` : td ? (cooked ? `${td.title} (cooked)` : `Trade with ${td.title}`) : 'Nothing planned';
      return html`<li><button type="button" class="move-row ${td && !cooked ? '' : 'is-open'}" data-action="move:to" data-from="${fromDate}" data-to="${x}" data-dinner="${d.id}" ${cooked ? 'disabled' : ''}>
        <span class="move-day"><b>${dayWord(x, today)}</b><small>${shortDate(x)}</small></span><span class="move-what">${what}</span>${ic('right', { size: 18 })}
      </button></li>`;
    })}</ul>`,
  });
}

// ---------------------------------------------------------------- not eating at home

export function openAway(app, date) {
  const today = app.today();
  const e = app.state.plan?.[date];
  const d = e?.dinner && e.status !== 'away' ? dinnerById(app.db, app.state, e.dinner) : null;
  const wasAway = e?.status === 'away';
  const block = wasAway ? awayBlock(app.state, date) : [date];
  // One tap does the usual thing (docs/spec/29): skip it, or move it. A reason, a note and "a few
  // nights" wait under the fold, and nothing is picked for you.
  const st = { mode: block.length > 1 ? 'range' : 'one', from: block[0] || date, to: block[block.length - 1] || addDays(date, 2), reason: e?.away?.reason || '', note: e?.away?.note || '' };
  const opens = openNights(app.state, addDays(today, 0), { limit: 10, exclude: [date] });
  const night = date === today ? 'tonight' : weekdayName(date);
  openSheet({
    id: `away:${date}`,
    size: 'tall',
    title: 'Not eating at home',
    subtitle: date === today ? `Tonight, ${longDay(date)}` : longDay(date),
    render: () => html`
      <form class="form" data-submit="away:save" data-date="${date}">
        ${when(st.mode === 'one' && !wasAway, () => html`<div class="away-quick">
          <button type="button" class="btn btn-primary btn-block btn-lg" data-action="away:quick" data-date="${date}" data-push="skip">${d ? `Skip ${night}` : `Not home ${night}`}</button>
          ${when(d, () => html`<p class="muted small away-hint">${d.title} comes off the list this time.</p>`)}
          ${when(d && opens.length, () => html`<div class="away-move">
            <label class="field"><span class="field-label">Or move it to</span>
              <select class="input" name="pushTo" aria-label="Night to move ${d.title} to">${opens.map((x) => html`<option value="${x}">${dayAndDate(x, today)}</option>`)}</select></label>
            <button type="button" class="btn btn-secondary" data-action="away:quick" data-date="${date}" data-push="move">Move it</button>
          </div>`)}
        </div>`)}
        <details class="away-more" ${wasAway || st.mode === 'range' ? 'open' : ''}>
          <summary>${wasAway ? 'Nights and reason' : 'Away a few nights, or add a reason'}</summary>
          <div class="seg" role="radiogroup" aria-label="How many nights">
            <button type="button" role="radio" class="seg-opt ${st.mode === 'one' ? 'is-on' : ''}" aria-checked="${tf(st.mode === 'one')}" data-away-mode="one">Just this night</button>
            <button type="button" role="radio" class="seg-opt ${st.mode === 'range' ? 'is-on' : ''}" aria-checked="${tf(st.mode === 'range')}" data-away-mode="range">Away a few nights</button>
          </div>
          ${when(st.mode === 'range', () => html`<div class="field-row">
            <label class="field"><span class="field-label">From</span><input class="input" type="date" name="from" value="${st.from}" min="${today}" required></label>
            <label class="field"><span class="field-label">Through</span><input class="input" type="date" name="to" value="${st.to}" min="${today}" required></label>
          </div>`)}
          <fieldset class="field">
            <legend class="field-label">Why? <small>(optional)</small></legend>
            <div class="chip-grid">
              ${AWAY_REASONS.map((r) => html`<label class="chip chip-radio ${st.reason === r.id ? 'is-on' : ''}"><input type="radio" name="reason" value="${r.id}" ${st.reason === r.id ? 'checked' : ''}>${r.label}</label>`)}
            </div>
          </fieldset>
          <label class="field"><span class="field-label">Note <small>(optional)</small></span><input class="input" name="note" value="${st.note}" maxlength="80" placeholder="Grandma’s birthday, Knox’s game…"></label>
          <button type="submit" class="btn btn-primary btn-block">${st.mode === 'range' ? 'Mark these nights away' : wasAway ? 'Save' : `Not home ${night}`}</button>
        </details>
      </form>`,
    onMount: (el) => {
      const form = el.querySelector('form');
      const keep = () => {
        const f = new FormData(form);
        st.reason = f.get('reason') || st.reason;
        st.note = f.get('note') ?? st.note;
        if (f.get('from')) st.from = f.get('from');
        if (f.get('to')) st.to = f.get('to');
      };
      el.querySelectorAll('[data-away-mode]').forEach((b) => b.addEventListener('click', () => { keep(); st.mode = b.dataset.awayMode; renderSheet(); }));
      form.addEventListener('change', (ev) => {
        if (ev.target.name === 'reason') { keep(); form.querySelectorAll('.chip-radio').forEach((c) => c.classList.toggle('is-on', c.querySelector('input').checked)); }
      });
    },
  });
}

// ---------------------------------------------------------------- substitute a side

export function openSubstitute(app, { date, dinnerId, slot }) {
  const d = dinnerById(app.db, app.state, dinnerId);
  if (!d) return;
  const st = { tab: 'box', qty: {}, newName: '', newQty: 2, newUnit: 'cans' };
  const adding = slot >= sideSlotsFor(d) && !app.state.substitutions?.[dinnerId]?.[String(slot)];
  openSheet({
    id: `sub:${dinnerId}:${slot}`,
    size: 'tall',
    title: adding ? `Add a side to ${d.title}` : 'Change side',
    subtitle: adding ? 'Remembered every time it’s on the menu.' : `For ${d.title}. Remembered every time it’s on the menu.`,
    render: () => subBody(app, d, slot, st, date),
    onMount: (el) => {
      el.querySelectorAll('[data-sub-tab]').forEach((b) => b.addEventListener('click', () => { st.tab = b.dataset.subTab; renderSheet(); }));
    },
  });
  openSubstitute.state = st;
}

function shelfItems(app) {
  const out = [];
  for (const [id, p] of Object.entries(app.state.pantry || {})) {
    if (!p || p.low) continue;
    const ing = app.db.ingredients[id];
    const c = app.state.custom?.[id];
    if (!ing && !c) continue;
    if ((ing?.kind || c?.kind) === 'staple') continue;
    if (!(typeof p.qty === 'number' && p.qty > 0) && !p.stocked) continue;
    out.push({ id, type: ing ? 'item' : 'custom', name: ing?.name || c.name, unit: ing?.unit || c.unit || 'each', have: p.qty, aisle: ing?.aisle || c.aisle });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function defaultQty(unit) {
  if (unit === 'lb') return 1.5;
  if (unit === 'oz') return 16;
  if (unit === 'cups') return 3;
  if (unit === 'cans') return 2;
  return 2;
}

function subBody(app, d, slot, st, date) {
  const current = sidesFor(app, d.id, date ? app.state.plan?.[date] : null).find((s) => s.slot === slot);
  const other = sidesFor(app, d.id, null).filter((s) => s.slot !== slot).map((s) => s.ref);
  const remembered = !!app.state.substitutions?.[d.id]?.[String(slot)];
  const sides = app.db.sideList.filter((s) => s.id !== current?.ref && !other.includes(s.id) && !isSideDropped(app.state, s.id));
  const shelf = shelfItems(app);
  return html`
    ${when(current, () => html`<div class="current-side">
      ${sidePhoto(app, current, { size: 'thumb' })}
      <span><small>${remembered ? 'Now (remembered)' : 'Now'}</small><b>${current.info?.title}</b></span>
      ${when(remembered, () => html`<button type="button" class="btn btn-small btn-quiet" data-action="side:reset" data-dinner="${d.id}" data-slot="${slot}">${slot >= sideSlotsFor(d) ? 'Remove' : 'Reset to the recipe’s side'}</button>`)}
    </div>`)}
    <div class="seg" role="tablist" aria-label="Where the side comes from">
      <button type="button" role="tab" aria-selected="${tf(st.tab === 'box')}" class="seg-opt ${st.tab === 'box' ? 'is-on' : ''}" data-sub-tab="box">Recipe box</button>
      <button type="button" role="tab" aria-selected="${tf(st.tab === 'shelf')}" class="seg-opt ${st.tab === 'shelf' ? 'is-on' : ''}" data-sub-tab="shelf">On the shelf</button>
    </div>
    ${st.tab === 'box'
      ? html`<ul class="pick-list">${sides.map((s) => html`<li><button type="button" class="pick-row" data-action="side:use" data-dinner="${d.id}" data-slot="${slot}" data-ref="${s.id}">
          ${sidePhoto(app, { parsed: { type: 'side', id: s.id }, info: { kind: s.kind } }, { size: 'thumb' })}
          <span class="pick-main"><b>${s.title}</b><small>${s.minutes ? fmtMinutes(s.minutes) : ''}${s.kind ? `${s.minutes ? ', ' : ''}${s.kind}` : ''}${(() => { const sn = showNutrition(app) ? sideNutrition(app.db, app.state, { type: 'side', id: s.id }) : null; return sn ? `, ${fmtKcal(sn.kcal)} cal a plate` : ''; })()}</small></span></button></li>`)}</ul>`
      : html`
        ${shelf.length ? html`<ul class="shelf-list">${shelf.map((it) => {
          const q = st.qty[it.id] ?? Math.min(defaultQty(it.unit), typeof it.have === 'number' ? it.have : defaultQty(it.unit));
          return html`<li class="shelf-row">
            <span class="shelf-name"><b>${it.name}</b><small>${typeof it.have === 'number' ? `${fmtQty(it.have)} ${it.unit} on the shelf` : 'Stocked'}</small></span>
            ${stepper({ value: fmtQty(q), step: it.unit === 'lb' ? 0.5 : 1, min: 0.5, action: 'side:qty', data: { id: it.id }, unit: it.unit, label: `How much ${it.name}` })}
            <button type="button" class="btn btn-small btn-primary" data-action="side:use" data-dinner="${d.id}" data-slot="${slot}" data-ref="${shelfRef(it.type, it.id, q)}">Use</button>
          </li>`;
        })}</ul>` : html`<p class="sheet-text">Nothing measured is in the pantry yet. Add what’s on the shelf below, or scan the pantry from the Pantry tab.</p>`}
        <form class="form form-inline-card" data-submit="side:new" data-dinner="${d.id}" data-slot="${slot}">
          <p class="field-label">Something else on the shelf</p>
          <input class="input" name="name" placeholder="Canned green beans" required maxlength="60" aria-label="Item name">
          <div class="field-row">
            <input class="input" name="qty" type="number" inputmode="decimal" min="0.25" step="0.25" value="2" aria-label="Amount">
            <select class="input" name="unit" aria-label="Unit">${['cans', 'lb', 'oz', 'bags', 'boxes', 'jars', 'each'].map((u) => html`<option>${u}</option>`)}</select>
          </div>
          <button type="submit" class="btn btn-secondary btn-block">Use it as the side</button>
        </form>`}`;
}

// ---------------------------------------------------------------- leftovers (SPEC §22.5)

/** Which night should the leftovers be dinner? Only nights before they're past their best. */
export function openLeftoverNight(app, from) {
  openSheet({
    id: `leftover-night:${from}`,
    live: true,
    title: 'Make it a leftover night',
    get subtitle() { const l = leftoversOnHand(app.state, app.today()).find((x) => x.date === from); return l ? `${servingsText(l.servings)} of ${l.title}, ${useByText(l, app.today())}.` : ''; },
    render: () => {
      const today = app.today();
      const l = leftoversOnHand(app.state, today).find((x) => x.date === from);
      if (!l) return html`<p class="sheet-text">Those leftovers are gone.</p><div class="sheet-actions"><button type="button" class="btn btn-primary btn-block" data-action="sheet:close">OK</button></div>`;
      const nights = leftoverNightChoices(app.state, l, today);
      if (!nights.length) return html`<p class="sheet-text">There’s no free night before they’re past their best (${useByText(l, today)}). Have them for lunch instead.</p><div class="sheet-actions"><button type="button" class="btn btn-primary btn-block" data-action="sheet:close">OK</button></div>`;
      return html`
        <p class="sheet-text">Nothing is cooked that night, and its groceries come off the list.${l.servings < 5 ? ` With ${servingsText(l.servings)} for five, plan to add a side or a salad.` : ''}</p>
        <ul class="move-list">${nights.map((x) => {
          const t = app.state.plan?.[x];
          const td = t?.dinner ? dinnerById(app.db, app.state, t.dinner) : null;
          return html`<li><button type="button" class="move-row ${td ? '' : 'is-open'}" data-action="leftovers:night-set" data-from="${from}" data-night="${x}">
            <span class="move-day"><b>${dayWord(x, today)}</b><small>${shortDate(x)}</small></span><span class="move-what">${td ? `Instead of ${td.title}` : 'Open'}</span>${ic('right', { size: 18 })}
          </button></li>`;
        })}</ul>`;
    },
  });
}

/**
 * The other two places leftovers can go (docs/spec/21 §21.3, on §22.5's one batch): a serving in
 * someone's packed lunch (whoever packs: Jeff and Knox, and anyone the family added), or plates in
 * the freezer as a dated shelf item.
 */
export function openLeftoverMore(app, from) {
  const st = (openLeftoverMore.state = { from, plates: null });
  const dayName = (d, today) => (d === today ? 'today' : d === addDays(today, 1) ? 'tomorrow' : `on ${weekdayName(d)}`);
  openSheet({
    id: `leftover-more:${from}`,
    live: true,
    title: 'Lunch or freezer',
    get subtitle() { const l = leftoversOnHand(app.state, app.today()).find((x) => x.date === from); return l ? `${servingsText(l.servings)} of ${l.title}, ${useByText(l, app.today())}.` : ''; },
    render: () => {
      const today = app.today();
      const l = leftoversOnHand(app.state, today).find((x) => x.date === from);
      if (!l) return html`<p class="sheet-text">Those leftovers are gone.</p><div class="sheet-actions"><button type="button" class="btn btn-primary btn-block" data-action="sheet:close">OK</button></div>`;
      const lunches = leftoverLunchChoices(app.db, app.state, { from, today });
      const plates = Math.max(1, Math.min(l.servings, st.plates ?? l.servings));
      return html`
        <h3 class="sheet-h">For a lunch</h3>
        ${lunches.length ? html`<div class="action-list left-choices">${lunches.map((c) => html`<button type="button" class="action-row" data-action="leftovers:lunch" data-from="${from}" data-name="${c.name}" data-to="${c.date}">${ic('lunch')}<span><b>${c.name}’s lunch ${dayName(c.date, today)}</b><small>One serving goes in the lunch box. That packed lunch comes off the plan and the list.</small></span></button>`)}</div>`
          : html`<p class="muted small">Nobody packs a lunch before these are past their best.</p>`}
        <h3 class="sheet-h">Or freeze them</h3>
        <div class="left-plates"><span class="set-label">How many plates?</span>
          <span class="qty-edit"><button type="button" class="stepper-btn" data-action="leftovers:plates" data-delta="-1" aria-label="One plate less" ${plates <= 1 ? 'disabled' : ''}>${ic('minus', { size: 18 })}</button>
            <b class="left-n" aria-live="polite">${plates}</b>
            <button type="button" class="stepper-btn" data-action="leftovers:plates" data-delta="1" aria-label="One plate more" ${plates >= l.servings ? 'disabled' : ''}>${ic('plus', { size: 18 })}</button></span></div>
        <div class="action-list">
          <button type="button" class="action-row" data-action="leftovers:freeze" data-from="${from}" data-n="${plates}">${ic('snow')}<span><b>Put ${plates === l.servings ? (plates === 1 ? 'it' : 'them all') : plates} in the freezer</b><small>Dated today, good for about 3 months, and listed in the pantry with the quick backups.</small></span></button>
        </div>`;
    },
  });
}

// ---------------------------------------------------------------- sync

export function openSync(app) {
  openSheet({
    id: 'sync',
    live: true,
    title: 'Family sync',
    render: () => {
      const s = app.store;
      const pending = s.pending.length;
      const text = {
        synced: 'Every phone, computer and the TV show the same plan, favorites, pantry and list.',
        syncing: 'Sending your changes to the family…',
        offline: `No connection to the family server right now. ${pending ? `${pending} change${pending === 1 ? ' is' : 's are'} saved on this device and will sync when you’re back online.` : 'Changes you make are saved on this device and sync later.'}`,
        local: 'This device keeps its own plan. Nothing is shared with the family.',
        'needs-setup': 'The family passcode hasn’t been created yet. Create it once, then type it on every other phone and the TV.',
        'needs-passcode': s.statusDetail || 'Enter the family passcode to share the plan with everyone.',
        error: s.statusDetail || 'Sync is paused.',
      }[s.status] || '';
      return html`
        <p class="sheet-text">${text}</p>
        ${when(s.lastSyncAt, () => html`<p class="muted small">Last synced ${new Date(s.lastSyncAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' })}.</p>`)}
        <div class="sheet-actions">
          ${when(['offline', 'synced', 'error'].includes(s.status) && s.device.key, () => html`<button type="button" class="btn btn-primary btn-block" data-action="sync:now">${ic('refresh', { size: 20 })}Sync now</button>`)}
          ${when(s.status === 'offline' && !s.device.key, () => html`<button type="button" class="btn btn-primary btn-block" data-action="sync:retry">${ic('refresh', { size: 20 })}Try to connect</button>`)}
          ${when(['needs-setup', 'needs-passcode'].includes(s.status), () => html`<a class="btn btn-primary btn-block" href="#/family" data-action="sync:passcode">${ic('lock', { size: 20 })}${s.status === 'needs-setup' ? 'Create the family passcode' : 'Enter the family passcode'}</a>`)}
          ${when(s.status === 'local', () => html`<button type="button" class="btn btn-primary btn-block" data-action="sync:family">Share with the family</button>`)}
        </div>`;
    },
  });
}

// ---------------------------------------------------------------- actions

export const actions = {
  'night:open': (app, el) => openNight(app, el.dataset.date),
  'night:pick': (app, el) => openPick(app, el.dataset.date),
  'night:move': (app, el) => openMove(app, el.dataset.date),
  'night:away': (app, el) => openAway(app, el.dataset.date),
  'night:tonight': (app, el) => {
    const e = app.state.plan?.[el.dataset.date];
    if (e?.dinner) place(app, { dinnerId: e.dinner, date: app.today(), fromDate: el.dataset.date });
  },
  'night:back-trip': (app, el) => {
    app.commit(bringBackTripOps(app.db, app.state, { date: el.dataset.date, who: app.who(), today: app.today() }));
    closeSheet();
  },
  'night:back': (app, el) => {
    const res = bringBackOps(app.db, app.state, { date: el.dataset.date, who: app.who(), today: app.today() });
    app.commit(res);
    if (res.open) openPick(app, el.dataset.date);
    else closeSheet();
  },
  // The sheet stays open on a cooked night: it asks about leftovers next.
  'night:cooked': (app, el) => { if (app.commit(markCookedOps(app.db, app.state, { date: el.dataset.date, who: app.who(), today: app.today() })) && sheetId() === `night:${el.dataset.date}`) renderSheet(); else closeSheet(); },
  'leftovers:save': (app, el) => {
    const ok = app.commit(saveLeftoversOps(app.db, app.state, { date: el.dataset.date, servings: Number(el.dataset.n), who: app.who() }));
    if (sheetId() === `leftovers:${el.dataset.date}`) closeSheet();
    else renderSheet();
    // From cook mode's last screen: the cooking session is over.
    if (ok && el.dataset.then) { finishCooking(app); app.navigate(el.dataset.then); }
  },
  'leftovers:edit': (app, el) => {
    const date = el.dataset.date;
    const e = app.state.plan?.[date];
    openSheet({
      id: `leftovers:${date}`,
      title: 'Leftovers',
      subtitle: `${dinnerById(app.db, app.state, e?.dinner)?.title || 'Dinner'}, ${relativeDay(date, app.today()).toLowerCase() === 'tonight' ? 'tonight' : weekdayName(date)}`,
      render: () => leftoversQuestion(app, date, { heading: 'How many servings are in the fridge?' }),
    });
  },
  'leftovers:ate': (app, el) => { app.commit(useLeftoverOps(app.db, app.state, { date: el.dataset.date, servings: 1 })); renderSheet(); },
  // Past their best and thrown out: that goes in the waste log. Otherwise they were eaten.
  'leftovers:gone': (app, el) => {
    app.commit(el.dataset.tossed ? tossLeftoversOps(app.db, app.state, { date: el.dataset.date, today: app.today(), who: app.who() }) : clearLeftoversOps(app.db, app.state, { date: el.dataset.date }));
    renderSheet();
  },
  'leftovers:more': (app, el) => openLeftoverMore(app, el.dataset.date),
  'leftovers:plates': (app, el) => {
    const st = openLeftoverMore.state;
    const l = st ? app.state.leftovers?.[st.from] : null;
    if (!l) return;
    st.plates = Math.max(1, Math.min(l.servings, (st.plates ?? l.servings) + Number(el.dataset.delta)));
    renderSheet();
  },
  'leftovers:lunch': (app, el) => {
    const res = leftoverLunchOps(app.db, app.state, { from: el.dataset.from, name: el.dataset.name, to: el.dataset.to, today: app.today() });
    if (res.error) { toast(res.message); return; }
    app.commit(res);
    closeSheet();
  },
  'leftovers:freeze': (app, el) => {
    const res = freezeLeftoversOps(app.db, app.state, { from: el.dataset.from, servings: Number(el.dataset.n), today: app.today(), who: app.who() });
    if (res.error) { toast(res.message); return; }
    app.commit(res);
    closeSheet();
  },
  'leftovers:night': (app, el) => openLeftoverNight(app, el.dataset.date),
  'leftovers:night-set': (app, el) => {
    app.commit(leftoverNightOps(app.db, app.state, { from: el.dataset.from, night: el.dataset.night, who: app.who(), today: app.today() }));
    closeSheet();
  },
  'night:uncook': (app, el) => { app.commit(unmarkCookedOps(app.db, app.state, { date: el.dataset.date })); closeSheet(); },
  'night:clear': (app, el) => { app.commit(clearNightOps(app.db, app.state, { date: el.dataset.date, today: app.today() })); closeSheet(); },
  'night:auto': (app, el) => {
    const res = generateOps(app.db, app.state, { dates: [el.dataset.date], who: app.who(), today: app.today(), seedKey: el.dataset.date });
    if (app.commit(res)) renderSheet();
  },
  'pick:choose': (app, el) => place(app, { dinnerId: el.dataset.dinner, date: el.dataset.date }),
  'move:to': (app, el) => place(app, { dinnerId: el.dataset.dinner, date: el.dataset.to, fromDate: el.dataset.from }),
  // The one-tap answers on the "Not eating at home" sheet: skip this night, or move its dinner.
  'away:quick': (app, el) => {
    const form = el.closest('form');
    const f = form ? new FormData(form) : new FormData();
    const pushTo = el.dataset.push === 'move' ? f.get('pushTo') || null : null;
    app.commit(markAwayOps(app.db, app.state, { dates: [el.dataset.date], reason: f.get('reason') || 'Other', note: String(f.get('note') || '').trim(), who: app.who(), today: app.today(), pushTo }));
    closeSheet();
  },
  'away:save': (app, form) => {
    const date = form.dataset.date;
    const f = new FormData(form);
    const reason = f.get('reason') || 'Other';
    const note = String(f.get('note') || '').trim();
    let dates = [date];
    const from = f.get('from');
    const to = f.get('to');
    if (from && to) {
      if (!isISODate(from) || !isISODate(to) || to < from) { toast('Pick a “through” date on or after the first night.'); return; }
      if (diffDays(to, from) > 60) { toast('That’s more than two months. Pick a shorter trip.'); return; }
      dates = datesBetween(from, to);
    }
    const pushTo = f.get('push') === 'move' ? f.get('pushTo') : null;
    app.commit(markAwayOps(app.db, app.state, { dates, reason, note, who: app.who(), today: app.today(), pushTo }));
    closeSheet();
  },
  'side:sub': (app, el) => openSubstitute(app, { date: el.dataset.date, dinnerId: el.dataset.dinner, slot: Number(el.dataset.slot) }),
  'side:use': (app, el) => {
    app.commit(substituteOps(app.db, app.state, { dinnerId: el.dataset.dinner, slot: Number(el.dataset.slot), ref: el.dataset.ref }));
    closeSheet();
  },
  'side:reset': (app, el) => { app.commit(resetSideOps(app.db, app.state, { dinnerId: el.dataset.dinner, slot: Number(el.dataset.slot) })); closeSheet(); },
  'side:qty': (app, el) => {
    const st = openSubstitute.state;
    if (!st) return;
    const id = el.dataset.id;
    const it = shelfItems(app).find((x) => x.id === id);
    const cur = st.qty[id] ?? Math.min(defaultQty(it?.unit), typeof it?.have === 'number' ? it.have : defaultQty(it?.unit));
    st.qty[id] = Math.max(0.5, Math.round((cur + Number(el.dataset.delta)) * 100) / 100);
    renderSheet();
  },
  'side:new': (app, form) => {
    const f = new FormData(form);
    const name = String(f.get('name') || '').trim();
    const qty = Number(f.get('qty')) || 1;
    const unit = String(f.get('unit') || 'each');
    if (!name) return;
    const c = customItemOps(app.state, { name, unit });
    const pantry = setPantryOps(app.db, app.state, { id: c.id, qty: Math.max(qty, app.state.pantry?.[c.id]?.qty || 0), who: app.who() });
    app.store.commit([...c.ops, ...pantry.ops]);
    app.commit(substituteOps(app.db, app.store.state, { dinnerId: form.dataset.dinner, slot: Number(form.dataset.slot), ref: shelfRef('custom', c.id, qty) }));
    closeSheet();
  },
  // A button from before the shared profile (an older page still open) lands on settings instead of a dead tap.
  'sheet:who': (app) => { closeSheet(); app.navigate('#/family'); },
  // The family's signal, everywhere (SPEC §9.2, docs/spec/20): thumbs up = loved, thumbs down = not
  // for us, neither = fine. One signal for the whole family; every change's message has Undo.
  // "Not for us" changes the menu for everyone, so it asks first (gauntlet r1); "Loved" and "fine"
  // just happen, with Undo.
  'vote:dinner': async (app, el) => {
    const r = voteOps(app.db, app.state, { dinnerId: el.dataset.id, value: Number(el.dataset.value), today: app.today() });
    if (r.retired && !(await confirmOff(app, { title: dinnerById(app.db, app.state, el.dataset.id)?.title, promoted: r.promoted ? dinnerById(app.db, app.state, r.promoted)?.title : null, nights: r.replacedNights || 0 }))) return;
    app.commit(r);
    renderSheet();
  },
  'vote:side': async (app, el) => {
    const r = sideVoteOps(app.db, app.state, { sideId: el.dataset.id, value: Number(el.dataset.value) });
    if (r.dropped && !(await confirmOff(app, { title: app.db.sides[el.dataset.id]?.title, side: true }))) return;
    app.commit(r);
    renderSheet();
  },
  'vote:lunch': (app, el) => {
    app.commit(lunchVoteOps(app.db, app.state, { itemId: el.dataset.id, person: el.dataset.person, value: Number(el.dataset.value) }));
    renderSheet();
  },
  'lighter:dismiss': (app, el) => {
    const list = [...new Set([...(app.store.device.dismissed || []), el.dataset.key])].slice(-60);
    app.store.setDevice({ dismissed: list });
    renderSheet();
  },
  'lighter:side': (app, el) => {
    app.commit(substituteOps(app.db, app.state, { dinnerId: el.dataset.dinner, slot: Number(el.dataset.slot), ref: el.dataset.ref }));
    renderSheet();
  },
  'sheet:sync': (app) => openSync(app),
  'sync:now': (app) => app.store.sync(),
  'sync:retry': (app) => app.store.connect(),
  'sync:family': (app) => { app.store.useFamilySync(); },
  'sync:passcode': (app) => { closeSheet(); app.ui.showPasscode = true; app.navigate('#/family'); },
};

export { STORE_NAMES, waitText };
