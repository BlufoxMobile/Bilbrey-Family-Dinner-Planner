// Sheets shared by Tonight, Plan and Recipes: a night's actions, picking a dinner,
// moving/swapping, not eating at home, substituting sides, the family's signal, sync.
import { html, ic, when, openSheet, closeSheet, toast, renderSheet, confirmSheet, stepper, sheetId, tf, switchToggle } from '../ui.js';
import { AWAY_REASONS } from '../config.js';
import {
  addDays, datesBetween, diffDays, fmtQty, longDay, relativeDay, shortDate, shortWeekday, isISODate, weekdayName, dayWord, dayAndDate, byLabel, listJoin, hourIn, midSentence, money, minutesIn, clockText,
} from '../util.js';
import {
  dinnerById, rotationList, findInPlan, openNights, parseSideRef, shelfRef, sideInfo, isFavorite, kindOf, itemsForNight,
  dinnerFeasibleAt, sideSlotsFor, isRetired, isSideDropped,
} from '../planner.js';
import {
  placeDinnerOps, markAwayOps, bringBackOps, markCookedOps, unmarkCookedOps, substituteOps, nightSideOps, prepDoneOps,
  resetSideOps, clearNightOps, generateOps, customItemOps, setPantryOps, nightName, awayBlock, bringBackTripOps,
  voteOps, sideVoteOps, lunchVoteOps, saveLeftoversOps, useLeftoverOps, clearLeftoversOps, leftoverNightOps,
  leftoverLunchChoices, leftoverLunchOps, freezeLeftoversOps, tossLeftoversOps,
} from '../actions.js';
import {
  sidesFor, dinnerPhoto, sidePhoto, equipment, favoriteBadge, awayReason, nutri, showNutrition, lighterChip, thumbs, replacedNote,
  plate, leanMark, isLeftoverNight, leftoversQuestion, costOf, costNote,
} from './common.js';
import { sideNutrition, lighterSide, fmtKcal } from '../nutrition.js';
import { leftoversOnHand, leftoverNightChoices, servingsText, useByText, timeLabel, pantryCheck } from '../cooking.js';
import { finishCooking } from './cook.js';
import { waitText } from '../state.js';
import { fmtMinutes } from '../data.js';
import { readiness } from '../easy.js';
import { onHand } from '../coverage.js';
import { itemMeta } from '../shopping.js';

const STORE_NAMES = { sams: "Sam's Club", jewel: 'Jewel-Osco' };

// ---------------------------------------------------------------- "not for us" asks first

/** "Take X off the menu for everyone?" Reopens the night sheet it came from, either way. */
async function confirmOff(app, { title, promoted = null, nights = 0, dates = [], side = false }) {
  const from = sheetId();
  const night = /^night:(\d{4}-\d{2}-\d{2})$/.exec(from || '')?.[1];
  const name = title || (side ? 'This side' : 'This dinner');
  const what = side ? 'Dinners that have it get a similar side.'
    : promoted && nights ? `${promoted} goes on ${dates.length ? listJoin(dates.slice(0, 3).map((x) => weekdayName(x))) : nights === 1 ? 'its night' : `its ${nights} nights`} instead. Tonight stays.` : 'Tonight stays.';
  const ok = await confirmSheet({
    title: `Take ${name} off the menu for everyone?`,
    body: `It won’t be planned again. ${what}`,
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
        ${costNote(costOf(app, d.id, e), { cls: 'night-cost' })}
      </div>
    </div>
    <div class="night-rate">${thumbs(app, { kind: 'dinner', id: d.id, label: d.title, labels: true })}</div>
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
    ${when(!cooked && slots === 1 && sides.length < 2, () => html`<button type="button" class="btn btn-quiet btn-small add-side" data-action="side:sub" data-date="${date}" data-dinner="${d.id}" data-slot="1">${ic('plus', { size: 18 })}Add a side</button>`)}
    <div class="action-list">${nightActions(app, { date, d, today, past, cooked })}</div>`;
}

// Tonight leads with cooking; a night ahead leads with changing it; a night gone by with "Mark cooked".
function nightActions(app, { date, d, today, past, cooked }) {
  const isToday = date === today;
  const later = diffDays(date, today) === 1 ? 'tomorrow' : dayAndDate(date, today);
  const recipe = html`<a class="action-row" href="#/recipe/${d.id}">${ic('recipes')}<span><b>Open the recipe</b></span></a>`;
  if (cooked) {
    return html`<button type="button" class="action-row" data-action="night:uncook" data-date="${date}">${ic('undo')}<span><b>Mark as not cooked</b><small>Puts it back in the pantry.</small></span></button>${recipe}`;
  }
  const cook = html`<a class="action-row" href="#/cook/${date}">${ic('flame')}<span><b>Start cooking</b><small>Step by step, with timers.</small></span></a>`;
  const change = html`<button type="button" class="action-row" data-action="night:pick" data-date="${date}">${ic('swap')}<span><b>Change dinner</b></span></button>`;
  const move = html`<button type="button" class="action-row" data-action="night:move" data-date="${date}">${ic('move')}<span><b>Move to another night</b><small>Trades places if that night has a dinner.</small></span></button>`;
  const away = html`<button type="button" class="action-row" data-action="night:away" data-date="${date}">${ic('away')}<span><b>Not eating at home</b></span></button>`;
  const tonight = html`<button type="button" class="action-row" data-action="night:tonight" data-date="${date}">${ic('tonight')}<span><b>Make this tonight</b><small>Tonight’s dinner moves to ${later}.</small></span></button>`;
  const markCooked = html`<button type="button" class="action-row" data-action="night:cooked" data-date="${date}">${ic('checkCircle')}<span><b>Mark cooked</b><small>Takes it out of the pantry.</small></span></button>`;
  const clear = html`<button type="button" class="action-row action-quiet" data-action="night:clear" data-date="${date}">${ic('trash')}<span><b>Clear this night</b></span></button>`;
  if (isToday) return html`${cook}${change}${move}${away}${markCooked}${recipe}${clear}`;
  if (past) return html`${markCooked}${change}${move}${recipe}${clear}`;
  return html`${change}${move}${away}${tonight}${recipe}${clear}`;
}

// ---------------------------------------------------------------- pick a dinner

/**
 * "All in the house", "Needs chicken thighs and 6 more", "All in but a side: green beans", or
 * "Chicken thighs are frozen (about 1 hr to thaw)", which in the evening says when dinner would be:
 * "Chicken thighs are frozen: dinner about 7:30" (gauntlet r8: don't make the family add it up).
 */
export function readyText(r, { eatAt = '' } = {}) {
  // midSentence keeps a proper name's capitals ("Greek yogurt", "Italian seasoning"; gauntlet r7).
  const few = (xs) => { const l = xs.map((x) => midSentence(x)); return l.length <= 2 ? listJoin(l) : `${l[0]} and ${l.length - 1} more`; };
  if (!r.ready) return `Needs ${few(r.missing)}`;
  if (r.sideOut.length) return `All in but a side: ${few(r.sideOut)}`;
  if (r.thaw.length) {
    const t = r.thaw[0];
    const m = Math.max(...r.thaw.map((x) => x.minutes));
    const are = /s$/.test(t.name) ? 'are' : 'is';
    return eatAt ? `${t.name} ${are} frozen: dinner about ${eatAt}` : `${t.name} ${are} frozen (about ${m >= 60 ? `${fmtQty(Math.round(m / 30) / 2)} hr` : `${m} min`} to thaw)`;
  }
  return 'All in the house';
}

const FAMILY_SIZE = 5;
const HAVE_SHOW = 8; // Closest first shows this many until "Show all", so the two buttons stay in reach (gauntlet r8)

/**
 * "Cook from what we have" (Jeff, r6: smart recipes from the food we actually have): what the house
 * can make, what a fresh receipt brought home, then the closest dinners, with planning the week from
 * the pantry and asking Claude for new ideas under them. Opens after a receipt fills the pantry
 * (bought: the receipt's item ids) and from the Pantry page.
 */
export function openHave(app, { bought = null } = {}) {
  openPick(app, app.today(), 'Cook from what we have', { have: true, bought });
}

// What a dinner's own ingredients take from a fresh receipt: not a side, not a staple (gauntlet r8:
// "Chicken tender night" sat under "Uses what you just bought" for a side's cheese).
function boughtIn(app, d, bought) {
  if (!bought?.size) return [];
  return Object.keys(d.items || {}).filter((id) => bought.has(id) && kindOf(app.db, app.state, id) !== 'staple');
}

const shortName = (app, id) => midSentence(app.db.ingredients?.[id]?.short || itemMeta(app.db, app.state, id).name.replace(/\s*\(.*?\)\s*/g, ' ').replace(/,.*$/, '').trim());

function pickBody(app, st) {
  const { date, query, have = false, bought = null } = st;
  const today = app.today();
  const q = (query || '').trim().toLowerCase();
  const planStore = app.settings.planStore;
  const tonight = date === today;
  const rem = tonight ? onHand(app.db, app.state) : null;
  const ready = new Map();
  const readyOf = (d) => { if (!ready.has(d.id)) ready.set(d.id, readiness(app.db, app.state, d.id, rem)); return ready.get(d.id); };
  const plannedSoon = (d) => findInPlan(app.state, d.id, { exclude: date, from: today }).some((w) => w <= addDays(today, 6));
  const fresh = new Map();
  const freshOf = (d) => { if (!fresh.has(d.id)) fresh.set(d.id, boughtIn(app, d, bought)); return fresh.get(d.id); };
  const current = app.state.plan?.[date]?.status === 'planned' ? app.state.plan[date].dinner : null;
  // In the evening a thaw says when dinner would be on the table.
  const now = tonight ? minutesIn() : 0;
  const eatAt = (d, r) => (tonight && now >= 15 * 60 && r.thaw.length ? clockText(now + Math.max(...r.thaw.map((x) => x.minutes)) + (Number(d.minutes) || 30)) : '');
  // Tonight's picker: ready now, ready after a thaw, this week's dinners (a trade), then the rest.
  // Cook from what we have: ready now, after a thaw, what the receipt just brought home, then the
  // closest. "Ready" means the sides too, as in the recipe box's Can make now (gauntlet r8: one answer).
  const group = (d) => {
    if (!tonight) return 'rest';
    const r = readyOf(d);
    if (r.makeable) return r.thaw.length ? 'thaw' : 'ready';
    if (have) return freshOf(d).length ? 'bought' : 'rest';
    return plannedSoon(d) ? 'week' : 'rest';
  };
  const ORDER = have ? ['ready', 'thaw', 'bought', 'rest'] : ['ready', 'thaw', 'week', 'rest'];
  // Closest means closest: a missing main (the pulled pork, the deli Alfredo) is far; a missing side
  // or a clove of garlic is near (gauntlet r8).
  const need = (d) => {
    if (!tonight) return 0;
    const r = readyOf(d);
    return (r.missing.length - r.keyMissing) + r.keyMissing * 4 + r.sideOut.length * 0.3 + (r.thaw.length ? Math.max(...r.thaw.map((x) => x.minutes)) / 600 : 0);
  };
  const rank = (d) => ORDER.indexOf(group(d));
  // The dinner already on this night isn't a choice for it (gauntlet r8), except in Cook from what we
  // have, where tonight's dinner is one of the answers.
  const list = rotationList(app.db, app.state)
    .filter((d) => have || d.id !== current)
    .filter((d) => !q || d.title.toLowerCase().includes(q) || d.category.toLowerCase().includes(q) || d.protein.includes(q))
    .sort((a, b) => (rank(a) - rank(b)) || (freshOf(b).length - freshOf(a).length) || (need(a) - need(b)) || (isFavorite(app.state, b) - isFavorite(app.state, a)) || a.title.localeCompare(b.title));
  const lefts = tonight && !q ? leftoversOnHand(app.state, today).filter((l) => !l.night && l.daysLeft >= 0 && l.servings >= 3 && l.date !== today) : [];
  const leftsFull = lefts.filter((l) => l.servings >= FAMILY_SIZE);
  const leftsShort = lefts.filter((l) => l.servings < FAMILY_SIZE);
  // The heading names what came home: "Uses the chicken breasts and shredded cheddar you just bought".
  const boughtUsed = [...new Set(list.filter((d) => group(d) === 'bought').flatMap((d) => freshOf(d)))];
  const boughtNames = boughtUsed.length > 3 ? `${listJoin(boughtUsed.slice(0, 2).map((id) => shortName(app, id)))} and more` : listJoin(boughtUsed.map((id) => shortName(app, id)));
  const HEADS = {
    ready: 'Ready now',
    thaw: 'Ready after thawing',
    bought: `Uses the ${boughtNames} you just bought`,
    week: 'This week’s dinners (they trade places)',
    rest: have ? (bought?.size ? 'Everything else, closest first' : 'Closest first') : 'Everything else',
  };
  let first = true;
  const autof = () => { const a = first ? html`data-autofocus` : ''; first = false; return a; };
  const row = (d, extra = '') => {
    const r = tonight ? readyOf(d) : null;
    const where = d.id === current ? date : findInPlan(app.state, d.id, { exclude: date, from: today, near: date })[0];
    const off = planStore !== 'both' && !dinnerFeasibleAt(app.db, app.state, d.id, planStore);
    const facts = !tonight && showNutrition(app) ? plate(app, d.id, null) : null;
    const c = costOf(app, d.id, null);
    // One meta line at 390px: the star sits by the name, and "≈ $2.67 a serving" (gauntlet r7).
    const cost = c?.perServing > 0 ? `≈ ${money(c.perServing)} a serving` : '';
    const whereText = where ? (d.id === current ? 'on for tonight' : `on ${relativeDay(where, today).toLowerCase() === 'tonight' ? 'tonight' : shortWeekday(where)}${tonight ? '' : ' (they’ll trade)'}`) : '';
    const time = timeLabel(d);
    const meta = [time, whereText, off ? `needs ${planStore === 'jewel' ? "Sam's" : 'Jewel'}` : '', cost].filter(Boolean);
    const fav = isFavorite(app.state, d);
    // The star stays with the last word, so a long name doesn't leave it on a line of its own (gauntlet r8).
    const words = d.title.split(' ');
    const last = words.pop();
    const name = fav ? html`${words.length ? `${words.join(' ')} ` : ''}<span class="pick-last">${last}<span class="pick-fav">${ic('star', { size: 14 })}<span class="sr-only">, family favorite</span></span></span>` : d.title;
    const tone = !r ? '' : r.makeable && !r.thaw.length ? 'is-ready' : r.makeable ? 'is-thaw' : 'is-need';
    return html`<li><button type="button" class="pick-row" data-action="${have ? 'have:choose' : 'pick:choose'}" data-date="${date}" data-dinner="${d.id}" ${extra} ${autof()}>
      ${dinnerPhoto(app, d, { size: 'thumb' })}
      <span class="pick-main"><b>${name}</b>
        ${when(r, () => html`<small class="pick-ready ${tone}">${tone === 'is-ready' ? ic('checkCircle', { size: 14 }) : tone === 'is-thaw' ? ic('snow', { size: 14 }) : ''}${readyText(r, { eatAt: eatAt(d, r) })}</small>`)}
        <small class="pick-meta">${meta.map((m, k) => html`${k ? ' · ' : ''}<span class="pick-meta-part ${m === time && /,/.test(m) ? 'is-wrap' : ''}">${m}</span>`)}</small>
        ${when(facts, () => html`<small class="pick-nutri">≈ ${fmtKcal(facts.kcal)} cal, ${Math.round(facts.protein)} g protein a plate${leanMark(facts, { compact: true })}</small>`)}</span>
    </button></li>`;
  };
  // Real headings, so a screen reader can jump between the groups (WCAG 1.3.1, gauntlet r7).
  const head = (text) => html`<li class="pick-head"><h3>${text}</h3></li>`;
  // Leftovers that feed all five come first; a few servings go after the ready dinners (gauntlet r8).
  const leftRows = (ls) => (ls.length ? html`${head('Leftovers')}${ls.map((l) => { const enough = l.servings >= FAMILY_SIZE; return html`<li><button type="button" class="pick-row pick-left" data-action="leftovers:night-set" data-from="${l.date}" data-night="${date}" ${autof()}>
          <span class="pick-ic" aria-hidden="true">${ic('bowl', { size: 22 })}</span>
          <span class="pick-main"><b><span class="sr-only">Leftovers: </span>${l.title}</b><small class="pick-ready ${enough ? 'is-ready' : 'is-need'}">${servingsText(l.servings)} in the fridge${enough ? '. Nothing to cook' : `, not enough for all ${FAMILY_SIZE} on its own`}.</small></span></button></li>`; })}` : '');
  const groups = tonight && !q ? ORDER.map((g) => ({ g, items: list.filter((d) => group(d) === g) })).filter((x) => x.items.length) : [{ g: null, items: list }];
  const noneReady = have && !q && !list.some((d) => readyOf(d).makeable);
  const capped = have && !q && !st.all;
  const groupHtml = (x) => {
    const cut = capped && x.g === 'rest' && x.items.length > HAVE_SHOW + 2;
    const shown = cut ? x.items.slice(0, HAVE_SHOW) : x.items;
    return html`${when(x.g, () => head(HEADS[x.g]))}${shown.map((d, k) => row(d, st.all && x.g === 'rest' && k === HAVE_SHOW ? html`id="pick-more-first"` : ''))}${when(cut, () => html`<li class="pick-more-li"><button type="button" class="btn btn-quiet btn-block pick-more" data-action="pick:all">Show ${x.items.length - HAVE_SHOW} more dinners</button></li>`)}`;
  };
  const shortAt = groups.findIndex((x) => x.g !== 'ready' && x.g !== 'thaw');
  return html`
    ${when(noneReady, () => html`<p class="have-none">${ic('info', { size: 18 })}<span>Nothing is all in the house yet. These need the fewest things.</span></p>`)}
    <label class="search">${ic('search', { size: 20 })}<input type="search" placeholder="Search dinners" value="${query || ''}" data-input="pick:query" data-date="${date}" aria-label="Search dinners" autocomplete="off"></label>
    <ul class="pick-list">
      ${leftRows(leftsFull)}
      ${list.length ? groups.map((x, k) => html`${when(k === (shortAt < 0 ? groups.length : shortAt), () => leftRows(leftsShort))}${groupHtml(x)}`)
        : html`<li class="muted pad">${q ? `No dinners match “${query}”. Try another word, or browse the recipe box.` : 'Nothing is on the menu. Bring some back from Recipes, Not for us.'}</li>`}
      ${when(list.length && shortAt < 0, () => leftRows(leftsShort))}
    </ul>
    ${when(have, () => html`<div class="have-acts">
      <button type="button" class="btn btn-secondary" data-action="ahead:open" data-pantry="1">${ic('sparkle', { size: 20 })}Plan the week from the pantry</button>
      <button type="button" class="btn btn-quiet" data-action="ideas:open">${ic('camera', { size: 20 })}New ideas from Claude</button>
    </div>`)}`;
}

export function openPick(app, date, title, { have = false, bought = null, st: keep = null, focusDinner = null } = {}) {
  const st = keep || { date, query: '', have, bought, all: false, title };
  openPick.state = st;
  openSheet({
    id: `pick:${date}${have ? ':have' : ''}`,
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
      // Back from "Make it tonight anyway?": the row you tapped, not the top of a long list (gauntlet r8).
      if (focusDinner) requestAnimationFrame(() => el.querySelector(`.pick-row[data-dinner="${CSS.escape(focusDinner)}"]`)?.focus());
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
    if (!ok) return false;
  }
  // A dinner it bumps moves to the next open night in the same change, so it's one decision with one
  // Undo (gauntlet r8: a second "What about …?" sheet, where closing it dropped the dinner).
  const res = placeDinnerOps(app.db, app.state, { dinnerId, date, fromDate, who: app.who(), today });
  if (!app.commit(res)) return false;
  closeSheet();
  return true;
}

/** What happens to the dinner already on `date`, in one sentence, before the family says yes. */
function bumpText(app, dinnerId, date) {
  const today = app.today();
  const res = placeDinnerOps(app.db, app.state, { dinnerId, date, who: app.who(), today });
  if (res.error || !res.ops.length) return '';
  const cur = app.state.plan?.[date]?.dinner;
  const t = dinnerById(app.db, app.state, cur)?.title;
  if (!t) return '';
  if (res.kind === 'swap') return `${t} moves to ${nightName(res.other, today)}.`;
  if (res.kind === 'replace') return res.movedTo ? `${t} moves to ${nightName(res.movedTo, today)}.` : `${t} comes off the plan.`;
  return '';
}

// ---------------------------------------------------------------- move to another night

export function openMove(app, fromDate) {
  const today = app.today();
  const e = app.state.plan?.[fromDate];
  const d = dinnerById(app.db, app.state, e?.dinner);
  if (!d) return;
  const start = today;
  // A night already gone by can only move forward into an empty night: trading would push another
  // dinner into the past (gauntlet r2). And a night never offers a trade with the same dinner.
  const pastFrom = fromDate < today;
  const nights = datesBetween(start, addDays(start, 27)).filter((x) => x !== fromDate && app.state.plan?.[x]?.dinner !== d.id
    && (!pastFrom || !(app.state.plan?.[x]?.dinner && app.state.plan[x].status !== 'away')));
  openSheet({
    id: `move:${fromDate}`,
    size: 'tall',
    title: `Move ${d.title}`,
    subtitle: pastFrom ? 'Pick a night with nothing planned.' : 'If that night has a dinner, they trade places.',
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
  const adding = slot >= sideSlotsFor(d) && !app.state.substitutions?.[dinnerId]?.[String(slot)];
  // From a night, a change is for that night unless you say every time (gauntlet r4). A slot with a
  // remembered side, an added side, or the recipe page (no night) can only change it every time.
  const canNight = !!date && !adding && app.state.plan?.[date]?.dinner === dinnerId && !app.state.substitutions?.[dinnerId]?.[String(slot)];
  const st = { tab: 'box', qty: {}, newName: '', newQty: 2, newUnit: 'cans', scope: canNight ? 'night' : 'always', canNight };
  openSheet({
    id: `sub:${dinnerId}:${slot}`,
    size: 'tall',
    title: adding ? `Add a side to ${d.title}` : 'Change side',
    subtitle: adding ? 'Remembered every time it’s on the menu.' : canNight ? `For ${d.title}.` : `For ${d.title}. Remembered every time it’s on the menu.`,
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
  // What can be made from the house comes first, and every side says so (gauntlet r6: a missing side
  // sent you hunting through 30 names).
  const canMake = new Map();
  const missingFor = (s) => { if (!canMake.has(s.id)) canMake.set(s.id, pantryCheck(app.db, app.state, s.items || {}).missing); return canMake.get(s.id); };
  const sides = app.db.sideList.filter((s) => s.id !== current?.ref && !other.includes(s.id) && !isSideDropped(app.state, s.id))
    .sort((a, b) => (Math.min(missingFor(a).length, 3) - Math.min(missingFor(b).length, 3)) || a.title.localeCompare(b.title));
  const shelf = shelfItems(app);
  const nm = (x) => midSentence(app.db.ingredients[x.id]?.short || String(x.name || '').replace(/\s*\(.*?\)\s*/g, ' ').replace(/,.*$/, '').trim());
  return html`
    ${when(current, () => html`<div class="current-side">
      ${sidePhoto(app, current, { size: 'thumb' })}
      <span><small>${remembered ? 'Now (remembered)' : 'Now'}</small><b>${current.info?.title}</b></span>
      ${when(remembered, () => html`<button type="button" class="btn btn-small btn-quiet" data-action="side:reset" data-dinner="${d.id}" data-slot="${slot}">${slot >= sideSlotsFor(d) ? 'Remove' : 'Reset to the recipe’s side'}</button>`)}
    </div>`)}
    <div class="seg" role="tablist" aria-label="Where the side comes from">
      <button type="button" role="tab" aria-selected="${tf(st.tab === 'box')}" class="seg-opt ${st.tab === 'box' ? 'is-on' : ''}" data-sub-tab="box">Recipe box</button>
      <button type="button" role="tab" aria-selected="${tf(st.tab === 'shelf')}" class="seg-opt ${st.tab === 'shelf' ? 'is-on' : ''}" data-sub-tab="shelf">From the pantry</button>
    </div>
    ${st.tab === 'box'
      ? html`<ul class="pick-list">${sides.map((s) => html`<li><button type="button" class="pick-row" data-action="side:use" data-dinner="${d.id}" data-slot="${slot}" data-date="${date || ''}" data-ref="${s.id}">
          ${sidePhoto(app, { parsed: { type: 'side', id: s.id }, info: { kind: s.kind } }, { size: 'thumb' })}
          <span class="pick-main"><b>${s.title}</b>${(() => { const m = missingFor(s); return m.length ? html`<small class="pick-ready is-need">Needs ${m.length <= 2 ? listJoin(m.map((x) => nm(x))) : `${nm(m[0])} and ${m.length - 1} more`}</small>` : html`<small class="pick-ready is-ready">${ic('checkCircle', { size: 14 })}All in the house</small>`; })()}<small>${s.minutes ? fmtMinutes(s.minutes) : ''}${s.kind ? `${s.minutes ? ', ' : ''}${s.kind}` : ''}${(() => { const sn = showNutrition(app) ? sideNutrition(app.db, app.state, { type: 'side', id: s.id }) : null; return sn ? `, ${fmtKcal(sn.kcal)} cal a plate` : ''; })()}</small></span></button></li>`)}</ul>`
      : html`
        ${shelf.length ? html`<ul class="shelf-list">${shelf.map((it) => {
          const q = st.qty[it.id] ?? Math.min(defaultQty(it.unit), typeof it.have === 'number' ? it.have : defaultQty(it.unit));
          return html`<li class="shelf-row">
            <span class="shelf-name"><b>${it.name}</b><small>${typeof it.have === 'number' ? `${fmtQty(it.have)} ${it.unit} on the shelf` : 'Stocked'}</small></span>
            ${stepper({ value: fmtQty(q), step: it.unit === 'lb' ? 0.5 : 1, min: 0.5, action: 'side:qty', data: { id: it.id }, unit: it.unit, label: `How much ${it.name}` })}
            <button type="button" class="btn btn-small btn-primary" data-action="side:use" data-dinner="${d.id}" data-slot="${slot}" data-date="${date || ''}" data-ref="${shelfRef(it.type, it.id, q)}">Use</button>
          </li>`;
        })}</ul>` : html`<p class="sheet-text">Nothing measured is in the pantry yet. Add what’s on the shelf below, or scan the pantry from the Pantry tab.</p>`}
        <form class="form form-inline-card" data-submit="side:new" data-dinner="${d.id}" data-slot="${slot}" data-date="${date || ''}">
          <p class="field-label">Something else on the shelf</p>
          <input class="input" name="name" placeholder="Canned green beans" required maxlength="60" aria-label="Item name">
          <div class="field-row">
            <input class="input" name="qty" type="number" inputmode="decimal" min="0.25" step="0.25" value="2" aria-label="Amount">
            <select class="input" name="unit" aria-label="Unit">${['cans', 'lb', 'oz', 'bags', 'boxes', 'jars', 'each'].map((u) => html`<option>${u}</option>`)}</select>
          </div>
          <button type="submit" class="btn btn-secondary btn-block">Use it as the side</button>
        </form>`}
    ${when(st.canNight, () => html`<div class="set-row sub-scope">
      <span class="set-label">Use it every time<small>${st.scope === 'always' ? `Whenever ${d.title} is on the menu.` : `Off: just ${date === app.today() ? 'tonight' : weekdayName(date)}.`}</small></span>
      ${switchToggle({ on: st.scope === 'always', action: 'side:scope', label: `Use it every time for ${d.title}` })}
    </div>`)}`;
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
            <span class="move-day"><b>${dayWord(x, today)}</b><small>${shortDate(x)}</small></span><span class="move-what">${td ? `Instead of ${td.title}` : 'Nothing planned'}</span>${ic('right', { size: 18 })}
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
    title: 'Use the leftovers',
    get subtitle() { const l = leftoversOnHand(app.state, app.today()).find((x) => x.date === from); return l ? `${servingsText(l.servings)} of ${l.title}, ${useByText(l, app.today())}.` : ''; },
    render: () => {
      const today = app.today();
      const l = leftoversOnHand(app.state, today).find((x) => x.date === from);
      if (!l) return html`<p class="sheet-text">Those leftovers are gone.</p><div class="sheet-actions"><button type="button" class="btn btn-primary btn-block" data-action="sheet:close">OK</button></div>`;
      // After 2 PM today's lunch has been eaten, so the choices start tomorrow (gauntlet r3).
      const lunches = leftoverLunchChoices(app.db, app.state, { from, today, after: hourIn() >= 14 ? addDays(today, 1) : today });
      const plates = Math.max(1, Math.min(l.servings, st.plates ?? l.servings));
      const nights = l.night ? [] : leftoverNightChoices(app.state, l, today);
      return html`
        <div class="action-list">
          <button type="button" class="action-row" data-action="leftovers:ate" data-date="${from}">${ic('bowl')}<span><b>Someone ate a serving</b><small>${servingsText(Math.max(0, l.servings - 1))} left after that.</small></span></button>
          ${when(l.servings >= 3 && nights.length, () => html`<button type="button" class="action-row" data-action="leftovers:night" data-date="${from}">${ic('tonight')}<span><b>Make them dinner one night</b><small>Instead of cooking; that dinner moves.</small></span></button>`)}
        </div>
        ${when(lunches.length, () => html`<h3 class="sheet-h">For a lunch</h3>
          <div class="action-list left-choices">${lunches.map((c) => html`<button type="button" class="action-row" data-action="leftovers:lunch" data-from="${from}" data-name="${c.name}" data-to="${c.date}">${ic('lunch')}<span><b>${c.name}’s lunch ${dayName(c.date, today)}</b><small>One serving, instead of the packed lunch.</small></span></button>`)}</div>`)}
        <h3 class="sheet-h">Or freeze them</h3>
        <div class="left-freeze">
          <span class="qty-edit"><button type="button" class="stepper-btn" data-action="leftovers:plates" data-delta="-1" aria-label="One plate less" ${plates <= 1 ? 'disabled' : ''}>${ic('minus', { size: 18 })}</button>
            <b class="left-n" aria-live="polite">${plates}</b>
            <button type="button" class="stepper-btn" data-action="leftovers:plates" data-delta="1" aria-label="One plate more" ${plates >= l.servings ? 'disabled' : ''}>${ic('plus', { size: 18 })}</button></span>
          <button type="button" class="btn btn-secondary" data-action="leftovers:freeze" data-from="${from}" data-n="${plates}">${ic('snow', { size: 20 })}Freeze ${plates === 1 ? '1 plate' : `${plates} plates`}</button>
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
    const fromHave = /:have$/.test(sheetId() || '');
    if (!app.commit(leftoverNightOps(app.db, app.state, { from: el.dataset.from, night: el.dataset.night, who: app.who(), today: app.today() }))) return;
    if (fromHave) { closeSheet({ instant: true }); app.navigate('#/tonight'); } else closeSheet();
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
  'have:open': (app) => openHave(app),
  // A pick from Cook from what we have: a dinner that's still short asks first, and either way the
  // family lands on Tonight to see it (gauntlet r7: you were left on the Budget page).
  'have:choose': async (app, el) => {
    const today = app.today();
    const dinnerId = el.dataset.dinner;
    const st = openPick.state;
    const toTonight = () => { closeSheet({ instant: true }); app.navigate('#/tonight'); };
    const cur = app.state.plan?.[today];
    if (cur?.dinner === dinnerId && cur.status === 'planned') { toTonight(); return; }
    const r = readiness(app.db, app.state, dinnerId);
    if (!r.ready) {
      // One question that says everything: what's missing and where tonight's dinner goes. Focus starts
      // on Cancel, and Cancel goes back to the row you tapped (gauntlet r8).
      const d = dinnerById(app.db, app.state, dinnerId);
      const bump = bumpText(app, dinnerId, today);
      const ok = await confirmSheet({
        title: `${d?.title || 'This dinner'} needs ${r.missing.length === 1 ? 'one thing' : `${r.missing.length} things`}`,
        body: `Not in the house: ${listJoin(r.missing.map((x) => midSentence(x)))}.${bump ? ` ${bump}` : ''} Make it tonight anyway?`,
        confirm: 'Make it tonight',
        safe: true,
        onCancel: st ? () => openPick(app, today, st.title, { have: true, st, focusDinner: dinnerId }) : null,
      });
      if (!ok) return;
    }
    // Either way the family lands on Tonight to see it, with one toast and one Undo (gauntlet r7, r8).
    if (await place(app, { dinnerId, date: today })) toTonight();
  },
  'pick:all': () => {
    const st = openPick.state;
    if (!st) return;
    st.all = true;
    renderSheet();
    requestAnimationFrame(() => document.getElementById('pick-more-first')?.focus());
  },
  'side:scope': () => { const st = openSubstitute.state; if (st?.canNight) { st.scope = st.scope === 'always' ? 'night' : 'always'; renderSheet(); } },
  'side:use': (app, el) => {
    const st = openSubstitute.state;
    const date = el.dataset.date;
    app.commit(st?.scope === 'night' && date
      ? nightSideOps(app.db, app.state, { date, dinnerId: el.dataset.dinner, slot: Number(el.dataset.slot), ref: el.dataset.ref })
      : substituteOps(app.db, app.state, { dinnerId: el.dataset.dinner, slot: Number(el.dataset.slot), ref: el.dataset.ref }));
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
    const args = { dinnerId: form.dataset.dinner, slot: Number(form.dataset.slot), ref: shelfRef('custom', c.id, qty) };
    app.commit(openSubstitute.state?.scope === 'night' && form.dataset.date
      ? nightSideOps(app.db, app.store.state, { ...args, date: form.dataset.date })
      : substituteOps(app.db, app.store.state, args));
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
    const later = Object.entries(app.state.plan || {}).filter(([dt, x]) => dt > app.today() && x?.dinner === el.dataset.id && x.status === 'planned').map(([dt]) => dt).sort();
    if (r.retired && !(await confirmOff(app, { title: dinnerById(app.db, app.state, el.dataset.id)?.title, promoted: r.promoted ? dinnerById(app.db, app.state, r.promoted)?.title : null, nights: r.replacedNights || 0, dates: later }))) return;
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
  'prep:done': (app, el) => {
    // The ticked job leaves the card, so focus goes to the next job's box, or the "done" line after the
    // last one, never back to the top of the page (gauntlet r5, WCAG 2.4.3).
    const card = el.closest('.prep-card') || document;
    const boxes = [...card.querySelectorAll('.prep-check')];
    const at = boxes.indexOf(el);
    const cardId = card.id;
    // The last one: the redraw itself lands on the "done" line (and a later redraw keeps it there).
    if (at >= boxes.length - 1 && boxes.length <= 1) app.ui.focusNext = (card.querySelector?.('.prep-done-line')?.id) || `prep-done-${(cardId || '').replace('prep-card-', '')}`;
    if (!app.commit(prepDoneOps(app.state, { date: el.dataset.date, key: el.dataset.key, who: app.who(), today: app.today() }))) return;
    requestAnimationFrame(() => setTimeout(() => {
      const root = (cardId && document.getElementById(cardId)) || document;
      const next = [...root.querySelectorAll('.prep-check')][Math.max(0, at)] || root.querySelector('.prep-done-line');
      next?.focus({ preventScroll: false });
    }, 30));
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
